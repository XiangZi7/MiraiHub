<script setup lang="ts">
defineProps<{
  summary: string
  history: boolean
  canPause: boolean
  canResume: boolean
}>()

const emit = defineEmits<{
  pauseAll: []
  resumeAll: []
  clearHistory: []
}>()
</script>

<template>
  <footer class="transfer-footer">
    <p class="transfer-footer-summary" :title="summary">{{ summary }}</p>
    <button
      v-if="history"
      type="button"
      class="transfer-footer-button"
      @click="emit('clearHistory')"
    >
      Clear History
    </button>
    <button
      v-else
      type="button"
      class="transfer-footer-button"
      :disabled="!canPause && !canResume"
      @click="canPause ? emit('pauseAll') : emit('resumeAll')"
    >
      {{ canResume ? 'Resume All' : 'Pause All' }}
    </button>
  </footer>
</template>

<style scoped>
.transfer-footer {
  position: relative;
  min-height: 56px;
  flex: 0 0 auto;
  border-top: 1px solid rgb(255 255 255 / 5%);
  padding: 8px 11px;
  background: rgb(12 16 19 / 96%);
}

.transfer-footer-summary {
  overflow: hidden;
  padding-right: 2px;
  color: #9ba4ac;
  font-size: 9px;
  line-height: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.transfer-footer-button {
  display: block;
  height: 25px;
  margin-top: 3px;
  margin-left: auto;
  cursor: pointer;
  border: 1px solid rgb(255 255 255 / 5%);
  border-radius: 5px;
  background: #20252a;
  padding: 0 10px;
  color: #d7dce0;
  font-size: 10px;
  font-weight: 500;
  outline: none;
  box-shadow: 0 2px 8px rgb(0 0 0 / 18%);
  transition: color 150ms ease, background-color 150ms ease, border-color 150ms ease;
}

.transfer-footer-button:hover,
.transfer-footer-button:focus-visible {
  border-color: rgb(255 255 255 / 10%);
  background: #282e34;
  color: #fff;
}

.transfer-footer-button:disabled {
  cursor: default;
  opacity: 0.45;
}

@media (prefers-reduced-motion: reduce) {
  .transfer-footer-button {
    transition: none;
  }
}
</style>
