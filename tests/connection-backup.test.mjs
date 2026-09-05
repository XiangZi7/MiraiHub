import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import ts from 'typescript'
const { outputText } = ts.transpileModule(readFileSync(new URL('../src/utils/connection-backup.ts', import.meta.url), 'utf8'), { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
const { createConnectionBackup, parseConnectionBackup, restorePlan } = await import(`data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`)
const ssh = (overrides = {}) => ({ id: 'ssh-1', kind: 'ssh', name: 'Server', host: 'server.example', port: 22, username: 'admin', group: 'Production', description: '', tags: ['prod'], tagColor: 'green', createdAt: 100, lastUsedAt: 200, settings: { auth: { type: 'password', password: 'secret' }, timeoutSecs: 30, keepaliveSecs: 30, terminalType: 'xterm-256color', startupCommand: 'echo startup' }, ...overrides })
const snapshot = (...connections) => ({ connections, groups: [{ id: 'g1', name: 'Production', kind: 'ssh', createdAt: 1 }], tags: [{ name: 'prod', color: 'red', createdAt: 1 }] })
const defaults = { mode: 'skip', credentials: false, startupCommands: false }
const archive = (...connections) => createConnectionBackup(snapshot(...connections), true)

test('plain backup removes SSH, database and key secrets without mutating current configuration', () => {
  const original = snapshot(ssh(), ssh({ id: 'db', kind: 'mysql', settings: { database: 'app', password: 'db-secret', ssl: true } }), ssh({ id: 'key', settings: { auth: { type: 'privateKey', path: 'C:/key', passphrase: 'phrase' }, startupCommand: 'echo key' } }))
  const result = createConnectionBackup(original, false)
  assert.equal(result.includesCredentials, false)
  assert.equal(result.connections[0].settings.auth.password, '')
  assert.equal(result.connections[0].settings.startupCommand, '')
  assert.equal(result.connections[1].settings.password, '')
  assert.equal(result.connections[2].settings.auth.passphrase, '')
  assert.equal(original.connections[0].settings.auth.password, 'secret')
})
test('default restore skips collisions and strips credentials/startup commands from new connections', () => {
  const original = snapshot(ssh())
  const result = restorePlan(original, archive(ssh({ name: 'Changed' }), ssh({ id: 'new' })), defaults, () => 'copy')
  assert.deepEqual(result.changes.map(c => c.action), ['skip', 'add'])
  assert.equal(result.next.connections[0].name, 'Server')
  assert.equal(result.next.connections[1].settings.auth.password, '')
  assert.equal(result.next.connections[1].settings.startupCommand, '')
  assert.equal(original.connections.length, 1)
})
test('update retains a current secret only when endpoint and authentication still match', () => {
  const original = snapshot(ssh())
  const update = value => restorePlan(original, archive(value), { ...defaults, mode: 'update' }, () => 'new').next.connections[0]
  assert.equal(update(ssh({ name: 'Renamed' })).settings.auth.password, 'secret')
  for (const patch of [{ host: 'foreign.example' }, { port: 2200 }, { username: 'other' }]) {
    const connection = update(ssh(patch))
    assert.equal(connection.settings.auth.password, '')
    assert.equal(connection.settings.startupCommand, '')
  }
  const key = ssh({ settings: { auth: { type: 'privateKey', path: 'C:/old-key', passphrase: 'old-secret' }, startupCommand: '' } })
  const changed = structuredClone(key); changed.settings.auth.path = 'C:/new-key'
  const result = restorePlan(snapshot(key), archive(changed), { ...defaults, mode: 'update' }, () => 'new')
  assert.equal(result.next.connections[0].settings.auth.passphrase, '')
})
test('credential and startup command restoration require separate explicit options', () => {
  const restore = options => restorePlan(snapshot(), archive(ssh()), { ...defaults, ...options }, () => 'new').next.connections[0].settings
  assert.equal(restore({ credentials: true }).auth.password, 'secret')
  assert.equal(restore({ credentials: true }).startupCommand, '')
  assert.equal(restore({ startupCommands: true }).auth.password, '')
  assert.equal(restore({ startupCommands: true }).startupCommand, 'echo startup')
})
test('copy produces independent IDs; merging groups and tags does not duplicate existing names', () => {
  let id = 0
  const result = restorePlan(snapshot(ssh()), archive(ssh(), ssh({ id: 'ssh-2' })), { ...defaults, mode: 'copy' }, () => `new-${++id}`)
  assert.deepEqual(result.next.connections.map(c => c.id), ['ssh-1', 'new-1', 'new-2'])
  assert.equal(result.next.groups.length, 1)
  assert.equal(result.next.tags.length, 1)
})
test('import validates formats, ports, IDs and shell choices and removes unknown properties', () => {
  const source = archive(ssh())
  source.connections[0].untrusted = { execute: 'bad' }
  assert.equal(parseConnectionBackup(source).connections[0].untrusted, undefined)
  for (const mutate of [p => p.version = 2, p => p.connections.push(p.connections[0]), p => p.connections[0].port = 70000, p => p.connections[0].settings.auth.type = 'shell', p => p.connections[0].host = '', p => p.connections[0].id = 'bad\0id']) {
    const invalid = structuredClone(source); mutate(invalid)
    assert.throws(() => parseConnectionBackup(invalid))
  }
})
