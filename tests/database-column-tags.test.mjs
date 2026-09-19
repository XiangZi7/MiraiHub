import assert from 'node:assert/strict'
import { test } from 'node:test'
import { shallowRef } from 'vue'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'

const vueUrl = JSON.stringify(import.meta.resolve('vue'))
const toasts = []
globalThis.__columnTagsFixture = { toasts, handler: null }
const load = sourceLoader({
  '@vueuse/core': dataModule(`
    import { shallowRef } from ${vueUrl}
    export const useStorage = (_key, value) => shallowRef(value)
  `),
  '@/constants/connection': dataModule(`
    export const CONNECTION_TAG_COLORS = [
      { id: 'red', label: '红色', css: 'var(--color-danger)' },
      { id: 'green', label: '绿色', css: 'var(--color-success)' },
      { id: 'violet', label: '紫色', css: 'var(--color-violet)' },
    ]
  `),
  '@/composables/useToast': dataModule(`
    export const toast = { success: message => globalThis.__columnTagsFixture.toasts.push(message) }
  `),
  '@/api/column-tags': dataModule(`
    export async function onColumnTagsResult(handler) {
      globalThis.__columnTagsFixture.handler = handler
      return () => {}
    }
  `),
})
const {
  useDatabaseColumnTags,
  normalizeTagConfig,
  defaultTagColor,
  tagColorCss,
  tagLabel,
  autoFillCandidates,
  isColumnTagConfig,
  applyColumnTags,
  startColumnTagsReceiver,
  tagsVisible,
  toggleTagsVisible,
} = await load('src/composables/useDatabaseColumnTags.ts')
const { i18n } = await load('src/i18n/index.ts')

test('规则去掉空值与重复值，颜色不认识时回退，没有有效规则时视为清除', () => {
  const config = normalizeTagConfig({
    style: 'dot',
    rules: [
      { value: ' 200 ', label: ' OK ', color: 'green' },
      { value: '', label: 'empty', color: 'red' },
      { value: '200', label: 'dup', color: 'red' },
      { value: 'POST', label: '', color: 'nope' },
    ],
  })
  assert.deepEqual(config, {
    style: 'dot',
    rules: [
      { value: '200', label: 'OK', color: 'green' },
      { value: 'POST', label: '', color: 'violet' },
    ],
  })
  assert.equal(normalizeTagConfig({ style: 'badge', rules: [] }), null)
  assert.equal(
    normalizeTagConfig({
      style: 'weird',
      rules: [{ value: 'x', label: '', color: 'red' }],
    }).style,
    'badge'
  )
  assert.equal(defaultTagColor(0), 'red')
  assert.equal(defaultTagColor(4), 'green')
  assert.equal(tagColorCss('green'), 'var(--color-success)')
  assert.equal(tagColorCss('unknown'), 'var(--color-accent)')
})

test('标签文字优先显示文字并截断超长值；只有短枚举值才会自动带入规则', () => {
  assert.equal(tagLabel({ value: '1', label: ' 启用 ' }), '启用')
  assert.equal(tagLabel({ value: 'POST', label: '' }), 'POST')
  const long = 'x'.repeat(40)
  assert.equal(tagLabel({ value: long, label: '' }), `${'x'.repeat(24)}…`)
  assert.deepEqual(autoFillCandidates(['POST', 'GET']), ['POST', 'GET'])
  assert.deepEqual(autoFillCandidates([]), [])
  assert.deepEqual(autoFillCandidates(['$2b$12$' + 'a'.repeat(50)]), [])
  assert.deepEqual(
    autoFillCandidates(Array.from({ length: 13 }, (_, i) => String(i))),
    []
  )
  assert.equal(isColumnTagConfig({ style: 'badge', rules: [] }), true)
  assert.equal(
    isColumnTagConfig({ style: 'badge', rules: [{ value: 1 }] }),
    false
  )
  assert.equal(isColumnTagConfig(null), false)
})

test('标签按作用域保存，单元格值精确匹配才命中，切换作用域后互不影响', () => {
  const scope = shallowRef('table:public.requests')
  const tags = useDatabaseColumnTags(scope)
  assert.equal(tags.hasAny.value, false)
  assert.equal(tags.hasTags('method'), false)
  assert.equal(tags.matchTag('method', 'POST'), null)

  tags.setTags('method', {
    style: 'badge',
    rules: [
      { value: 'POST', label: '', color: 'violet' },
      { value: 'GET', label: 'Read', color: 'green' },
    ],
  })
  assert.equal(tags.hasAny.value, true)
  assert.equal(tags.hasTags('method'), true)
  assert.equal(tags.matchTag('method', 'GET').label, 'Read')
  assert.equal(tags.matchTag('method', ' POST ').value, 'POST')
  assert.equal(tags.matchTag('method', 'post'), null)
  assert.equal(tags.matchTag('method', null), null)
  assert.equal(tags.matchTag('status', 'POST'), null)
  assert.equal(tags.configOf('method').style, 'badge')
  assert.equal(tags.lookups.value.get('method').get('GET').color, 'green')

  scope.value = 'table:public.other'
  assert.equal(tags.hasTags('method'), false)
  scope.value = 'table:public.requests'
  assert.equal(tags.hasTags('method'), true)

  tags.setTags('method', null)
  assert.equal(tags.hasTags('method'), false)
  assert.deepEqual(tags.tags.value, {})
})

test('原生设置窗口回传的结果写入对应作用域并提示；全局开关可切换', async () => {
  i18n.global.locale.value = 'zh-CN'
  startColumnTagsReceiver()
  await Promise.resolve()
  const handler = globalThis.__columnTagsFixture.handler
  assert.equal(typeof handler, 'function')
  handler({
    scope: 'table:public.users',
    column: 'status',
    config: {
      style: 'dot',
      rules: [{ value: '1', label: '启用', color: 'green' }],
    },
  })
  const tags = useDatabaseColumnTags(shallowRef('table:public.users'))
  assert.equal(tags.matchTag('status', '1').label, '启用')
  assert.match(toasts.at(-1), /status/)
  handler({ scope: 'table:public.users', column: 'status', config: null })
  assert.equal(tags.hasTags('status'), false)
  assert.match(toasts.at(-1), /取消/)
  // 结构不对的载荷按取消处理，不会写入脏数据。
  assert.equal(
    applyColumnTags('table:public.users', 'status', { rules: 'bad' }),
    null
  )
  assert.equal(tagsVisible.value, true)
  toggleTagsVisible()
  assert.equal(tagsVisible.value, false)
  toggleTagsVisible()
  assert.equal(tagsVisible.value, true)
})
