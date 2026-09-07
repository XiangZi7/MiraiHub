<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, toRefs } from 'vue'
import { openUrl } from '@tauri-apps/plugin-opener'
import { copyText } from '@/utils/clipboard'
import { IS_TAURI } from '@/utils/window'
import { isAgentWebLink, renderAgentMarkdown } from '@/utils/agent-markdown'

const props = defineProps<{ content: string }>()
const html = computed(() => renderAgentMarkdown(props.content))
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
async function activate(event: MouseEvent): Promise<void> {
  if (!(event.target instanceof Element)) return
  const copy = event.target.closest<HTMLButtonElement>('button[data-copy-code]')
  if (copy && event.button === 0) {
    const code = copy.closest('.md-code')?.querySelector('code')
    if (!code) return
    try {
      await copyText(code.textContent ?? '')
      notify('代码已复制')
    } catch {
      notify('复制失败，请选择代码后手动复制', true)
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
    notify('无法打开链接，请复制地址后在浏览器打开', true)
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
.agent-markdown {
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
</style>
