import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, shallowRef } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const nativeUrl = dataModule(`
  export const requests = []
  export const listDirectory = async () => ({path:'/data',entries:[]})
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
const { requests } = await import(nativeUrl)
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
