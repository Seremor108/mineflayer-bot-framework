# Mineflayer Bot Framework

A CommonJS Mineflayer project with lifecycle plugins, direct-message commands, serialized and interruptible tasks, persistent player following, scaffold-assisted pathfinding, autonomous utility behavior, safety preemption, social reactions, and configurable PvP.

## Requirements

- Node.js 18 or newer
- access to a Minecraft Java Edition server
- permission to automate a client on that server

## Setup

```bash
npm install
cp config.example.json config.json
npm start
```

On Windows Command Prompt, use `copy config.example.json config.json` instead of `cp`.

For an offline-mode server, use `"auth": "offline"`. For a Microsoft account, use `"auth": "microsoft"` and place the account email in `username`.

## Documentation

- [Complete command reference](docs/COMMANDS.md)
- [Complete configuration reference](docs/CONFIGURATION.md)
- [Follow player mode](docs/FOLLOW_MODE.md)
- [Scaffold-assisted pathfinding](docs/PATHFINDING_SCAFFOLDING.md)
- [Changelog](CHANGELOG.md)

The live `help` command remains authoritative for a running bot because disabled plugins do not register commands.

## Commands

Private messages are accepted by default and may omit the command prefix:

```text
/msg BarebonesBot goto 100 64 -20
/msg BarebonesBot !goto 100 64 -20
/msg BarebonesBot follow Alice 3
```

Restrict command access with `allowedUsers`. An empty list permits any player. Public commands remain disabled unless `plugins.commands.acceptPublic` is enabled.

Quoted arguments are supported:

```text
equip "diamond sword" hand
effect "Fire Resistance"
```

| Command | Purpose |
| --- | --- |
| `help [command]` | List commands or show usage. |
| `ping` | Check responsiveness. |
| `pos` | Show current coordinates. |
| `queue` | Show the current and pending tasks. |
| `stop` | Cancel your current user task. |
| `clear` | Clear your pending user tasks. |
| `goto <x> <y> <z> [range]` | Pathfind to coordinates. |
| `come [range]` | Pathfind once to the sender. |
| `follow [player\|me\|on\|off\|toggle\|status] [range]` | Control persistent player-follow mode. |
| `leftblock <x> <y> <z>` | Left-click a block once. |
| `rightblock <x> <y> <z>` | Right-click a block. |
| `leftentity <selector>` | Attack an allowed PvP target. |
| `rightentity <selector>` | Right-click an entity. |
| `jump [milliseconds]` | Hold jump temporarily. |
| `sneak [milliseconds\|on\|off]` | Sneak temporarily or toggle it. |
| `equip <item> [destination]` | Equip an item or armor piece. |
| `armor [best\|item]` | Equip the best armor or a named piece. |
| `effect <name\|id>` | Check whether a status effect is active. |
| `pvp [on\|off\|auto\|status]` | Override or inspect PvP mode. |
| `teammates <near\|list\|clear> [radius]` | Manage custom teammates. |
| `social [stare\|mimic] [on\|off\|status]` | Toggle social behaviors. |
| `loot [on\|off\|status]` | Toggle autonomous chest looting. |
| `tossjunk [on\|off\|status]` | Toggle full-inventory disposal. |

Entity selectors accept a player name, entity name/display name, `player:Name`, `id:123`, or a numeric entity id.

## Task queue and interruption

The `tasks` service executes one task at a time. Every task receives an `AbortSignal`. Higher-priority tasks can interrupt lower-priority interruptible tasks, and selected tasks can restart from the beginning afterward.

Default priority bands are:

- projectile dodge: `1400`
- falling-block dodge: `1300`
- lava/fire escape: `1200`
- unarmed retreat: `1100`
- PvP engagement: `100`
- persistent follow mode: `10`
- user commands: `0`
- automatic eating: `-5`
- social responses: `-10`
- inventory disposal: `-20`
- chest looting: `-30`
- animal interactions: `-35`
- visible ore mining: `-40`

Follow mode therefore supersedes ordinary queued work but yields to PvP and genuine safety emergencies. Low-priority autonomy waits behind user-controlled work.

`stop` and `clear` affect only tasks owned by the sending user. Persistent systems have their own controls, such as `follow off` and `pvp off`.

## Follow player mode

Version 1.6.0 adds a command-activated persistent follow service:

```text
/msg BarebonesBot follow Alice
/msg BarebonesBot follow Alice 3
/msg BarebonesBot follow me
/msg BarebonesBot follow off
/msg BarebonesBot follow status
```

The service uses Mineflayer Pathfinder’s dynamic `GoalFollow`. It retains the target when the player temporarily disappears or respawns and reacquires them case-insensitively.

Follow mode is interruptible and resumable. Higher-priority PvP or emergency tasks can preempt it, after which the same follow task restarts. With `pauseDuringPvp` enabled, follow movement also pauses while PvP is active even if no combat task currently owns the pathfinder; `pvp off` or expiry of automatic PvP resumes it.

See [Follow player mode](docs/FOLLOW_MODE.md).

## Scaffold-assisted pathfinding

Pathfinding uses a two-pass strategy:

1. Try a movement-only route with block placement disabled.
2. If Pathfinder reports `NoPath`, inspect the inventory for approved scaffold blocks.
3. Retry with block placement and optional 1×1 towers.
4. Restore the normal no-placement movement profile afterward.

```json
"scaffolding": {
  "enabled": true,
  "retryOnNoPath": true,
  "minimumBlocks": 1,
  "placeCost": 2,
  "allow1by1Towers": true,
  "blockNames": [
    "cobblestone",
    "cobbled_deepslate",
    "dirt",
    "netherrack"
  ]
}
```

Ordinary reachable routes do not consume blocks. Keep valuable or server-protected blocks out of `blockNames`. See [Scaffold-assisted pathfinding](docs/PATHFINDING_SCAFFOLDING.md).

## Autonomous survival and utility behavior

The autonomy plugin can:

- dodge incoming arrows, spectral arrows, snowballs, eggs, and fireballs;
- eat configured inventory food or nearby placed cake when hungry;
- shear eligible sheep and milk cows;
- mine configured visible ores;
- loot configured items from nearby chests; and
- dispose of configured items when inventory is full.

Projectile dodging is an emergency task and may interrupt normal work. Other autonomy tasks use negative priorities and normally wait for an idle queue. Every behavior has independent configuration, cooldowns, ranges, and enable flags.

Chest looting, animal interactions, visible-ore mining, and inventory disposal are disabled by default. Keep item rules conservative because the bot cannot infer ownership, personal value, or server-specific restrictions.

See [Configuration reference](docs/CONFIGURATION.md#autonomy).

## Safety

The safety plugin handles two emergency classes:

- falling sand, red sand, anvils, and generic falling-block hazards;
- lava, fire blocks, and the bot being on fire while Fire Resistance is absent.

Heat escape can seek nearby water or use a carried water bucket. Set `ignoreHeatWithFireResistance` to `false` to avoid heat even while protected.

Projectile dodging lives in autonomy but uses the highest default emergency priority.

## Social behavior

`plugins.social.stareBack` smoothly turns toward a nearby player whose view appears directed at the bot.

`plugins.social.mimicRepeatedActions` watches a player the bot is looking at. After repeated sneak, jump, or shield-block observations, it queues matching repeated actions.

Remote jump and shield states are inferred from movement and metadata, so custom servers or unusual movement can cause false positives.

## PvP

PvP attacks only valid targets while its mode is active. Valid defaults are:

- players not recognized as teammates;
- hostile mobs.

Passive mobs and teammates are excluded. Three automatic entry points are configurable: being attacked, a nearby non-teammate, and always on.

Melee combat dynamically follows the locked target, uses smoothed aim, equips a suitable weapon when configured, and swings inside the default three-block radius. When a bow is already equipped, combat charges, continuously aims, and releases it. An attacked bot with no usable weapon starts an emergency retreat.

For custom/legacy team plugins that do not expose vanilla scoreboard teams:

```text
/msg BarebonesBot teammates near
```

This immediately replaces the session-local custom teammate list with visible players inside seven blocks by default.

## Status effects

The `statusEffects` service resolves effect names across protocol versions and reads `entity.effects`:

```js
const effects = context.requireService('statusEffects')

if (effects.has('Fire Resistance')) {
  // Fire Resistance is active.
}
```

The `effect` command exposes the same basic check to chat.

## Plugin order and services

Built-ins load in dependency order:

1. `tasks`
2. `actions`
3. `status-effects`
4. `teams`
5. `pvp`
6. `follow`
7. `commands`
8. `social`
9. `autonomy`
10. `safety`
11. user plugins from `plugins/`, alphabetically

A user plugin exports `{ name, setup(context) }`. Tracked listeners and cleanup functions are removed during disconnect or shutdown.

```js
'use strict'

module.exports = {
  name: 'example',

  setup (context) {
    const commands = context.requireService('commands')
    const unregister = commands.register('hello2', {
      async run ({ username }) {
        return `Hello, ${username}.`
      }
    })
    context.addCleanup(unregister)
  }
}
```

Context provides `bot`, complete `config`, frozen `pluginConfig`, a prefixed logger, tracked `on`/`once`, `addCleanup`, and shared-service methods `provideService`, `getService`, and `requireService`.

## Development

```bash
npm run check
npm test
```

The suite covers task interruption and resumption, command parsing, plugin cleanup, item rules, effects, teammates, follow mode, social detection, projectile/falling/heat safety, autonomous animals/ores/food, PvP filtering, and scaffold fallback.

## Structure

```text
plugins/                              User plugins
src/index.js                          Connection and lifecycle
src/plugin-manager.js                 Plugin loading and shared services
src/task-queue.js                     Priority queue and interruption
src/action-service.js                 Movement, interaction, aiming, equipment, loot
src/scaffolding-action-service.js     Two-pass pathfinding and scaffold fallback
src/follow-service.js                 Persistent player-follow state and task
src/status-effect-service.js          Status-effect resolution/checking
src/team-service.js                   Scoreboard/custom teammate logic
src/combat-service.js                 PvP entry, targeting, melee, bow, retreat
src/social-service.js                 Stare-back and repeated-action responses
src/autonomy-service.js               Autonomous task scheduling and cooldowns
src/autonomy-behaviors.js             Projectile, animal, ore, and food actions
src/plugins/                          Built-in plugin adapters
docs/COMMANDS.md                      Complete command reference
docs/CONFIGURATION.md                 Complete configuration reference
docs/FOLLOW_MODE.md                   Follow behavior and limitations
docs/PATHFINDING_SCAFFOLDING.md       Scaffold configuration and limitations
```

## Limitations

Server anticheat, latency, permissions, protected regions, unloaded terrain, custom protocol behavior, and server plugins can change how movement and interactions behave. Scaffold routes do not understand land ownership or grief prevention. Follow mode cannot predict teleports beyond information exposed by the server. Combat bow aiming is line-of-sight rather than a complete latency/ballistics solver.

Test autonomous placement, interaction, looting, mining, following, and PvP only where they are permitted.
