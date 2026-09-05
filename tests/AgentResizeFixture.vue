<script setup lang="ts">
import { useTemplateRef } from 'vue'
import AppResizeHandle from '../src/components/ui/AppResizeHandle.vue'
import { useAgentPaneWidth } from '../src/composables/useAgentPaneWidth'

const props = defineProps<{ size: number; kind: 'ssh' | 'database' }>()
const container = useTemplateRef<HTMLElement>('container')
const { width, min, max, style } = useAgentPaneWidth(container, props.kind)
</script>
<template>
  <section
    ref="container"
    :data-kind="kind"
    :style="{ width: `${size}px` }"
    class="fixture"
  >
    <div class="editor">{{ kind === 'ssh' ? 'SSH 终端' : 'SQL 编辑区' }}</div>
    <AppResizeHandle
      v-model="width"
      pane-side="right"
      :min="min"
      :max="max"
      :label="`调整 ${kind} AI 宽度`"
    />
    <aside :style="style">
      <strong>AI Agent</strong><output>{{ width }} px</output>
    </aside>
  </section>
</template>
<style scoped>
.fixture {
  display: flex;
  height: 170px;
  max-width: 100%;
  margin: 16px 0;
}
.editor,
aside {
  min-width: 0;
  overflow: hidden;
  padding: 18px;
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-pane);
  color: var(--color-txt-2);
}
.editor {
  flex: 1;
}
aside {
  display: flex;
  flex-direction: column;
  gap: 12px;
}
output {
  color: var(--color-accent);
}
</style>
