'use strict'

/**
 * Disconnect a Mineflayer bot without masking the error that triggered cleanup.
 * During very early startup, the high-level quit/end methods may not have been
 * attached yet, so the underlying minecraft-protocol client is the last resort.
 */
function disconnectBot (bot, reason = 'Bot disconnecting') {
  if (!bot) return false

  for (const method of ['quit', 'end']) {
    if (typeof bot[method] !== 'function') continue
    try {
      bot[method](reason)
      return true
    } catch (_) {
      // Try the next available shutdown path.
    }
  }

  const client = bot._client
  if (typeof client?.end === 'function') {
    try {
      client.end(reason)
      return true
    } catch (_) {}
  }

  if (typeof client?.socket?.end === 'function') {
    try {
      client.socket.end()
      return true
    } catch (_) {}
  }

  return false
}

module.exports = { disconnectBot }
