<script setup lang="ts">
import { computed, onBeforeUnmount, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { copyText } from '@/utils/clipboard'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{
  text: string
  label?: string
  iconOnly?: boolean
}>()
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
  <span class="inline-flex flex-wrap items-center gap-1.5">
    <button
      type="button"
      class="text-txt-3 hover:bg-hover hover:text-txt focus-visible:outline-accent inline-flex shrink-0 cursor-pointer items-center justify-center gap-[5px] rounded p-[5px] text-[10px] select-none focus-visible:outline focus-visible:outline-1 focus-visible:outline-offset-2 disabled:cursor-default disabled:opacity-40"
      :title="label"
      :aria-label="label"
      :disabled="!text"
      @click.stop="copy"
    >
      <AppIcon
        :name="copied ? 'lucide:check' : 'lucide:copy'"
        :size="12"
      />
      <span v-if="!iconOnly">{{ copied ? t('已复制') : label }}</span
      ><span
        v-else
        class="sr-only"
        >{{ copied ? t('已复制') : label }}</span
      >
    </button>
    <span
      v-if="failed"
      class="text-danger text-[10px]"
      role="status"
      >{{ t('复制失败，请选中文字后按 Ctrl+C') }}</span
    >
  </span>
</template>
