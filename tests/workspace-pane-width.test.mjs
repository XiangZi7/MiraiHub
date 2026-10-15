import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, computed, nextTick, shallowRef, toRef } from 'vue'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const vueUrl = JSON.stringify(import.meta.resolve('vue'))
const boundaries = dataModule(`
  import { shallowRef, computed, toValue } from ${vueUrl}
  export const sizes=new WeakMap(), storage=new Map()
  export const useWindowSize=()=>({width:shallowRef(1400)})
  export function useElementSize(container){
    if(!sizes.has(container))sizes.set(container,shallowRef(container.value?.width??900))
    return {width:sizes.get(container)}
  }
  export function useStorage(key,defaults){
    return computed({
      get:()=>storage.get(toValue(key))??defaults,
      set:value=>storage.set(toValue(key),value),
    })
  }
`)
const { sizes, storage } = await import(boundaries)
const load = sourceLoader({ '@vueuse/core': boundaries })
const { useWorkspaceLayoutStore } = await load('src/stores/workspace-layout.ts')
const { useMachinePaneWidth } = await load(
  'src/composables/useMachinePaneWidth.ts'
)
const { useAgentPaneWidth } = await load('src/composables/useAgentPaneWidth.ts')
const { useDatabaseSidebarWidth } = await load(
  'src/composables/useDatabaseSidebarWidth.ts'
)

function fixture(t) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const scope = effectScope()
  storage.clear()
  t.after(() => {
    scope.stop()
    disposePinia(pinia)
  })
  return { layout: useWorkspaceLayoutStore(), scope }
}

test('文件面板宽度、开关和文件/Agent 视图属于各自连接，打开及重置不串改', t => {
  const { layout } = fixture(t)
  const a = layout.machinePaneFor('a'),
    b = layout.machinePaneFor('b')
  const original = b.width
  a.width = 310
  a.open = false
  a.view = 'agent'
  assert.equal(b.width, original)
  assert.equal(b.open, true)
  assert.equal(b.view, 'files')
  layout.openMachinePane('a', 'files')
  assert.equal(a.open, true)
  assert.equal(a.view, 'files')
  assert.equal(layout.machinePaneFor('a'), a)
  layout.removeMachinePane('a')
  assert.equal(layout.machinePanes.a, undefined)
  assert.equal(layout.machinePaneFor('b'), b)
  b.width = 280
  b.open = false
  b.view = 'agent'
  layout.reset()
  assert.equal(b.open, true)
  assert.equal(b.view, 'files')
  assert.equal(b.width, layout.machineWidth)
})

test('按当前分屏限制文件面板尺寸，调整一侧不影响另一侧，缩小/隐藏不覆盖偏好', async t => {
  const { layout, scope } = fixture(t)
  const a = layout.machinePaneFor('a'),
    b = layout.machinePaneFor('b')
  a.width = 620
  b.width = 620
  const ca = shallowRef({ width: 616 }),
    cb = shallowRef({ width: 616 })
  const wa = scope.run(() => useMachinePaneWidth(ca, toRef(a, 'width')))
  const wb = scope.run(() => useMachinePaneWidth(cb, toRef(b, 'width')))
  assert.equal(wa.width.value, 346)
  assert.equal(wb.width.value, 346)
  wa.width.value = 280
  assert.equal(a.width, 280)
  assert.equal(b.width, 620)
  assert.equal(wb.width.value, 346)
  sizes.get(ca).value = 420
  await nextTick()
  assert.equal(wa.width.value, 226)
  assert.equal(a.width, 280)
  assert.ok(420 - wa.width.value - 10 > 180)
  sizes.get(ca).value = 700
  await nextTick()
  assert.equal(wa.width.value, 280)
  sizes.get(ca).value = 0
  await nextTick()
  assert.equal(wa.width.value, 280)
  wa.width.value = Infinity
  assert.equal(a.width, 280)
})

test('数据库与 Redis 的侧栏和 Agent 宽度按连接保存，切换连接恢复对应宽度', t => {
  const { scope } = fixture(t)
  const container = shallowRef({ width: 1200 }),
    id = shallowRef('a')
  const aAgent = scope.run(() =>
    useAgentPaneWidth(container, 'database', () => id.value)
  )
  const bAgent = scope.run(() => useAgentPaneWidth(container, 'database', 'b'))
  const aSidebar = scope.run(() =>
    useDatabaseSidebarWidth(container, () => id.value)
  )
  const bSidebar = scope.run(() => useDatabaseSidebarWidth(container, 'b'))
  aAgent.width.value = 300
  aSidebar.width.value = 320
  assert.equal(bAgent.width.value, 400)
  assert.equal(bSidebar.width.value, 248)
  id.value = 'b'
  assert.equal(aAgent.width.value, 400)
  assert.equal(aSidebar.width.value, 248)
  id.value = 'a'
  assert.equal(aAgent.width.value, 300)
  assert.equal(aSidebar.width.value, 320)
})
