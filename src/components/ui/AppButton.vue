<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'

type Variant = 'default' | 'primary' | 'danger' | 'ghost' | 'bare'
type Size = 'sm' | 'md'
type ButtonType = 'button' | 'submit' | 'reset'

const props = withDefaults(
  defineProps<{
    variant?: Variant
    size?: Size
    type?: ButtonType
  }>(),
  {
    variant: 'default',
    size: 'md',
    type: 'button',
  }
)

const classes = computed<string>(() =>
  cn(
    {
      default: 'btn',
      primary: 'btn-primary',
      danger:
        'btn border-danger/30 bg-danger/8 text-danger hover:border-danger/45 hover:bg-danger/15 hover:text-danger',
      ghost: 'btn border-transparent bg-transparent',
      bare: 'inline-flex cursor-pointer items-center disabled:pointer-events-none disabled:opacity-35',
    }[props.variant],
    props.variant !== 'bare' && props.size === 'sm' && 'px-2 py-1 text-[11px]'
  )
)
</script>

<template>
  <button
    :type="type"
    :class="classes"
  >
    <slot />
  </button>
</template>
