<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  onBeforeUnmount,
  reactive,
  shallowRef,
  toRefs,
  watch,
} from 'vue'
import { useThrottleFn } from '@vueuse/core'
import { openUrl } from '@tauri-apps/plugin-opener'
import { ask } from '@tauri-apps/plugin-dialog'
import { copyText } from '@/utils/clipboard'
import { IS_TAURI } from '@/utils/window'
import { isAgentWebLink, renderAgentMarkdown } from '@/utils/agent-markdown'
import { writeToShell } from '@/api/ssh'
import { useAgentTerminalSession } from '@/composables/useAgentContextBus'
import { toast } from '@/composables/useToast'

const { t } = useI18n()

const props = defineProps<{
  content: string
  canApplySql?: boolean
  /** 内容仍在流式追加时节流渲染；完成后的内容始终立即渲染。 */
  streaming?: boolean
}>()
const emit = defineEmits<{ applySql: [sql: string] }>()
const source = shallowRef(props.content)
// 流式增量约 50ms 一次，每次都全量解析 markdown 太重；trailing 保证最后一段一定渲染。
const syncStreaming = useThrottleFn(
  () => {
    source.value = props.content
  },
  120,
  true
)
watch(
  () => props.content,
  content => {
    if (props.streaming) void syncStreaming()
    else source.value = content
  }
)
watch(
  () => props.streaming,
  streaming => {
    if (!streaming) source.value = props.content
  }
)
const terminalSession = useAgentTerminalSession()
const SHELL_LANGUAGE = /^(bash|sh|shell|zsh|console|shellsession|powershell|pwsh|ps1)$/i
const COMMAND_START =
  /^(\$ |sudo |cd |ls|cat |grep |tail |head |systemctl |journalctl |docker |kubectl |git |apt(-get)? |yum |dnf |npm |pnpm |ps |top|df |du |free|chmod |chown |mkdir |rm |cp |mv |curl |wget |echo |export |find |ss |netstat |ip |ping |kill )/
const TERMINAL_ICON =
  '<svg xmlns="http://www.w3.org/2000/svg" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m7 11 2-2-2-2"/><path d="M11 13h4"/><rect width="18" height="18" x="3" y="3" rx="2" ry="2"/></svg>'
// 判断无语言标注的代码块是否像一段 shell 命令：首个非空行以常见命令开头。
function looksLikeCommand(code: string): boolean {
  const first = code.split('\n').find(line => line.trim())?.trim() ?? ''
  return COMMAND_START.test(first)
}
// 给 shell 代码块的标题栏追加“插入终端”按钮；只在受限渲染结果上增加本组件自己的按钮。
function withTerminalButtons(rendered: string, sessionId: string): string {
  if (!rendered.includes('md-code')) return rendered
  const template = document.createElement('template')
  template.innerHTML = rendered
  const plain = t('代码')
  for (const block of template.content.querySelectorAll('.md-code')) {
    const language = block.querySelector('.md-code-header > span')?.textContent ?? ''
    const code = block.querySelector('code')?.textContent ?? ''
    const shell =
      SHELL_LANGUAGE.test(language) ||
      (language === plain && looksLikeCommand(code))
    if (!shell || !code.trim()) continue
    const button = document.createElement('button')
    button.type = 'button'
    button.dataset.insertTerminal = ''
    button.className =
      'ml-auto inline-flex items-center gap-1 disabled:cursor-not-allowed disabled:opacity-40'
    button.disabled = !sessionId
    button.title = sessionId
      ? t('插入到终端（不会自动执行）')
      : t('终端未连接，无法插入')
    button.innerHTML = `${TERMINAL_ICON}<span></span>`
    button.lastElementChild!.textContent = t('插入终端')
    block.querySelector('button[data-copy-code]')?.before(button)
  }
  return template.innerHTML
}
const html = computed(() => {
  const rendered = renderAgentMarkdown(source.value, props.canApplySql)
  return terminalSession
    ? withTerminalButtons(rendered, terminalSession.value)
    : rendered
})
const state = reactive({ feedback: '', failed: false })
const { feedback, failed } = toRefs(state)
let feedbackTimer: ReturnType<typeof setTimeout> | undefined
function notify(message: string, failed = false): void {
  clearTimeout(feedbackTimer)
  state.feedback = message
  state.failed = failed
  feedbackTimer = setTimeout(() => {
    state.feedback = ''
  }, 2500)
}
// 把代码块文本粘贴到活动终端但不执行；多行先确认，并用括号粘贴模式避免 shell 逐行执行。
async function insertToTerminal(code: string): Promise<void> {
  const sessionId = terminalSession?.value
  if (!sessionId) {
    notify(t('终端未连接，无法插入'), true)
    return
  }
  const text = code.replace(/\r\n?/g, '\n').replace(/\n+$/, '')
  if (!text.trim()) return
  const lines = text.split('\n').length
  if (lines > 1) {
    const message = t(
      '将插入 {value0} 行命令。支持括号粘贴的 shell 会等待你按回车，否则可能逐行执行，确定插入？',
      { value0: lines }
    )
    const confirmed = IS_TAURI
      ? await ask(message, { title: t('插入终端'), kind: 'warning' })
      : window.confirm(message)
    if (!confirmed) return
  }
  try {
    await writeToShell(
      sessionId,
      lines > 1 ? `\x1b[200~${text.replace(/\n/g, '\r')}\x1b[201~` : text
    )
    notify(t('已插入终端，确认后按回车执行'))
  } catch (error) {
    toast.error({ title: t('插入终端失败'), description: String(error) })
  }
}
// 响应代码块的复制、插入终端或 SQL 应用按钮，应用只填入编辑器，不触发查询执行。
async function activate(event: MouseEvent): Promise<void> {
  if (!(event.target instanceof Element)) return
  const insert = event.target.closest<HTMLButtonElement>(
    'button[data-insert-terminal]'
  )
  if (insert) {
    if (event.button !== 0 || insert.disabled) return
    const code = insert.closest('.md-code')?.querySelector('code')?.textContent
    if (code) await insertToTerminal(code)
    return
  }
  const apply = event.target.closest<HTMLButtonElement>(
    'button[data-apply-sql]'
  )
  if (apply && event.button === 0 && props.canApplySql) {
    const code = apply.closest('.md-code')?.querySelector('code')?.textContent
    if (code?.trim()) emit('applySql', code)
    return
  }
  const copy = event.target.closest<HTMLButtonElement>('button[data-copy-code]')
  if (copy && event.button === 0) {
    const code = copy.closest('.md-code')?.querySelector('code')
    if (!code) return
    try {
      await copyText(code.textContent ?? '')
      notify(t('代码已复制'))
    } catch {
      notify(t('复制失败，请选择代码后手动复制'), true)
    }
    return
  }
  const link = event.target.closest<HTMLAnchorElement>('a')
  if (!link) return
  event.preventDefault()
  if (event.button !== 0 && event.button !== 1) return
  const url = link.getAttribute('href') ?? ''
  if (!isAgentWebLink(url)) return
  try {
    if (IS_TAURI) await openUrl(url)
    else window.open(url, '_blank', 'noopener,noreferrer')
  } catch {
    notify(t('无法打开链接，请复制地址后在浏览器打开'), true)
  }
}
onBeforeUnmount(() => clearTimeout(feedbackTimer))
</script>

<template>
  <div class="agent-markdown">
    <!-- HTML only comes from the restricted renderer, never directly from a message. -->
    <div
      class="markdown-body"
      @click="activate"
      @auxclick="activate"
      v-html="html"
    />
    <span
      v-if="feedback"
      role="status"
      class="markdown-feedback"
      :class="failed && 'text-danger'"
      >{{ feedback }}</span
    >
  </div>
</template>

<style scoped>
@layer components {
  .agent-markdown {
    user-select: text;
    position: relative;
    min-width: 0;
  }
  .markdown-body {
    min-width: 0;
    line-height: 1.8;
    overflow-wrap: anywhere;
  }
  .markdown-body :deep(> :first-child) {
    margin-top: 0;
  }
  .markdown-body :deep(> :last-child) {
    margin-bottom: 0;
  }
  .markdown-body :deep(p) {
    margin: 0 0 12px;
    white-space: normal;
  }
  .markdown-body :deep(h1),
  .markdown-body :deep(h2),
  .markdown-body :deep(h3),
  .markdown-body :deep(h4),
  .markdown-body :deep(h5),
  .markdown-body :deep(h6) {
    margin: 20px 0 10px;
    font-weight: 600;
    line-height: 1.5;
  }
  .markdown-body :deep(h1) {
    font-size: 18px;
  }
  .markdown-body :deep(h2) {
    font-size: 16px;
  }
  .markdown-body :deep(h3) {
    font-size: 14px;
  }
  .markdown-body :deep(h4),
  .markdown-body :deep(h5),
  .markdown-body :deep(h6) {
    font-size: 12px;
  }
  .markdown-body :deep(strong) {
    font-weight: 600;
    color: var(--color-txt);
  }
  .markdown-body :deep(em) {
    font-style: italic;
  }
  .markdown-body :deep(ul),
  .markdown-body :deep(ol) {
    margin: 10px 0 14px;
    padding-left: 22px;
  }
  .markdown-body :deep(ul) {
    list-style-type: disc;
  }
  .markdown-body :deep(ol) {
    list-style-type: decimal;
  }
  .markdown-body :deep(li) {
    padding-left: 2px;
    margin-block: 4px;
  }
  .markdown-body :deep(li > ul),
  .markdown-body :deep(li > ol),
  .markdown-body :deep(li > p) {
    margin-block: 4px;
  }
  .markdown-body :deep(blockquote) {
    margin: 12px 0;
    padding: 4px 12px;
    border-left: 3px solid var(--agent-color);
    color: var(--color-txt-3);
    background: var(--color-card);
    border-radius: 0 5px 5px 0;
  }
  .markdown-body :deep(blockquote > :last-child) {
    margin-bottom: 0;
  }
  .markdown-body :deep(a) {
    color: var(--agent-color);
    text-decoration: underline;
    text-underline-offset: 3px;
  }
  .markdown-body :deep(code) {
    font-family: var(--font-mono);
    font-size: 11px;
    padding: 2px 4px;
    border-radius: 4px;
    background: var(--color-card);
  }
  .markdown-body :deep(pre) {
    margin: 12px 0;
    max-width: 100%;
    overflow-x: auto;
    padding: 12px;
    background: var(--color-terminal);
    border-radius: 7px;
    white-space: pre;
    overflow-wrap: normal;
    line-height: 1.7;
  }
  .markdown-body :deep(pre code) {
    padding: 0;
    border: 0;
    border-radius: 0;
    background: transparent;
    white-space: pre;
  }
  .markdown-body :deep(.md-code) {
    overflow: hidden;
    margin: 14px 0;
    border: 1px solid var(--color-line);
    border-radius: 8px;
  }
  .markdown-body :deep(.md-code pre) {
    margin: 0;
    border-radius: 0;
  }
  .markdown-body :deep(.md-code-header) {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    padding: 6px 10px;
    background: var(--color-card);
    font-size: 10px;
    color: var(--color-txt-3);
  }
  .markdown-body :deep(.md-code-header button) {
    flex-shrink: 0;
    padding: 2px 6px;
    border-radius: 4px;
    cursor: pointer;
  }
  .markdown-body :deep(.md-code-header button:hover) {
    background: var(--color-hover);
    color: var(--color-txt);
  }
  .markdown-body :deep(.md-table) {
    margin: 14px 0;
    max-width: 100%;
    overflow-x: auto;
    border: 1px solid var(--color-line);
    border-radius: 7px;
  }
  .markdown-body :deep(table) {
    width: 100%;
    border-collapse: collapse;
    font-size: 11px;
  }
  .markdown-body :deep(th),
  .markdown-body :deep(td) {
    padding: 7px 10px;
    border: 1px solid var(--color-line);
    text-align: left;
    min-width: 90px;
  }
  .markdown-body :deep(th) {
    background: var(--color-card);
    font-weight: 600;
  }
  .markdown-body :deep(hr) {
    margin: 20px 0;
    border: 0;
    border-top: 1px solid var(--color-line);
  }
  .markdown-body :deep(:focus-visible) {
    outline: 1px solid var(--agent-color);
    outline-offset: -1px;
  }
  .markdown-feedback {
    position: absolute;
    right: 0;
    bottom: 0;
    padding: 5px 9px;
    border: 1px solid var(--color-line);
    border-radius: 5px;
    background: var(--color-canvas);
    font-size: 10px;
  }
}
</style>
