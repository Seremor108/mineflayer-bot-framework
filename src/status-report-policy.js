'use strict'

function isFollowStatus ({ args }) {
  return matchesOperation(args, ['status', 'state'])
}

function isEffectStatus ({ args }) {
  return Array.isArray(args) && args.length > 0
}

function isTeammateStatus ({ args }) {
  return matchesOperation(args, ['list'])
}

function isPvpStatus ({ args }) {
  return matchesOperation(args, ['status'])
}

function isSocialStatus ({ args }) {
  const behavior = normalizeArgument(args?.[0], 'status')
  if (behavior === 'status') return true
  if (!['stare', 'mimic'].includes(behavior)) return false
  return normalizeArgument(args?.[1], 'status') === 'status'
}

function isAutonomyStatus ({ args }) {
  return matchesOperation(args, ['status'])
}

function isPluginStatus ({ args }) {
  const operation = normalizeArgument(args?.[0], 'list')
  if (operation === 'list' || operation === 'services') return true
  return operation === 'info' && Boolean(String(args?.[1] || '').trim())
}

function matchesOperation (args, operations) {
  const operation = normalizeArgument(args?.[0], operations[0])
  return operations.includes(operation)
}

function normalizeArgument (value, fallback) {
  return String(value == null || value === '' ? fallback : value).trim().toLowerCase()
}

module.exports = {
  isAutonomyStatus,
  isEffectStatus,
  isFollowStatus,
  isPluginStatus,
  isPvpStatus,
  isSocialStatus,
  isTeammateStatus
}
