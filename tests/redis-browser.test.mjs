import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { sourceLoader } from './helpers/source-module.mjs'

const rendered = [
  'src/components/workspace/redis/RedisKeyList.vue',
  'src/components/workspace/redis/RedisCommandGuide.vue',
  'src/components/ui/IconButton.vue',
  'src/components/ui/AppInput.vue',
]
const load = sourceLoader({}, rendered)
const { redisSearchPattern, groupRedisKeys } = await load(
  'src/utils/redis-browser.ts'
)
const {
  quoteRedisArgument,
  quoteRedisKey,
  isRedisReadCommand,
  REDIS_COMMAND_TEMPLATES,
} = await load('src/utils/redis-commands.ts')
const { i18n } = await load('src/i18n/index.ts')
const { messages } = await load('src/i18n/messages.ts')
const key = name => ({ name, id: Buffer.from(name).toString('base64') })

test('plain key searches escape glob characters and preserve significant spaces', () => {
  assert.equal(
    redisSearchPattern('user:*[a]?\\', 'contains'),
    '*user:\\*\\[a\\]\\?\\\\*'
  )
  assert.equal(redisSearchPattern(' user: ', 'prefix'), ' user: *')
  assert.equal(redisSearchPattern('user:[0-9]*', 'glob'), 'user:[0-9]*')
  assert.equal(redisSearchPattern('', 'contains'), '*')
})

test('prefix grouping stops before URL protocols and preserves original key identities', () => {
  const keys = [
    key('soloband:8c:v1:https://www.8comic.com:True:banner'),
    key('soloband:wt:v2:https://www.webtoons.com'),
    key('https://example.com:80/path'),
    { id: '/w==', name: 'base64:/w==' },
    key('plain'),
  ]
  const groups = groupRedisKeys(keys, 3)
  assert.deepEqual(
    groups.map(group => group.prefix),
    ['soloband:8c:v1:', 'soloband:wt:v2:', '']
  )
  assert.equal(groups[0].keys[0], keys[0])
  assert.equal(groups[2].keys[1].id, '/w==')
  assert.equal(groupRedisKeys([key('user:')], 2)[0].prefix, '')
  assert.equal(groupRedisKeys([key('user:profile:')], 2)[0].prefix, 'user:')
})

test('command templates quote literal keys, preserve UTF-8 BOM and binary bytes', () => {
  assert.equal(
    quoteRedisArgument('user:"x"\\\n\0'),
    '"user:\\"x\\"\\\\\\x0a\\x00"'
  )
  assert.equal(quoteRedisKey(key('用户:😀')), '"用户:😀"')
  assert.equal(quoteRedisKey(key('\ufeffkey')), '"\ufeffkey"')
  assert.equal(
    quoteRedisKey({ id: '/wAi', name: 'base64:/wAi' }),
    '"\\xff\\x00\\x22"'
  )
  const scan = REDIS_COMMAND_TEMPLATES.find(template => template.id === 'scan')
  assert.equal(
    scan.build('"k"', 'user:"*'),
    'SCAN 0 MATCH "user:\\"*" COUNT 100'
  )
  assert.ok(
    !REDIS_COMMAND_TEMPLATES.some(template =>
      /^KEYS\b/.test(template.build('"k"', '*'))
    )
  )
  for (const template of REDIS_COMMAND_TEMPLATES) {
    for (const locale of ['zh-CN', 'en-US']) {
      assert.ok(Object.hasOwn(messages[locale], template.group), template.group)
      assert.ok(Object.hasOwn(messages[locale], template.label), template.label)
      assert.ok(
        Object.hasOwn(messages[locale], template.description),
        template.description
      )
    }
    assert.equal(
      isRedisReadCommand(template.build('"k"', '*')),
      !template.write,
      template.id
    )
  }
  for (const command of [
    'GETSET k v',
    'GETDEL k',
    'MEMORY PURGE',
    'EVAL script 0',
    'SET k v',
    '"GETDEL" k',
  ])
    assert.equal(isRedisReadCommand(command), false, command)
  assert.equal(isRedisReadCommand('  "GET" "space key"'), true)
})

const node = (type, text = '') =>
  markRaw({
    type,
    text,
    props: {},
    children: [],
    parent: null,
    ownerDocument: { activeElement: null },
    getRootNode() {
      return this.ownerDocument
    },
    querySelector(type) {
      return allNodes(this).find(child => child.type === type)
    },
    focus() {
      this.ownerDocument.activeElement = this
    },
    get options() {
      return this.children.filter(child => child.type === 'option')
    },
    addEventListener() {},
    removeEventListener() {},
  })
const renderer = createRenderer({
  createElement: type => node(type),
  createText: text => node('#text', text),
  createComment: text => node('#comment', text),
  setText: (el, text) => {
    el.text = text
  },
  setElementText: (el, text) => {
    el.text = text
    el.children = []
  },
  patchProp: (el, name, _previous, value) => {
    el.props[name] = value
    if (name === 'value') el._value = value
  },
  parentNode: el => el.parent,
  nextSibling: el =>
    el.parent?.children[el.parent.children.indexOf(el) + 1] ?? null,
  insert(el, parent, anchor) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
    el.parent = parent
    const index = anchor ? parent.children.indexOf(anchor) : -1
    parent.children.splice(index < 0 ? parent.children.length : index, 0, el)
  },
  remove(el) {
    if (el.parent) el.parent.children.splice(el.parent.children.indexOf(el), 1)
  },
})
const allNodes = el => [el, ...el.children.flatMap(allNodes)]
const allVnodes = vnode => [
  vnode,
  ...(vnode.component ? allVnodes(vnode.component.subTree) : []),
  ...(Array.isArray(vnode.children)
    ? vnode.children
        .filter(child => child && typeof child === 'object')
        .flatMap(allVnodes)
    : []),
]

test('10,000 loaded keys render at most 50 list rows; groups, pagination and filtering stay usable', async t => {
  const previousDocument = globalThis.Document
  const previousShadowRoot = globalThis.ShadowRoot
  globalThis.Document = class {}
  globalThis.ShadowRoot = class {}
  t.after(() => {
    globalThis.Document = previousDocument
    globalThis.ShadowRoot = previousShadowRoot
  })
  i18n.global.locale.value = 'zh-CN'
  const { default: List } = await load(rendered[0])
  const props = reactive({
    keys: Array.from({ length: 10000 }, (_, index) =>
      key(`soloband:${index % 2 ? 'wt' : '8c'}:item:${index}`)
    ),
    disabled: false,
  })
  const selected = []
  const root = node('root')
  const app = renderer.createApp({
    render: () =>
      h(List, { ...props, onSelect: value => selected.push(value) }),
  })
  app.use(i18n).mount(root)
  t.after(() => app.unmount())
  const listRows = () =>
    allNodes(root).filter(
      el =>
        el.type === 'button' &&
        String(el.props.class).includes('nav-item') &&
        (el.props['aria-expanded'] !== undefined ||
          el.props['aria-pressed'] !== undefined)
    )
  assert.equal(listRows().length, 2)
  listRows()[0].props.onClick()
  await nextTick()
  assert.equal(listRows().length, 50)
  allNodes(root)
    .find(
      el => el.type === 'button' && el.props['aria-label'] === '筛选已加载的键'
    )
    .props.onClick()
  await nextTick()
  allNodes(root)
    .find(el => el.props['aria-label'] === '下一页')
    .props.onClick()
  await nextTick()
  assert.equal(listRows().length, 50)
  const filter = allVnodes(app._instance.subTree).find(
    vnode => vnode.type === 'input'
  )
  filter.props['onUpdate:modelValue']('9998')
  await nextTick()
  const matches = listRows().filter(
    el => el.props['aria-pressed'] !== undefined
  )
  assert.equal(matches.length, 1)
  matches[0].props.onClick()
  assert.equal(selected[0].id, props.keys[9998].id)
  props.keys = [key('new:key')]
  await nextTick()
  assert.ok(!allNodes(root).some(el => el.props['aria-label'] === '下一页'))
  allNodes(root)
    .find(el => el.props['aria-label'] === '清除筛选')
    .props.onClick()
  await nextTick()
  assert.ok(!allNodes(root).some(el => el.type === 'input'))
  assert.equal(listRows().length, 1)
})

test('guide inserts templates for the selected key and labels writes without executing them', async t => {
  i18n.global.locale.value = 'zh-CN'
  const { default: Guide } = await load(rendered[1])
  const inserts = []
  const root = node('root')
  const props = reactive({
    busy: false,
    selectedKey: key('用户:"键"'),
    keyType: 'string',
  })
  const app = renderer.createApp({
    render: () =>
      h(Guide, { ...props, onInsert: value => inserts.push(value) }),
  })
  app.use(i18n).mount(root)
  t.after(() => app.unmount())
  allNodes(root)
    .find(el => el.props.title === 'TTL "用户:\\"键\\""')
    .props.onClick()
  assert.deepEqual(inserts, ['TTL "用户:\\"键\\""'])
  allNodes(root)
    .find(el => el.type === 'button' && el.text === '写入与删除')
    .props.onClick()
  await nextTick()
  assert.ok(
    allNodes(root).some(el => el.props.title === 'UNLINK "用户:\\"键\\""')
  )
  assert.equal(inserts.length, 1)
  i18n.global.locale.value = 'en-US'
  await nextTick()
  assert.ok(allNodes(root).some(el => el.text === 'Common commands'))
  i18n.global.locale.value = 'zh-CN'
})
