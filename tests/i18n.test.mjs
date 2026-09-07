import assert from 'node:assert/strict'
import { test } from 'node:test'
import { nextTick, reactive } from 'vue'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'

const load = sourceLoader()
const { normalizeLanguage, resolveLocale } = await load('src/utils/locale.ts')
const { DEFAULT_SETTINGS } = await load('src/types/settings.ts')
const { i18n, translateLabel } = await load('src/i18n/index.ts')
const { messages } = await load('src/i18n/messages.ts')
const { useLocalizedSettings } = await load(
  'src/composables/useLocalizedSettings.ts'
)

test('默认跟随系统，中英文区域变体和不支持的语言有确定回退', () => {
  assert.equal(DEFAULT_SETTINGS.language, 'system')
  for (const locale of ['zh', 'zh-CN', 'zh-TW', 'zh_Hans_CN', 'ZH-hk'])
    assert.equal(resolveLocale('system', locale), 'zh-CN')
  for (const locale of ['en-US', 'en-GB', 'ja-JP', 'fr_FR.UTF-8', '', 'C'])
    assert.equal(resolveLocale('system', locale), 'en-US')
  assert.equal(resolveLocale('en-US', 'zh-CN'), 'en-US')
  assert.equal(resolveLocale('zh-CN', 'en-US'), 'zh-CN')
  assert.equal(normalizeLanguage('invalid'), 'system')
  assert.equal(resolveLocale('invalid', 'zh-TW'), 'zh-CN')
})

test('设置元数据完整翻译，打开的页面随语言变化，并正确插入参数', () => {
  const pages = useLocalizedSettings()
  i18n.global.locale.value = 'zh-CN'
  assert.equal(pages.value.find(page => page.id === 'general').label, '通用')
  i18n.global.locale.value = 'en-US'
  const general = pages.value.find(page => page.id === 'general')
  assert.equal(general.label, 'General')
  const languages = general.groups
    .flatMap(group => group.fields)
    .find(field => field.key === 'language')
  assert.deepEqual(
    languages.options.map(option => option.value),
    ['system', 'zh-CN', 'en-US']
  )
  assert.equal(languages.options[0].label, 'Follow system')
  assert.equal(
    i18n.global.t('skin.resetColor', { name: 'Accent' }),
    'Reset Accent'
  )
  assert.equal(
    i18n.global.t('settings.integerRange', { min: 1, max: 10 }),
    'Enter an integer between 1 and 10'
  )
  assert.equal(translateLabel('JetBrains Mono'), 'JetBrains Mono')
  for (const page of pages.value) {
    for (const text of [
      page.label,
      page.title,
      page.description,
      ...page.groups.flatMap(group => [
        group.title,
        ...group.fields.flatMap(field => [
          field.label,
          field.description,
          field.placeholder,
          ...(field.options ?? []).map(option => option.label),
        ]),
      ]),
    ]) {
      if (text && text !== '简体中文')
        assert.doesNotMatch(text, /[\u3400-\u9fff]/, text)
    }
  }
  assert.deepEqual(
    Object.keys(messages['zh-CN']).sort(),
    Object.keys(messages['en-US']).sort()
  )
  i18n.global.locale.value = 'zh-CN'
  assert.equal(pages.value.find(page => page.id === 'general').label, '通用')
})

test('原生系统语言在首次渲染前应用，保存立即同步，重新聚焦时更新跟随系统语言', async () => {
  const settings = reactive({ ...DEFAULT_SETTINGS })
  const eventTarget = new EventTarget()
  const originalWindow = globalThis.window
  const originalDocument = globalThis.document
  globalThis.window = eventTarget
  globalThis.document = { documentElement: { lang: '' } }
  globalThis.__localeSettings = settings
  const native = dataModule(
    `export let current = 'zh-TW'; export const set = value => current = value; export async function getSystemLocale() { return current }`
  )
  const runtimeLoad = sourceLoader({
    '@/api/system': native,
    '@/stores/settings': dataModule(
      'export const useSettingsStore = () => ({ values: globalThis.__localeSettings })'
    ),
    '@/stores': dataModule('export const pinia = {}'),
  })
  try {
    const { startLanguageRuntime } = await runtimeLoad('src/i18n/runtime.ts')
    const { set } = await import(native)
    await startLanguageRuntime()
    assert.equal(document.documentElement.lang, 'zh-CN')
    settings.language = 'en-US'
    assert.equal(
      document.documentElement.lang,
      'en-US',
      'save updates synchronously'
    )
    set('zh-CN')
    window.dispatchEvent(new Event('focus'))
    await nextTick()
    assert.equal(
      document.documentElement.lang,
      'en-US',
      'explicit choice ignores system changes'
    )
    settings.language = 'system'
    await nextTick()
    assert.equal(document.documentElement.lang, 'zh-CN')
    set('en-GB')
    window.dispatchEvent(new Event('focus'))
    await nextTick()
    assert.equal(document.documentElement.lang, 'en-US')
  } finally {
    globalThis.window = originalWindow
    globalThis.document = originalDocument
    delete globalThis.__localeSettings
  }
})
