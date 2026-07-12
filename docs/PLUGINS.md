# Plugin authoring

User plugins are CommonJS modules placed directly in `plugins/`. They load alphabetically after the built-in plugins and are automatically unloaded when the bot disconnects.

## Create and check a plugin

```bash
npm run plugin:create -- greeting
npm run plugin:validate
npm run plugin:test -- plugins/greeting.js
```

`plugin:create` generates a minimal listener plugin. `plugin:validate` loads plugin modules and applies the same structural validation used by the runtime. `plugin:test` performs a lifecycle smoke test with a mock bot and command service, then verifies that services and commands are cleaned up.

## Copyable example plugins

The repository includes deliberately barebones examples in `plugins/`. Every example is disabled by default in `config.example.json`; copy one to a new filename, change its exported `name`, add a matching configuration entry, and then enable your copy.

| File | Pattern demonstrated |
| --- | --- |
| `example-command.js` | Immediate commands, arguments, automatic replies, aliases, and unregister cleanup. |
| `example-config.js` | Defaults and values from `context.pluginConfig`. |
| `example-events.js` | Mineflayer events, plugin logging, timers, and lifecycle cleanup. |
| `example-queued-task.js` | Serialized work, task metadata, cancellation, `AbortSignal`, and abort-aware sleeping. |
| `example-service-provider.js` | Publishing a read-only shared service. |
| `example-service-user.js` | Requiring another plugin's service and exposing it through a status command. |

To try an example, copy `config.example.json` to `config.json`, set that example's `enabled` value to `true`, and restart the bot. The service-user example also requires `example-service-provider` to be enabled. User plugins load alphabetically by filename, which ensures the included provider loads before its consumer.

The examples favor comments and explicit cleanup over brevity. Delete comments you no longer need after copying them, but keep the cleanup calls and cancellation handling relevant to your plugin.

## Plugin contract

Every plugin exports an object with a valid `name` and `setup(context)` function:

```js
'use strict'

module.exports = {
  name: 'greeting',

  setup (context) {
    const commands = context.requireService('commands')
    const unregister = commands.register('greet', {
      description: 'Send a greeting.',
      async run ({ username }) {
        return `Hello, ${username}.`
      }
    })
    context.addCleanup(unregister)
  }
}
```

Names may contain letters, numbers, hyphens, and underscores and must begin with a letter or number. An optional `teardown(context)` function may perform shutdown work. `setup` may instead return a cleanup function or an object with a `dispose()` method.

## Context API

| Member | Purpose |
| --- | --- |
| `bot` | Current Mineflayer bot. |
| `config` | Complete framework configuration. |
| `pluginConfig` | Frozen configuration from `config.plugins[plugin.name]`. |
| `logger` | Logger prefixed with the plugin name. |
| `on(emitter, event, listener)` | Register an automatically removed listener. |
| `once(emitter, event, listener)` | Register an automatically removed one-time listener. |
| `addCleanup(function)` | Register shutdown cleanup. Cleanups run in reverse order. |
| `provideService(name, value)` | Publish a service until the plugin unloads. |
| `getService(name)` | Read an optional service. |
| `requireService(name)` | Read a required service or fail plugin setup clearly. |
| `listPlugins()` | Return loaded plugin names, sources, and states. |
| `describePlugin(name)` | Return state and owned service names for one loaded plugin. |
| `listServices()` | Return service names and provider plugin names. |

Prefer `context.on` and `context.once` to calling `bot.on` directly. Register cleanup for commands, timers, files, sockets, and other resources that the context cannot track itself.

### Finding framework elements

- Use `context.bot` for Mineflayer state and APIs such as entities, inventory, chat, and world blocks.
- Use `context.pluginConfig` for your plugin's own settings. `context.config` exposes the complete root configuration when integration with a global option is genuinely required.
- Use `context.requireService('commands')` to register commands and `context.requireService('tasks')` or `context.requireService('actions')` for lower-level queue/action integration.
- Optional built-in services include `statusEffects`, `teams`, `pvp`, `follow`, `social`, and `autonomy`. Retrieve optional integrations with `getService` so your plugin can still load when their providers are disabled.
- Run `plugins services` as an AllowedUser to see service names and their provider plugins in a live bot.
- Inspect `src/plugins/` to see how built-ins connect services, then inspect the corresponding `src/*-service.js` file for the methods that service exposes.

## Commands and tasks

An immediate command defines `run(context)`. A queued command defines `createTask(context)` and returns a task with an asynchronous `run({ signal })` function. Long-running work should observe the supplied `AbortSignal` so safety or PvP tasks can interrupt it.

Commands that only report state may set `statusReport: true` or provide a `statusReport({ args })` predicate. A successful status report may reply privately even when `plugins.commands.sendPrivateReplies` is disabled; command and task errors remain suppressed.

```js
const unregister = commands.register('waitabit', {
  createTask () {
    return {
      name: 'wait briefly',
      async run ({ signal }) {
        if (signal.aborted) throw signal.reason
      }
    }
  }
})
context.addCleanup(unregister)
```

## Configuration

Add a matching entry to `config.json`:

```json
{
  "plugins": {
    "greeting": {
      "enabled": true,
      "message": "Hello"
    }
  }
}
```

Setting `enabled` to `false` prevents setup from running. Runtime tools do not rewrite configuration.

## Diagnostics

Users explicitly named in `allowedUsers` can inspect the runtime with:

```text
plugins
plugins info greeting
plugins services
```

The commands intentionally expose service ownership, not service values.

## Testing with the harness

Tests can use `test/helpers/plugin-harness.js`:

```js
const { createPluginHarness } = require('./helpers/plugin-harness')

const harness = createPluginHarness({ plugin, services: { example: fakeService } })
await harness.load()
await harness.unload()
harness.assertClean()
```

Use `createMockCommandService()` when testing command registration and cleanup. For plugins that need complex Mineflayer behavior, pass a purpose-built mock `bot` and service doubles.

## Common failures

- `must have a non-empty string name`: the module did not export the required object or `name`.
- `Required service ... is not available`: the providing built-in is disabled, the service name is wrong, or plugin load order is incorrect.
- `already registered`: a command, alias, service, or plugin name collides with an existing one.
- listeners still fire after reconnecting: use `context.on`/`once`, or register cleanup for listeners created manually.
