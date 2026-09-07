import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const mockUrl = dataModule(`
  export const api = { settings: null, handlers: new Set(), saved: null, deferred: null }
  export const getConfig = async () => api.deferred ? await api.deferred : structuredClone(api.settings)
  export const onConfigChanged = async handler => { api.handlers.add(handler); return () => api.handlers.delete(handler) }
  export const errorMessage = error => error.message
  export const activateConfig = async id => { api.settings.activeId = id; for (const handler of api.handlers) handler(); return structuredClone(api.settings) }
  export const saveConfig = async (input, clearKey) => {
    api.saved = structuredClone({ input, clearKey })
    const id = input.id || 'new-profile'
    const {apiKey, ...config} = input.config
    const profile = { ...config, id, name:input.name, hasApiKey: !!apiKey }
    api.settings.profiles = [...api.settings.profiles.filter(p => p.id !== id), profile]
    api.settings.activeId = id
    return structuredClone(api.settings)
  }
  export const testConfig = async () => 'OK'
  export const deleteConfig = async id => { api.settings.profiles = api.settings.profiles.filter(p => p.id !== id); return structuredClone(api.settings) }
`)
const { api } = await import(mockUrl)
const load = sourceLoader({
  '@/api/agent': mockUrl,
  '@/utils/window': dataModule('export const IS_TAURI = true'),
})
const { useAgentSettings } = await load('src/composables/useAgentSettings.ts')
const { useAgentProfiles } = await load('src/composables/useAgentProfiles.ts')
const { i18n } = await load('src/i18n/index.ts')
const { DEFAULT_AGENT_LIMITS, AGENT_CAPACITY_PRESETS, validAgentLimits } =
  await load('src/constants/agent-limits.ts')
i18n.global.locale.value = 'zh-CN'
const flush = () => new Promise(resolve => setImmediate(resolve))
function fixture(composable) {
  api.settings = {
    activeId: 'a',
    profiles: ['a', 'b'].map(id => ({
      id,
      name: id,
      enabled: true,
      apiFormat: 'openai',
      baseUrl: 'https://same.example/v1',
      model: id + '-model',
      hasApiKey: true,
    })),
  }
  api.handlers.clear()
  api.deferred = null
  api.saved = null
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
      state = composable()
      return () => null
    },
  })
  app.use(i18n)
  app.mount({})
  return { app, state }
}
test('profile drafts survive selection changes and saving clears only the saved draft key', async () => {
  const { app, state } = fixture(useAgentSettings)
  try {
    await flush()
    assert.equal(state.draft.value.apiKey, '')
    state.draft.value.apiKey = 'draft-key-a'
    state.selectedId.value = 'b'
    assert.equal(state.draft.value.apiKey, '')
    state.draft.value.name = 'Relay B'
    state.selectedId.value = 'a'
    assert.equal(state.draft.value.apiKey, 'draft-key-a')
    state.preset.value = 'claude'
    state.add()
    assert.equal(state.draft.value.apiFormat, 'anthropic')
    state.draft.value.model = 'claude-test'
    state.draft.value.apiKey = 'new-test-key'
    await state.save()
    assert.equal(api.saved.input.id, undefined)
    assert.equal(api.saved.input.config.apiFormat, 'anthropic')
    assert.equal(state.draft.value.apiKey, '')
    assert.equal(state.drafts.value.a.apiKey, 'draft-key-a')
    assert.equal(state.drafts.value.b.name, 'Relay B')
  } finally {
    app.unmount()
  }
  assert.equal(state.drafts.value.a.apiKey, '')
  assert.equal(api.handlers.size, 0)
})
test('capacity settings migrate old profiles and remain independent through save and reload', async () => {
  const { app, state } = fixture(useAgentSettings)
  try {
    await flush()
    assert.deepEqual({ ...state.draft.value.limits }, DEFAULT_AGENT_LIMITS)
    state.draft.value.limits = { ...AGENT_CAPACITY_PRESETS[1].limits }
    state.selectedId.value = 'b'
    assert.deepEqual({ ...state.draft.value.limits }, DEFAULT_AGENT_LIMITS)
    state.draft.value.limits.maxSteps = 48
    state.selectedId.value = 'a'
    await state.save()
    assert.deepEqual(
      api.saved.input.config.limits,
      AGENT_CAPACITY_PRESETS[1].limits
    )
    assert.equal(state.drafts.value.b.limits.maxSteps, 48)
    assert.equal(
      state.settings.value.profiles.find(p => p.id === 'a').limits.maxSteps,
      32
    )
    // Re-opening the editor uses the saved values and fresh draft objects.
    const stored = structuredClone(api.settings)
    app.unmount()
    const reopened = fixture(useAgentSettings)
    api.settings = stored
    try {
      await flush()
      assert.deepEqual(
        { ...reopened.state.draft.value.limits },
        AGENT_CAPACITY_PRESETS[1].limits
      )
      reopened.state.draft.value.limits.maxSteps = 96
      assert.equal(
        reopened.state.settings.value.profiles.find(p => p.id === 'a').limits
          .maxSteps,
        32
      )
      reopened.state.add()
      assert.deepEqual(
        { ...reopened.state.draft.value.limits },
        DEFAULT_AGENT_LIMITS
      )
      reopened.state.draft.value.limits.maxSteps = 100
      reopened.state.add()
      assert.equal(reopened.state.draft.value.limits.maxSteps, 8)
    } finally {
      reopened.app.unmount()
    }
  } finally {
    app.unmount()
  }
})

test('invalid custom capacity blocks saving and all presets stay within backend ranges', async () => {
  const { app, state } = fixture(useAgentSettings)
  try {
    await flush()
    for (const preset of AGENT_CAPACITY_PRESETS)
      assert.ok(validAgentLimits(preset.limits))
    for (const [key, values] of Object.entries({
      maxSteps: [0, 129, 1.5, '', NaN],
      maxContextKb: [63, 4001, Infinity],
      maxMessages: [15, 2049],
    })) {
      for (const value of values) {
        state.draft.value.limits = { ...DEFAULT_AGENT_LIMITS, [key]: value }
        await state.save()
        assert.equal(api.saved, null)
        assert.match(state.error.value, /请填写整数/)
        assert.equal(state.busy.value, false)
      }
    }
    state.draft.value.limits = {
      maxSteps: 128,
      maxContextKb: 4000,
      maxMessages: 2048,
    }
    await state.save()
    assert.equal(state.error.value, '')
    assert.equal(api.saved.input.config.limits.maxSteps, 128)
  } finally {
    app.unmount()
  }
})

test('external activation updates settings markers without overwriting unsaved fields', async () => {
  const { app, state } = fixture(useAgentSettings)
  try {
    await flush()
    state.draft.value.name = 'Unsaved name'
    api.settings.activeId = 'b'
    for (const handler of api.handlers) handler()
    await flush()
    assert.equal(state.settings.value.activeId, 'b')
    assert.equal(state.draft.value.name, 'Unsaved name')
    assert.match(state.options.value.find(p => p.value === 'b').label, /使用中/)
  } finally {
    app.unmount()
  }
})
test('panel activation updates the selected profile and late metadata cannot undo it', async () => {
  let cleared = 0
  const { app, state } = fixture(() => useAgentProfiles(() => cleared++))
  try {
    await flush()
    let resolve
    api.deferred = new Promise(done => {
      resolve = done
    })
    await state.select('b')
    assert.equal(state.activeId.value, 'b')
    assert.ok(cleared > 0)
    resolve({ activeId: 'a', profiles: [] })
    await flush()
    assert.equal(state.activeId.value, 'b')
    assert.equal(state.loading.value, false)
  } finally {
    app.unmount()
    api.deferred = null
  }
})
