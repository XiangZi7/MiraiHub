<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'

defineProps<{
  statusLabel: string
  statusIcon: string
  progress: number
  busy: boolean
}>()

const emit = defineEmits<{
  close: []
}>()
</script>

<template>
  <header class="transfer-header">
    <div class="transfer-titlebar">
      <AppIcon
        name="lucide:arrow-down-up"
        :size="14"
        class="transfer-title-icon"
      />
      <h2 class="transfer-title">文件传输</h2>
      <span
        class="transfer-overview"
        aria-label="Overall transfer progress"
      >
        <AppIcon
          :name="statusIcon"
          :size="12"
          :class="['transfer-overview-icon', busy && 'transfer-overview-spin']"
        />
        <span class="transfer-overview-label">{{ statusLabel }}</span>
        <span class="transfer-overview-percent">{{ progress }}%</span>
      </span>
      <button
        type="button"
        class="transfer-close"
        title="关闭"
        aria-label="Close file transfer"
        @click="emit('close')"
      >
        <AppIcon
          name="lucide:x"
          :size="14"
        />
      </button>
    </div>
    <div
      class="transfer-overview-track"
      role="progressbar"
      :aria-valuenow="progress"
      aria-valuemin="0"
      aria-valuemax="100"
    >
      <div
        class="transfer-overview-bar"
        :style="{ width: `${progress}%` }"
      />
    </div>
  </header>
</template>

<style scoped>
.transfer-header {
  flex: 0 0 auto;
}

.transfer-titlebar {
  display: flex;
  height: 38px;
  align-items: center;
  gap: 7px;
  padding: 0 8px 0 12px;
}

.transfer-title-icon {
  color: var(--color-blue);
}

.transfer-title {
  color: var(--color-txt);
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.transfer-overview {
  display: inline-flex;
  height: 20px;
  align-items: center;
  gap: 4px;
  margin-left: auto;
  border: 1px solid var(--color-line-soft);
  border-radius: 999px;
  background: color-mix(in oklch, var(--color-txt) 4%, transparent);
  padding: 0 8px 0 6px;
  color: var(--color-txt-2);
  font-size: 9.5px;
  line-height: 1;
}

.transfer-overview-icon {
  color: var(--color-blue);
}

.transfer-overview-spin {
  animation: transfer-spin 1.2s linear infinite;
}

.transfer-overview-percent {
  color: var(--color-txt-3);
  font-variant-numeric: tabular-nums;
}

.transfer-close {
  display: grid;
  width: 24px;
  height: 24px;
  cursor: pointer;
  place-items: center;
  border-radius: 5px;
  color: var(--color-txt-3);
  outline: none;
  transition:
    color 150ms ease,
    background-color 150ms ease;
}

.transfer-close:hover,
.transfer-close:focus-visible {
  background: color-mix(in oklch, var(--color-txt) 6%, transparent);
  color: var(--color-txt);
}

.transfer-overview-track {
  height: 2px;
  overflow: hidden;
  background: var(--color-line-soft);
}

.transfer-overview-bar {
  height: 100%;
  background: linear-gradient(90deg, #4387ff, #5ca6ff);
  transition: width 180ms ease;
}

@keyframes transfer-spin {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .transfer-close,
  .transfer-overview-bar {
    transition: none;
  }

  .transfer-overview-spin {
    animation: none;
  }
}
</style>
