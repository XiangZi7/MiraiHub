import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const {
  classifyConnectionError,
  connectionErrorCopy,
  connectionErrorTips,
  redactConnectionError,
  hostKind,
  CONNECTION_ERROR_COPY,
} = await load('src/utils/connection-error.ts')
const { default: en } = await load('src/i18n/modules/en-US.ts')

// [message, kind, category, code?, field?]
const CASES = [
  [
    "连接 root@10.0.0.12:3306 失败：error returned from database: 1045 (28000): Access denied for user 'root'@'172.17.0.1' (using password: YES)",
    'auth',
    'auth',
    '1045 (28000)',
    'user',
  ],
  [
    "error returned from database: 1044 (42000): Access denied for user 'u'@'%' to database 'erp'",
    '',
    'permission',
    '1044 (42000)',
    'user',
  ],
  [
    "error returned from database: 1130 (HY000): Host '1.2.3.4' is not allowed to connect to this MySQL server",
    '',
    'permission',
    '1130 (HY000)',
    'host',
  ],
  [
    'error returned from database: no pg_hba.conf entry for host "1.2.3.4", user "app", database "x", SSL off',
    'auth',
    'permission',
    undefined,
    'host',
  ],
  [
    'error returned from database: password authentication failed for user "postgres"',
    '',
    'auth',
  ],
  [
    "error returned from database: 1049 (42000): Unknown database 'shop'",
    'notFound',
    'database-missing',
    '1049 (42000)',
    'database',
  ],
  [
    'error returned from database: database "shop" does not exist',
    '',
    'database-missing',
  ],
  [
    'SSH 隧道失败：Connection refused (os error 111)',
    '',
    'ssh-tunnel',
    undefined,
    'tunnel',
  ],
  ['经 SSH 连接数据库超时', '', 'ssh-tunnel'],
  ['隧道使用的 SSH 连接不存在，请重新选择', '', 'ssh-tunnel'],
  [
    'error communicating with database: 由于目标计算机积极拒绝，无法连接。 (os error 10061)',
    '',
    'refused',
    'os error 10061',
    'port',
  ],
  [
    'error communicating with database: failed to lookup address information: 不知道这样的主机。 (os error 11001)',
    '',
    'dns',
    undefined,
    'host',
  ],
  ['error communicating with database: No route to host (os error 113)', '', 'unreachable'],
  [
    'error occurred while attempting to establish a TLS connection: invalid peer certificate: UnknownIssuer',
    '',
    'tls',
    undefined,
    'ssl',
  ],
  [
    'WRONGPASS invalid username-password pair or user is disabled.',
    'auth',
    'auth',
    'WRONGPASS',
  ],
  [
    "NOPERM this user has no permissions to run the 'select' command",
    '',
    'permission',
  ],
  ['Invalid Redis host or port', 'invalidInput', 'config'],
  ['Connection reset by peer (os error 104)', '', 'disconnected'],
  ['something weird', 'internal', 'unknown', ''],
  ['something weird', 'network', 'unreachable'],
]

test('classifies representative MySQL / PostgreSQL / SQLite / Redis / tunnel errors', () => {
  for (const [message, kind, category, code, field] of CASES) {
    const info = classifyConnectionError(message, kind)
    assert.equal(info.category, category, message)
    if (code !== undefined) assert.equal(info.code, code, message)
    if (field !== undefined) assert.equal(info.field, field, message)
  }
})

test('parses the timeout seconds from the backend message', () => {
  const info = classifyConnectionError('连接 root@db:3306 超时（10s）', 'network')
  assert.equal(info.category, 'timeout')
  assert.equal(info.timeoutSecs, 10)
  assert.equal(
    classifyConnectionError('Connection refused (os error 111)').timeoutSecs,
    null
  )
})

test('SQLite and Redis use their own database-missing copy', () => {
  const message = 'error returned from database: unable to open database file (code: 14)'
  const info = classifyConnectionError(message, '', { engine: 'sqlite' })
  assert.equal(info.category, 'database-missing')
  const sqlite = connectionErrorCopy(info.category, { engine: 'sqlite' })
  assert.equal(sqlite.title, '无法打开数据库文件')
  assert.equal(sqlite.icon, 'lucide:file-x')
  assert.equal(
    connectionErrorCopy('database-missing', { engine: 'redis' }).title,
    '数据库编号无效'
  )
  assert.equal(
    connectionErrorCopy('database-missing', { engine: 'mysql' }).title,
    '数据库不存在'
  )
})

test('tips are filtered by engine and tunnel and capped at three', () => {
  const tunnel = connectionErrorTips('refused', { viaTunnel: true })
  assert.ok(tunnel.length <= 3)
  assert.ok(tunnel.includes('隧道模式下，主机应填写跳板机视角的地址，例如 127.0.0.1'))
  assert.ok(!tunnel.includes('服务只监听 127.0.0.1 时，请改用 SSH 隧道连接'))
  const direct = connectionErrorTips('refused', { viaTunnel: false })
  assert.ok(direct.includes('服务只监听 127.0.0.1 时，请改用 SSH 隧道连接'))
  assert.ok(
    connectionErrorTips('auth', { engine: 'redis' }).includes(
      'Redis 6 及以上启用 ACL 时，需要同时填写用户名'
    )
  )
  assert.ok(
    !connectionErrorTips('auth', { engine: 'mysql' }).includes(
      'Redis 6 及以上启用 ACL 时，需要同时填写用户名'
    )
  )
  assert.equal(connectionErrorTips('unknown', {}, 1).length, 1)
})

test('redaction replaces every occurrence literally, longest secret first', () => {
  const text = redactConnectionError(
    'connect root@db.a+b.io:3306/app.db failed; root@db.a+b.io via bastion.db.a+b.io; dbXio',
    {
      host: 'db.a+b.io',
      user: 'root',
      database: 'app.db',
      sshHost: 'bastion.db.a+b.io',
    }
  )
  assert.equal(
    text,
    'connect <user>@<host>:3306/<database> failed; <user>@<host> via <ssh-host>; dbXio'
  )
  assert.equal(redactConnectionError('nothing', { host: '', user: ' ' }), 'nothing')
})

test('hostKind classifies hosts without leaking them', () => {
  assert.equal(hostKind('127.0.0.1'), 'loopback')
  assert.equal(hostKind('localhost'), 'loopback')
  assert.equal(hostKind('10.1.2.3'), 'private-ip')
  assert.equal(hostKind('172.16.0.1'), 'private-ip')
  assert.equal(hostKind('172.31.255.1'), 'private-ip')
  assert.equal(hostKind('172.32.0.1'), 'public-ip')
  assert.equal(hostKind('192.168.1.1'), 'private-ip')
  assert.equal(hostKind('8.8.8.8'), 'public-ip')
  assert.equal(hostKind('db.example.com'), 'hostname')
  assert.equal(hostKind('/tmp/app.db', 'sqlite'), 'file')
})

test('every category has an icon, copy and at least two reachable tips', () => {
  const contexts = [
    { engine: 'mysql', viaTunnel: false },
    { engine: 'postgresql', viaTunnel: true },
    { engine: 'sqlite' },
    { engine: 'redis' },
  ]
  for (const [category, copy] of Object.entries(CONNECTION_ERROR_COPY)) {
    assert.match(copy.icon, /^lucide:[a-z0-9-]+$/, category)
    assert.ok(copy.title && copy.explain && copy.explainFallback, category)
    const best = Math.max(
      ...contexts.map(context => connectionErrorTips(category, context).length)
    )
    assert.ok(best >= 2, category)
  }
})

test('every title, explain and tip key has an English translation', () => {
  const keys = new Set()
  const engines = ['mysql', 'postgresql', 'sqlite', 'redis']
  for (const [category, copy] of Object.entries(CONNECTION_ERROR_COPY)) {
    for (const engine of engines) {
      const variant = connectionErrorCopy(category, { engine })
      keys.add(variant.title)
      keys.add(variant.explain)
      keys.add(variant.explainFallback)
    }
    for (const tip of copy.tips) keys.add(tip.key)
  }
  for (const key of keys) assert.ok(typeof en[key] === 'string' && en[key], key)
})
