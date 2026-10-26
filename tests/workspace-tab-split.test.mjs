import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, reactive, shallowRef } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const eventsUrl = dataModule(`
  export const listeners=new Map()
  export function useEventListener(type,handler){listeners.set(type,handler)}
  export function useRafFn(){return {pause(){},resume(){}}}
`)
const { listeners } = await import(eventsUrl)
const load = sourceLoader({ '@vueuse/core': eventsUrl })
const { useWorkspaceTabSplit } = await load(
  'src/composables/useWorkspaceTabSplit.ts'
)
const { useTabReorder } = await load('src/composables/useTabReorder.ts')
const { useSplitDropZone } = await load('src/composables/useSplitDropZone.ts')
const { useSplitPanes } = await load('src/composables/useSplitPanes.ts')

function fixture(t) {
  listeners.clear()
  const tabs = reactive(['a', 'b', 'c', 'd'].map(id => ({ id })))
  const activeId = shallowRef('b'),
    enabled = shallowRef(true),
    scope = effectScope()
  const layout = scope.run(() =>
    useWorkspaceTabSplit({
      tabs: () => tabs,
      activeId: () => activeId.value,
      enabled: () => enabled.value,
    })
  )
  const rootId = layout.tree.value.id
  const rect = (left, top, width, height) => ({
    left,
    top,
    width,
    height,
    right: left + width,
    bottom: top + height,
  })
  const root = { dataset: { workspaceTabGroup: rootId } }
  const bar = {}
  const tabElements = ['a', 'b'].map((id, index) => ({
    dataset: { reorderableTabId: id },
    getBoundingClientRect: () => rect(index * 100, 0, 100, 40),
    closest: selector =>
      selector === '[data-reorderable-tab-id]'
        ? tabElements[index]
        : selector === '[data-workspace-tab-bar]'
          ? bar
          : selector === '[data-workspace-tab-group]'
            ? root
            : null,
  }))
  const pane = {
    getBoundingClientRect: () => rect(0, 50, 1000, 600),
    closest: selector =>
      selector === '[data-workspace-tab-group]' ? root : null,
  }
  const container = {
    contains: el => tabElements.includes(el),
    getBoundingClientRect: () => rect(0, 0, 300, 40),
    querySelectorAll: () => tabElements,
  }
  const previousDocument = globalThis.document
  globalThis.document = {
    elementFromPoint: (x, y) => (y < 40 ? tabElements[x < 100 ? 0 : 1] : pane),
  }
  layout.setTarget(rootId, pane)
  const reordered = []
  const reorder = scope.run(() =>
    useTabReorder({
      tabs: () =>
        layout.groups.value
          .find(group => group.id === rootId)
          ?.tabIds.map(id => ({ id })) ?? [],
      container: () => container,
      onReorder: (from, to) => {
        reordered.push([from, to])
        layout.reorder(rootId, from, to)
      },
      onDragMove: layout.preview,
      onDrop: drag => {
        if (layout.drop(drag)) activeId.value = drag.id
      },
      onDragEnd: layout.clearPreview,
    })
  )
  const pointer = (x, y, pointerId = 1) => ({
    clientX: x,
    clientY: y,
    pointerId,
    button: 0,
    isPrimary: true,
    target: { closest: () => null },
    currentTarget: {},
    preventDefault() {},
  })
  t.after(() => {
    scope.stop()
    if (previousDocument) globalThis.document = previousDocument
    else delete globalThis.document
  })
  return {
    tabs,
    activeId,
    enabled,
    layout,
    rootId,
    reorder,
    reordered,
    pointer,
  }
}

for (const [x, y, direction] of [
  [10, 350, 'left'],
  [990, 350, 'right'],
  [500, 60, 'up'],
  [500, 640, 'down'],
]) {
  test('拖动标签到 ' + direction + ' 创建带独立 Tabs 的分组', t => {
    const { layout, rootId, reorder, reordered, pointer } = fixture(t)
    reorder.start(pointer(20, 20), 'a')
    listeners.get('pointermove')(pointer(x, y))
    assert.deepEqual(layout.dropTarget.value, {
      groupId: rootId,
      position: direction,
    })
    listeners.get('pointerup')(pointer(x, y))
    assert.equal(layout.tree.value.type, 'split')
    const leaves = layout.groups.value
    assert.deepEqual(
      leaves.map(group => group.activeId),
      direction === 'up' || direction === 'left' ? ['a', 'b'] : ['b', 'a']
    )
    assert.deepEqual(layout.groupForTab('a').tabIds, ['a'])
    assert.deepEqual(layout.groupForTab('b').tabIds, ['b', 'c', 'd'])
    assert.deepEqual(layout.tree.value.ratios, [50, 50])
    assert.ok(layout.isVisible('a') && layout.isVisible('b'))
    assert.deepEqual(reordered, [])
    assert.equal(layout.dropTarget.value, null)
    assert.equal(reorder.consumeSuppressedClick('a'), true)
  })
}

test('同组标签栏排序，小位移点击不分屏', t => {
  const { layout, reorder, reordered, pointer } = fixture(t)
  reorder.start(pointer(20, 20), 'a')
  listeners.get('pointermove')(pointer(22, 21))
  listeners.get('pointerup')(pointer(22, 21))
  assert.equal(reorder.consumeSuppressedClick('a'), false)
  reorder.start(pointer(20, 20), 'a')
  listeners.get('pointermove')(pointer(190, 20))
  listeners.get('pointerup')(pointer(190, 20))
  assert.deepEqual(reordered, [[0, 1]])
  assert.deepEqual(layout.tree.value.tabIds, ['b', 'a', 'c', 'd'])
  assert.equal(layout.split.value, false)
})

test('取消、移出内容区与停用页面不分屏；取消后的补发点击不激活标签', t => {
  const { layout, reorder, enabled, pointer } = fixture(t)
  for (const cancel of [
    () => listeners.get('keydown')({ key: 'Escape' }),
    () => listeners.get('pointercancel')(pointer(990, 350)),
    () => listeners.get('blur')(),
  ]) {
    reorder.start(pointer(20, 20), 'a')
    listeners.get('pointermove')(pointer(990, 350))
    cancel()
    listeners.get('pointerup')(pointer(990, 350))
    assert.equal(layout.split.value, false)
    assert.equal(layout.dropTarget.value, null)
    assert.equal(reorder.consumeSuppressedClick('a'), true)
  }
  assert.equal(layout.drop({ id: 'a', clientX: 1200, clientY: 350 }), false)
  enabled.value = false
  assert.equal(layout.drop({ id: 'a', clientX: 990, clientY: 350 }), false)
})

test('左右分屏的一侧可再上下分屏，各组活动标签独立，分隔条仅调整当前分支', async t => {
  const { layout, rootId, activeId } = fixture(t)
  layout.moveTab('a', rootId, 'right')
  layout.moveTab('c', rootId, 'up')
  assert.equal(layout.tree.value.orientation, 'horizontal')
  assert.equal(layout.tree.value.children[0].orientation, 'vertical')
  assert.deepEqual(
    layout.groups.value.map(group => group.activeId),
    ['c', 'b', 'a']
  )
  const nested = layout.tree.value.children[0]
  layout.resize(nested.id, 70)
  assert.deepEqual(layout.tree.value.ratios, [50, 50])
  assert.deepEqual(layout.tree.value.children[0].ratios, [70, 30])
  activeId.value = 'd'
  await nextTick()
  assert.deepEqual(
    layout.groups.value.map(group => group.activeId),
    ['c', 'd', 'a']
  )
  layout.reorder(rootId, 1, 0)
  assert.deepEqual(layout.groupForTab('d').tabIds, ['d', 'b'])
  assert.equal(layout.groups.value.flatMap(group => group.tabIds).length, 4)
})

test('中央或目标 Tabs 栏投放加入分组，空组自动折叠，不关闭连接标签', t => {
  const { layout, rootId } = fixture(t)
  layout.moveTab('a', rootId, 'right')
  assert.equal(layout.drop({ id: 'a', clientX: 500, clientY: 350 }), true)
  assert.equal(layout.split.value, false)
  assert.deepEqual(layout.tree.value.tabIds, ['b', 'c', 'd', 'a'])
  layout.moveTab('a', rootId, 'right')
  assert.equal(layout.drop({ id: 'a', clientX: 110, clientY: 20 }), true)
  assert.deepEqual(layout.tree.value.tabIds, ['a', 'b', 'c', 'd'])
  assert.equal(layout.tree.value.activeId, 'a')
})

test('合并、关闭标签和添加标签保持树内标签唯一，关闭空组后仍可继续打开连接', async t => {
  const { layout, rootId, tabs, activeId } = fixture(t)
  layout.moveTab('a', rootId, 'right')
  layout.moveTab('c', rootId, 'up')
  layout.mergeGroup(layout.groupForTab('c').id)
  assert.equal(layout.groups.value.length, 2)
  assert.equal(
    new Set(layout.groups.value.flatMap(group => group.tabIds)).size,
    4
  )
  activeId.value = 'a'
  await nextTick()
  tabs.push({ id: 'e' })
  activeId.value = 'e'
  await nextTick()
  assert.deepEqual(layout.groupForTab('e').tabIds, ['a', 'e'])
  assert.equal(layout.preferredAfterClose(['e']), 'a')
  tabs.splice(
    tabs.findIndex(tab => tab.id === 'a'),
    1
  )
  tabs.splice(
    tabs.findIndex(tab => tab.id === 'e'),
    1
  )
  activeId.value = 'b'
  await nextTick()
  assert.equal(layout.tree.value.type, 'group')
  tabs.splice(0)
  activeId.value = ''
  await nextTick()
  assert.deepEqual(layout.tree.value.tabIds, [])
  assert.ok(layout.targetFor(''))
  tabs.push({ id: 'fresh' })
  activeId.value = 'fresh'
  await nextTick()
  assert.equal(layout.tree.value.activeId, 'fresh')
  assert.equal(layout.moveTab('fresh', layout.tree.value.id, 'left'), false)
  assert.equal(layout.moveTab('missing', layout.tree.value.id, 'right'), false)
})

test('终端内分屏比例与主面板 id 保持稳定', () => {
  const layout = useSplitPanes({ rootId: 'primary' })
  layout.add('left', 'left')
  layout.focus('primary')
  layout.add('up', 'above')
  assert.deepEqual(
    layout.panes.value.map(pane => pane.id),
    ['left', 'above', 'primary']
  )
  layout.resize(1, 100)
  assert.deepEqual(layout.ratios.value, [50, 42.5, 7.5])
  layout.add('right', 'primary')
  assert.equal(layout.panes.value.length, 3)
})

test('分屏按钮取消拖拽后抑制点击，下一次正常点击不受影响', t => {
  const scope = effectScope(),
    dropped = []
  const gesture = scope.run(() =>
    useSplitDropZone({
      container: () => ({
        getBoundingClientRect: () => ({
          left: 0,
          right: 1000,
          top: 0,
          bottom: 600,
          width: 1000,
          height: 600,
        }),
      }),
      onDrop: direction => dropped.push(direction),
    })
  )
  const pointer = (x, y) => ({
    clientX: x,
    clientY: y,
    pointerId: 1,
    button: 0,
    isPrimary: true,
    currentTarget: {},
    preventDefault() {},
  })
  t.after(() => scope.stop())
  gesture.start(pointer(20, 20))
  listeners.get('pointermove')(pointer(990, 300))
  listeners.get('keydown')({ key: 'Escape' })
  listeners.get('pointerup')(pointer(990, 300))
  assert.deepEqual(dropped, [])
  assert.equal(gesture.consumeSuppressedClick(), true)
  gesture.start(pointer(20, 20))
  listeners.get('pointerup')(pointer(20, 20))
  assert.equal(gesture.consumeSuppressedClick(), false)
  gesture.start(pointer(20, 20))
  listeners.get('pointermove')(pointer(10, 300))
  listeners.get('pointerup')(pointer(10, 300))
  assert.deepEqual(dropped, ['left'])
  assert.equal(gesture.consumeSuppressedClick(), true)
})
