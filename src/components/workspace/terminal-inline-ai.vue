<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { nextTick, reactive, toRefs, useTemplateRef, watch } from 'vue'
import type { Terminal } from '@xterm/xterm'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import * as agent from '@/api/agent'
import { translateNativeMessage } from '@/i18n/native'
import type { ShellCommandSuggestion } from '@/types/agent'

const { t, locale } = useI18n()

const props = defineProps<{
  /** 是否显示输入条 */
  open: boolean
  /** 当前终端实例，用于读取上下文与插入命令 */
  terminal?: Terminal
  /** 终端所属的 SSH 会话 */
  sessionId: string
}>()

const emit = defineEmits<{
  /** 关闭输入条 */
  close: []
}>()

const inputRef = useTemplateRef<HTMLInputElement>('input')

// 响应式状态
const state = reactive({
  // 用户输入的自然语言需求
  request: '',
  // 是否正在等待 AI 返回
  loading: false,
  // AI 返回的命令建议
  result: null as ShellCommandSuggestion | null,
  // 当前结果对应的需求文本，用于判断回车是插入还是重新生成
  resultFor: '',
  // 请求失败时的错误信息
  error: '',
})
const { request, loading, result, error } = toRefs(state)

// 请求序号：取消或重新请求后，迟到的旧结果直接丢弃
let requestSeq = 0

watch(
  () => props.open,
  async open => {
    if (!open) {
      cancelRequest()
      return
    }
    // 重新打开时清掉上次的结果，避免把旧命令插入到新的上下文
    state.result = null
    state.resultFor = ''
    state.error = ''
    await nextTick()
    inputRef.value?.focus()
    inputRef.value?.select()
  }
)

// 读取终端光标附近最近 40 行可见文本作为上下文
function terminalContext(): string {
  const terminal = props.terminal
  if (!terminal) return ''
  const buffer = terminal.buffer.active
  const end = buffer.baseY + buffer.cursorY
  const lines: string[] = []
  for (let index = Math.max(0, end - 39); index <= end; index++)
    lines.push(buffer.getLine(index)?.translateToString(true) ?? '')
  return lines.join('\n').trim()
}

// 调用后端把自然语言转换为命令
async function generate(): Promise<void> {
  const text = state.request.trim()
  if (!text || !props.sessionId) return
  const seq = ++requestSeq
  state.loading = true
  state.error = ''
  state.result = null
  try {
    const suggestion = await agent.shellCommand(
      props.sessionId,
      text,
      terminalContext(),
      String(locale.value)
    )
    if (seq !== requestSeq) return
    state.result = suggestion
    state.resultFor = text
  } catch (err) {
    if (seq !== requestSeq) return
    state.error = translateNativeMessage(agent.errorMessage(err))
  } finally {
    if (seq === requestSeq) state.loading = false
  }
}

// 取消进行中的请求，忽略之后返回的结果
function cancelRequest(): void {
  requestSeq += 1
  state.loading = false
}

// 把命令粘贴到终端输入行，不自动回车执行
function insert(): void {
  const command = state.result?.command
  if (!command || !props.terminal) return
  props.terminal.paste(command)
  state.request = ''
  state.result = null
  close()
}

// 关闭输入条并把焦点还给终端
function close(): void {
  cancelRequest()
  emit('close')
  props.terminal?.focus()
}

// 回车：已有对应结果时插入，否则发起生成
function submit(): void {
  if (state.loading) return
  if (state.result && state.resultFor === state.request.trim()) insert()
  else void generate()
}
</script>

<template>
  <Transition
    enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
    enter-from-class="translate-y-2 opacity-0"
    leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
    leave-to-class="translate-y-2 opacity-0"
  >
    <div
      v-if="open"
      class="glass border-line absolute inset-x-3 bottom-3 z-30 flex flex-col gap-2 rounded-lg border p-2 shadow-lg"
      @keydown.esc.stop.prevent="close"
    >
      <div class="flex items-center gap-2">
        <AppIcon
          name="lucide:wand-sparkles"
          :size="14"
          class="text-accent shrink-0"
        />
        <input
          ref="input"
          v-model="request"
          type="text"
          class="text-txt placeholder:text-txt-3 min-w-0 flex-1 bg-transparent text-xs outline-none"
          :placeholder="t('用自然语言描述要执行的操作，回车生成命令')"
          :aria-label="t('用自然语言生成命令')"
          @keydown.enter.prevent="submit"
        />
        <template v-if="loading">
          <AppIcon
            name="lucide:loader-circle"
            :size="14"
            class="text-txt-3 shrink-0 animate-spin motion-reduce:animate-none"
          />
          <button
            type="button"
            class="text-txt-3 hover:text-txt focus-visible:outline-accent shrink-0 cursor-pointer rounded text-[11px] focus-visible:outline-2"
            @click="cancelRequest"
          >
            {{ t('取消') }}
          </button>
        </template>
        <IconButton
          icon="lucide:x"
          :size="14"
          :title="t('关闭 (Esc)')"
          @click="close"
        />
      </div>
      <p
        v-if="error"
        class="text-danger text-[11px] break-all"
      >
        {{ error }}
      </p>
      <div
        v-if="result"
        class="border-line flex items-start gap-2 border-t pt-2"
      >
        <div class="min-w-0 flex-1">
          <code
            class="text-txt block font-mono text-xs break-all whitespace-pre-wrap"
            >{{ result.command }}</code
          >
          <p class="text-txt-2 mt-1 text-[11px]">
            <span
              :class="
                result.risk === 'high'
                  ? 'text-danger font-medium'
                  : result.risk === 'medium'
                    ? 'text-amber'
                    : 'text-txt-3'
              "
              >{{
                result.risk === 'high'
                  ? t('高风险')
                  : result.risk === 'medium'
                    ? t('中风险')
                    : t('低风险')
              }}</span
            >
            · {{ result.explanation }}
          </p>
        </div>
        <button
          type="button"
          class="border-accent text-accent hover:bg-hover focus-visible:outline-accent shrink-0 cursor-pointer rounded-md border px-2 py-1 text-[11px] focus-visible:outline-2 focus-visible:outline-offset-2"
          @click="insert"
        >
          {{ t('插入') }} ↵
        </button>
      </div>
    </div>
  </Transition>
</template>
