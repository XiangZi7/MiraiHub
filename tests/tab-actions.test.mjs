import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { test } from 'node:test'
import { nextTick, reactive, watch } from 'vue'
import ts from 'typescript'

function moduleUrl(path, replacements = {}) {
  let { outputText } = ts.transpileModule(readFileSync(new URL(path, import.meta.url), 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  })
  for (const [source, target] of Object.entries({ vue: import.meta.resolve('vue'), ...replacements }))
    outputText = outputText.replace(new RegExp(`from ['"]${source}['"]`, 'g'), `from '${target}'`)
  return `data:text/javascript;base64,${Buffer.from(outputText).toString('base64')}`
}
const helpersUrl = moduleUrl('../src/utils/tab-actions.ts')
const { tabCloseTargets, activeAfterTabClose } = await import(helpersUrl)
const { useDatabaseTabActions } = await import(moduleUrl('../src/composables/useDatabaseTabActions.ts'))

test('关闭范围按右键目标和当前显示顺序计算，并保留不可关闭标签', () => {
  const tabs = ['a', 'fixed', 'c', 'b', 'd'].map(id => ({ id, closable: id !== 'fixed' }))
  const before = structuredClone(tabs)
  for (const [scope, expected] of Object.entries({ current: ['b'], others: ['a', 'c', 'd'], left: ['a', 'c'], right: ['d'], all: ['a', 'c', 'b', 'd'] }))
    assert.deepEqual(tabCloseTargets(tabs, 'b', scope), expected)
  assert.deepEqual(tabCloseTargets(tabs, 'fixed', 'current'), [])
  for (const scope of ['current', 'others', 'left', 'right', 'all'])
    assert.deepEqual(tabCloseTargets(tabs, 'removed', scope), [])
  assert.deepEqual(tabs, before)
})

test('关闭后保持活动标签，或选择最近右邻、左邻；全关后清空', () => {
  const tabs = ['a', 'b', 'c', 'd'].map(id => ({ id }))
  assert.equal(activeAfterTabClose(tabs, 'b', ['a', 'd']), 'b')
  assert.equal(activeAfterTabClose(tabs, 'b', ['b', 'c']), 'd')
  assert.equal(activeAfterTabClose(tabs, 'd', ['c', 'd']), 'b')
  assert.equal(activeAfterTabClose(tabs, 'b', ['a', 'b', 'c', 'd']), '')
  assert.equal(activeAfterTabClose([], '', ['missing']), '')
})

function queryFixture() {
  const tabs = reactive([
    { id: 'empty', label: 'Empty', kind: 'query', sql: '  ' },
    { id: 'draft', label: 'Draft', kind: 'query', sql: 'SELECT 1' },
    { id: 'saved', label: 'Saved', kind: 'query', sql: 'SELECT 2', savedQueryId: 's1' },
    { id: 'deleted', label: 'Deleted saved query', kind: 'query', sql: 'SELECT 3', savedQueryId: 'gone' },
    { id: 'designer', label: 'New table', kind: 'table-designer' },
    { id: 'object', label: 'Table data', kind: 'object' },
  ])
  const events = []
  const actions = useDatabaseTabActions({
    tabs: () => tabs, close: ids => events.push(['close', ids]),
    hasSavedQuery: id => id === 's1',
    save: id => events.push(['save', id]), duplicate: id => events.push(['duplicate', id]),
    copy: async id => { events.push(['copy', id]) },
  })
  return { tabs, events, actions }
}

test('空查询、自动保存查询与对象可直接关闭，临时 SQL 和建表草稿需要确认', () => {
  const { events, actions } = queryFixture()
  actions.requestClose(['empty', 'saved', 'object'])
  assert.deepEqual(events, [['close', ['empty', 'saved', 'object']]])
  for (const id of ['draft', 'deleted', 'designer']) {
    actions.requestClose([id])
    assert.deepEqual(actions.state.pendingIds, [id])
    assert.equal(events.length, 1)
    actions.cancel()
  }
})

test('取消批量关闭不移除任何标签，确认只关闭原始快照中的标签', () => {
  const { tabs, events, actions } = queryFixture()
  actions.requestClose(['draft', 'designer', 'object', 'missing'])
  assert.match(actions.description.value, /Draft.*New table/)
  actions.cancel()
  assert.deepEqual(events, [])
  actions.requestClose(['draft', 'designer', 'object'])
  tabs.push({ id: 'new', label: 'New', kind: 'query', sql: 'SELECT 4' })
  actions.confirm()
  assert.deepEqual(events, [['close', ['draft', 'designer', 'object']]])
  assert.deepEqual(actions.state.pendingIds, [])
})

test('查询操作精确定位右键标签，空 SQL、非查询及已移除目标不执行操作', async () => {
  const { events, actions } = queryFixture()
  for (const action of ['query:save', 'query:copy', 'query:duplicate'])
    await actions.action('draft', action)
  for (const id of ['empty', 'object', 'missing']) {
    await actions.action(id, 'query:save')
    await actions.action(id, 'query:copy')
  }
  await actions.action('object', 'query:duplicate')
  await actions.action('draft', 'unknown')
  assert.deepEqual(events, [['save', 'draft'], ['copy', 'draft'], ['duplicate', 'draft']])
})

test('工作区批量关闭保留共享数组引用，不激活即将被关闭的连接', async () => {
  const storage = new Map()
  globalThis.localStorage = { setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) }
  const { useWorkspaceTabs } = await import(moduleUrl('../src/composables/useWorkspaceTabs.ts', {
    '@/utils/tab-actions': helpersUrl,
    '@/composables/useSettings': 'data:text/javascript,export const settings={restoreLastSession:true}',
  }))
  const workspace = useWorkspaceTabs()
  const shared = workspace.tabs
  for (const id of ['a', 'b', 'c', 'd']) workspace.open({ id, name: id })
  workspace.activate('b')
  await nextTick()
  const activated = []
  const stop = watch(workspace.activeId, id => activated.push(id), { flush: 'sync' })
  workspace.closeMany(['b', 'c'])
  assert.equal(workspace.tabs, shared)
  assert.deepEqual(shared.map(tab => tab.id), ['a', 'd'])
  assert.deepEqual(activated, ['d'])
  workspace.reorder(1, 0)
  workspace.closeMany(['a'])
  assert.equal(workspace.activeId.value, 'd')
  workspace.closeMany(['d'])
  await nextTick()
  assert.equal(workspace.activeId.value, '')
  assert.deepEqual(shared, [])
  assert.deepEqual(JSON.parse(storage.get('miraihub:workspace-tabs')), { ids: [], activeId: '' })
  stop()
  delete globalThis.localStorage
})


test('菜单在打开确认框前恢复标签焦点，后续更新不会抢走弹窗焦点', async () => {
  const { useTabContextMenu } = await import(moduleUrl('../src/composables/useTabContextMenu.ts', {
    '@/utils/tab-actions': helpersUrl,
    '@/utils/clipboard': 'data:text/javascript,export async function copyText(){}',
    '@/composables/useToast': 'data:text/javascript,export const toast={success(){},error(){}}',
  }))
  const body = { closest: () => null }
  const dialog = { closest: () => null }
  const menuItem = { closest: () => ({}) }
  globalThis.document = { activeElement: menuItem, body }
  const tab = { dataset: { reorderableTabId: 'b' }, focus: () => { document.activeElement = tab }, closest: () => null }
  let previous
  const menu = useTabContextMenu({
    tabs: () => [{ id: 'a', label: 'A', closable: true }, { id: 'b', label: 'B', closable: true }],
    container: () => ({ querySelectorAll: () => [tab] }), active: () => 'a', extraItems: () => [],
    close: () => { previous = document.activeElement; document.activeElement = dialog },
    closeMany: () => {}, reorder: () => {}, action: () => {},
  })
  menu.state.id = 'b'
  menu.state.open = true
  await menu.select('tabs:current')
  await nextTick()
  assert.equal(previous, tab)
  assert.equal(document.activeElement, dialog)
  assert.equal(menu.state.open, false)
  delete globalThis.document
})
