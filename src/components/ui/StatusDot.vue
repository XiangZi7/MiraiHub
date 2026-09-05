<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'

type Tone =
  'accent' | 'success' | 'blue' | 'violet' | 'amber' | 'danger' | 'txt-3'

const props = withDefaults(
  defineProps<{
    /** 颜色语义 */
    tone?: Tone
    /** 尺寸，单位 px */
    size?: number
    /** 是否发光 */
    glow?: boolean
  }>(),
  {
    tone: 'accent',
    size: 7,
    glow: true,
  }
)

const toneClass = computed<string>(
  () =>
    ({
      accent: 'text-accent',
      success: 'text-success',
      blue: 'text-blue',
      violet: 'text-violet',
      amber: 'text-amber',
      danger: 'text-danger',
      'txt-3': 'text-txt-3',
    })[props.tone]
)
</script>

<template>
  <span
    :class="
      cn(
        'inline-block shrink-0 rounded-full bg-current',
        toneClass,
        glow && 'glow'
      )
    "
    :style="{ width: `${size}px`, height: `${size}px` }"
  />
</template>
