import assert from 'node:assert/strict'
import { test } from 'node:test'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'
import { createPinia, disposePinia } from 'pinia'
import { updaterManifest } from '../scripts/updater-manifest.mjs'

const { createUpdateController, initialUpdateState } = await sourceLoader()(
  'src/utils/app-updater.ts'
)
function fixture(overrides = {}) {
  const state = initialUpdateState()
  const calls = { check: 0, download: 0, install: 0, close: 0 }
  const update = {
    version: '2.1.0',
    download: async report => {
      calls.download++
      report({ event: 'Started', data: { contentLength: 100 } })
      report({ event: 'Progress', data: { chunkLength: 40 } })
      report({ event: 'Progress', data: { chunkLength: 60 } })
      report({ event: 'Finished' })
    },
    install: async () => {
      calls.install++
    },
    close: async () => {
      calls.close++
    },
  }
  const controller = createUpdateController({
    state,
    check: async () => {
      calls.check++
      return update
    },
    canInstall: async () => true,
    enabled: () => true,
    changed() {},
    ...overrides,
  })
  return { state, calls, update, controller }
}

test('downloads one update, tracks bytes and installs only after idle preflight', async () => {
  let idle = false
  const { controller, state, calls } = fixture({ canInstall: async () => idle })
  await Promise.all([controller.check(), controller.check()])
  assert.equal(calls.check, 1)
  assert.equal(calls.download, 1)
  assert.equal(state.phase, 'ready')
  assert.equal(state.downloaded, 100)
  await controller.installWhenIdle()
  assert.equal(calls.install, 0)
  await controller.check()
  assert.equal(calls.check, 1)
  idle = true
  await Promise.all([
    controller.installWhenIdle(),
    controller.installWhenIdle(),
  ])
  assert.equal(calls.install, 1)
  assert.equal(state.phase, 'installing')
})

test('latest and network errors never start an installer; checks can be retried', async () => {
  let failed = true
  const { controller, state, calls } = fixture({
    check: async () => {
      if (failed) throw new Error('offline')
      return null
    },
  })
  await controller.check()
  assert.equal(state.phase, 'error')
  assert.match(state.error, /offline/)
  assert.equal(state.errorStage, 'check')
  await controller.installWhenIdle()
  failed = false
  await controller.check()
  assert.equal(state.phase, 'latest')
  assert.equal(state.error, '')
  assert.equal(state.errorStage, '')
  assert.equal(calls.install, 0)
})

test('Finished event followed by a bad signature never makes the update installable', async () => {
  const { controller, update, state, calls } = fixture()
  update.download = async report => {
    report({ event: 'Finished' })
    await controller.installWhenIdle()
    assert.equal(state.phase, 'downloading')
    throw new Error('signature verification failed')
  }
  await controller.check()
  assert.equal(state.phase, 'error')
  assert.equal(state.errorStage, 'download')
  assert.equal(calls.close, 1)
  await controller.installWhenIdle()
  assert.equal(calls.install, 0)
})

test('postpone and disabled auto-update block installation, explicit resume allows it', async () => {
  const { controller, calls } = fixture({ enabled: () => false })
  await controller.check()
  await controller.installWhenIdle()
  assert.equal(calls.install, 0)
  controller.resume()
  controller.defer()
  await controller.installWhenIdle()
  assert.equal(calls.install, 0)
  controller.resume()
  await controller.installWhenIdle()
  assert.equal(calls.install, 1)
})

test('postpone during native preflight wins over a ready-to-install response', async () => {
  let finish
  const { controller, calls } = fixture({
    canInstall: () =>
      new Promise(resolve => {
        finish = resolve
      }),
  })
  await controller.check()
  const installing = controller.installWhenIdle()
  controller.defer()
  finish(true)
  await installing
  assert.equal(calls.install, 0)
})

test('installer failure releases resources and a retry downloads a fresh package', async () => {
  const { controller, update, state, calls } = fixture()
  update.install = async () => {
    throw new Error('installer launch failed')
  }
  await controller.check()
  await controller.installWhenIdle()
  assert.equal(state.phase, 'error')
  assert.equal(state.errorStage, 'install')
  assert.equal(calls.close, 1)
  await controller.check()
  assert.equal(calls.download, 2)
  assert.equal(state.phase, 'ready')
})

test('disposing during an in-flight check closes the eventual resource', async () => {
  let resolve
  const { controller, update, calls } = fixture({
    check: () =>
      new Promise(done => {
        resolve = done
      }),
  })
  const checking = controller.check()
  await controller.dispose()
  resolve(update)
  await checking
  assert.equal(calls.close, 1)
  assert.equal(calls.download, 0)
  await controller.installWhenIdle()
  assert.equal(calls.install, 0)
})

test('unsupported installations do not check or download', async () => {
  const { controller, state, calls } = fixture()
  state.phase = 'unsupported'
  await controller.check()
  assert.equal(calls.check, 0)
})

const flushUpdates = async () => {
  for (let n = 0; n < 15; n++) await Promise.resolve()
}

test('missing release recovers with bounded backoff instead of waiting six hours', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let available = false
  let checks = 0
  const { controller, state } = fixture({
    check: async () => {
      checks++
      if (!available)
        throw new Error('Could not fetch a valid release JSON from the remote')
      return null
    },
  })
  controller.startAutoChecks()
  for (const [index, delay] of [15_000, 60_000, 300_000, 900_000].entries()) {
    context.mock.timers.tick(delay - 1)
    await flushUpdates()
    assert.equal(checks, index)
    context.mock.timers.tick(1)
    await flushUpdates()
    assert.equal(checks, index + 1)
  }
  available = true
  context.mock.timers.tick(6 * 60 * 60_000)
  await flushUpdates()
  assert.equal(checks, 5)
  assert.equal(state.phase, 'latest')
  assert.equal(state.error, '')
  context.mock.timers.tick(6 * 60 * 60_000)
  await flushUpdates()
  assert.equal(checks, 6)
  await controller.dispose()
})

test('turning updates off cancels retry; enabling and reconnecting recover promptly', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let enabled = true
  let checks = 0
  const { controller } = fixture({
    enabled: () => enabled,
    check: async () => {
      checks++
      throw new Error('offline')
    },
  })
  controller.startAutoChecks()
  context.mock.timers.tick(15_000)
  await flushUpdates()
  assert.equal(checks, 1)
  enabled = false
  controller.refreshAutoChecks()
  controller.retryOnReconnect()
  context.mock.timers.tick(6 * 60 * 60_000)
  await flushUpdates()
  assert.equal(checks, 1)
  enabled = true
  controller.refreshAutoChecks()
  context.mock.timers.tick(1)
  await flushUpdates()
  assert.equal(checks, 2)
  controller.retryOnReconnect()
  context.mock.timers.tick(1)
  await flushUpdates()
  assert.equal(checks, 3)
  await controller.dispose()
  context.mock.timers.tick(6 * 60 * 60_000)
  await flushUpdates()
  assert.equal(checks, 3)
})

test('manual retry replaces the scheduled retry without duplicate downloads', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let available = false
  let checks = 0
  const { controller, state, update, calls } = fixture({
    check: async () => {
      checks++
      if (!available) throw new Error('offline')
      return update
    },
  })
  controller.startAutoChecks()
  context.mock.timers.tick(15_000)
  await flushUpdates()
  controller.dismiss()
  assert.equal(state.dismissed, true)
  await controller.check()
  assert.equal(
    state.dismissed,
    true,
    'repeated errors do not reopen the notice'
  )
  available = true
  await controller.check()
  assert.equal(state.phase, 'ready')
  assert.equal(state.dismissed, false, 'a ready update is a new notification')
  context.mock.timers.tick(6 * 60 * 60_000)
  await flushUpdates()
  assert.equal(checks, 3)
  assert.equal(calls.download, 1)
  controller.dismiss()
  assert.equal(state.phase, 'ready', 'dismissal does not cancel the update')
  await controller.installWhenIdle()
  assert.equal(calls.install, 1)
  await controller.dispose()
})

test('signature failures use the normal cadence and never install unverified bytes', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  const { controller, state, update, calls } = fixture()
  update.download = async () => {
    throw new Error('signature verification failed')
  }
  controller.startAutoChecks()
  context.mock.timers.tick(15_000)
  await flushUpdates()
  assert.equal(state.errorStage, 'download')
  controller.retryOnReconnect()
  controller.refreshAutoChecks()
  context.mock.timers.tick(6 * 60 * 60_000 - 1)
  await flushUpdates()
  await controller.installWhenIdle()
  assert.equal(calls.check, 1)
  assert.equal(calls.install, 0)
  context.mock.timers.tick(1)
  await flushUpdates()
  assert.equal(calls.check, 2)
  await controller.installWhenIdle()
  assert.equal(calls.install, 0)
  await controller.dispose()
})

test('disposing during a failed automatic check never schedules another attempt', async context => {
  context.mock.timers.enable({ apis: ['setTimeout'] })
  let reject
  let checks = 0
  const { controller } = fixture({
    check: () => {
      checks++
      return new Promise((_resolve, fail) => {
        reject = fail
      })
    },
  })
  controller.startAutoChecks()
  context.mock.timers.tick(15_000)
  await controller.dispose()
  reject(new Error('offline'))
  await flushUpdates()
  context.mock.timers.tick(6 * 60 * 60_000)
  await flushUpdates()
  assert.equal(checks, 1)
})

test('only the main window schedules updates; settings routes actions and receives progress', async context => {
  context.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] })
  const boundary = dataModule(`
    export const data = { label: 'main', checks: 0, downloads: 0, installs: 0, closes: 0, values: { autoUpdate: true }, tabs: [1], listeners: [] };
    export const IS_TAURI = true;
    export const getCurrentWindow = () => ({ label: data.label });
    export const useSettingsStore = () => ({ values: data.values });
    export const useWorkspaceStore = () => ({ tabs: data.tabs });
    export const useTransfersStore = () => ({ activeTasks: [] });
    export const invoke = async name => name === 'updater_environment' ? {supported:true,reason:''} : true;
    export const listen = async (event, handler) => {
      const entry = {event,handler,label:data.label}; data.listeners.push(entry);
      return () => { data.listeners = data.listeners.filter(x => x !== entry) };
    };
    export const emit = async (event, payload) => {
      for (const entry of data.listeners.filter(x => x.event === event)) entry.handler({payload});
    };
    export const emitTo = async (label, event, payload) => {
      for (const entry of data.listeners.filter(x => x.event === event && x.label === label)) entry.handler({payload});
    };
    export const check = async () => {
      data.checks++;
      return { version:'2.1.0', download:async () => {data.downloads++}, install:async () => {data.installs++}, close:async () => {data.closes++} };
    };
  `)
  const { data } = await import(boundary)
  const load = sourceLoader(
    Object.fromEntries(
      [
        '@tauri-apps/api/event',
        '@tauri-apps/api/core',
        '@tauri-apps/api/window',
        '@tauri-apps/plugin-updater',
        '@/utils/window',
        './workspace',
        './settings',
        './transfers',
      ].map(name => [name, boundary])
    )
  )
  const { useAppUpdaterStore } = await load('src/stores/app-updater.ts')
  const mainPinia = createPinia()
  const settingsPinia = createPinia()
  const flush = async () => {
    for (let n = 0; n < 10; n++) await Promise.resolve()
  }
  try {
    const main = useAppUpdaterStore(mainPinia)
    await Promise.all([main.start(), main.start()])
    data.label = 'settings'
    const settings = useAppUpdaterStore(settingsPinia)
    await settings.start()
    assert.equal(settings.state.phase, 'idle')
    context.mock.timers.tick(15_000)
    await flush()
    assert.equal(data.checks, 1)
    assert.equal(data.downloads, 1)
    assert.equal(settings.state.phase, 'ready')
    await settings.command('dismiss')
    assert.equal(main.state.dismissed, true)
    assert.equal(settings.state.dismissed, true)
    await settings.command('check')
    assert.equal(data.checks, 1)
    context.mock.timers.tick(10_000)
    await flush()
    assert.equal(data.installs, 0)
    await settings.command('defer')
    assert.equal(main.state.deferred, true)
    data.tabs = []
    context.mock.timers.tick(10_000)
    await flush()
    assert.equal(data.installs, 0)
    await settings.command('resume')
    context.mock.timers.tick(10_000)
    await flush()
    assert.equal(data.installs, 1)
  } finally {
    disposePinia(settingsPinia)
    disposePinia(mainPinia)
    assert.equal(data.listeners.length, 0)
  }
})

test('manifest points to the exact renamed signed installer and Tauri architecture', () => {
  const manifest = updaterManifest({
    tag: 'v2.0.33',
    repository: 'XiangZi7/MiraiHub',
    signature: 'c2lnbmF0dXJl\r\n',
  })
  assert.equal(manifest.version, '2.0.33')
  assert.deepEqual(manifest.platforms, {
    'windows-x86_64': {
      signature: 'c2lnbmF0dXJl',
      url: 'https://github.com/XiangZi7/MiraiHub/releases/download/v2.0.33/MiraiHub_2.0.33_windows_x64_setup.exe',
    },
  })
  assert.ok(Number.isFinite(Date.parse(manifest.pub_date)))
  const preview = updaterManifest({
    tag: 'v2.1.0-beta.1',
    repository: 'XiangZi7/MiraiHub',
    signature: 'YWJj',
  })
  assert.equal(preview.version, '2.1.0-beta.1')
  for (const bad of [
    { signature: '' },
    { signature: '<html>404</html>' },
    { tag: 'v2.1.0\n' },
    { repository: '../../evil' },
  ])
    assert.throws(() =>
      updaterManifest({
        tag: 'v2.1.0',
        repository: 'XiangZi7/MiraiHub',
        signature: 'YWJj',
        ...bad,
      })
    )
})
