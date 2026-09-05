<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'

defineOptions({ inheritAttrs: false })

type InputType = 'text' | 'password' | 'search' | 'number'
type InputSize = 'sm' | 'md'
type InputVariant = 'default' | 'cell'

const props = withDefaults(
  defineProps<{
    type?: InputType
    size?: InputSize
    variant?: InputVariant
    monospace?: boolean
  }>(),
  {
    type: 'text',
    size: 'md',
    variant: 'default',
    monospace: false,
  }
)

const model = defineModel<string>({ required: true })

const classes = computed(() =>
  cn(
    'app-input min-w-0 outline-none disabled:pointer-events-none disabled:opacity-45',
    props.variant === 'default'
      ? 'w-full border border-line bg-panel px-2.5 text-xs text-txt placeholder:text-txt-4 focus:border-violet/65 focus:ring-3 focus:ring-violet/12'
      : 'h-7 w-full min-w-36 border border-transparent bg-transparent px-2.5 text-inherit placeholder:italic placeholder:text-txt-4 focus:border-violet/40 focus:bg-card focus:ring-1 focus:ring-inset focus:ring-violet/45',
    props.variant === 'default' &&
      (props.size === 'sm' ? 'h-7 rounded-md text-[10.5px]' : 'h-8 rounded-lg'),
    props.monospace && 'font-mono'
  )
)
</script>

<template>
  <input
    v-bind="$attrs"
    v-model="model"
    :type="type"
    :class="classes"
  />
</template>

<style scoped>
.app-input {
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    box-shadow 150ms ease;
}

@media (prefers-reduced-motion: reduce) {
  .app-input {
    transition: none;
  }
}
</style>
