'use strict'

const PLUGIN_NAME_PATTERN = /^[a-z0-9][a-z0-9-_]*$/i

function validatePlugin (plugin, source = 'inline') {
  if (!plugin || typeof plugin !== 'object') {
    throw new TypeError(`Plugin from ${source} must export an object.`)
  }

  if (!plugin.name || typeof plugin.name !== 'string') {
    throw new TypeError(`Plugin from ${source} must have a non-empty string name.`)
  }

  if (!PLUGIN_NAME_PATTERN.test(plugin.name)) {
    throw new TypeError(`Plugin name "${plugin.name}" contains unsupported characters.`)
  }

  if (typeof plugin.setup !== 'function') {
    throw new TypeError(`Plugin "${plugin.name}" must define a setup(context) function.`)
  }

  if (plugin.teardown !== undefined && typeof plugin.teardown !== 'function') {
    throw new TypeError(`Plugin "${plugin.name}" teardown must be a function when provided.`)
  }

  return plugin
}

function normalizePluginModule (pluginModule) {
  return pluginModule && pluginModule.default ? pluginModule.default : pluginModule
}

module.exports = { PLUGIN_NAME_PATTERN, normalizePluginModule, validatePlugin }
