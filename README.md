# Mineflayer Bot Framework

A small CommonJS Mineflayer project with lifecycle plugins, direct-message commands, serialized tasks, pathfinding, autonomous inventory behavior, emergency preemption, social reactions, and a configurable PvP controller.

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

For an offline-mode server, use `"auth": "offline"`. For a Microsoft account, use `"auth": "microsoft"` and put the account email in `username`.

## Direct-message commands

Private messages are accepted by default and may omit the command prefix:

```text
/msg BarebonesBot goto 100 64 -20
/msg BarebonesBot !goto 100 64 -20
```

Restrict control with `allowedUsers`. An empty list allows any player to command the bot. Public commands remain disabled unless `plugins.commands.acceptPublic` is enabled.

Quoted arguments are supported, such as `equip "diamond sword" hand`.

### Commands

| Command | Purpose |
| --- | --- |
| `help [command]` | List commands or show usage. |
| `ping` | Check responsiveness. |
| `pos` | Show current coordinates. |
| `queue` | Show the current and pending tasks. |
| `stop` | Cancel your current user task. |
| `clear` | Clear your pending user tasks. |
| `goto <x> <y> <z> [range]` | Pathfind to coordinates. |
| `come [range]` | Pathfind to the sender. |
| `leftblock <x> <y> <z>` | Left-click a block once. |
| `rightblock <x> <y> <z>` | Right-click a block. |
| `leftentity <selector>` | Attack an allowed PvP target; blocked while PvP is inactive. |
| `rightentity <selector>` | Right-click an entity. |
| `jump [milliseconds]` | Hold jump temporarily. |
| `sneak [milliseconds\|on\|off]` | Sneak temporarily or toggle it. |
| `equip <item> [destination]` | Equip an item or armor piece. |
| `armor [best\|item]` | Equip the best armor or a named piece. |
| `effect <name\|id>` | Check whether a status effect is active. |
| `pvp [on\|off\|auto\|status]` | Override or inspect PvP mode. |
| `teammates near` | Replace custom teammates with players within seven blocks. |
| `teammates list` | List custom teammates. |
| `teammates clear` | Clear custom teammates. |
| `social [stare\|mimic] [on\|off\|status]` | Toggle social behaviors at runtime. |
| `loot [on\|off\|status]` | Toggle autonomous chest looting. |
| `tossjunk [on\|off\|status]` | Toggle full-inventory item disposal. |

Entity selectors accept a player name, entity name/display name, `player:Name`, `id:123`, or a numeric entity id.

## Task queue and interruption

The `tasks` service executes one task at a time. Every task receives an `AbortSignal`, and higher-priority tasks can interrupt a lower-priority interruptible task. User tasks are configured to restart from their beginning after an emergency finishes.

Default priority bands are:

- falling-block dodge: `1300`
- lava/fire escape: `1200`
- unarmed retreat: `1100`
- PvP engagement: `100`
- user commands: `0`
- social responses: `-10`
- inventory disposal: `-20`
- chest looting: `-30`

Autonomous tasks therefore wait for normal user work unless a genuine safety or combat entry condition preempts it.

## Social behaviors

`plugins.social.stareBack` makes the bot smoothly turn toward a nearby player whose view direction points at the bot. By default it only does this while the task queue is idle, so it does not steer against pathfinding or combat.

`plugins.social.mimicRepeatedActions` watches players the bot is looking at. After the configured number of repeated sneak, jump, or shield-block actions within a time window, the bot queues the corresponding repeated response.

Sneaking uses Mineflayer's crouch events. Shield use is inferred from living-entity metadata and equipped items. Remote jumping is inferred from upward movement because servers do not send another player's control-state input directly; stair movement and unusual server movement can therefore produce false positives.

## Autonomous chest looting

Chest looting is off by default:

```json
"chestLooting": {
  "enabled": false,
  "searchRadius": 16,
  "revisitCooldownMs": 300000,
  "blockNames": ["chest", "trapped_chest"],
  "include": ["diamond*", "iron_ingot", "gold_ingot", "emerald", "*_sword", "bow", "arrow"],
  "exclude": ["wooden_*"],
  "maxPerStack": null
}
```

Patterns use `*` wildcards after item names are normalized to lower-case underscore form. `include: ["*"]` loots everything. Exclusions win over inclusions. The bot remembers chest positions for the configured cooldown to avoid repeatedly reopening the same chest.

## Full-inventory disposal

Automatic tossing is also off by default:

```json
"inventoryToss": {
  "enabled": false,
  "minimumFreeSlots": 1,
  "include": ["rotten_flesh", "poisonous_potato", "spider_eye", "dirt", "cobblestone"],
  "exclude": ["*_sword", "*_pickaxe", "*_axe"]
}
```

It only starts when the inventory has no empty slots and only tosses items matching the configured rules. Keep the include list conservative; the bot cannot know an item's personal or server-specific value.

## Status effects and heat safety

The `statusEffects` service resolves effect names across protocol versions and checks `entity.effects`:

```js
const effects = context.requireService('statusEffects')

if (effects.has('Fire Resistance')) {
  // Fire Resistance is currently active on the bot.
}
```

The `effect` command exposes a basic chat check.

The safety plugin scans for lava, fire blocks, and the bot's on-fire state. When Fire Resistance is absent, it inserts an emergency escape task. It attempts to move away from lava/fire and, when burning, enter nearby water or place a carried water bucket. Set `ignoreHeatWithFireResistance` to `false` to avoid heat even while protected.

## Falling anvils and sand

The safety plugin watches falling-block entities above the bot. It decodes the falling block state when the protocol exposes it and defaults to sand, red sand, and the three anvil variants. A detected configured block within the horizontal/vertical danger envelope preempts the current task and makes the bot sprint-jump away.

Older or custom protocol implementations may not expose a decodable block state. Such an entity is treated as a generic falling-block hazard rather than ignored.

## PvP

PvP attacks only valid targets while PvP mode is active. Valid defaults are:

- players not recognized as teammates
- hostile mobs

Passive mobs and teammates are excluded. The action service also rejects `leftentity` attacks while PvP is inactive.

Three configurable entry points are available under `plugins.pvp.entryPoints`:

```json
"entryPoints": {
  "attacked": true,
  "nearbyNonTeammate": false,
  "always": false
}
```

`attacked` activates PvP for `activationDurationMs`. On newer protocols Mineflayer can provide a damage source; on older protocols the framework infers the attacker from a recent nearby arm swing. `nearbyNonTeammate` activates when another player outside the teammate set enters `nearbyEntryRadius`. `always` keeps PvP eligible whenever a valid target is visible.

Melee combat dynamically follows the locked target, smoothly turns toward it, and calls `bot.attack(target, true)` inside the configured radius, which defaults to three blocks. It can automatically equip the best sword, axe, trident, or mace in the inventory.

When a bow is already equipped, combat holds use-item for `bow.chargeMs`, continuously smooth-aims at the locked target, and releases to fire. This is direct line-of-sight aiming, not a full projectile/latency solver.

When the bot is attacked without a sword, axe, trident, mace, or bow available, it inserts an emergency retreat task instead of trying to punch the attacker.

## Teammates and 1.8.9 custom teams

The teammate service combines two sources:

- normal Minecraft scoreboard teams, when available
- a session-local custom teammate set

For servers with a custom teams plugin that does not populate vanilla scoreboard teams, send:

```text
/msg BarebonesBot teammates near
```

The current custom list is immediately replaced with every visible player within seven blocks. The list is intentionally not persisted across restarts.

## Action service

Plugins can use the abort-aware `actions` service directly:

```js
const actions = context.requireService('actions')

await actions.gotoPosition({ x: 10, y: 64, z: 10, range: 1 }, signal)
await actions.rightClickBlock({ x: 11, y: 64, z: 10 }, {}, signal)
await actions.equipArmor('best', signal)
await actions.smoothAimAtEntity(target, { durationMs: 300 }, signal)
await actions.fireBowAt(target, { chargeMs: 1000 }, signal)
```

Pathfinding does not break blocks by default. A block left-click is a short start/cancel digging interaction; instantly breakable blocks may still break.

## Plugin order and services

Built-ins load in this dependency order:

1. `tasks`
2. `actions`
3. `status-effects`
4. `teams`
5. `pvp`
6. `commands`
7. `social`
8. `autonomy`
9. `safety`
10. user plugins from `plugins/`, alphabetically

A user plugin exports `{ name, setup(context) }`. Tracked listeners and cleanup functions are removed during disconnect/shutdown.

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

Context provides `bot`, complete `config`, frozen `pluginConfig`, a prefixed `logger`, tracked `on`/`once`, `addCleanup`, and shared-service methods `provideService`, `getService`, and `requireService`.

## Development

```bash
npm run check
npm test
```

The test suite covers task interruption, command parsing, plugin cleanup, item rules, effects, teammates, social look/shield detection, falling/heat detection, and PvP target filtering.

## Structure

```text
plugins/                         User plugins
src/index.js                     Connection and lifecycle
src/plugin-manager.js            Plugin loading and shared services
src/task-queue.js                Priority queue and interruption
src/action-service.js            Movement, interaction, aiming, equipment, loot
src/status-effect-service.js     Status-effect resolution/checking
src/team-service.js              Scoreboard/custom teammate logic
src/combat-service.js            PvP entry, targeting, melee, bow, retreat
src/social-service.js            Stare-back and repeated-action responses
src/autonomy-service.js          Chest looting and inventory disposal
src/plugins/                     Built-in plugin adapters
```

## Limitations

Server anticheat, latency, permissions, custom protocol behavior, and server plugins can change how movement and interaction appear. This framework does not contain advanced combat prediction, projectile ballistics, shield timing, chest ownership rules, or grief-prevention awareness. Test autonomous looting and PvP only where they are allowed.
