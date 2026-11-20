import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, shallowRef } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const nativeUrl = dataModule(`
  export const requests = []
  export const directoryRequests = []
  export let deferDirectories = false
  export const setDirectoryDeferral = value => deferDirectories = value
  export const listDirectory = (id,path) => deferDirectories
    ? new Promise((resolve,reject)=>directoryRequests.push({id,path,resolve,reject}))
    : Promise.resolve({path:'/data',entries:[]})
  export const completeShell = (id,line,cwd) => new Promise((resolve,reject)=>requests.push({id,line,cwd,resolve,reject}))
`)
const debounceUrl = dataModule(`
  export const queued = []
  export const useDebounceFn = fn => {
    let latest
    return (...args) => {
      const job = () => latest === job ? fn(...args) : undefined
      latest = job
      queued.push(job)
    }
  }
`)
const load = sourceLoader({
  vue: dataModule(`
    export * from ${JSON.stringify(import.meta.resolve('vue'))}
    import {onScopeDispose} from ${JSON.stringify(import.meta.resolve('vue'))}
    export const onBeforeUnmount = onScopeDispose
  `),
  '@vueuse/core': debounceUrl,
  '@/api/ssh': nativeUrl,
})
const { requests, directoryRequests, setDirectoryDeferral } = await import(
  nativeUrl
)
const { queued } = await import(debounceUrl)
const { useSshShellCompletion } = await load(
  'src/composables/useSshShellCompletion.ts'
)
const directory = value => ({
  value,
  label: value.replace(/\/$/, ''),
  kind: 'directory',
  description: '远端目录',
})
const settle = () => new Promise(resolve => setImmediate(resolve))

/** 保留真实 Vue watch 与可控防抖队列，覆盖接受候选、快速输入和远端迟到响应。 */
function fixture(t) {
  requests.length = 0
  directoryRequests.length = 0
  setDirectoryDeferral(false)
  queued.length = 0
  const sessionId = shallowRef('session-1'),
    inputLine = shallowRef(''),
    enabled = shallowRef(true)
  const scope = effectScope()
  const api = scope.run(() =>
    useSshShellCompletion({ sessionId, inputLine, enabled })
  )
  t.after(() => {
    scope.stop()
    queued.length = 0
  })
  return {
    api,
    sessionId,
    inputLine,
    enabled,
    scope,
    flush: () => queued.splice(0).forEach(run => run()),
  }
}

test('接受目录后弹层保持关闭，不自动展开子目录；继续键入才重新补全', async t => {
  const f = fixture(t)
  await settle()
  f.inputLine.value = 'cd mirai'
  f.flush()
  requests[0].resolve([directory('miraiTV/'), directory('miraitv-secrets/')])
  await settle()
  assert.equal(f.api.open.value, true)
  f.inputLine.value = 'cd miraiTV/'
  f.api.close()
  assert.equal(f.api.open.value, false)
  assert.equal(f.api.suggestions.value.length, 0)
  f.flush()
  await settle()
  assert.equal(requests.length, 1, '已排队的子目录请求也应被关闭状态拦住')
  f.inputLine.value = 'cd miraiTV/s'
  f.flush()
  assert.equal(requests[1].line, 'cd miraiTV/s')
  requests[1].resolve([directory('miraiTV/service/')])
  await settle()
  assert.equal(f.api.open.value, true)
  assert.equal(f.api.activeSuggestion.value.value, 'miraiTV/service/')
})

test('Esc 关闭后迟到结果不会重开弹层，新输入也不能选择旧候选', async t => {
  const f = fixture(t)
  await settle()
  f.inputLine.value = 'cd m'
  f.flush()
  f.api.close()
  requests[0].resolve([directory('miraiTV/')])
  await settle()
  assert.equal(f.api.open.value, false)
  f.inputLine.value = 'cd mi'
  f.flush()
  requests[1].resolve([directory('miraiTV/')])
  await settle()
  assert.equal(f.api.open.value, true)
  f.inputLine.value = 'cd other'
  assert.equal(f.api.open.value, false)
  assert.equal(f.api.activeSuggestion.value, undefined)
})

test('快速输入又删除回同一前缀时只接受最新请求，切换连接后旧候选失效', async t => {
  const f = fixture(t)
  await settle()
  f.inputLine.value = 'cd m'
  f.flush()
  f.inputLine.value = 'cd mi'
  f.flush()
  f.inputLine.value = 'cd m'
  f.flush()
  requests[0].resolve([directory('old/')])
  requests[1].resolve([directory('obsolete/')])
  await settle()
  assert.equal(f.api.open.value, false)
  requests[2].resolve([directory('miraiTV/')])
  await settle()
  assert.equal(f.api.activeSuggestion.value.value, 'miraiTV/')
  f.inputLine.value = 'cd miraiTV/s'
  f.flush()
  f.sessionId.value = 'session-2'
  await nextTick()
  requests[3].resolve([directory('miraiTV/service/')])
  await settle()
  assert.equal(f.api.open.value, false)
  assert.equal(f.api.suggestions.value.length, 0)
})

test('前缀收窄立即筛选同目录候选，精确缓存不重复查询，其他参数不复用', async t => {
  const f = fixture(t)
  await settle()
  f.inputLine.value = 'cd m'
  f.flush()
  requests[0].resolve([directory('miraiTV/'), directory('mirror/')])
  await settle()
  f.inputLine.value = 'cd mi'
  assert.equal(f.api.open.value, true)
  assert.equal(f.api.suggestions.value.length, 2)
  f.inputLine.value = 'cd miraiT'
  assert.equal(f.api.open.value, true)
  assert.equal(f.api.suggestions.value.length, 1)
  f.flush()
  assert.equal(requests.length, 2, '连续收窄只刷新最新前缀')
  f.inputLine.value = 'cd m'
  assert.equal(f.api.open.value, true)
  f.flush()
  assert.equal(requests.length, 2, '精确缓存不再发请求，旧排队任务也失效')
  f.inputLine.value = 'ls m'
  assert.equal(f.api.open.value, false)
  assert.equal(f.api.activeSuggestion.value, undefined)
})

test('接受目录后可主动查询下一层，已有命令尾空格可以补路径，求值表达式不补', async t => {
  const f = fixture(t)
  await settle()
  f.inputLine.value = 'cd miraiTV/'
  f.api.close()
  f.flush()
  assert.equal(requests.length, 0)
  f.api.request()
  assert.equal(requests[0].line, 'cd miraiTV/')
  requests[0].resolve([directory('miraiTV/src/')])
  await settle()
  assert.equal(f.api.open.value, true)
  f.inputLine.value = 'ls '
  f.flush()
  assert.equal(requests[1].line, 'ls ')
  requests[1].resolve([directory('data/')])
  await settle()
  assert.equal(f.api.open.value, true)
  f.inputLine.value = 'cd $(pwd)/x'
  f.flush()
  assert.equal(requests.length, 2)
  assert.equal(f.api.open.value, false)
})

test('引用路径 cd 只查询实际参数，OSC 7 的真实目录报告优先于迟到的启发式探测', async t => {
  const f = fixture(t)
  await settle()
  setDirectoryDeferral(true)
  const tracking = f.api.trackSubmittedCommand("cd -- 'nested folder'")
  assert.equal(directoryRequests[0].path, '/data/nested folder')
  assert.equal(
    f.api.updateWorkingDirectory('file://fixture/srv/actual%20cwd'),
    true
  )
  directoryRequests[0].resolve({ path: '/data/nested folder', entries: [] })
  await tracking
  assert.equal(f.api.cwd.value, '/srv/actual cwd')
  assert.equal(
    f.api.updateWorkingDirectory('https://example.invalid/not-a-directory'),
    false
  )
  await f.api.trackSubmittedCommand('cd elsewhere && pwd')
  assert.equal(directoryRequests.length, 1, '复合表达式不猜测目标')
  setDirectoryDeferral(false)
})

test('cd 探测与初始目录只属于原连接，旧会话的响应不能覆盖新会话目录', async t => {
  const f = fixture(t)
  await settle()
  setDirectoryDeferral(true)
  const tracking = f.api.trackSubmittedCommand('cd /old')
  f.sessionId.value = 'session-2'
  assert.equal(directoryRequests[1].id, 'session-2')
  directoryRequests[0].resolve({ path: '/old', entries: [] })
  await tracking
  assert.equal(f.api.cwd.value, '')
  directoryRequests[1].resolve({ path: '/new-home', entries: [] })
  await settle()
  assert.equal(f.api.cwd.value, '/new-home')
  setDirectoryDeferral(false)
})

test('卸载后排队任务不发请求，晚到响应不缓存或重开', async t => {
  const f = fixture(t)
  await settle()
  f.inputLine.value = 'cd m'
  f.scope.stop()
  f.flush()
  assert.equal(requests.length, 0)
  assert.equal(f.api.open.value, false)
})
