# Mineflayer Bot Command Reference

This document describes every chat command included in **Mineflayer Bot Framework v1.3.0**.

## Sending commands

The command framework accepts direct messages by default. With the example bot username `BarebonesBot`, both of these work:

```text
/msg BarebonesBot goto 100 64 -20
/msg BarebonesBot !goto 100 64 -20
```

The default prefix is `!`, configured through `commandPrefix`. In direct messages, the prefix is optional while `plugins.commands.whisperPrefixOptional` is `true`.

Public-chat commands are disabled by default. Set `plugins.commands.acceptPublic` to `true` to enable them. Public commands must use the configured prefix:

```text
!ping
```

Command names and aliases are case-insensitive. Arguments may be quoted when they contain spaces:

```text
equip "diamond sword" hand
effect "Fire Resistance"
```

Backslashes escape the next character. An unclosed quote produces a parse error.

### Command permissions

`allowedUsers` controls who may send commands. Names are compared case-insensitively.

```json
"allowedUsers": [
  "YourMinecraftName"
]
```

An empty array allows any player to command the bot. Messages from the bot itself are ignored.

### Replies and task notifications

Commands received by direct message are answered by direct message. Public commands are answered in public chat.

Queued commands immediately return a task number:

```text
Queued #12: go to 100, 64, -20.
```

When `plugins.commands.notifyTaskCompletion` is enabled, the bot also reports whether that task completed, failed, or was cancelled.

## Quick reference

| Command | Aliases | Type | Purpose |
| --- | --- | --- | --- |
| `help [command]` | — | Immediate | List commands or explain one command. |
| `ping` | — | Immediate | Check whether the bot is responsive. |
| `pos` | `position` | Immediate | Report the bot's coordinates. |
| `queue` | `tasks` | Immediate | Show the running task and pending queue. |
| `stop` | `cancel` | Immediate | Cancel your currently running user task. |
| `clear` | — | Immediate | Remove your pending user tasks. |
| `goto <x> <y> <z> [range]` | `go` | Queued | Pathfind to coordinates. |
| `come [range]` | `comehere` | Queued | Pathfind to the sender's current position. |
| `leftblock <x> <y> <z>` | `left-click-block`, `punchblock` | Queued | Left-click a block. |
| `rightblock <x> <y> <z>` | `right-click-block`, `useblock` | Queued | Right-click a block. |
| `leftentity <selector>` | `left-click-entity`, `attack` | Queued | Attack a permitted PvP target. |
| `rightentity <selector>` | `right-click-entity`, `useentity` | Queued | Right-click a visible entity. |
| `jump [milliseconds]` | — | Queued | Hold the jump control temporarily. |
| `sneak [milliseconds\|on\|off]` | `crouch` | Queued | Sneak temporarily or toggle sneaking. |
| `equip <item> [destination]` | — | Queued | Equip an inventory item. |
| `armor [best\|item]` | `equiparmor` | Queued | Equip armor or choose the best available set. |
| `effect <name\|id>` | `status` | Immediate | Check whether a status effect is active. |
| `teammates <near\|list\|clear> [radius]` | `team` | Immediate | Manage the custom teammate list. |
| `pvp [on\|off\|auto\|status]` | — | Immediate | Override or inspect PvP mode. |
| `social [stare\|mimic] [on\|off\|status]` | — | Immediate | Toggle social behaviors. |
| `loot [on\|off\|status]` | — | Immediate | Toggle autonomous chest looting. |
| `tossjunk [on\|off\|status]` | `autotoss` | Immediate | Toggle automatic configured-item disposal. |
| `hello` | — | Immediate | Run the disabled-by-default example plugin command. |

## General commands

### `help [command]`

Lists registered commands or shows the usage and description for one command.

```text
help
help goto
help attack
```

When an alias is supplied, the help response describes its primary command.

### `ping`

Checks whether the bot is receiving and processing commands.

```text
ping
```

Response:

```text
Pong!
```

### `pos`

Aliases: `position`

Reports the bot's current coordinates, rounded to one decimal place.

```text
pos
position
```

Example response:

```text
Position: 102.4, 64.0, -18.7.
```

## Task queue commands

The bot executes one task at a time. Normal user tasks have priority `0`, are interruptible by higher-priority emergency tasks, and are configured to restart from the beginning after an emergency finishes.

### `queue`

Aliases: `tasks`

Shows the current task and up to eight pending tasks. This is a global queue view, so it may include tasks belonging to other users or autonomous systems.

```text
queue
tasks
```

Example response:

```text
Current #12: go to 100, 64, -20. Pending: #13 equip diamond_sword to hand; #14 go to Steve.
```

### `stop`

Aliases: `cancel`

Cancels the currently running task only when all of the following are true:

- it is a user task;
- it belongs to the player sending the command; and
- it is currently cancellable.

```text
stop
cancel
```

It does not cancel another player's task or an emergency, PvP, social, or autonomy task.

### `clear`

Removes all pending user tasks belonging to the player sending the command.

```text
clear
```

It does not cancel the currently running task. Use `stop` for that. It also leaves tasks belonging to other users and autonomous systems untouched.

## Movement commands

### `goto <x> <y> <z> [range]`

Aliases: `go`

Pathfinds to coordinates.

```text
goto 100 64 -20
goto 100.5 64 -20.5 2
go 0 80 0 0
```

Arguments:

- `x`, `y`, and `z` must be finite numbers.
- `range` is optional, defaults to `1`, cannot be negative, and is rounded down to an integer.
- A range of `0` requests the exact block coordinate.
- A positive range allows the bot to finish within that many blocks of the destination.

Pathfinding behavior is controlled by `plugins.actions`, including digging, sprinting, parkour, one-by-one towers, and maximum drop distance.

### `come [range]`

Aliases: `comehere`

Pathfinds to the player who sent the command.

```text
come
come 1
comehere 3
```

The default range is `2`. The sender must have a visible player entity when the task starts. This command travels to the sender's position resolved at execution time; it is not a continuous follow mode.

### `jump [milliseconds]`

Holds the jump control for a duration.

```text
jump
jump 1000
```

The default duration is `450` milliseconds. The command parser accepts values from `50` through `60000` milliseconds. The current action implementation caps a single jump hold at `10000` milliseconds.

### `sneak [milliseconds|on|off]`

Aliases: `crouch`

Sneaks for a duration or changes the persistent sneak control state.

```text
sneak
sneak 2500
sneak on
sneak off
crouch 500
```

Behavior:

- No argument sneaks for `1000` milliseconds.
- A number sneaks for that duration, from `50` through `60000` milliseconds.
- `on`, `true`, or `start` enables persistent sneaking.
- `off`, `false`, or `stop` disables persistent sneaking.

Persistent sneaking remains enabled until an explicit off command or another system clears that control state.

## Block interaction commands

Block coordinates are rounded down to whole block coordinates. The bot pathfinds into interaction range when necessary.

### `leftblock <x> <y> <z>`

Aliases: `left-click-block`, `punchblock`

Looks at and briefly left-clicks the block at the specified coordinates.

```text
leftblock 101 64 -20
punchblock 101.9 64.2 -20.1
```

The target chunk must be loaded, and the target cannot be air. The action sends a start-digging packet, swings the main arm, waits briefly, and sends a cancel-digging packet. Instantly breakable blocks may still break.

### `rightblock <x> <y> <z>`

Aliases: `right-click-block`, `useblock`

Looks at and activates the block at the specified coordinates.

```text
rightblock 101 64 -20
useblock 101 64 -20
```

The exact result depends on the block and held item. It may open a container, press a button, use a door, place or use an item against the block, or trigger another normal Minecraft interaction.

## Entity interaction commands

### Entity selector syntax

`leftentity` and `rightentity` accept these selector forms:

- Exact player username: `Steve`
- Explicit player username: `player:Steve`
- Entity ID: `id:123`
- Numeric entity ID: `123`
- Exact entity name or display name: `zombie`
- Partial entity name or display name: `villag`

Examples:

```text
rightentity player:Steve
rightentity id:123
leftentity zombie
```

When multiple non-player entities match a name, the nearest visible match is selected. Entity IDs only work while that entity is currently visible and valid.

### `leftentity <selector>`

Aliases: `left-click-entity`, `attack`

Approaches, looks at, and attacks a target entity.

```text
leftentity zombie
attack player:EnemyName
left-click-entity id:123
```

This command is guarded by the PvP service. It succeeds only while PvP is active and the target passes the configured attack policy. By default, valid targets are:

- non-teammate players; and
- hostile mobs.

Teammates, passive mobs, and other protected entities are rejected. The PvP state and target policy are checked when the command is queued and again when it executes.

### `rightentity <selector>`

Aliases: `right-click-entity`, `useentity`

Approaches, looks at, and activates a visible entity.

```text
rightentity villager
useentity player:Steve
```

This is not treated as an attack and does not require PvP mode. The result depends on the entity and server, such as opening villager trading or interacting with an animal.

## Equipment commands

Item queries are normalized to lower-case underscore form. Spaces and hyphens are treated like underscores.

Examples of equivalent queries:

```text
diamond_sword
"diamond sword"
diamond-sword
```

Exact item names and display names are preferred. Partial matching is supported, but an ambiguous query fails and reports several possible matches.

### `equip <item> [destination]`

Equips a matching inventory item to a destination.

```text
equip "diamond sword"
equip shield off-hand
equip diamond_helmet head
equip elytra torso
```

The default destination is `hand`.

Supported destinations and aliases:

| Destination | Accepted names |
| --- | --- |
| Main hand | `hand`, `mainhand`, `main_hand` |
| Off hand | `off-hand`, `offhand`, `off_hand` |
| Head | `head`, `helmet` |
| Torso | `torso`, `chest`, `chestplate` |
| Legs | `legs`, `leggings` |
| Feet | `feet`, `boots` |

The last argument is treated as a destination only when there is at least one preceding item argument and it matches a valid destination name.

### `armor [best|item]`

Aliases: `equiparmor`

Equips armor from the inventory.

```text
armor
armor best
armor diamond_helmet
equiparmor "iron chestplate"
```

With no argument, or with `best`, the bot checks the `head`, `torso`, `legs`, and `feet` slots and equips upgrades it finds. The built-in ranking generally prefers netherite, diamond, iron, turtle, chainmail, gold, then leather, with a small bonus for enchantments.

With a named item, the item must be recognized as armor for its slot. Recognized special cases include turtle helmets, carved pumpkins, and elytra.

## Status-effect command

### `effect <name|id>`

Aliases: `status`

Requires the `status-effects` plugin.

Checks whether a status effect is currently active on the bot.

```text
effect "Fire Resistance"
effect minecraft:speed
effect 12
status regeneration
```

Effect-name matching ignores case, spaces, punctuation, and an optional `minecraft:` prefix. Numeric protocol effect IDs are also accepted.

An active effect reports its one-based level and remaining duration in ticks:

```text
Fire Resistance is active at level 1 for 420 tick(s).
```

An unknown effect name produces an error. A known but inactive effect is reported as inactive.

## Teammate commands

### `teammates <near|list|clear> [radius]`

Aliases: `team`

Requires the `teams` plugin. With no arguments, this command behaves like `teammates list`.

#### `teammates near [radius]`

Immediately replaces the entire custom teammate list with every visible player inside the radius.

```text
teammates near
teammates near 10
team near 7
```

The default radius is `7` blocks. The value may be any non-negative number.

This is intended for older or custom servers whose teams plugin does not populate vanilla scoreboard teams. The custom list is session-local and is not persisted across restarts.

#### `teammates list`

Lists the current custom teammate names.

```text
teammates list
team list
```

Vanilla scoreboard teammates are still respected by PvP when `plugins.teams.useScoreboardTeams` is enabled, but this command lists only the custom teammate set.

#### `teammates clear`

Clears the custom teammate list.

```text
teammates clear
```

It does not alter vanilla scoreboard teams.

## PvP command

### `pvp [on|off|auto|status]`

Requires the `pvp` plugin. With no argument, it reports status.

```text
pvp
pvp status
pvp on
pvp off
pvp auto
```

Modes:

- `on`: PvP is manually active whenever a valid target is available.
- `off`: PvP is manually disabled and any current combat task is stopped.
- `auto`: Manual override is removed; configured entry-point rules decide whether PvP is active.
- `status`: Reports the current mode, active state, and locked target.

Accepted synonyms include `enabled` and `true` for on, `disabled` and `false` for off, and `config` and `default` for auto.

Example response:

```text
PvP mode: auto; active: yes; target: player EnemyName.
```

PvP configuration controls entry points, target types, attack radius, attack timing, melee weapon selection, bow behavior, and unarmed retreat.

## Social-behavior command

### `social [stare|mimic] [on|off|status]`

Requires the `social` plugin. With no arguments, it reports both behavior states.

```text
social
social stare status
social stare on
social stare off
social mimic on
social mimic off
```

Behaviors:

- `stare`: Smoothly look back at a nearby player who appears to be staring at the bot.
- `mimic`: After a player the bot is looking at repeatedly sneaks, jumps, or shield-blocks, queue repeated matching actions.

The second argument defaults to `status`. Accepted toggle synonyms include `true`, `enable`, and `enabled` for on, and `false`, `disable`, and `disabled` for off.

These changes affect only the current running bot process; they do not rewrite `config.json`.

## Autonomy commands

### `loot [on|off|status]`

Requires the `autonomy` plugin. With no argument, it reports status.

```text
loot
loot status
loot on
loot off
```

Controls autonomous chest looting. Enabling it makes the bot search configured chest block types and withdraw items matching `plugins.autonomy.chestLooting.include` and not matching `exclude`.

Accepted toggle synonyms include `true`, `enable`, and `enabled` for on, and `false`, `disable`, and `disabled` for off.

This changes runtime state only. It does not modify the configuration file.

### `tossjunk [on|off|status]`

Aliases: `autotoss`

Requires the `autonomy` plugin. With no argument, it reports status.

```text
tossjunk
tossjunk on
tossjunk off
autotoss status
```

Controls automatic disposal of configured items when the inventory is full. Matching is controlled by `plugins.autonomy.inventoryToss.include` and `exclude`.

The bot only begins the automatic toss task when its inventory has no empty slots. It stops tossing once the configured minimum number of free slots has been reached or no matching item remains.

Accepted toggle synonyms include `true`, `enable`, and `enabled` for on, and `false`, `disable`, and `disabled` for off.

This changes runtime state only. It does not modify the configuration file.

## Example plugin command

### `hello`

The project includes `plugins/hello.js` as an example of registering a command from a user plugin. It is disabled by default:

```json
"hello": {
  "enabled": false,
  "message": "Hello from a custom plugin!"
}
```

Enable it by setting `plugins.hello.enabled` to `true` and restarting the bot.

```text
hello
```

It replies with the configured message followed by the sender's username.

## Plugin availability

Commands are registered only when their providing plugin loads successfully.

| Commands | Required plugin or service |
| --- | --- |
| Core, queue, movement, interaction, and equipment commands | `commands`, `tasks`, and `actions` |
| `effect` / `status` | `status-effects` |
| `teammates` / `team` | `teams` |
| `pvp` | `pvp` |
| `social` | `social` |
| `loot`, `tossjunk` / `autotoss` | `autonomy` |
| `hello` | User plugin `hello`, disabled by default |

The live `help` command is the authoritative list for the currently running configuration because it includes only commands that were actually registered.
