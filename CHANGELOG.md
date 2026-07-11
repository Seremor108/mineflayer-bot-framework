# Changelog

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
