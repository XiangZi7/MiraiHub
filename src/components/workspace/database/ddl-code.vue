<script setup lang="ts">
import { computed } from 'vue'
import { highlightTree, tagHighlighter, tags } from '@lezer/highlight'
import type { DatabaseKind } from '@/types/database'
import { SQL_DIALECTS } from '@/utils/sql-completion'

const props = defineProps<{ source: string; kind?: DatabaseKind }>()

const highlighter = tagHighlighter([
  { tag: tags.keyword, class: 'text-accent' },
  { tag: [tags.typeName, tags.className], class: 'text-term-blue' },
  { tag: [tags.string, tags.special(tags.string)], class: 'text-term-green' },
  { tag: [tags.number, tags.bool, tags.null], class: 'text-amber' },
  { tag: tags.comment, class: 'text-term-dim italic' },
])

/** 逐段标出 SQL token，原样保留未高亮的文字、缩进和换行。 */
const chunks = computed(() => {
  const source = props.source
  const tree = SQL_DIALECTS[props.kind ?? 'mysql'].language.parser.parse(source)
  const parts: { text: string; css?: string }[] = []
  let end = 0
  highlightTree(tree, highlighter, (from, to, css) => {
    if (from > end) parts.push({ text: source.slice(end, from) })
    parts.push({ text: source.slice(from, to), css })
    end = to
  })
  if (end < source.length) parts.push({ text: source.slice(end) })
  return parts
})
</script>

<template>
  <pre
    class="text-term-fg pr-24 font-mono text-[11.5px] leading-5 whitespace-pre-wrap"
  ><code><span v-for="(part, index) in chunks" :key="index" :class="part.css">{{ part.text }}</span></code></pre>
</template>
