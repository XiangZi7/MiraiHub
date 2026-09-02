<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'

type Variant = 'default' | 'primary' | 'ghost'
type Size = 'sm' | 'md'

const props = withDefaults(defineProps<{
  variant?: Variant
  size?: Size
}>(), {
  variant: 'default',
  size: 'md',
})

const classes = computed<string>(() => cn(
  {
    default: 'btn',
    primary: 'btn-primary',
    ghost: 'btn border-transparent bg-transparent',
  }[props.variant],
  props.size === 'sm' && 'px-2 py-1 text-[11px]',
))
</script>

<template>
  <button type="button" :class="classes">
    <slot />
  </button>
</template>
