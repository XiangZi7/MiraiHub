<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { errorMessage } from '@/api/agent'
import AgentMarkdown from '@/components/agent/AgentMarkdown.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useDatabaseAi } from '@/composables/useDatabaseAi'
import { toast } from '@/composables/useToast'
import type { DatabaseStatementResult } from '@/types/database'
import {
  parseChartSpec,
  stripChartBlock,
  summarizeResult,
} from '@/utils/sql-ai'
import SqlAiChart from './SqlAiChart.vue'

const props = defineProps<{ statement: DatabaseStatementResult | null }>()

const { t } = useI18n()
const { text, loading, tokens, run, cancel } = useDatabaseAi()
const question = shallowRef('')

const answer = computed(() => stripChartBlock(text.value))
const chart = computed(() =>
  props.statement && !loading.value
    ? parseChartSpec(
        text.value,
        props.statement.columns.map(column => column.name)
      )
    : null
)

// 结果切换后旧回答不再对应当前数据，直接作废。
watch(
  () => props.statement,
  () => {
    cancel()
    text.value = ''
    tokens.value = 0
  }
)

/** 发送问题及结果摘要；失败走公共通知，问题保留以便重试。 */
async function ask(): Promise<void> {
  const statement = props.statement
  if (!statement || !question.value.trim() || loading.value) return
  try {
    await run({
      mode: 'ask',
      instruction: question.value.trim(),
      sql: statement.statement,
      extra: summarizeResult(statement),
    })
  } catch (error) {
    toast.error(errorMessage(error))
  }
}
</script>

<template>
  <div
    class="scroll-thin flex min-h-0 flex-1 flex-col gap-2 overflow-auto p-3 text-xs"
  >
    <p
      v-if="!statement?.columns.length"
      class="text-txt-3"
    >
      {{ t('当前没有可分析的结果集') }}
    </p>
    <template v-else>
      <form
        class="flex shrink-0 gap-1.5"
        @submit.prevent="ask"
      >
        <input
          v-model="question"
          class="border-line bg-terminal text-txt focus-visible:border-violet min-w-0 flex-1 rounded border px-2 py-1 outline-none"
          :aria-label="t('针对当前结果提问')"
          :placeholder="t('针对当前结果提问，例如：哪个类别占比最高？')"
        />
        <AppButton
          v-if="loading"
          size="sm"
          @click="cancel"
        >
          {{ t('停止') }}
        </AppButton>
        <AppButton
          v-else
          size="sm"
          type="submit"
          :disabled="!question.trim()"
        >
          <AppIcon
            name="lucide:sparkles"
            :size="12"
          />
          {{ t('问 AI') }}
        </AppButton>
      </form>
      <p class="text-txt-4 shrink-0 text-[10px]">
        {{ t('发送内容：列信息、前 50 行抽样及逐列统计。') }}
        <span
          v-if="tokens"
          class="font-mono tabular-nums"
          >{{ t('{tokens} tokens', { tokens }) }}</span
        >
      </p>
      <AgentMarkdown
        v-if="answer"
        :content="answer"
        :streaming="loading"
      />
      <SqlAiChart
        v-if="chart && statement"
        :spec="chart"
        :statement="statement"
      />
    </template>
  </div>
</template>
