<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import IconButton from '@/components/ui/IconButton.vue'
import { copyText } from '@/utils/clipboard'
import {
  base64ToBytes,
  formatRedisValue,
  guessViewMode,
  type RedisViewMode,
} from './redis-value'

const props = defineProps<{
  /** UTF-8 展示文本（二进制值为有损解码）。 */
  text: string
  /** Base64 原始字节；缺省时按 text 的 UTF-8 编码计算。 */
  raw?: string
  binary?: boolean
}>()
const { t } = useI18n()
const mode = shallowRef<RedisViewMode>('text')
const modes: { value: RedisViewMode; label: string }[] = [
  { value: 'text', label: 'Text' },
  { value: 'json', label: 'JSON' },
  { value: 'hex', label: 'Hex' },
  { value: 'msgpack', label: 'MsgPack' },
]
watch(
  () => [props.text, props.binary] as const,
  ([text, binary]) => {
    mode.value = guessViewMode(text, !!binary)
  },
  { immediate: true }
)
const bytes = computed(() =>
  props.raw !== undefined
    ? base64ToBytes(props.raw)
    : new TextEncoder().encode(props.text)
)
const rendered = computed(() => {
  try {
    return { text: formatRedisValue(mode.value, props.text, bytes.value) }
  } catch (error) {
    return {
      text: props.text,
      error: t('无法按 {mode} 解析：{reason}', {
        mode: modes.find(item => item.value === mode.value)?.label,
        reason: error instanceof Error ? error.message : String(error),
      }),
    }
  }
})
</script>

<template>
  <div class="flex min-h-0 min-w-0 flex-1 flex-col">
    <div
      class="border-line-soft flex h-8 shrink-0 items-center gap-1 border-b px-2"
    >
      <div
        class="bg-raised flex items-center gap-0.5 rounded-md p-0.5"
        role="radiogroup"
        :aria-label="t('查看格式')"
      >
        <button
          v-for="item in modes"
          :key="item.value"
          type="button"
          role="radio"
          :aria-checked="mode === item.value"
          :class="[
            'rounded px-2 py-0.5 text-[10px] motion-safe:transition-colors',
            mode === item.value
              ? 'bg-accent-deep text-white'
              : 'text-txt-3 hover:text-txt',
          ]"
          @click="mode = item.value"
        >
          {{ item.label }}
        </button>
      </div>
      <span class="text-txt-4 ml-auto text-[10px]">{{
        t('{count} 字节', { count: bytes.length })
      }}</span>
      <IconButton
        icon="lucide:copy"
        :size="12"
        :title="t('复制')"
        :aria-label="t('复制')"
        @click="copyText(rendered.text)"
      />
    </div>
    <p
      v-if="rendered.error"
      class="text-amber shrink-0 px-3 pt-2 text-[10px]"
    >
      {{ rendered.error }}
    </p>
    <pre
      class="scroll-thin bg-terminal text-txt-2 min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
      >{{ rendered.text }}</pre>
  </div>
</template>
