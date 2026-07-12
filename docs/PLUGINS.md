# Plugin authoring

User plugins are CommonJS modules placed directly in `plugins/`. They load alphabetically after the built-in plugins and are automatically unloaded when the bot disconnects.

## Create and check a plugin

```bash
npm run plugin:create -- greeting
npm run plugin:validate
npm run plugin:test -- plugins/greeting.js
```

`plugin:create` generates a minimal listener plugin. `plugin:validate` loads plugin modules and applies the same structural validation used by the runtime. `plugin:test` performs a lifecycle smoke test with a mock bot and command service, then verifies that services and commands are cleaned up.

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

## Commands and tasks

An immediate command defines `run(context)`. A queued command defines `createTask(context)` and returns a task with an asynchronous `run({ signal })` function. Long-running work should observe the supplied `AbortSignal` so safety or PvP tasks can interrupt it.

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
