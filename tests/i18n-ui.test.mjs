import assert from 'node:assert/strict'
import { test } from 'node:test'
import { createRenderer, h, markRaw, nextTick, reactive } from 'vue'
import { sourceLoader, dataModule } from './helpers/source-module.mjs'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import ts from 'typescript'
import { parse, compileTemplate } from 'vue/compiler-sfc'

const components = [
  'src/components/workspace/transfer/TransferStatusFilter.vue',
  'src/components/workspace/transfer/TransferTaskCard.vue',
  'src/components/workspace/transfer/TransferPanelHeader.vue',
  'src/components/agent/AgentComposer.vue',
  'src/components/agent/AgentApprovalCard.vue',
  'src/components/agent/AgentMarkdown.vue',
  'src/components/agent/AgentRetryStatus.vue',
  'src/components/settings/AiCapacityFields.vue',
]
const load = sourceLoader({}, components)
const { i18n } = await load('src/i18n/index.ts')
const { translateNativeMessage } = await load('src/i18n/native.ts')
const { messages } = await load('src/i18n/messages.ts')
const node = (type, text = '') =>
  markRaw({
    type,
    text,
    style: {},
    scrollHeight: 30,
    props: {},
    children: [],
    parent: null,
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
  patchProp: (el, key, _old, value) => {
    el.props[key] = value
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
const visible = el =>
  [
    el.type === '#comment' ? '' : el.text,
    ...Object.entries(el.props)
      .filter(([key]) =>
        ['title', 'aria-label', 'placeholder', 'innerHTML'].includes(key)
      )
      .map(([, value]) => value),
    ...el.children.map(visible),
  ].join(' ')

test('retry status counts down, translates diagnostics, and updates for the next attempt', async context => {
  context.mock.timers.enable({ apis: ['Date', 'setInterval'], now: 10000 })
  const { default: RetryStatus } = await load(components[6])
  const props = reactive({
    retry: {
      attempt: 1,
      max: 999,
      retryAt: 12000,
      reason: '模型服务错误：HTTP 429 · Too many requests',
    },
  })
  const root = node('root')
  const app = renderer.createApp({ render: () => h(RetryStatus, props) })
  i18n.global.locale.value = 'zh-CN'
  app.use(i18n).mount(root)
  try {
    assert.match(visible(root), /第 1\/999 次重试 · 2 秒/)
    context.mock.timers.tick(1000)
    await nextTick()
    assert.match(visible(root), /1 秒后/)
    props.retry = { ...props.retry, attempt: 2, retryAt: 14000 }
    i18n.global.locale.value = 'en-US'
    await nextTick()
    assert.match(visible(root), /Retry 2\/999.*3s/)
    assert.match(visible(root), /Model service error: HTTP 429/)
    context.mock.timers.tick(5000)
    await nextTick()
    assert.match(visible(root), /in 0s/)
  } finally {
    app.unmount()
  }
})

test('capacity presets preserve the independently editable retry count', async () => {
  const { default: Capacity } = await load(components[7])
  const { DEFAULT_AGENT_LIMITS } = await load('src/constants/agent-limits.ts')
  const state = reactive({
    limits: { ...DEFAULT_AGENT_LIMITS, maxRetries: 999 },
  })
  const root = node('root')
  const app = renderer.createApp({
    render: () =>
      h(Capacity, {
        disabled: false,
        modelValue: state.limits,
        'onUpdate:modelValue': value => {
          state.limits = value
        },
      }),
  })
  app.use(i18n).mount(root)
  try {
    const section = app._instance.subTree.component.subTree
    const select = section.children.find(
      child => child.props?.['onUpdate:modelValue']
    )
    select.props['onUpdate:modelValue']('enhanced')
    await nextTick()
    assert.equal(state.limits.maxSteps, 32)
    assert.equal(state.limits.maxRetries, 999)
    const retryInput = root.children[0].children
      .flatMap(child => child.children)
      .find(child => child.props.id === 'ai-max-retries')
    assert.ok(retryInput)
    assert.equal(retryInput.props.min, 0)
    assert.equal(retryInput.props.max, 999)
  } finally {
    app.unmount()
  }
})

test('panel preserves the selected permission across profiles and conversations, but resets for another target', async () => {
  const mockUrl = dataModule(`
    import { shallowRef } from ${JSON.stringify(import.meta.resolve('vue'))}
    export let profileChanged
    const ref = shallowRef
    export function useAgentProfiles(changed) {
      profileChanged = changed
      return { activeId: ref('a'), active: ref({enabled:true}), options: ref([]), loading: ref(false), switching: ref(false), error: ref(''), select() {} }
    }
    export function useAiAgent() {
      return { run:ref(null), busy:ref(false), progress:ref(null), error:ref(''), awaitingApproval:ref(false), conversations:ref([]), historyLoading:ref(false), historyError:ref(''), historyMutating:ref(false), switchingConversation:ref(false), selectConversation() {}, removeConversation() {}, renameConversation() {}, refreshHistory() {}, send() {}, decide() {}, stop() {}, clear() {}, changeProfile() {} }
    }
    export function useAgentDraft() {
      return { prompt:ref(''), attachments:ref([]), reading:ref(false), attachmentError:ref(''), reset() {}, clearAttachments() {} }
    }
  `)
  const panelLoad = sourceLoader(
    {
      '@/composables/useAgentProfiles': mockUrl,
      '@/composables/useAiAgent': mockUrl,
      '@/composables/useAgentDraft': mockUrl,
    },
    ['src/components/agent/AiAgentPanel.vue']
  )
  const { default: Panel } = await panelLoad(
    'src/components/agent/AiAgentPanel.vue'
  )
  const mock = await import(mockUrl)
  const root = node('root')
  const state = reactive({
    target: { kind: 'ssh', sessionId: 'a', database: '' },
  })
  const app = renderer.createApp({
    render: () => h(Panel, { target: state.target }),
  })
  app.use(i18n).mount(root)
  const find = predicate => {
    const visit = vnode => {
      if (predicate(vnode)) return vnode
      for (const child of Array.isArray(vnode.children) ? vnode.children : []) {
        const match = child && typeof child === 'object' ? visit(child) : null
        if (match) return match
      }
    }
    return visit(app._instance.subTree.component.subTree)
  }
  const composer = () => find(vnode => vnode.props?.['onUpdate:approvalMode'])
  try {
    assert.equal(composer().props['approval-mode'], 'auto')
    composer().props['onUpdate:approvalMode']('full')
    await nextTick()
    mock.profileChanged()
    await nextTick()
    assert.equal(composer().props['approval-mode'], 'full')
    find(vnode => vnode.props?.icon === 'lucide:square-pen').props.onClick()
    await nextTick()
    assert.equal(composer().props['approval-mode'], 'full')
    find(vnode => vnode.props?.onSelect).props.onSelect('another-chat')
    await nextTick()
    assert.equal(composer().props['approval-mode'], 'full')
    state.target = { ...state.target, sessionId: 'b' }
    await nextTick()
    assert.equal(composer().props['approval-mode'], 'auto')
  } finally {
    app.unmount()
  }
})

test('mounted transfer and AI components update immediately in both languages', async () => {
  const cases = [
    [
      components[0],
      {
        modelValue: 'all',
        counts: { all: 2, active: 1, completed: 1, failed: 0 },
      },
      '进行中',
      'In progress',
    ],
    [
      components[1],
      {
        task: {
          id: 'one',
          fileName: '服务器日志.txt',
          status: 'running',
          direction: 'upload',
          source: '/local/a',
          target: '/remote/a',
          totalBytes: 100,
          transferredBytes: 25,
        },
      },
      '暂停',
      'Pause',
    ],
    [
      components[2],
      { statusLabel: '', statusIcon: '', progress: 25, busy: false },
      '文件传输',
      'File transfers',
    ],
    [
      components[3],
      {
        modelValue: '',
        approvalMode: 'auto',
        isDatabase: false,
        attachments: [],
        disabled: false,
        awaitingApproval: false,
        busy: false,
        canSend: false,
        reading: false,
        attachmentError: '',
        activeId: '',
        profileOptions: [],
        profileDisabled: false,
        profileError: '',
      },
      '描述问题',
      'Describe a problem',
    ],
    [
      components[4],
      {
        approval: {
          id: 'one',
          expiresAt: Date.now() + 60000,
          label: '执行 Shell 命令',
          command: 'echo 测试',
          reason: '用户原因',
        },
        target: '用户服务器',
        busy: false,
      },
      '需要你的审批',
      'Your approval is required',
    ],
    [
      components[5],
      { content: '```sh\necho 用户内容\n```' },
      '复制代码',
      'Copy code',
    ],
  ]
  for (const [file, props, chinese, english] of cases) {
    const { default: component } = await load(file)
    const root = node('root')
    i18n.global.locale.value = 'zh-CN'
    const app = renderer.createApp({ render: () => h(component, props) })
    app.use(i18n)
    app.mount(root)
    try {
      assert.ok(visible(root).includes(chinese), `${file}: ${visible(root)}`)
      i18n.global.locale.value = 'en-US'
      await nextTick()
      assert.ok(visible(root).includes(english), `${file}: ${visible(root)}`)
      assert.ok(!visible(root).includes(chinese), `${file} retained Chinese UI`)
      if (file === components[1])
        assert.ok(visible(root).includes('服务器日志.txt'))
      if (file === components[4]) assert.ok(visible(root).includes('echo 测试'))
      i18n.global.locale.value = 'zh-CN'
      await nextTick()
      assert.ok(visible(root).includes(chinese), `${file} did not switch back`)
    } finally {
      app.unmount()
    }
  }
})

test('copy buttons preserve exact text, update feedback and expose clipboard errors', async () => {
  const clipboardModule = dataModule(
    `export const clipboard={values:[],fail:false}; export async function copyText(text){if(clipboard.fail)throw new Error('denied');clipboard.values.push(text)}`
  )
  const { clipboard } = await import(clipboardModule)
  const file = 'src/components/agent/AgentCopyButton.vue'
  const { default: CopyButton } = await sourceLoader(
    { '@/utils/clipboard': clipboardModule },
    [file]
  )(file)
  const props = reactive({
    text: 'command -v pm2 && pm2 --version\n中文说明',
    label: '复制命令',
  })
  const root = node('root')
  const app = renderer.createApp({ render: () => h(CopyButton, props) })
  app.use(i18n)
  app.mount(root)
  const findButton = el =>
    el.type === 'button' ? el : el.children.map(findButton).find(Boolean)
  try {
    const button = findButton(root)
    await button.props.onClick({ stopPropagation() {} })
    await nextTick()
    assert.equal(clipboard.values[0], props.text)
    assert.match(visible(root), /已复制/)
    props.text = '更新后的文字'
    await nextTick()
    assert.doesNotMatch(visible(root), /已复制/)
    clipboard.fail = true
    await button.props.onClick({ stopPropagation() {} })
    await nextTick()
    assert.match(visible(root), /Ctrl\+C/)
  } finally {
    app.unmount()
  }
})

test('approval waiting keeps an actionable stop button in the composer', async () => {
  const { default: Composer } = await load(components[3])
  const root = node('root')
  let stopped = 0
  const app = renderer.createApp({
    render: () =>
      h(Composer, {
        modelValue: '',
        approvalMode: 'auto',
        disabled: true,
        busy: false,
        canSend: false,
        awaitingApproval: true,
        isDatabase: false,
        attachments: [],
        reading: false,
        attachmentError: '',
        activeId: '',
        profileOptions: [],
        profileDisabled: false,
        profileError: '',
        onStop: () => stopped++,
      }),
  })
  app.use(i18n)
  app.mount(root)
  const findStop = el =>
    el.type === 'button' && el.props['aria-label'] === '停止后续操作'
      ? el
      : el.children.map(findStop).find(Boolean)
  try {
    const button = findStop(root)
    assert.ok(button)
    assert.ok(!button.props.disabled)
    button.props.onClick()
    assert.equal(stopped, 1)
  } finally {
    app.unmount()
  }
})

test('all catalog messages compile, have matching parameters, and contain no untranslated Chinese in English', () => {
  const errors = []
  const previous = console.error
  console.error = (...args) => errors.push(args.join(' '))
  try {
    assert.deepEqual(
      Object.keys(messages['zh-CN']).sort(),
      Object.keys(messages['en-US']).sort()
    )
    for (const locale of ['zh-CN', 'en-US']) {
      i18n.global.locale.value = locale
      for (const [key, text] of Object.entries(messages[locale])) {
        const params = Object.fromEntries(
          [...text.matchAll(/\{(\w+)\}/g)].map(([, name]) => [name, 2])
        )
        const translated = i18n.global.t(key, params)
        if (locale === 'en-US' && text !== '简体中文')
          assert.doesNotMatch(translated, /[\u3400-\u9fff]/, key)
        const parameters = value =>
          [...value.matchAll(/\{(\w+)\}/g)].map(([, name]) => name).sort()
        assert.deepEqual(
          parameters(text),
          parameters(messages[locale === 'en-US' ? 'zh-CN' : 'en-US'][key]),
          key
        )
      }
    }
    assert.deepEqual(errors, [])
  } finally {
    console.error = previous
  }
})

test('native labels translate while external errors and user content stay intact', () => {
  i18n.global.locale.value = 'en-US'
  assert.equal(
    translateNativeMessage('等待审批；尚未执行'),
    'Awaiting approval; not executed yet'
  )
  assert.equal(
    translateNativeMessage('工具失败：数据库已切换'),
    'Tool failed: Database switched'
  )
  assert.equal(
    translateNativeMessage('数据库服务返回：用户自定义错误'),
    '数据库服务返回：用户自定义错误'
  )
  i18n.global.locale.value = 'zh-CN'
  assert.equal(
    translateNativeMessage('等待审批；尚未执行'),
    '等待审批；尚未执行'
  )
})

test('every literal translation key used by the frontend exists in both catalogs', () => {
  const missing = []
  function scan(code, file) {
    const ast = ts.createSourceFile(
      file + '.ts',
      code,
      ts.ScriptTarget.Latest,
      true
    )
    function visit(n) {
      if (
        ts.isCallExpression(n) &&
        /(?:^|\.)t$/.test(n.expression.getText(ast)) &&
        n.arguments[0] &&
        ts.isStringLiteral(n.arguments[0])
      ) {
        const key = n.arguments[0].text
        for (const locale of ['zh-CN', 'en-US'])
          if (!Object.hasOwn(messages[locale], key))
            missing.push(`${file}: ${locale}: ${key}`)
      }
      ts.forEachChild(n, visit)
    }
    visit(ast)
  }
  function walk(dir) {
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const file = `${dir}/${entry.name}`
      if (entry.isDirectory()) {
        if (entry.name !== 'i18n') walk(file)
        continue
      }
      if (!/\.(ts|vue)$/.test(file)) continue
      const source = readFileSync(file, 'utf8')
      if (file.endsWith('.vue')) {
        const { descriptor } = parse(source)
        scan(descriptor.scriptSetup?.content ?? '', file)
        if (descriptor.template)
          scan(
            compileTemplate({
              source: descriptor.template.content,
              filename: file,
              id: file,
            }).code,
            file
          )
      } else scan(source, file)
    }
  }
  walk(fileURLToPath(new URL('../src', import.meta.url)))
  assert.deepEqual(missing, [])
})
