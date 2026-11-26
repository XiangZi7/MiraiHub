<script setup lang="ts">
import { computed } from 'vue'
import StatusDot from '@/components/ui/StatusDot.vue'

const props = defineProps<{
  state: string
  label: string
  health?: string
  exitCode?: number | null
}>()
const tone = computed(() => {
  const health = props.health || props.label
  if (
    props.state === 'dead' ||
    /\bunhealthy\b/i.test(health) ||
    (props.state === 'exited' &&
      (Boolean(props.exitCode) || /^Exited \([1-9]/i.test(props.label)))
  )
    return 'danger'
  if (
    ['paused', 'restarting'].includes(props.state) ||
    /\bstarting\b/i.test(health)
  )
    return 'amber'
  return props.state === 'running' ? 'success' : 'txt-3'
})
const backgrounds = {
  danger: 'bg-danger/10',
  amber: 'bg-amber/12',
  success: 'bg-success/10',
  'txt-3': 'bg-hover',
}
</script>

<template>
  <!-- 紧凑状态标签由原有状态点、文字和主题语义底色组成。 -->
  <span
    class="text-txt-2 inline-flex max-w-full items-center gap-1.5 rounded-full px-2 py-0.5 text-[11px] leading-4"
    :class="backgrounds[tone]"
    :title="label"
  >
    <StatusDot
      :tone="tone"
      :size="6"
      :glow="false"
      aria-hidden="true"
    />
    <span class="min-w-0 truncate">{{ label }}</span>
  </span>
</template>
