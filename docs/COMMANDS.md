# Command reference

This document describes every chat command included in **Mineflayer Bot Framework v1.6.2**.

## Sending commands

Direct messages are accepted by default. With a bot named `BarebonesBot`, both forms work:

```text
/msg BarebonesBot goto 100 64 -20
/msg BarebonesBot !goto 100 64 -20
```

The configured prefix defaults to `!`. It is optional in direct messages while `plugins.commands.whisperPrefixOptional` is `true`.

Public-chat commands are disabled by default. Set `plugins.commands.acceptPublic` to `true` to enable them. Public commands must use the configured prefix:

```text
!ping
```

Command names and aliases are case-insensitive. Quote arguments containing spaces:

```text
equip "diamond sword" hand
effect "Fire Resistance"
```

Backslashes escape the following character. An unclosed quote produces a parse error.

## Permissions and replies

`allowedUsers` controls who may command the bot. Names are compared case-insensitively. An empty list permits any player.

```json
"allowedUsers": ["YourMinecraftName"]
```

Direct-message commands receive direct-message replies by default. Set `plugins.commands.sendPrivateReplies` to `false` to suppress ordinary private replies without disabling or changing the command itself. This is useful when an AllowedUser sends commands through a macro and does not need confirmations.

Status reports continue replying privately while ordinary replies are suppressed. These include `ping`, `pos`, `queue`, `effect`, and the status/list forms of `follow`, `teammates`, `pvp`, `social`, `loot`, and `tossjunk`. Parse errors, unknown-command errors, command confirmations, queued-task notices, completion notices, cancellation notices, and failure notices are suppressed. Public-chat replies are unaffected. Messages sent by the bot itself are ignored.

## Task behavior

Queued commands report their task number immediately when replies are enabled. When `plugins.commands.notifyTaskCompletion` is enabled, the bot also reports completion, cancellation, or failure unless private replies are suppressed.

Persistent follow mode is not a normal user task. `stop` and `clear` do not disable it; use `follow off`.

## Quick reference

| Command | Aliases | Type | Purpose |
| --- | --- | --- | --- |
| `help [command]` | — | Immediate | List commands or explain one command. |
| `ping` | — | Immediate | Check responsiveness. |
| `pos` | `position` | Immediate | Report current coordinates. |
| `queue` | `tasks` | Immediate | Show the running task and pending queue. |
| `plugins [info <name>\|services]` | — | Immediate | Inspect loaded plugins and service ownership. |
| `stop` | `cancel` | Immediate | Cancel your currently running user task. |
| `clear` | — | Immediate | Remove your pending user tasks. |
| `goto <x> <y> <z> [range]` | `go` | Queued | Pathfind to coordinates. |
| `come [range]` | `comehere` | Queued | Pathfind once to the sender’s current position. |
| `follow …` | `followplayer` | Persistent | Start, stop, toggle, retarget, or inspect follow mode. |
| `leftblock <x> <y> <z>` | `left-click-block`, `punchblock` | Queued | Left-click a block. |
| `rightblock <x> <y> <z>` | `right-click-block`, `useblock` | Queued | Right-click a block. |
| `leftentity <selector>` | `left-click-entity`, `attack` | Queued | Attack a permitted PvP target. |
| `rightentity <selector>` | `right-click-entity`, `useentity` | Queued | Right-click an entity. |
| `jump [milliseconds]` | — | Queued | Hold jump temporarily. |
| `sneak [milliseconds\|on\|off]` | `crouch` | Queued | Sneak temporarily or toggle sneaking. |
| `equip <item> [destination]` | — | Queued | Equip an inventory item. |
| `armor [best\|item]` | `equiparmor` | Queued | Equip armor or the best available set. |
| `effect <name\|id>` | `status` | Immediate | Check whether a status effect is active. |
| `teammates <near\|list\|clear> [radius]` | `team` | Immediate | Manage the custom teammate list. |
| `pvp [on\|off\|auto\|status]` | — | Immediate | Override or inspect PvP mode. |
| `social [stare\|mimic] [on\|off\|status]` | — | Immediate | Toggle social behaviors. |
| `loot [on\|off\|status]` | — | Immediate | Toggle autonomous chest looting. |
| `tossjunk [on\|off\|status]` | `autotoss` | Immediate | Toggle full-inventory disposal. |
| `hello` | — | Immediate | Example user-plugin command, disabled by default. |

## General commands

### `help [command]`

Lists registered commands or shows the usage and description of one command.

```text
help
help goto
help follow
```

The live help output is authoritative because disabled plugins do not register their commands.

### `ping`

```text
ping
```

Replies with `Pong!`.

### `pos`

Aliases: `position`

Reports the bot’s coordinates rounded to one decimal place.

```text
pos
position
```

## Queue commands

### `plugins [info <name>|services]`

Lists loaded plugins and their lifecycle states. `plugins info <name>` reports the plugin source and the services it owns. `plugins services` lists every registered service and its provider. Service values are never displayed.

```text
plugins
plugins info autonomy
plugins services
```

Plugin diagnostics require the sender to have an explicit entry in `allowedUsers`. They remain unavailable when `allowedUsers` is empty, even though other commands accept any sender in that configuration.

### `queue`

Aliases: `tasks`

Shows the current task and up to eight pending tasks. The view is global and may include user, follow, PvP, safety, social, and autonomy tasks.

```text
queue
```

### `stop`

Aliases: `cancel`

Cancels the currently running task only when it is an interruptible user task owned by the sender.

```text
stop
```

It does not cancel another player’s task, follow mode, PvP, emergencies, or autonomous work. Use the controlling command for persistent modes, such as `follow off` or `pvp off`.

### `clear`

Removes all pending user tasks owned by the sender.

```text
clear
```

It does not cancel the currently running task and does not remove follow, PvP, safety, social, or autonomy tasks.

## Movement commands

### `goto <x> <y> <z> [range]`

Aliases: `go`

Pathfinds to coordinates.

```text
goto 100 64 -20
goto 100.5 64 -20.5 2
go 0 80 0 0
```

- `x`, `y`, and `z` must be finite numbers.
- `range` defaults to `1`, cannot be negative, and is rounded down.
- `range 0` requests the exact block coordinate.
- Positive ranges permit completion within that many blocks.
- If normal movement cannot find a route and scaffold fallback is enabled, approved inventory blocks may be placed.

### `come [range]`

Aliases: `comehere`

Pathfinds once to the sender’s position as resolved when the queued task starts.

```text
come
come 3
```

The default range is `2`. This is not continuous following; use `follow me` for that.

### `follow`

Alias: `followplayer`

Controls persistent player-follow mode.

```text
follow Alice
follow Alice 3
follow me
follow on
follow on Alice 3
follow toggle Alice
follow off
follow status
```

Forms:

- `follow <player> [range]`: enable follow mode or retarget it.
- `follow me [range]`: follow the sender.
- `follow on [player] [range]`: enable following; omitting the player selects the sender.
- `follow toggle [player] [range]`: disable an active mode, or enable it for the supplied player/sender.
- `follow off`: immediately disable following and stop its pathfinder goal.
- `follow status`: report the target, range, task state, and pause reason.

Follow mode:

- keeps a dynamic Pathfinder goal on the selected player;
- waits and reacquires the player after temporary disappearance, respawn, or entity-id change;
- pauses while PvP is active when configured to do so;
- resumes after PvP becomes inactive or is disabled;
- restarts after higher-priority emergency or PvP interruption;
- remains active until explicitly disabled or the plugin is unloaded.

Requested ranges are clamped between `plugins.follow.minimumRange` and `maximumRange`. See [Follow mode](FOLLOW_MODE.md).

### `jump [milliseconds]`

Holds jump temporarily.

```text
jump
jump 1000
```

The default duration is `450` milliseconds. Parsed durations must be between `50` and `60000` milliseconds; the action implementation may cap an individual hold more conservatively.

### `sneak [milliseconds|on|off]`

Aliases: `crouch`

```text
sneak
sneak 2500
sneak on
sneak off
```

No argument sneaks for `1000` milliseconds. `on`, `true`, or `start` enables persistent sneaking; `off`, `false`, or `stop` disables it.

## Block interactions

Coordinates are rounded down to whole blocks. The bot pathfinds into interaction range when needed.

### `leftblock <x> <y> <z>`

Aliases: `left-click-block`, `punchblock`

Looks at and briefly left-clicks a non-air block.

```text
leftblock 101 64 -20
```

The action sends start-digging, swings, waits briefly, and sends cancel-digging. Instantly breakable blocks may still break.

### `rightblock <x> <y> <z>`

Aliases: `right-click-block`, `useblock`

Looks at and activates a block.

```text
rightblock 101 64 -20
```

The result depends on the block and held item: opening a container, using a door/button, placing an item, or another normal interaction.

## Entity interactions

### Selectors

`leftentity` and `rightentity` accept:

- exact player username: `Steve`
- explicit player username: `player:Steve`
- entity id: `id:123` or `123`
- exact entity name/display name: `zombie`
- partial entity name/display name: `villag`

When several non-player entities match a name, the nearest visible match is selected.

### `leftentity <selector>`

Aliases: `left-click-entity`, `attack`

Approaches, aims at, and attacks a target.

```text
attack player:EnemyName
leftentity zombie
```

The command is rejected unless PvP is active and the target passes the configured attack policy. Teammates and passive mobs are protected by default.

### `rightentity <selector>`

Aliases: `right-click-entity`, `useentity`

Approaches, aims at, and activates an entity.

```text
rightentity villager
rightentity player:Steve
```

This is not treated as an attack and does not require PvP mode.

## Equipment commands

Item queries are normalized to lower-case underscore form. Spaces and hyphens are equivalent to underscores. Exact matches are preferred; unambiguous partial matches are accepted.

### `equip <item> [destination]`

```text
equip "diamond sword"
equip shield off-hand
equip diamond_helmet head
```

The default destination is `hand`.

| Destination | Accepted names |
| --- | --- |
| Main hand | `hand`, `mainhand`, `main_hand` |
| Off hand | `off-hand`, `offhand`, `off_hand` |
| Head | `head`, `helmet` |
| Torso | `torso`, `chest`, `chestplate` |
| Legs | `legs`, `leggings` |
| Feet | `feet`, `boots` |

### `armor [best|item]`

Aliases: `equiparmor`

```text
armor
armor best
armor diamond_helmet
```

No argument or `best` equips upgrades for head, torso, legs, and feet. A named item must be recognized as armor for its slot.

## Status effects

### `effect <name|id>`

Aliases: `status`

Requires the `status-effects` plugin.

```text
effect "Fire Resistance"
effect minecraft:speed
effect 12
```

Matching ignores case, punctuation, spaces, and an optional `minecraft:` prefix. Active effects report their one-based level and remaining duration in ticks.

## Teammates

### `teammates <near|list|clear> [radius]`

Aliases: `team`

Requires the `teams` plugin. With no operation, it behaves like `list`.

#### `teammates near [radius]`

Immediately replaces the custom teammate list with every visible player inside the radius.

```text
teammates near
teammates near 10
```

The default is `7` blocks. This is intended for older/custom servers that do not expose teams through vanilla scoreboard data.

#### `teammates list`

Lists the session-local custom teammate names. It does not list vanilla scoreboard teammates.

#### `teammates clear`

Clears only the custom teammate list.

## PvP

### `pvp [on|off|auto|status]`

Requires the `pvp` plugin. No argument reports status.

```text
pvp on
pvp off
pvp auto
pvp status
```

- `on`: manually keeps PvP eligible while valid targets exist.
- `off`: disables PvP and stops current combat.
- `auto`: removes the manual override and uses configured entry-point rules.
- `status`: reports mode, active state, and locked target.

Disabling PvP allows a retained follow mode to resume automatically.

## Social behavior

### `social [stare|mimic] [on|off|status]`

Requires the `social` plugin.

```text
social
social stare off
social mimic on
```

- `stare`: smoothly look back at a nearby player who appears to be staring at the bot.
- `mimic`: respond after a looked-at player repeatedly sneaks, jumps, or shield-blocks.

Runtime toggles do not rewrite `config.json`.

## Autonomy toggles

### `loot [on|off|status]`

Requires the `autonomy` plugin.

```text
loot on
loot off
loot status
```

Controls autonomous chest looting according to the configured block and item rules. This is a runtime-only toggle.

### `tossjunk [on|off|status]`

Alias: `autotoss`

```text
tossjunk on
autotoss status
```

Controls disposal of configured items when the inventory is full. This is a runtime-only toggle.

Projectile dodging, eating, animal interactions, and ore mining currently have configuration toggles but no chat commands.

## Example plugin command

### `hello`

The project includes `plugins/hello.js` as an example. It is disabled by default under `plugins.hello.enabled`.

```text
hello
```

When enabled, it replies with the configured example message and the sender’s username.

## Plugin availability

Commands register only when their providing plugin loads successfully.

| Commands | Provider |
| --- | --- |
| General, queue, movement, interactions, equipment | `commands`, with `tasks` and `actions` |
| `follow` | `follow` |
| `effect` | `status-effects` |
| `teammates` | `teams` |
| `pvp` | `pvp` |
| `social` | `social` |
| `loot`, `tossjunk` | `autonomy` |
| `hello` | disabled example user plugin |

Use `help` on the running bot for the exact command set available under its current configuration.
