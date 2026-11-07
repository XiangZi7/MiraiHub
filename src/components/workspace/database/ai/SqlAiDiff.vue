<script setup lang="ts">
import { computed } from 'vue'
import { cn } from '@/utils/cn'
import { diffSqlLines } from '@/utils/sql-ai'

const props = defineProps<{ before: string; after: string }>()

const lines = computed(() => diffSqlLines(props.before, props.after))
const marks = { same: ' ', add: '+', remove: '-' } as const
</script>

<template>
  <div
    class="bg-terminal scroll-thin min-h-0 overflow-auto rounded py-1 font-mono text-[11px] leading-5"
  >
    <div
      v-for="(line, index) in lines"
      :key="index"
      :class="
        cn(
          'flex min-w-max px-2 whitespace-pre',
          line.kind === 'add' && 'bg-term-green/12 text-txt',
          line.kind === 'remove' && 'bg-danger/12 text-txt-3 line-through',
          line.kind === 'same' && 'text-txt-3'
        )
      "
    >
      <span
        class="text-txt-4 w-4 shrink-0 select-none"
        aria-hidden="true"
        >{{ marks[line.kind] }}</span
      >
      <span>{{ line.text || ' ' }}</span>
    </div>
  </div>
</template>
