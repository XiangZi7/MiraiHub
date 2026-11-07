<script setup lang="ts">
import { computed, onMounted, shallowRef, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import { errorMessage } from '@/api/agent'
import AgentMarkdown from '@/components/agent/AgentMarkdown.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useDatabaseAi } from '@/composables/useDatabaseAi'
import { toast } from '@/composables/useToast'
import { extractSqlBlock, findSqlBlock, sqlDangerReason } from '@/utils/sql-ai'
import SqlAiDiff from './SqlAiDiff.vue'

export type SqlAiPanelMode = 'generate' | 'fix' | 'explain' | 'optimize'

const props = defineProps<{
  mode: SqlAiPanelMode
  /** 待改写、修复或解释的 SQL；在光标处生成新语句时为空 */
  source: string
  /** 修复模式下的数据库报错 */
  error?: string
  /** 修复模式下的自动迭代轮次，0 表示用户手动发起 */
  round?: number
}>()

const emit = defineEmits<{
  accept: [sql: string, run: boolean]
  close: []
}>()

const { t } = useI18n()
const { text, loading, tokens, run, cancel } = useDatabaseAi()
const instruction = shallowRef('')
const done = shallowRef(false)
const inputRef = useTemplateRef<HTMLInputElement>('input')

const title = computed(
  () =>
    ({
      generate: props.source ? t('AI 改写 SQL') : t('AI 生成 SQL'),
      fix: t('AI 修复 SQL'),
      explain: t('AI 解释 SQL'),
      optimize: t('AI 优化 SQL'),
    })[props.mode]
)
// 生成和修复的回复就是 SQL；解释和优化的回复是 Markdown。
const sqlOnly = computed(
  () => props.mode === 'generate' || props.mode === 'fix'
)
const proposal = computed(() => {
  if (!done.value) return ''
  if (sqlOnly.value) return extractSqlBlock(text.value)
  return props.mode === 'optimize' ? findSqlBlock(text.value) : ''
})
const danger = computed(() => sqlDangerReason(proposal.value))

/** 发起请求；失败走公共通知，用户可点“重新生成”再试。 */
async function submit(): Promise<void> {
  if (props.mode === 'generate' && !instruction.value.trim()) return
  done.value = false
  try {
    const result = await run({
      mode: props.mode,
      instruction: instruction.value.trim(),
      sql: props.source,
      extra: props.error ?? '',
    })
    if (result) done.value = true
  } catch (error) {
    toast.error(errorMessage(error))
  }
}

/** 关闭面板并中止未完成的请求。 */
function close(): void {
  cancel()
  emit('close')
}

/** 生成模式聚焦输入框，其余模式直接开始请求。 */
onMounted(() => {
  if (props.mode === 'generate') inputRef.value?.focus()
  else void submit()
})
</script>

<template>
  <section
    class="border-line-strong bg-panel shadow-pop pop-in absolute top-2 right-3 left-3 z-20 flex max-h-[85%] flex-col gap-2 rounded-lg border p-2 font-sans"
    :aria-label="title"
    @keydown.esc.stop.prevent="close"
  >
    <header class="flex items-center gap-1.5 text-[11px]">
      <AppIcon
        name="lucide:sparkles"
        :size="12"
        class="text-violet"
      />
      <span class="text-txt font-medium">{{ title }}</span>
      <span
        v-if="round"
        class="text-txt-3"
        >{{ t('自动修复第 {round}/2 轮', { round }) }}</span
      >
      <span class="flex-1" />
      <span
        v-if="tokens"
        class="text-txt-4 font-mono tabular-nums"
        >{{ t('{tokens} tokens', { tokens }) }}</span
      >
      <IconButton
        icon="lucide:x"
        :size="13"
        :title="t('关闭')"
        @click="close"
      />
    </header>
    <form
      v-if="mode === 'generate'"
      class="flex gap-1.5"
      @submit.prevent="submit"
    >
      <input
        ref="input"
        v-model="instruction"
        class="border-line bg-terminal text-txt focus-visible:border-violet min-w-0 flex-1 rounded border px-2 py-1 text-xs outline-none"
        :aria-label="t('描述你想要的 SQL')"
        :placeholder="t('描述你想要的 SQL，按 Enter 发送')"
      />
      <AppButton
        size="sm"
        type="submit"
        :disabled="loading || !instruction.trim()"
      >
        {{ t('发送') }}
      </AppButton>
    </form>
    <div
      v-if="loading && !text"
      class="text-txt-3 flex items-center gap-2 text-[11px]"
      aria-live="polite"
    >
      <AppIcon
        name="lucide:loader-circle"
        :size="12"
        class="motion-safe:animate-spin"
      />
      {{ t('AI 正在思考…') }}
    </div>
    <SqlAiDiff
      v-if="sqlOnly && text"
      :before="source"
      :after="extractSqlBlock(text)"
    />
    <div
      v-else-if="text"
      class="scroll-thin min-h-0 overflow-auto text-xs"
    >
      <AgentMarkdown
        :content="text"
        :streaming="loading"
      />
    </div>
    <SqlAiDiff
      v-if="mode === 'optimize' && proposal"
      class="max-h-40 shrink-0"
      :before="source"
      :after="proposal"
    />
    <p
      v-if="danger"
      class="text-amber flex items-center gap-1.5 text-[11px]"
      role="alert"
    >
      <AppIcon
        name="lucide:triangle-alert"
        :size="12"
      />
      {{ t('包含危险操作 {reason}，请确认后再执行', { reason: danger }) }}
    </p>
    <footer
      v-if="done || (mode !== 'generate' && !loading)"
      class="flex flex-wrap items-center justify-end gap-1.5"
    >
      <AppButton
        size="sm"
        :disabled="loading"
        @click="submit"
      >
        {{ t('重新生成') }}
      </AppButton>
      <AppButton
        v-if="proposal"
        size="sm"
        @click="emit('accept', proposal, false)"
      >
        {{ source ? t('接受替换') : t('接受插入') }}
      </AppButton>
      <AppButton
        v-if="proposal"
        size="sm"
        variant="primary"
        @click="emit('accept', proposal, true)"
      >
        {{ t('接受并运行') }}
      </AppButton>
    </footer>
  </section>
</template>
