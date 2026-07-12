'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const packageJson = require('../package.json')
const packageLock = require('../package-lock.json')

test('package-lock root metadata matches package.json', () => {
  const lockRoot = packageLock.packages['']

  assert.equal(packageLock.name, packageJson.name)
  assert.equal(packageLock.version, packageJson.version)
  assert.equal(lockRoot.name, packageJson.name)
  assert.equal(lockRoot.version, packageJson.version)
  assert.equal(lockRoot.description, packageJson.description)
  assert.deepEqual(lockRoot.engines, packageJson.engines)
  assert.deepEqual(lockRoot.dependencies, packageJson.dependencies)
})
