import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader } from './helpers/source-module.mjs'

const { connectionList } = await sourceLoader()('src/utils/connection-list.ts')
const item = (id, name, host, lastUsedAt = 0) => ({
  id,
  name,
  host,
  port: 22,
  username: 'root',
  tags: ['linux'],
  description: '',
  lastUsedAt,
})
const groups = [
  {
    id: 'production',
    name: '生产',
    kind: 'ssh',
    items: [
      item('b', 'Server 10', '10.0.0.10', 300),
      item('a', 'Server 2', '10.0.0.2', 100),
    ],
  },
  { id: 'empty', name: '测试', kind: 'ssh', items: [] },
  {
    id: 'ungrouped',
    name: 'Ungrouped',
    kind: 'ssh',
    virtual: true,
    items: [item('c', 'Other', '127.0.0.1')],
  },
]

test('search matches groups, names, host, user and tags across multiple terms', () => {
  assert.deepEqual(
    connectionList(groups, 'server 10.0.0.2 linux', 'name-asc')[0].items.map(
      item => item.id
    ),
    ['a']
  )
  assert.equal(
    connectionList(groups, '生产 root', 'name-asc')[0].items.length,
    2
  )
  assert.deepEqual(
    connectionList(groups, '测试', 'name-asc').map(group => group.id),
    ['empty']
  )
  assert.deepEqual(connectionList(groups, '不存在', 'name-asc'), [])
})

test('sorts naturally within groups without changing the stored tree or dropping empty groups', () => {
  const before = JSON.stringify(groups)
  for (const [sort, expected] of [
    ['name-asc', ['a', 'b']],
    ['name-desc', ['b', 'a']],
    ['host', ['a', 'b']],
    ['recent', ['b', 'a']],
  ]) {
    const result = connectionList(groups, '', sort)
    assert.deepEqual(
      result
        .find(group => group.id === 'production')
        .items.map(item => item.id),
      expected
    )
    assert.equal(result.length, 3)
    assert.equal(result.at(-1).id, 'ungrouped')
  }
  assert.equal(JSON.stringify(groups), before)
})

test('connection sorting preserves the manually arranged group order', () => {
  const reordered = [groups[1], groups[0], groups[2]]
  for (const sort of ['name-asc', 'name-desc', 'host', 'recent'])
    assert.deepEqual(
      connectionList(reordered, '', sort).map(group => group.id),
      ['empty', 'production', 'ungrouped']
    )
})
