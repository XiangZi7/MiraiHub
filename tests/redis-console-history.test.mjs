import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const load = sourceLoader()
const {
  REDIS_CONSOLE_HISTORY_KEY,
  isSensitiveRedisCommand,
  purgeSensitiveRedisHistory,
} = await load('src/utils/redis-console-history.ts')

/** 内存版 Storage，用于验证启动清理的读写结果。 */
function memoryStorage(initial) {
  const data = new Map(
    initial === undefined ? [] : [[REDIS_CONSOLE_HISTORY_KEY, initial]]
  )
  return {
    data,
    getItem: key => data.get(key) ?? null,
    setItem: (key, value) => data.set(key, value),
    removeItem: key => data.delete(key),
  }
}

test('识别各类含凭据的 Redis 命令', () => {
  for (const command of [
    'AUTH secret',
    'auth user secret',
    'HELLO 3 AUTH default secret',
    'CONFIG SET requirepass secret',
    'config set masterauth secret',
    'ACL SETUSER app on >secret',
    'MIGRATE 127.0.0.1 6379 k 0 100 AUTH secret',
    'MIGRATE 127.0.0.1 6379 k 0 100 AUTH2 user secret',
    'GET a\nAUTH secret',
  ])
    assert.equal(isSensitiveRedisCommand(command), true, command)
  for (const command of ['GET auth', 'SET token abc', 'CONFIG GET maxmemory'])
    assert.equal(isSensitiveRedisCommand(command), false, command)
})

test('启动清理只移除敏感历史，保留其余命令及顺序', () => {
  const storage = memoryStorage(
    JSON.stringify(['GET a', 'AUTH secret', 'CONFIG SET requirepass x', 'SET b 1'])
  )
  purgeSensitiveRedisHistory(storage)
  assert.deepEqual(JSON.parse(storage.data.get(REDIS_CONSOLE_HISTORY_KEY)), [
    'GET a',
    'SET b 1',
  ])
})

test('无敏感历史不改写，内容损坏时直接移除', () => {
  const raw = JSON.stringify(['GET a'])
  const clean = memoryStorage(raw)
  clean.setItem = () => assert.fail('不应改写')
  purgeSensitiveRedisHistory(clean)
  assert.equal(clean.data.get(REDIS_CONSOLE_HISTORY_KEY), raw)

  const broken = memoryStorage('{not json')
  purgeSensitiveRedisHistory(broken)
  assert.equal(broken.data.has(REDIS_CONSOLE_HISTORY_KEY), false)
})
