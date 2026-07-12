'use strict'

const { createCommandService } = require('../commands')
const { normalizeDestination } = require('../action-service')

module.exports = {
  name: 'commands',

  setup (context) {
    const tasks = context.requireService('tasks')
    const actions = context.requireService('actions')
    const commands = createCommandService(
      context.bot,
      context.config,
      context.logger,
      tasks,
      context.pluginConfig
    )

    context.provideService('commands', commands)
    context.addCleanup(() => commands.dispose())

    registerBuiltInCommands(commands, tasks, actions, {
      statusEffects: context.getService('statusEffects'),
      teams: context.getService('teams'),
      pvp: context.getService('pvp'),
      follow: context.getService('follow')
    })
  }
}

function registerBuiltInCommands (commands, tasks, actions, services = {}) {
  const { statusEffects, teams, pvp, follow, plugins } = services
  commands.register('help', {
    description: 'List commands or explain one command.',
    usage: '!help [command]',
    async run ({ args, prefix }) {
      if (args[0]) {
        const command = commands.get(args[0])
        if (!command) return `Unknown command "${args[0]}".`
        return `${command.usage} — ${command.description}`
      }

      const names = commands.list().map(command => `${prefix}${command.name}`)
      return `Commands: ${names.join(', ')}`
    }
  })

  commands.register('ping', {
    description: 'Check whether the bot is responsive.',
    statusReport: true,
    async run () { return 'Pong!' }
  })

  commands.register('pos', {
    aliases: ['position'],
    description: 'Show the bot\'s current coordinates.',
    statusReport: true,
    async run ({ bot }) {
      const { x, y, z } = bot.entity.position
      return `Position: ${x.toFixed(1)}, ${y.toFixed(1)}, ${z.toFixed(1)}.`
    }
  })

  commands.register('queue', {
    aliases: ['tasks'],
    description: 'Show the current task and pending queue.',
    statusReport: true,
    async run () {
      const state = tasks.list()
      const current = state.current ? `Current #${state.current.id}: ${state.current.name}` : 'Current: none'
      const pending = state.pending.length > 0
        ? `Pending: ${state.pending.slice(0, 8).map(task => `#${task.id} ${task.name}`).join('; ')}`
        : 'Pending: none'
      return `${current}. ${pending}.`
    }
  })

  if (plugins) {
    commands.register('plugins', {
      description: 'Inspect loaded plugins and the services they provide.',
      usage: '!plugins [info <name>|services]',
      async run ({ args, username }) {
        if (!plugins.canInspect(username)) {
          throw new Error('Plugin diagnostics require an explicit allowedUsers entry.')
        }
        const operation = String(args[0] || 'list').toLowerCase()

        if (operation === 'services') {
          const registered = plugins.listServices()
          return registered.length > 0
            ? `Services: ${registered.map(service => `${service.name} (${service.owner})`).join(', ')}.`
            : 'Services: none.'
        }

        if (operation === 'info') {
          const name = String(args[1] || '').trim()
          if (!name) throw new Error('Usage: plugins info <name>')
          const plugin = plugins.describe(name)
          if (!plugin) return `Plugin "${name}" is not loaded.`
          return `Plugin ${plugin.name}: ${plugin.status}; source: ${plugin.source}; services: ${plugin.services.join(', ') || 'none'}.`
        }

        if (operation !== 'list') throw new Error('Usage: plugins [info <name>|services]')
        const loaded = plugins.list()
        return loaded.length > 0
          ? `Plugins: ${loaded.map(plugin => `${plugin.name} (${plugin.status})`).join(', ')}.`
          : 'Plugins: none.'
      }
    })
  }

  commands.register('stop', {
    aliases: ['cancel'],
    description: 'Cancel your currently running task.',
    async run ({ username }) {
      const cancelled = tasks.cancelCurrent(
        `Cancelled by ${username}.`,
        task => task.source === 'user' && task.metadata.username === username
      )
      return cancelled ? 'Cancelling your current task.' : 'You do not have a cancellable task running.'
    }
  })

  commands.register('clear', {
    description: 'Remove your pending tasks from the queue.',
    async run ({ username }) {
      const ids = tasks.cancelPending(
        task => task.source === 'user' && task.metadata.username === username,
        `Cleared by ${username}.`
      )
      return ids.length > 0 ? `Cleared ${ids.length} pending task(s).` : 'You have no pending tasks.'
    }
  })

  commands.register('goto', {
    aliases: ['go'],
    description: 'Pathfind to coordinates.',
    usage: '!goto <x> <y> <z> [range]',
    createTask ({ args }) {
      requireArgs(args, 3, 'goto <x> <y> <z> [range]')
      const [x, y, z] = args.slice(0, 3).map(parseFiniteNumber)
      const range = args[3] == null ? 1 : parseNonNegativeInteger(args[3])
      return queuedTask(`go to ${x}, ${y}, ${z}`, ({ signal }) =>
        actions.gotoPosition({ x, y, z, range }, signal)
      )
    }
  })

  commands.register('come', {
    aliases: ['comehere'],
    description: 'Pathfind to the player who sent the command.',
    usage: '!come [range]',
    createTask ({ args, username }) {
      const range = args[0] == null ? 2 : parseNonNegativeInteger(args[0])
      return queuedTask(`go to ${username}`, ({ signal }) =>
        actions.gotoEntity(`player:${username}`, { range }, signal)
      )
    }
  })

  if (follow) {
    commands.register('follow', {
      aliases: ['followplayer'],
      description: 'Start, stop, toggle, or inspect persistent player-follow mode.',
      usage: '!follow [player|me|on|off|toggle|status] [range]',
      statusReport: ({ args }) => !args[0] || ['status', 'state'].includes(String(args[0]).toLowerCase()),
      async run ({ args, username }) {
        const request = parseFollowCommand(args, username)

        if (request.operation === 'status') return formatFollowStatus(follow.getStatus())
        if (request.operation === 'off') {
          const stopped = follow.stop(`Follow mode disabled by ${username}.`)
          return stopped ? 'Follow mode disabled.' : 'Follow mode is already disabled.'
        }
        if (request.operation === 'toggle') {
          if (follow.isActive()) {
            follow.stop(`Follow mode toggled off by ${username}.`)
            return 'Follow mode disabled.'
          }
          return formatFollowStatus(follow.start(request.target, {
            range: request.range,
            requestedBy: username
          }))
        }

        return formatFollowStatus(follow.start(request.target, {
          range: request.range,
          requestedBy: username
        }))
      }
    })
  }

  commands.register('leftblock', {
    aliases: ['left-click-block', 'punchblock'],
    description: 'Left-click a block at coordinates.',
    usage: '!leftblock <x> <y> <z>',
    createTask ({ args }) {
      const position = parseBlockPosition(args, 'leftblock <x> <y> <z>')
      return queuedTask(`left-click block at ${position.x}, ${position.y}, ${position.z}`, ({ signal }) =>
        actions.leftClickBlock(position, {}, signal)
      )
    }
  })

  commands.register('rightblock', {
    aliases: ['right-click-block', 'useblock'],
    description: 'Right-click a block at coordinates.',
    usage: '!rightblock <x> <y> <z>',
    createTask ({ args }) {
      const position = parseBlockPosition(args, 'rightblock <x> <y> <z>')
      return queuedTask(`right-click block at ${position.x}, ${position.y}, ${position.z}`, ({ signal }) =>
        actions.rightClickBlock(position, {}, signal)
      )
    }
  })

  commands.register('leftentity', {
    aliases: ['left-click-entity', 'attack'],
    description: 'Left-click a visible entity by player name, type, or id:<number>.',
    usage: '!leftentity <selector>',
    createTask ({ args }) {
      requireArgs(args, 1, 'leftentity <selector>')
      const selector = args.join(' ')
      if (!pvp) throw new Error('PvP is disabled, so entity attacks are unavailable.')
      const target = actions.resolveEntity(selector)
      if (!pvp.canAttack(target)) throw new Error('PvP mode is disabled, or the target is a teammate/non-hostile entity.')
      return queuedTask(`left-click entity ${selector}`, ({ signal }) =>
        actions.leftClickEntity(selector, signal)
      )
    }
  })

  commands.register('rightentity', {
    aliases: ['right-click-entity', 'useentity'],
    description: 'Right-click a visible entity by player name, type, or id:<number>.',
    usage: '!rightentity <selector>',
    createTask ({ args }) {
      requireArgs(args, 1, 'rightentity <selector>')
      const selector = args.join(' ')
      return queuedTask(`right-click entity ${selector}`, ({ signal }) =>
        actions.rightClickEntity(selector, {}, signal)
      )
    }
  })

  commands.register('jump', {
    description: 'Hold jump for a duration in milliseconds.',
    usage: '!jump [milliseconds]',
    createTask ({ args }) {
      const duration = args[0] == null ? 450 : parseDuration(args[0])
      return queuedTask(`jump for ${duration} ms`, ({ signal }) => actions.jump(duration, signal))
    }
  })

  commands.register('sneak', {
    aliases: ['crouch'],
    description: 'Sneak for a duration, or turn sneaking on/off.',
    usage: '!sneak [milliseconds|on|off]',
    createTask ({ args }) {
      const value = String(args[0] || '1000').toLowerCase()
      if (['on', 'true', 'start'].includes(value)) {
        return queuedTask('enable sneaking', ({ signal }) => actions.setSneaking(true, signal))
      }
      if (['off', 'false', 'stop'].includes(value)) {
        return queuedTask('disable sneaking', ({ signal }) => actions.setSneaking(false, signal))
      }
      const duration = parseDuration(value)
      return queuedTask(`sneak for ${duration} ms`, ({ signal }) => actions.sneak(duration, signal))
    }
  })

  commands.register('equip', {
    description: 'Equip an inventory item to a hand or armor slot.',
    usage: '!equip <item> [hand|off-hand|head|torso|legs|feet]',
    createTask ({ args }) {
      requireArgs(args, 1, 'equip <item> [destination]')
      let destination = 'hand'
      let itemArgs = [...args]
      const last = args[args.length - 1]

      try {
        const parsedDestination = normalizeDestination(last)
        if (args.length > 1) {
          destination = parsedDestination
          itemArgs = args.slice(0, -1)
        }
      } catch (_) {}

      const item = itemArgs.join(' ')
      return queuedTask(`equip ${item} to ${destination}`, ({ signal }) =>
        actions.equipItem(item, destination, signal)
      )
    }
  })

  commands.register('armor', {
    aliases: ['equiparmor'],
    description: 'Equip a named armor item, or the best armor in the inventory.',
    usage: '!armor [best|item]',
    createTask ({ args }) {
      const item = args.length > 0 ? args.join(' ') : 'best'
      return queuedTask(`equip armor: ${item}`, ({ signal }) => actions.equipArmor(item, signal))
    }
  })

  if (statusEffects) {
    commands.register('effect', {
      aliases: ['status'],
      description: 'Check whether a status effect is currently applied.',
      usage: '!effect <name|id>',
      statusReport: true,
      async run ({ args }) {
        requireArgs(args, 1, 'effect <name|id>')
        const query = args.join(' ')
        const descriptor = statusEffects.resolve(query)
        const active = statusEffects.get(descriptor)
        if (!active) return `${descriptor.displayName || descriptor.name} is not active.`
        return `${descriptor.displayName || descriptor.name} is active at level ${Number(active.amplifier) + 1} for ${active.duration} tick(s).`
      }
    })
  }

  if (teams) {
    commands.register('teammates', {
      aliases: ['team'],
      description: 'Manage the custom teammate list; "near" replaces it with players within seven blocks.',
      usage: '!teammates <near|list|clear> [radius]',
      statusReport: ({ args }) => !args[0] || String(args[0]).toLowerCase() === 'list',
      async run ({ args }) {
        const operation = String(args[0] || 'list').toLowerCase()
        if (operation === 'near') {
          const radius = args[1] == null ? 7 : parseNonNegativeNumber(args[1])
          const names = teams.replaceWithNearbyPlayers(radius)
          return names.length > 0
            ? `Teammates redefined from players within ${radius} blocks: ${names.join(', ')}.`
            : `No players were within ${radius} blocks; the teammate list is now empty.`
        }
        if (operation === 'clear') {
          teams.clear()
          return 'The custom teammate list is now empty.'
        }
        if (operation === 'list') {
          const names = teams.list()
          return names.length > 0 ? `Custom teammates: ${names.join(', ')}.` : 'The custom teammate list is empty.'
        }
        throw new Error('Usage: teammates <near|list|clear> [radius]')
      }
    })
  }

  if (pvp) {
    commands.register('pvp', {
      description: 'Set PvP mode on, off, or back to automatic entry-point rules.',
      usage: '!pvp [on|off|auto|status]',
      statusReport: ({ args }) => !args[0] || String(args[0]).toLowerCase() === 'status',
      async run ({ args }) {
        const mode = String(args[0] || 'status').toLowerCase()
        const status = mode === 'status' ? pvp.getStatus() : pvp.setMode(mode)
        return `PvP mode: ${status.mode}; active: ${status.active ? 'yes' : 'no'}; target: ${status.target || 'none'}.`
      }
    })
  }
}

function queuedTask (name, run) {
  return {
    name,
    priority: 0,
    source: 'user',
    interruptible: true,
    resumeOnInterrupt: true,
    run
  }
}

function parseFollowCommand (args, username) {
  const first = String(args[0] || 'status').trim()
  const operation = first.toLowerCase()

  if (['status', 'state'].includes(operation)) return { operation: 'status' }
  if (['off', 'stop', 'disable', 'disabled'].includes(operation)) return { operation: 'off' }

  if (['toggle'].includes(operation)) {
    const target = normalizeFollowTarget(args[1], username)
    const range = args[2] == null ? undefined : parsePositiveNumber(args[2])
    return { operation: 'toggle', target, range }
  }

  if (['on', 'start', 'enable', 'enabled'].includes(operation)) {
    const target = normalizeFollowTarget(args[1], username)
    const range = args[2] == null ? undefined : parsePositiveNumber(args[2])
    return { operation: 'on', target, range }
  }

  const target = normalizeFollowTarget(first, username)
  const range = args[1] == null ? undefined : parsePositiveNumber(args[1])
  return { operation: 'on', target, range }
}

function normalizeFollowTarget (value, username) {
  const target = String(value || username || '').trim()
  if (!target || target.toLowerCase() === 'me') return String(username || '').trim()
  return target
}

function formatFollowStatus (status) {
  if (!status?.active) return 'Follow mode: off.'
  const pause = status.pausedReason === 'pvp'
    ? ' paused while PvP is active'
    : status.pausedReason === 'target-unavailable'
      ? ' waiting for the target to become visible'
      : ''
  return `Follow mode: on; target: ${status.target}; range: ${status.range}; task: ${status.taskStatus || 'queued'}${pause}.`
}

function parseBlockPosition (args, usage) {
  requireArgs(args, 3, usage)
  return {
    x: Math.floor(parseFiniteNumber(args[0])),
    y: Math.floor(parseFiniteNumber(args[1])),
    z: Math.floor(parseFiniteNumber(args[2]))
  }
}

function parseFiniteNumber (value) {
  const number = Number(value)
  if (!Number.isFinite(number)) throw new Error(`"${value}" is not a valid number.`)
  return number
}

function parseNonNegativeNumber (value) {
  const number = parseFiniteNumber(value)
  if (number < 0) throw new Error('Value cannot be negative.')
  return number
}

function parsePositiveNumber (value) {
  const number = parseFiniteNumber(value)
  if (number <= 0) throw new Error('Value must be greater than zero.')
  return number
}

function parseNonNegativeInteger (value) {
  const number = parseNonNegativeNumber(value)
  if (number < 0) throw new Error('Range cannot be negative.')
  return Math.floor(number)
}

function parseDuration (value) {
  const duration = parseFiniteNumber(value)
  if (duration < 50 || duration > 60000) throw new Error('Duration must be between 50 and 60000 milliseconds.')
  return Math.floor(duration)
}

function requireArgs (args, count, usage) {
  if (args.length < count) throw new Error(`Usage: ${usage}`)
}

module.exports = {
  registerBuiltInCommands,
  parseFollowCommand,
  formatFollowStatus
}
