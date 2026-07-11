# Changelog

## 1.6.0

- Added a command-activated persistent player-follow mode.
- Added `follow`/`followplayer` controls for starting, stopping, toggling, retargeting, changing range, and reporting status.
- Added interruptible follow tasks that automatically requeue after higher-priority emergency and PvP tasks.
- Added PvP-aware pausing so follow movement resumes when PvP is no longer active or is explicitly disabled.
- Added target reacquisition when the followed player temporarily leaves visibility, respawns, or changes entity id.
- Added focused tests for command parsing, target resolution, PvP pausing, emergency interruption, and follow resumption.
- Added complete command and configuration references, refreshed the README, and clarified persistent follow controls and runtime behavior.
- Fixed the built-in commands plugin export so startup validation receives its required `name` and `setup` fields.
- Added guarded early-startup disconnect handling so a plugin failure does not produce a second `quit is not a function` exception.

## 1.5.0

- Added a two-pass pathfinding strategy that first searches for a movement-only route.
- Added automatic fallback to approved scaffold blocks when Mineflayer Pathfinder reports `NoPath`.
- Added configurable scaffold block preference, placement cost, minimum inventory, and 1x1 tower support.
- Added automatic restoration of the normal no-placement movement profile after a scaffold-assisted route.
- Added focused tests for scaffold configuration, inventory counting, error filtering, retry behavior, and profile restoration.

## 1.4.0

- Added emergency dodging for arrows, spectral arrows, snowballs, eggs, and fireballs using short-horizon trajectory prediction.
- Added ground and void-edge checks when selecting a projectile dodge direction.
- Added toggleable autonomous sheep shearing and cow milking.
- Added toggleable mining of configured visible ore blocks with automatic harvest-tool selection.
- Added hunger-aware inventory eating with configurable food rules and nearby cake eating as a fallback.
- Integrated all new behaviors with the priority task queue, cooldown tracking, cancellation, and duplicate-task suppression.
- Added focused automated tests for projectile prediction, safe dodging, animals, ores, cake, food selection, and configuration.

## 1.3.0

- Added toggleable stare-back and repeated sneak/jump/shield mirroring.
- Added configurable autonomous chest looting and full-inventory item disposal.
- Added status-effect resolution and the `effect` command.
- Added falling sand/anvil dodge and Fire-Resistance-aware lava/fire escape tasks.
- Added custom/scoreboard teammate tracking and `teammates near` for seven-block team capture.
- Added PvP entry points for attacks, nearby non-teammates, and always-on mode.
- Added teammate/hostile target filtering, smooth melee aim, bow charging/firing, and unarmed retreat.
- Expanded validation from 11 to 20 automated tests.
