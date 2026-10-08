<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import type { AgentFileChange } from '@/types/agent'
import { configurationDiff } from '@/utils/agent-artifacts'
const props = defineProps<{ change: AgentFileChange }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 大文件分批显示，避免阻塞审批界面
  limit: 200,
})
const { limit } = toRefs(state)
const lines = computed(() =>
  configurationDiff(props.change.before, props.change.after)
)
const additions = computed(
  () => lines.value.filter(line => line.kind === 'add').length
)
const removals = computed(
  () => lines.value.filter(line => line.kind === 'remove').length
)
watch(
  () => props.change,
  () => {
    state.limit = 200
  }
)
</script>
<template>
  <section
    class="file-diff"
    :aria-label="t('配置差异预览')"
  >
    <header>
      <strong>{{ t('配置差异预览') }}</strong
      ><span class="diff-add">+{{ additions }}</span
      ><span class="diff-remove">−{{ removals }}</span>
    </header>
    <p class="diff-path">{{ change.path }}</p>
    <div
      class="diff-lines"
      tabindex="0"
      :aria-label="t('配置增删行')"
    >
      <div
        v-for="(line, index) in lines.slice(0, limit)"
        :key="index"
        class="diff-line"
        :class="line.kind"
      >
        <span class="diff-number">{{ line.before ?? '' }}</span
        ><span class="diff-number">{{ line.after ?? '' }}</span
        ><span aria-hidden="true">{{
          line.kind === 'add' ? '+' : line.kind === 'remove' ? '−' : ' '
        }}</span
        ><code>{{ line.text || ' ' }}</code>
      </div>
    </div>
    <button
      v-if="lines.length > limit"
      type="button"
      @click="limit += 200"
    >
      {{
        t('继续显示差异（剩余 {count} 行）', { count: lines.length - limit })
      }}
    </button>
    <p v-if="change.before === change.after">{{ t('配置内容没有变化') }}</p>
  </section>
</template>
<style scoped>
.file-diff {
  margin: 12px 0;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  overflow: hidden;
  background: var(--color-terminal);
  color: var(--color-txt-2);
}
header {
  display: flex;
  gap: 12px;
  padding: 10px 12px;
  align-items: center;
  font-size: var(--agent-body-font, 12px);
}
header strong {
  flex: 1;
  font-weight: 500;
}
.diff-add {
  color: var(--color-success);
}
.diff-remove {
  color: var(--color-danger);
}
.diff-path {
  margin: 0;
  padding: 0 12px 10px;
  font: 11px var(--font-mono);
  overflow-wrap: anywhere;
  color: var(--color-txt-3);
}
.diff-lines {
  max-height: 340px;
  overflow: auto;
  scrollbar-width: thin;
  border-top: 1px solid var(--color-line);
}
.diff-line {
  display: flex;
  gap: 8px;
  padding: 3px 8px;
  min-width: max-content;
  font: var(--agent-small-font, 11px)/1.7 var(--font-mono);
  white-space: pre;
}
.diff-number {
  width: 3ch;
  text-align: right;
  color: var(--color-txt-4);
  flex-shrink: 0;
  user-select: none;
}
.add {
  background: color-mix(in srgb, var(--color-success) 13%, transparent);
}
.remove {
  background: color-mix(in srgb, var(--color-danger) 13%, transparent);
}
button {
  padding: 10px 12px;
  color: var(--agent-color);
  cursor: pointer;
  font-size: 11px;
}
p:last-child {
  font-size: 11px;
  padding: 0 12px;
}
button:focus-visible,
.diff-lines:focus-visible {
  outline: 1px solid var(--agent-color);
  outline-offset: -2px;
}
</style>
