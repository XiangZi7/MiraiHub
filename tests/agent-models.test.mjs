import assert from 'node:assert/strict'
import { test } from 'node:test'
import { effectScope, reactive } from 'vue'
import { dataModule, sourceLoader } from './helpers/source-module.mjs'

const apiUrl = dataModule(`
  export const calls = []
  export const listModels = input => new Promise((resolve, reject) => calls.push({ input, resolve, reject }))
  export const errorMessage = error => error.message
`)
const { calls } = await import(apiUrl)
const load = sourceLoader({ '@/api/agent': apiUrl })
const { useAgentModels } = await load('src/composables/useAgentModels.ts')
const { i18n } = await load('src/i18n/index.ts')
i18n.global.locale.value = 'zh-CN'

function fixture() {
  calls.length = 0
  const scope = effectScope()
  const draft = reactive({
    profileId: 'profile-a',
    apiFormat: 'openai',
    baseUrl: 'https://models.example/v1',
    apiKey: 'test-key',
    clearKey: false,
  })
  const models = scope.run(() => useAgentModels(() => draft))
  return { draft, models, scope }
}

test('model discovery uses the unsaved draft, ignores duplicate clicks and exposes choices', async () => {
  const { models, scope } = fixture()
  try {
    const pending = models.fetchModels()
    assert.equal(models.fetching.value, true)
    assert.equal(await models.fetchModels(), false)
    assert.equal(calls.length, 1)
    assert.deepEqual(calls[0].input, {
      profileId: 'profile-a',
      apiFormat: 'openai',
      baseUrl: 'https://models.example/v1',
      apiKey: 'test-key',
      clearKey: false,
    })
    calls[0].resolve(['model-a', 'model-b'])
    assert.equal(await pending, true)
    assert.deepEqual(models.models.value, ['model-a', 'model-b'])
    assert.equal(models.fetching.value, false)
    assert.match(models.message.value, /2/)
  } finally {
    scope.stop()
  }
})

test('changing address, key or clear-key selection invalidates stale discovery results', async () => {
  for (const [key, value] of [
    ['baseUrl', 'https://new.example/v1'],
    ['apiKey', 'new-key'],
    ['clearKey', true],
  ]) {
    const { draft, models, scope } = fixture()
    try {
      const stale = models.fetchModels()
      draft[key] = value
      const current = models.fetchModels()
      calls[0].resolve(['old-service-model'])
      assert.equal(await stale, false)
      assert.equal(models.fetching.value, true)
      assert.deepEqual(models.models.value, [])
      calls[1].resolve(['current-service-model'])
      assert.equal(await current, true)
      assert.deepEqual(models.models.value, ['current-service-model'])
    } finally {
      scope.stop()
    }
  }
})

test('empty and failed responses provide feedback and allow retry', async () => {
  const { models, scope } = fixture()
  try {
    const empty = models.fetchModels()
    calls[0].resolve([])
    assert.equal(await empty, false)
    assert.match(models.message.value, /手动输入/)
    const failed = models.fetchModels()
    calls[1].reject(new Error('HTTP 401'))
    assert.equal(await failed, false)
    assert.equal(models.error.value, 'HTTP 401')
    assert.equal(models.fetching.value, false)
    const retried = models.fetchModels()
    calls[2].resolve(['model'])
    assert.equal(await retried, true)
    assert.equal(models.error.value, '')
  } finally {
    scope.stop()
  }
})

test('closing the settings scope discards in-flight results and errors', async () => {
  for (const reject of [false, true]) {
    const { models, scope } = fixture()
    const pending = models.fetchModels()
    scope.stop()
    if (reject) calls[0].reject(new Error('late failure'))
    else calls[0].resolve(['late model'])
    assert.equal(await pending, false)
    assert.deepEqual(models.models.value, [])
    assert.equal(models.error.value, '')
    assert.equal(models.fetching.value, false)
  }
})

test('changing a profile or API format invalidates model results even at the same address', async () => {
  for (const [field, value] of [
    ['profileId', 'profile-b'],
    ['apiFormat', 'anthropic'],
  ]) {
    const { models, draft, scope } = fixture()
    try {
      const pending = models.fetchModels()
      draft[field] = value
      calls[0].resolve(['wrong-profile-model'])
      assert.equal(await pending, false)
      assert.deepEqual(models.models.value, [])
      const fresh = models.fetchModels()
      assert.equal(calls[1].input[field], value)
      calls[1].resolve(['right-profile-model'])
      assert.equal(await fresh, true)
    } finally {
      scope.stop()
    }
  }
})
