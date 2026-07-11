# Follow player mode

Version 1.6.0 adds a persistent, command-activated player-follow mode.

## Commands

Direct messages may omit the command prefix:

```text
/msg BarebonesBot follow Alice
/msg BarebonesBot follow Alice 3
/msg BarebonesBot follow on
/msg BarebonesBot follow on Alice 3
/msg BarebonesBot follow toggle Alice
/msg BarebonesBot follow off
/msg BarebonesBot follow status
```

`followplayer` is an alias for `follow`.

Command forms:

- `follow <player> [range]`: enable follow mode or retarget it.
- `follow me [range]`: follow the player who sent the command.
- `follow on [player] [range]`: enable follow mode; omitting the player follows the sender.
- `follow toggle [player] [range]`: disable an active follow mode, or enable it for the supplied player/sender.
- `follow off`: disable follow mode immediately.
- `follow status`: report the target, range, task state, and pause reason.

## Task and interruption behavior

Follow mode is represented by one persistent task with priority `10` by default. It therefore takes precedence over ordinary user tasks and low-priority autonomous work, while remaining below PvP (`100`) and emergency tasks (`1100` and above).

The task is interruptible and resumable. When PvP or a safety emergency preempts it, the task queue restarts the same follow mode after the higher-priority task finishes. The selected player and range are retained.

When `pauseDuringPvp` is enabled, an active PvP state suppresses follow movement even when no combat task is currently controlling the pathfinder. Disabling PvP with `pvp off`, or otherwise allowing automatic PvP activation to expire, resumes following without requiring another follow command.

If the target is temporarily unavailable, follow mode remains enabled and waits. It reacquires the player case-insensitively when they re-enter visibility, respawn, or receive a new entity id.

## Configuration

```json
"follow": {
  "enabled": true,
  "defaultRange": 2,
  "minimumRange": 1,
  "maximumRange": 16,
  "taskPriority": 10,
  "pollIntervalMs": 100,
  "pauseDuringPvp": true
}
```

Options:

- `enabled`: load or disable the built-in follow plugin.
- `defaultRange`: distance used when a command omits the range.
- `minimumRange`: lower clamp for requested ranges.
- `maximumRange`: upper clamp for requested ranges.
- `taskPriority`: task-queue priority for follow mode. Keep it below PvP and emergency priorities.
- `pollIntervalMs`: how often the service checks PvP state and target availability.
- `pauseDuringPvp`: stop follow movement while PvP is active without disabling the follow mode.

## Limitations

Follow mode uses Mineflayer Pathfinder's dynamic `GoalFollow`. It does not predict teleports or movement beyond what the server exposes. Server anticheat, protected regions, unloaded terrain, and custom movement rules may still prevent the bot from reaching the target.
