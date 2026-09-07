import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, shallowRef } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const mockUrl = dataModule(`
  export const mock = { records:new Map(), runs:new Map(), serial:0, starts:[], forgotten:[], stepGate:null, listGate:null, openError:false }
  const key = target => target.kind + ':' + target.sessionId + ':' + target.database
  const clone = value => structuredClone(value)
  const save = run => mock.records.set(run.conversationId, clone(run))
  export const listConversations = async target => {
    const result = [...mock.records.values()].filter(run => run.scope === key(target)).reverse().map(run => ({id:run.conversationId,title:run.title || run.entries[0].text,model:run.model,provider:run.provider,createdAt:1,updatedAt:2}))
    if(mock.listGate) await mock.listGate
    return result
  }
  export const openConversation = async (target,id) => {
    if(mock.openError) throw new Error('读取失败')
    const run = clone(mock.records.get(id))
    if(run.scope !== key(target)) throw new Error('错误目标')
    return {...run,id:'',approval:null,status:run.status === 'completed' ? 'completed' : 'cancelled'}
  }
  export const start = async (target,prompt,profileId,conversationId) => {
    mock.starts.push({target:clone(target),prompt,profileId,conversationId})
    const id = 'run-' + ++mock.serial
    const previous = conversationId ? await openConversation(target,conversationId) : null
    const run = {id,conversationId:conversationId || 'chat-' + mock.serial,scope:key(target),target:'test',model:'mock',provider:'https://example.com',status:'running',approval:null,entries:[...(previous?.entries || []),{role:'user',text:prompt}]}
    mock.runs.set(id,run);save(run);return clone(run)
  }
  export const send = async (id,prompt) => { const run = mock.runs.get(id); run.status='running';run.entries.push({role:'user',text:prompt});save(run);return clone(run) }
  export const step = async id => {
    if(mock.stepGate) return await mock.stepGate
    const run = mock.runs.get(id);run.status='completed';run.entries.push({role:'assistant',text:'**回复**'});save(run);return clone(run)
  }
  export const cancel = async id => {const run=mock.runs.get(id);if(run){run.status='cancelled';run.approval=null;save(run)}}
  export const forget = async id => {mock.forgotten.push(id)}
  export const deleteConversation = async (target,id) => {await openConversation(target,id);mock.records.delete(id)}
  export const renameConversation = async (target,id,title) => {
    await openConversation(target,id)
    if(!title.trim()) throw new Error('名称不能为空')
    const run=mock.records.get(id);run.title=title.trim()
    return {id,title:run.title,model:run.model,provider:run.provider,createdAt:1,updatedAt:2}
  }
  export const respond = async () => {throw new Error('历史审批不得执行')}
  export const errorMessage = error => error.message
`)
const { mock } = await import(mockUrl)
const { useAiAgent } = await sourceLoader({ '@/api/agent': mockUrl })(
  'src/composables/useAiAgent.ts'
)
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture(reset = true) {
  if (reset) {
    mock.records.clear()
    mock.runs.clear()
    mock.serial = 0
    mock.starts = []
    mock.forgotten = []
    mock.stepGate = null
    mock.listGate = null
    mock.openError = false
  }
  const target = shallowRef({
    kind: 'ssh',
    sessionId: 'server-a',
    database: '',
  })
  const active = shallowRef(true)
  const profile = shallowRef('profile-a')
  let state
  const renderer = createRenderer({
    createElement: () => ({}),
    createText: () => ({}),
    createComment: () => ({}),
    setText() {},
    setElementText() {},
    patchProp() {},
    insert() {},
    remove() {},
    parentNode: () => null,
    nextSibling: () => null,
  })
  const app = renderer.createApp({
    setup() {
      state = useAiAgent(target, active, profile)
      return () => null
    },
  })
  app.mount({})
  return { app, state, target, active, profile }
}

test('new conversations retain history, switching restores context and remount loads the latest chat', async () => {
  const { app, state } = fixture()
  await flush()
  assert.equal(await state.send('第一轮'), true)
  const first = state.run.value.conversationId
  await state.clear()
  assert.equal(state.run.value, null)
  assert.equal(state.conversations.value.length, 1)
  await state.send('另一个任务')
  assert.notEqual(state.run.value.conversationId, first)
  assert.equal(state.conversations.value.length, 2)
  await state.selectConversation(first)
  assert.equal(state.run.value.id, '')
  assert.equal(state.run.value.entries[0].text, '第一轮')
  await state.send('继续追问')
  assert.equal(mock.starts.at(-1).conversationId, first)
  assert.equal(state.run.value.entries.filter(e => e.role === 'user').length, 2)
  app.unmount()
  const reopened = fixture(false)
  await flush()
  assert.equal(reopened.state.conversations.value.length, 2)
  assert.ok(reopened.state.run.value)
  assert.equal(reopened.state.run.value.id, '')
  reopened.app.unmount()
})

test('late responses cannot replace a selected historical conversation', async () => {
  const { app, state } = fixture()
  await flush()
  await state.send('历史会话')
  const first = state.run.value.conversationId
  await state.clear()
  let finish
  mock.stepGate = new Promise(resolve => {
    finish = resolve
  })
  const pending = state.send('正在运行的会话')
  await flush()
  const old = JSON.parse(JSON.stringify(state.run.value))
  await state.selectConversation(first)
  finish({
    ...old,
    status: 'approval',
    approval: {
      id: 'expired',
      command: 'write',
      reason: 'test',
      label: 'Shell',
      expiresAt: 0,
    },
  })
  await pending
  assert.equal(state.run.value.conversationId, first)
  assert.equal(state.run.value.approval, null)
  assert.equal(state.awaitingApproval.value, false)
  assert.ok(mock.forgotten.includes(old.id))
  app.unmount()
})

test('loading blocks send and changing targets ignores stale history and approvals', async () => {
  const { app, state, target } = fixture()
  await flush()
  await state.send('SSH 私有历史')
  let release
  mock.listGate = new Promise(resolve => {
    release = resolve
  })
  const loading = state.refreshHistory()
  assert.equal(await state.send('不应发送'), false)
  target.value = { kind: 'database', sessionId: 'db-a', database: 'jac' }
  await flush()
  release()
  await loading
  await flush()
  assert.equal(state.run.value, null)
  assert.equal(state.conversations.value.length, 0)
  assert.equal(state.historyLoading.value, false)
  mock.listGate = null
  await state.send('数据库任务')
  assert.equal(state.run.value.entries[0].text, '数据库任务')
  app.unmount()
})

test('deleting removes the saved transcript and historical snapshots cannot approve old work', async () => {
  const { app, state } = fixture()
  await flush()
  await state.send('将被删除')
  const id = state.run.value.conversationId
  await state.clear()
  await state.selectConversation(id)
  await state.decide(true)
  assert.equal(state.error.value, '')
  await state.removeConversation()
  assert.equal(state.run.value, null)
  assert.equal(state.conversations.value.length, 0)
  assert.equal(mock.records.has(id), false)
  app.unmount()
})

test('failed history reads remain visible and do not delete the transcript', async () => {
  const { app, state } = fixture()
  await flush()
  await state.send('保留这段对话')
  const id = state.run.value.conversationId
  await state.clear()
  mock.openError = true
  await state.selectConversation(id)
  assert.equal(state.historyError.value, '读取失败')
  assert.equal(mock.records.has(id), true)
  mock.openError = false
  await state.selectConversation(id)
  assert.equal(state.historyError.value, '')
  assert.equal(state.run.value.conversationId, id)
  app.unmount()
})

test('renaming and deleting another transcript do not interrupt an active response', async () => {
  const { app, state } = fixture()
  await flush()
  await state.send('旧会话')
  const previous = state.run.value.conversationId
  await state.clear()
  let finish
  mock.stepGate = new Promise(resolve => {
    finish = resolve
  })
  const pending = state.send('当前任务')
  await flush()
  const active = JSON.parse(JSON.stringify(state.run.value))
  await state.renameConversation(previous, '服务器笔记')
  assert.equal(
    state.conversations.value.find(item => item.id === previous).title,
    '服务器笔记'
  )
  assert.equal(state.busy.value, true)
  assert.equal(state.run.value.id, active.id)
  await state.removeConversation(previous)
  assert.equal(mock.records.has(previous), false)
  assert.equal(state.busy.value, true)
  assert.equal(state.run.value.id, active.id)
  finish({
    ...active,
    status: 'completed',
    entries: [...active.entries, { role: 'assistant', text: '当前完成' }],
  })
  await pending
  assert.equal(state.run.value.entries.at(-1).text, '当前完成')
  assert.ok(!mock.forgotten.includes(active.id))
  app.unmount()
})

test('rename errors keep the old name and conversation visible', async () => {
  const { app, state } = fixture()
  await flush()
  await state.send('保留名称')
  const id = state.run.value.conversationId
  await state.renameConversation(id, ' ')
  assert.equal(state.historyError.value, '名称不能为空')
  assert.equal(state.conversations.value[0].title, '保留名称')
  assert.equal(state.run.value.conversationId, id)
  assert.equal(state.historyMutating.value, false)
  app.unmount()
})
