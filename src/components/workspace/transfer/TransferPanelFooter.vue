<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'

defineProps<{
  summary: string
  canPause: boolean
  canResume: boolean
  canCancel: boolean
  canClear: boolean
}>()

const emit = defineEmits<{
  pauseAll: []
  resumeAll: []
  cancelAll: []
  clearHistory: []
}>()
</script>

<template>
  <footer class="transfer-footer">
    <p
      class="transfer-footer-summary"
      :title="summary"
    >
      <AppIcon
        name="lucide:gauge"
        :size="11"
      />
      <span>{{ summary }}</span>
    </p>
    <div
      class="transfer-footer-actions"
      role="group"
      aria-label="批量操作"
    >
      <button
        type="button"
        class="transfer-footer-button"
        :title="canResume ? '全部继续' : '全部暂停'"
        :aria-label="canResume ? '全部继续' : '全部暂停'"
        :disabled="!canPause && !canResume"
        @click="canResume ? emit('resumeAll') : emit('pauseAll')"
      >
        <AppIcon
          :name="canResume ? 'lucide:play' : 'lucide:pause'"
          :size="12"
        />
      </button>
      <button
        type="button"
        class="transfer-footer-button transfer-footer-button-danger"
        title="全部取消"
        aria-label="全部取消"
        :disabled="!canCancel"
        @click="emit('cancelAll')"
      >
        <AppIcon
          name="lucide:circle-x"
          :size="12"
        />
      </button>
      <button
        type="button"
        class="transfer-footer-button"
        title="清除已结束的记录"
        aria-label="清除已结束的记录"
        :disabled="!canClear"
        @click="emit('clearHistory')"
      >
        <AppIcon
          name="lucide:trash-2"
          :size="12"
        />
      </button>
    </div>
  </footer>
</template>

<style scoped>
.transfer-footer {
  display: flex;
  height: 38px;
  flex: 0 0 auto;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--color-line-soft);
  padding: 0 8px 0 12px;
  background: transparent;
}

.transfer-footer-summary {
  display: flex;
  min-width: 0;
  flex: 1 1 auto;
  align-items: center;
  gap: 5px;
  color: var(--color-txt-2);
  font-size: 9.5px;
  line-height: 13px;
}

.transfer-footer-summary > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-footer-actions {
  display: flex;
  flex: 0 0 auto;
  gap: 2px;
}

.transfer-footer-button {
  display: grid;
  width: 24px;
  height: 24px;
  cursor: pointer;
  place-items: center;
  border-radius: 5px;
  color: var(--color-txt-2);
  outline: none;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.transfer-footer-button:hover:not(:disabled),
.transfer-footer-button:focus-visible:not(:disabled) {
  background: color-mix(in oklch, var(--color-txt) 7%, transparent);
  color: var(--color-txt);
}

.transfer-footer-button-danger:hover:not(:disabled),
.transfer-footer-button-danger:focus-visible:not(:disabled) {
  background: color-mix(in oklch, var(--color-danger) 14%, transparent);
  color: var(--color-danger);
}

.transfer-footer-button:disabled {
  cursor: default;
  opacity: 0.35;
}

@media (prefers-reduced-motion: reduce) {
  .transfer-footer-button {
    transition: none;
  }
}
</style>
