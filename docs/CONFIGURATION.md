# Configuration reference

This guide documents the configuration surface of **Mineflayer Bot Framework v1.6.0**. Copy `config.example.json` to `config.json`, then edit the copy.

```bash
cp config.example.json config.json
```

`config.json` is ignored by Git so account names and server details are not committed accidentally.

## Root options

| Option | Default | Description |
| --- | --- | --- |
| `host` | required | Minecraft server hostname or IP address. |
| `port` | `25565` | Server port. |
| `username` | required | Offline-mode username or Microsoft account email. |
| `auth` | required | Usually `offline` or `microsoft`. |
| `version` | `false` | `false` lets Mineflayer detect the server version; otherwise provide a supported version string. |
| `commandPrefix` | `!` | Prefix used for public commands and optional direct-message prefixes. |
| `allowedUsers` | `[]` | Case-insensitive player allowlist for commands. Empty permits everyone. |
| `plugins` | `{}` | Built-in and user-plugin configuration. |
| `reconnect` | see below | Reconnection behavior after disconnect. |

## Reconnection

```json
"reconnect": {
  "enabled": true,
  "delayMs": 5000
}
```

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Reconnect after an unexpected disconnect. |
| `delayMs` | `5000` | Delay before reconnecting. |

Intentional shutdown disables reconnection.

## Plugin activation

Every built-in plugin accepts an `enabled` option. A plugin set to `false` is not loaded, does not provide its service, and does not register its commands.

```json
"plugins": {
  "social": { "enabled": false }
}
```

Dependencies matter. For example, `follow` requires `tasks`, `actions`, and normally `pvp`; `commands` must load after the services whose commands it exposes.

## `tasks`

```json
"tasks": {
  "enabled": true
}
```

The task queue currently has no additional configuration. Priorities are configured by the systems that submit tasks.

## `actions`

```json
"actions": {
  "enabled": true,
  "canDigWhilePathing": false,
  "allowSprinting": true,
  "allowParkour": false,
  "interactionReach": 4.5,
  "entityReach": 3,
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
}
```

| Option | Default | Description |
| --- | --- | --- |
| `canDigWhilePathing` | `false` | Allow Pathfinder to break blocks while routing. Keep disabled on protected servers. |
| `allowSprinting` | `true` | Permit sprinting during Pathfinder movement. |
| `allowParkour` | `false` | Permit Pathfinder parkour moves. |
| `maxDropDown` | Pathfinder default | Optional maximum drop distance, rounded down and clamped to zero or more. |
| `interactionReach` | `4.5` | Maximum direct block-interaction distance before moving closer. |
| `entityReach` | `3` | Maximum direct entity-interaction distance before moving closer. |
| `blockPunchMs` | `120` | Duration of the start/cancel digging pulse used by `leftblock`. |

### Scaffold fallback

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable scaffold-assisted fallback. |
| `retryOnNoPath` | `true` | Use scaffolding only after the movement-only route reports `NoPath`. |
| `minimumBlocks` | `1` | Minimum total approved blocks required before retrying. This is not a reserve. |
| `placeCost` | `2` | Path cost added to placement; higher values prefer fewer placed blocks. |
| `allow1by1Towers` | `true` | Permit vertical pillaring during the fallback route. |
| `blockNames` | cobblestone, deepslate, dirt, netherrack | Ordered inventory block preference. Unknown blocks for the active protocol are ignored. |

See [Scaffold-assisted pathfinding](PATHFINDING_SCAFFOLDING.md).

## `status-effects`

```json
"status-effects": {
  "enabled": true
}
```

No additional options are currently exposed. The service resolves protocol-specific effect names and powers the `effect` command and Fire Resistance safety check.

## `teams`

```json
"teams": {
  "enabled": true,
  "useScoreboardTeams": true,
  "customTeammates": []
}
```

| Option | Default | Description |
| --- | --- | --- |
| `useScoreboardTeams` | `true` | Treat players sharing the bot’s vanilla scoreboard team as teammates. |
| `customTeammates` | `[]` | Initial custom teammate names. The runtime list can be replaced by `teammates near`. |

Runtime custom-team changes are session-local and do not rewrite the file.

## `pvp`

```json
"pvp": {
  "enabled": true,
  "entryPoints": {
    "attacked": true,
    "nearbyNonTeammate": false,
    "always": false
  },
  "activationDurationMs": 15000,
  "nearbyEntryRadius": 6,
  "targetSearchRadius": 24,
  "attackRadius": 3,
  "attackCooldownMs": 625,
  "attackPlayers": true,
  "attackHostileMobs": true,
  "equipBestMeleeWeapon": true,
  "combatPriority": 100,
  "smoothAim": {
    "stepMs": 50,
    "maxRadiansPerStep": 0.18
  },
  "bow": {
    "enabled": true,
    "chargeMs": 1000,
    "maximumRange": 24,
    "preferredRange": 12,
    "aimStepRadians": 0.12
  },
  "retreat": {
    "durationMs": 1800,
    "priority": 1100
  }
}
```

### Entry points

| Option | Default | Description |
| --- | --- | --- |
| `entryPoints.attacked` | `true` | Activate after a recognized attack. |
| `entryPoints.nearbyNonTeammate` | `false` | Activate when a non-teammate player enters `nearbyEntryRadius`. |
| `entryPoints.always` | `false` | Remain eligible whenever a valid target is visible. |
| `activationDurationMs` | `15000` | How long attack-triggered automatic PvP remains active. |
| `nearbyEntryRadius` | `6` | Radius for the nearby-player entry point. |
| `attackerInferenceWindowMs` | `900` | Legacy-protocol window for inferring an attacker from a recent arm swing. |
| `attackerInferenceRadius` | `4.5` | Legacy-protocol distance limit for inferred attackers. |

### Targeting and melee

| Option | Default | Description |
| --- | --- | --- |
| `targetSearchRadius` | `24` | Maximum distance for target selection. |
| `attackRadius` | `3` | Melee swing distance. |
| `attackCooldownMs` | `625` | Minimum delay between melee attacks. |
| `attackPlayers` | `true` | Permit non-teammate player targets. |
| `attackHostileMobs` | `true` | Permit hostile-mob targets. |
| `equipBestMeleeWeapon` | `true` | Equip the best available non-bow weapon automatically. |
| `combatPriority` | `100` | Task priority for PvP engagement. |
| `smoothAim.stepMs` | `50` | Aim-update interval. |
| `smoothAim.maxRadiansPerStep` | `0.18` | Maximum melee/following aim rotation per step. |

### Bow

| Option | Default | Description |
| --- | --- | --- |
| `bow.enabled` | `true` | Use bow behavior when a bow is already held. |
| `bow.chargeMs` | `1000` | Draw duration before release. |
| `bow.maximumRange` | `24` | Maximum firing distance; farther targets are approached. |
| `bow.preferredRange` | `12` | Follow distance while closing into bow range. |
| `bow.aimStepRadians` | `0.12` | Maximum bow-aim rotation per update. |

### Unarmed retreat

| Option | Default | Description |
| --- | --- | --- |
| `retreat.durationMs` | `1800` | Sprint/jump retreat duration. |
| `retreat.priority` | `1100` | Emergency priority for retreat. |

The `pvp` command changes only runtime override state.

## `follow`

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

| Option | Default | Description |
| --- | --- | --- |
| `defaultRange` | `2` | Distance used when the command omits a range. |
| `minimumRange` | `1` | Lower clamp for requested ranges. |
| `maximumRange` | `16` | Upper clamp for requested ranges. |
| `taskPriority` | `10` | Persistent follow task priority. Keep below PvP and emergencies. |
| `pollIntervalMs` | `100` | PvP and target-availability check interval. Minimum effective value is 25 ms. |
| `pauseDuringPvp` | `true` | Pause movement while PvP is active without forgetting the target. |

See [Follow player mode](FOLLOW_MODE.md).

## `commands`

```json
"commands": {
  "enabled": true,
  "acceptWhispers": true,
  "acceptPublic": false,
  "whisperPrefixOptional": true,
  "notifyTaskCompletion": true
}
```

| Option | Default | Description |
| --- | --- | --- |
| `acceptWhispers` | `true` | Accept direct-message commands. |
| `acceptPublic` | `false` | Accept commands from public chat. |
| `whisperPrefixOptional` | `true` | Permit prefix-free direct-message commands. |
| `notifyTaskCompletion` | `true` | Send completion/failure/cancellation replies for queued user commands. |

The root `commandPrefix` and `allowedUsers` options also affect this plugin. See [Command reference](COMMANDS.md).

## `social`

```json
"social": {
  "enabled": true,
  "tickIntervalMs": 150,
  "stareBack": {
    "enabled": true,
    "maxDistance": 12,
    "stareAngleDegrees": 12,
    "onlyWhenIdle": true,
    "aimStepRadians": 0.1
  },
  "mimicRepeatedActions": {
    "enabled": true,
    "threshold": 3,
    "windowMs": 2500,
    "responseCooldownMs": 5000,
    "responseRepetitions": 3,
    "pulseMs": 180,
    "gapMs": 100,
    "botLookAngleDegrees": 22,
    "jumpRiseThreshold": 0.2,
    "jumpResetMs": 500
  }
}
```

### Stare back

| Option | Default | Description |
| --- | --- | --- |
| `stareBack.enabled` | `true` | Enable looking back at staring players. |
| `stareBack.maxDistance` | `12` | Maximum player distance. |
| `stareBack.stareAngleDegrees` | `12` | How closely the player’s view must point at the bot. |
| `stareBack.responseAngleDegrees` | `18` | Reserved response-angle configuration used by the service defaults. |
| `stareBack.onlyWhenIdle` | `true` | Avoid steering while tasks are active or queued. |
| `stareBack.aimStepRadians` | `0.1` | Maximum smooth rotation per step. |

### Repeated-action mimic

| Option | Default | Description |
| --- | --- | --- |
| `mimicRepeatedActions.enabled` | `true` | Enable repeated sneak/jump/shield responses. |
| `threshold` | `3` | Number of observed repetitions required. Minimum effective value is 2. |
| `windowMs` | `2500` | Time window containing those repetitions. |
| `responseCooldownMs` | `5000` | Cooldown per player and action. |
| `responseRepetitions` | `3` | Number of response pulses. |
| `pulseMs` | `180` | Duration of each response pulse. |
| `gapMs` | `100` | Delay between pulses. |
| `botLookAngleDegrees` | `22` | How closely the bot must already be looking at the player. |
| `jumpRiseThreshold` | `0.2` | Upward movement used to infer a remote jump. |
| `jumpResetMs` | `500` | Delay before another jump can be recognized. |

The `social` command changes runtime enable flags only.

## `autonomy`

```json
"autonomy": {
  "enabled": true,
  "tickIntervalMs": 100
}
```

`tickIntervalMs` controls the scheduler tick. Each behavior also has its own check interval.

### Projectile dodging

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable projectile threat detection. |
| `checkIntervalMs` | `75` | Detection interval. |
| `projectileNames` | arrows, snowballs, eggs, fireballs | Entity names considered projectiles. |
| `lookAheadTicks` | `24` | Prediction horizon. |
| `minimumSpeed` | `0.03` | Ignore slower entities. |
| `threatRadius` | `1.4` | Predicted closest horizontal danger radius. |
| `verticalTolerance` | `2` | Vertical tolerance for a predicted hit. |
| `dodgeDistance` | `2.25` | Candidate side/away displacement. |
| `dodgeDurationMs` | `650` | Manual movement duration. |
| `cooldownMs` | `900` | Per-projectile cooldown. |
| `priority` | `1400` | Emergency task priority. |
| `sprint` | `true` | Sprint during the dodge. |
| `jump` | `false` | Jump during the dodge. |
| `unsafeFloorNames` | lava/fire/magma/cactus defaults | Blocks rejected beneath a dodge route. |

### Eating

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `true` | Enable hunger-aware eating. |
| `checkIntervalMs` | `500` | Hunger check interval. |
| `hungerThreshold` | `16` | Start eating below this food level. |
| `targetFood` | `19` | Continue cake bites toward this level. |
| `priority` | `-5` | Automatic eating task priority. |
| `preferBestFood` | `true` | Prefer the highest-restoration eligible item. |
| `eatCake` | `true` | Use visible placed cake when no inventory food is selected. |
| `cakeSearchRadius` | `12` | Cake search radius. |
| `maximumBites` | `7` | Maximum cake activations per task. |
| `include` | `[*]` | Eligible item wildcard patterns. |
| `exclude` | hazardous/valuable defaults | Excluded item wildcard patterns; exclusions win. |

### Animal interactions

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `false` | Enable autonomous shearing/milking. |
| `checkIntervalMs` | `1500` | Search interval. |
| `searchRadius` | `10` | Animal search radius. |
| `shearSheep` | `true` | Shear eligible unsheared sheep when shears are carried. |
| `milkCows` | `true` | Milk cows when an empty bucket is carried. |
| `sheepCooldownMs` | `300000` | Per-sheep revisit delay. |
| `cowCooldownMs` | `60000` | Per-cow revisit delay. |
| `interactionDelayMs` | `300` | Delay around item/entity interaction. |
| `priority` | `-35` | Task priority. |

### Visible ore mining

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `false` | Enable autonomous visible-ore mining. |
| `checkIntervalMs` | `1000` | Search interval. |
| `searchRadius` | `16` | Block search radius. |
| `maximumCandidates` | `64` | Maximum block candidates considered per search. |
| `revisitCooldownMs` | `60000` | Position revisit delay after an attempt. |
| `priority` | `-40` | Task priority. |
| `blockNames` | common overworld/nether ores | Exact ore block names eligible for mining. |

Only visible configured ores are selected. The behavior attempts to equip a suitable harvesting tool.

### Chest looting

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `false` | Enable autonomous looting. |
| `searchRadius` | `16` | Container search radius. |
| `checkIntervalMs` | `1500` | Search interval. |
| `revisitCooldownMs` | `300000` | Position revisit delay. |
| `blockNames` | chest, trapped chest | Eligible block names. |
| `include` | example valuables/equipment/food | Item wildcard patterns to withdraw. |
| `exclude` | `[]` | Item wildcard exclusions; exclusions win. |
| `maxPerStack` | `null` | Optional maximum count withdrawn per source stack. |

### Full-inventory disposal

| Option | Default | Description |
| --- | --- | --- |
| `enabled` | `false` | Enable configured disposal. |
| `checkIntervalMs` | `500` | Inventory check interval. |
| `minimumFreeSlots` | `1` | Stop after creating this many free slots. |
| `include` | example junk blocks/items | Item wildcard patterns eligible for tossing. |
| `exclude` | common tool patterns | Protected wildcard patterns; exclusions win. |

`loot` and `tossjunk` provide runtime toggles. Other autonomy behaviors are configured at startup only.

## `safety`

```json
"safety": {
  "enabled": true,
  "checkIntervalMs": 100,
  "fireRetryDelayMs": 2000,
  "avoidLavaAndFire": true,
  "ignoreHeatWithFireResistance": true,
  "heatHazardRadius": 2,
  "waterSearchRadius": 12,
  "extinguishTimeoutMs": 8000,
  "escapeDurationMs": 1800,
  "emergencyPriority": 1200,
  "fallingBlocks": {
    "enabled": true,
    "horizontalRadius": 1.35,
    "maxVerticalDistance": 12,
    "dodgeDurationMs": 1000,
    "priority": 1300,
    "blockNames": [
      "sand",
      "red_sand",
      "anvil",
      "chipped_anvil",
      "damaged_anvil"
    ]
  }
}
```

### Heat safety

| Option | Default | Description |
| --- | --- | --- |
| `checkIntervalMs` | `100` | Safety scan interval. |
| `fireRetryDelayMs` | `2000` | Minimum delay between heat-response attempts. |
| `avoidLavaAndFire` | `true` | Enable lava/fire detection and escape. |
| `ignoreHeatWithFireResistance` | `true` | Suppress heat responses while Fire Resistance is active. |
| `heatHazardRadius` | `2` | Nearby block scan radius. |
| `waterSearchRadius` | `12` | Radius for water used to extinguish fire. |
| `extinguishTimeoutMs` | `8000` | Maximum extinguishing attempt duration. |
| `escapeDurationMs` | `1800` | Manual movement duration away from heat. |
| `emergencyPriority` | `1200` | Heat emergency priority. |

### Falling blocks

| Option | Default | Description |
| --- | --- | --- |
| `fallingBlocks.enabled` | `true` | Enable falling-block detection. |
| `horizontalRadius` | `1.35` | Horizontal danger radius around the bot. |
| `maxVerticalDistance` | `12` | Maximum height above the bot to consider. |
| `dodgeDurationMs` | `1000` | Sprint/jump dodge duration. |
| `priority` | `1300` | Falling-block emergency priority. |
| `blockNames` | sand/red sand/anvils | Decoded falling block names treated as threats. Unknown generic falling blocks remain hazardous. |

## `hello` example plugin

```json
"hello": {
  "enabled": false,
  "message": "Hello from a custom plugin!"
}
```

This config belongs to `plugins/hello.js`, the disabled example user plugin. Enabling it registers the `hello` command.

## Runtime-only changes

These commands change in-memory state and do not modify `config.json`:

- `follow …`
- `pvp …`
- `teammates …`
- `social …`
- `loot …`
- `tossjunk …`

Persist desired defaults manually in `config.json` where a corresponding option exists.

## Wildcard item rules

Autonomy item rules normalize names to lower-case underscore form and support `*` wildcards.

```json
{
  "include": ["diamond*", "*_sword", "cooked_*"],
  "exclude": ["wooden_*", "golden_apple"]
}
```

Exclusions take precedence over inclusions. Keep looting and disposal rules conservative because the framework cannot infer personal value, ownership, or server-specific rules.
