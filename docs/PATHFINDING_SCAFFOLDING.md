# Scaffold-assisted pathfinding

Version 1.5.0 adds a two-pass pathfinding strategy to the `actions` service.

1. The bot first searches for a normal route with block placement disabled.
2. If Mineflayer Pathfinder reports `NoPath`, the bot checks its inventory for configured scaffold blocks.
3. When enough blocks are available, it retries the same goal with block placement enabled.
4. After the route completes, fails, or is interrupted, the normal no-placement movement profile is restored.

This means ordinary reachable routes do not consume blocks. Scaffold placement is reserved for gaps, ledges, vertical approaches, and other terrain that cannot be reached through movement alone.

## Configuration

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

### Options

- `enabled`: enables scaffold-assisted fallback.
- `retryOnNoPath`: restricts scaffolding to routes where the first movement-only search fails.
- `minimumBlocks`: minimum total number of configured blocks required before retrying.
- `placeCost`: additional path cost assigned to block placement. Higher values make the scaffold route prefer fewer placed blocks.
- `allow1by1Towers`: allows the fallback route to pillar vertically beneath the bot.
- `blockNames`: ordered list of block items that Pathfinder may place. Earlier entries are preferred when several are carried.

Only names that exist as both a block and an inventory item in the active Minecraft registry are accepted. This keeps the same configuration usable across old and new server versions; unavailable entries are ignored.

## Behavior and limitations

The feature uses Mineflayer Pathfinder's native block-placement movements. It does not build decorative structures or plan a permanent bridge independently of a navigation goal.

Pathfinding may consume every configured block needed by the selected route. `minimumBlocks` controls whether the fallback starts; it is not an inventory reserve. Keep valuable blocks out of `blockNames`.

Server anticheat, protected regions, placement restrictions, entity obstruction, and custom movement rules may cause a scaffold route to fail even when the search initially finds one.
