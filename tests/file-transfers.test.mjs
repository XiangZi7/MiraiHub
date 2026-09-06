import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, nextTick, reactive } from 'vue'
import { createPinia, disposePinia, setActivePinia } from 'pinia'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'

const settings = reactive({
  maxFileTransfers: 3,
  notifyTransferComplete: true,
  overwriteBehavior: 'ask',
})
const api = {
  uploadFile: async () => '',
  downloadFile: async () => '',
  pathExists: async () => false,
}
let onTransfer
let toastCount = 0
Object.assign(globalThis, {
  transferFixture: {
    settings,
    api,
    listen: handler => {
      onTransfer = handler
    },
    toast: () => {
      toastCount++
    },
  },
})
const load = sourceLoader({
  '@/api/ssh': dataModule(`
    const fixture = globalThis.transferFixture
    export const onTransfer = async handler => { fixture.listen(handler); return () => {} }
    export const uploadFile = options => fixture.api.uploadFile(options)
    export const downloadFile = options => fixture.api.downloadFile(options)
    export const pathExists = (session, path) => fixture.api.pathExists(session, path)
    export const errorMessage = error => error instanceof Error ? error.message : String(error)
  `),
  '@/utils/window': dataModule('export const IS_TAURI = true'),
  '@/stores/settings': dataModule(
    'export const useSettingsStore = () => ({ values: globalThis.transferFixture.settings })'
  ),
  '@/composables/useSettings': dataModule(`
    export const useSettings = () => ({ settings: globalThis.transferFixture.settings })
    export const settingNumber = (key, fallback) => globalThis.transferFixture.settings[key] ?? fallback
  `),
  '@/composables/useToast': dataModule(
    'export const toast = { success: globalThis.transferFixture.toast, error: globalThis.transferFixture.toast }'
  ),
})
const { useTransfersStore } = await load('src/stores/transfers.ts')
const { useRemoteUploads } = await load('src/composables/useRemoteUploads.ts')
const tick = async () => {
  for (let i = 0; i < 12; i++) await Promise.resolve()
  await nextTick()
}

function fixture(t) {
  const pinia = createPinia()
  setActivePinia(pinia)
  const scope = effectScope()
  const store = useTransfersStore()
  const context = reactive({
    sessionId: 'server-a',
    connectionName: 'Server A',
    directory: '/uploads',
  })
  let refreshes = 0
  const uploads = scope.run(() =>
    useRemoteUploads({
      context: () => context,
      refresh: async () => {
        refreshes++
      },
    })
  )
  settings.maxFileTransfers = 3
  settings.folderUploadConcurrency = 4
  settings.overwriteBehavior = 'ask'
  settings.notifyTransferComplete = true
  api.pathExists = async () => false
  api.uploadFile = async () => ''
  api.downloadFile = async () => ''
  toastCount = 0
  t.after(() => {
    scope.stop()
    disposePinia(pinia)
  })
  return { store, context, uploads, scope, refreshes: () => refreshes }
}

test('上传目录成功聚合进度，完成与失败都在传输中心记录且不弹 toast', async t => {
  const { store } = fixture(t)
  api.uploadFile = async options => {
    onTransfer({
      taskId: options.taskId,
      status: 'running',
      transferredBytes: 7,
      totalBytes: 10,
      localPath: null,
      error: null,
    })
    assert.equal(store.activeTasks[0].transferredBytes, 7)
    return options.remotePath
  }
  assert.equal(
    await store.upload({
      sessionId: 'a',
      localPath: 'C:\\project',
      remotePath: '/project',
    }),
    true
  )
  assert.equal(store.tasks[0].transferredBytes, 10)
  assert.equal(store.unreadCount, 1)
  assert.equal(store.hasUnreadError, false)
  store.markAllSeen()
  api.uploadFile = async () => {
    throw new Error('permission denied')
  }
  assert.equal(
    await store.upload({
      sessionId: 'a',
      localPath: 'C:\\project',
      remotePath: '/project',
    }),
    false
  )
  assert.equal(store.tasks[0].error, 'permission denied')
  assert.equal(store.hasUnreadError, true)
  assert.equal(store.unreadCount, 1)
  api.downloadFile = async () => '/local/readme'
  assert.equal(
    await store.download({ sessionId: 'a', remotePath: '/readme' }),
    '/local/readme'
  )
  api.downloadFile = async () => {
    throw new Error('download failed')
  }
  assert.equal(
    await store.download({ sessionId: 'a', remotePath: '/readme' }),
    null
  )
  assert.equal(toastCount, 0)
  store.clearSettled()
  assert.equal(store.unreadCount, 0)
  assert.equal(store.tasks.length, 0)
})

test('同名目录允许确认合并，沿用覆盖策略，失败也刷新已写入的目录', async t => {
  const f = fixture(t)
  const calls = []
  api.pathExists = async () => true
  api.uploadFile = async options => {
    calls.push(options)
    throw new Error('second file failed')
  }
  const batch = f.uploads.uploadPaths(['C:/project'])
  await tick()
  assert.equal(f.uploads.conflictOpen.value, true)
  assert.equal(f.uploads.conflictFileName.value, 'project')
  f.uploads.settleConflict('overwrite')
  await batch
  assert.equal(calls.length, 1)
  assert.equal(calls[0].remotePath, '/uploads/project')
  assert.equal(calls[0].overwrite, true)
  assert.equal(f.refreshes(), 1)
  assert.equal(f.store.tasks[0].status, 'error')
  assert.equal(toastCount, 0)
})

test('跳过、取消全部与卸载确认框都不启动上传', async t => {
  const f = fixture(t)
  api.pathExists = async () => true
  let batch = f.uploads.uploadPaths(['C:/one', 'C:/two'])
  await tick()
  f.uploads.conflictAlways.value = true
  f.uploads.settleConflict('skip')
  await batch
  assert.equal(f.store.tasks.length, 0)
  batch = f.uploads.uploadPaths(['C:/one', 'C:/two'])
  await tick()
  f.uploads.settleConflict('cancel')
  await batch
  assert.equal(f.store.tasks.length, 0)
  batch = f.uploads.uploadPaths(['C:/one'])
  await tick()
  f.scope.stop()
  await batch
  assert.equal(f.store.tasks.length, 0)
})

test('上传前检查失败进入传输中心；自动重命名保留原有文件', async t => {
  const f = fixture(t)
  api.pathExists = async () => {
    throw new Error('connection lost')
  }
  await f.uploads.uploadPaths(['C:/project'])
  assert.equal(f.store.tasks[0].error, 'connection lost')
  assert.equal(f.store.unreadCount, 1)
  assert.equal(toastCount, 0)
  settings.overwriteBehavior = 'rename'
  api.pathExists = async (_session, path) => path !== '/uploads/project (2)'
  const calls = []
  api.uploadFile = async options => {
    calls.push(options)
    return options.remotePath
  }
  await f.uploads.uploadPaths(['C:/project'])
  assert.equal(calls[0].remotePath, '/uploads/project (2)')
  assert.equal(calls[0].overwrite, false)
})

test('连续批次串行确认，切换服务器不会改变已经选择的上传目标', async t => {
  const f = fixture(t)
  api.pathExists = async () => true
  const calls = []
  api.uploadFile = async options => {
    calls.push(options)
    return options.remotePath
  }
  const first = f.uploads.uploadPaths(['C:/one'])
  const second = f.uploads.uploadPaths(['C:/two'])
  await tick()
  assert.equal(f.uploads.conflictFileName.value, 'one')
  f.context.sessionId = 'server-b'
  f.context.directory = '/other'
  f.uploads.settleConflict('overwrite')
  await first
  await tick()
  assert.equal(f.uploads.conflictFileName.value, 'two')
  f.uploads.settleConflict('overwrite')
  await second
  assert.deepEqual(
    calls.map(call => [call.sessionId, call.remotePath]),
    [
      ['server-a', '/uploads/one'],
      ['server-a', '/uploads/two'],
    ]
  )
  assert.equal(f.refreshes(), 0)
})

test('关闭完成提醒只影响导航栏标记，仍保留完成记录', async t => {
  const { store } = fixture(t)
  settings.notifyTransferComplete = false
  await store.upload({
    sessionId: 'a',
    localPath: 'C:/file',
    remotePath: '/file',
  })
  assert.equal(store.tasks[0].status, 'completed')
  assert.equal(store.unreadCount, 0)
  assert.equal(toastCount, 0)
})

function deferred() {
  let resolve
  const promise = new Promise(done => {
    resolve = done
  })
  return { promise, resolve }
}

test('多文件上传填满并发队列，修改上限启动排队任务，单个失败不阻塞余下文件', async t => {
  const f = fixture(t)
  settings.maxFileTransfers = 2
  settings.folderUploadConcurrency = 8
  const calls = []
  const gates = []
  api.uploadFile = async options => {
    const gate = deferred()
    calls.push(options)
    gates.push(gate)
    await gate.promise
    if (options.localPath.endsWith('/one')) throw new Error('first failed')
  }
  const batch = f.uploads.uploadPaths([
    'C:/one',
    'C:/two',
    'C:/three',
    'C:/four',
    'C:/five',
  ])
  await tick()
  await tick()
  assert.equal(calls.length, 2)
  assert.equal(f.store.tasks.filter(task => task.status === 'queued').length, 3)
  assert.equal(calls[0].concurrency, 8)
  settings.maxFileTransfers = 3
  await tick()
  assert.equal(calls.length, 3)
  gates[0].resolve()
  await tick()
  assert.equal(calls.length, 4)
  assert.equal(f.store.failedTasks.length, 1)
  gates[1].resolve()
  await tick()
  assert.equal(calls.length, 5)
  gates.forEach(gate => gate.resolve())
  await batch
  assert.equal(f.store.completedTasks.length, 4)
  assert.equal(f.refreshes(), 1)
})

test('并发上传自动重命名会预留目标名称，避免同时写入同一个新文件', async t => {
  const f = fixture(t)
  settings.overwriteBehavior = 'rename'
  const gate = deferred()
  const calls = []
  api.pathExists = async (_session, path) => path === '/uploads/file.txt'
  api.uploadFile = async options => {
    calls.push(options)
    await gate.promise
  }
  const batch = f.uploads.uploadPaths([
    'C:/first/file.txt',
    'C:/second/file.txt',
  ])
  await tick()
  await tick()
  assert.deepEqual(
    calls.map(call => call.remotePath),
    ['/uploads/file (1).txt', '/uploads/file (2).txt']
  )
  gate.resolve()
  await batch
})

test('并发设为 1 时保留排队与取消能力', async t => {
  const f = fixture(t)
  settings.maxFileTransfers = 1
  const gates = []
  api.uploadFile = async () => {
    const gate = deferred()
    gates.push(gate)
    await gate.promise
  }
  const batch = f.uploads.uploadPaths(['C:/one', 'C:/two', 'C:/three'])
  await tick()
  await tick()
  assert.equal(gates.length, 1)
  const queued = f.store.tasks.find(task => task.status === 'queued')
  await f.store.cancel(queued.id)
  gates[0].resolve()
  await tick()
  assert.equal(gates.length, 2)
  gates[1].resolve()
  await batch
  assert.equal(f.store.completedTasks.length, 2)
  assert.equal(
    f.store.tasks.filter(task => task.status === 'cancelled').length,
    1
  )
})
