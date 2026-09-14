<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyText } from '@/utils/clipboard'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{ text: string; label?: string }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 复制完成后的短暂反馈
  copied: false,
  // 剪贴板不可用时提供手动复制提示
  failed: false,
})
const { copied, failed } = toRefs(state)
const label = computed(() => props.label || t('复制'))
let timer: ReturnType<typeof setTimeout> | undefined
let version = 0
function reset(): void {
  version++
  clearTimeout(timer)
  state.copied = false
  state.failed = false
}
async function copy(): Promise<void> {
  reset()
  const token = version
  try {
    await copyText(props.text)
    if (token !== version) return
    state.copied = true
  } catch {
    if (token !== version) return
    state.failed = true
  }
  timer = setTimeout(reset, 2500)
}
watch(() => props.text, reset)
onBeforeUnmount(reset)
</script>

<template>
  <span class="copy-control">
    <button
      type="button"
      class="copy-button"
      :title="label"
      :aria-label="label"
      :disabled="!text"
      @click.stop="copy"
    >
      <AppIcon
        :name="copied ? 'lucide:check' : 'lucide:copy'"
        :size="12"
      />
      {{ copied ? t('已复制') : label }}
    </button>
    <span
      v-if="failed"
      class="copy-error"
      role="status"
      >{{ t('复制失败，请选中文字后按 Ctrl+C') }}</span
    >
  </span>
</template>

<style scoped>
.copy-control {
  display: inline-flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 6px;
}
.copy-button {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  border-radius: 4px;
  padding: 3px 5px;
  color: var(--color-txt-3);
  font-size: 10px;
  cursor: pointer;
  user-select: none;
}
.copy-button:hover {
  color: var(--color-txt);
  background: var(--color-hover);
}
.copy-button:focus-visible {
  outline: 1px solid var(--agent-color, var(--color-accent));
  outline-offset: 2px;
}
.copy-button:disabled {
  opacity: 0.4;
  cursor: default;
}
.copy-error {
  color: var(--color-danger);
  font-size: 10px;
}
</style>
