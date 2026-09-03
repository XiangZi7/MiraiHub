<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'

export type TransferPanelTab = 'transfers' | 'history'

defineProps<{
  tab: TransferPanelTab
  statusLabel: string
  progress: number
}>()

const emit = defineEmits<{
  close: []
  changeTab: [tab: TransferPanelTab]
}>()
</script>

<template>
  <header class="transfer-header">
    <div class="transfer-titlebar">
      <AppIcon name="lucide:folder" :size="14" class="transfer-title-icon" />
      <h2 class="transfer-title">File Transfer</h2>
      <button type="button" class="transfer-close" title="Close" aria-label="Close file transfer" @click="emit('close')">
        <AppIcon name="lucide:x" :size="14" />
      </button>
    </div>

    <div class="transfer-overview" aria-label="Overall transfer progress">
      <AppIcon name="lucide:folder-sync" :size="13" class="transfer-overview-icon" />
      <span class="transfer-overview-label">{{ statusLabel }}</span>
      <span class="transfer-overview-percent">{{ progress }}%</span>
      <div class="transfer-overview-track" role="progressbar" :aria-valuenow="progress" aria-valuemin="0" aria-valuemax="100">
        <div class="transfer-overview-bar" :style="{ width: `${progress}%` }" />
      </div>
    </div>

    <nav class="transfer-tabs" role="tablist" aria-label="File transfer views">
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'transfers'"
        :class="['transfer-tab', tab === 'transfers' && 'transfer-tab-active']"
        @click="emit('changeTab', 'transfers')"
      >
        Transfers
      </button>
      <button
        type="button"
        role="tab"
        :aria-selected="tab === 'history'"
        :class="['transfer-tab', tab === 'history' && 'transfer-tab-active']"
        @click="emit('changeTab', 'history')"
      >
        History
      </button>
    </nav>
  </header>
</template>

<style scoped>
.transfer-header {
  flex: 0 0 auto;
  border-bottom: 1px solid rgb(255 255 255 / 5%);
}

.transfer-titlebar {
  display: flex;
  height: 34px;
  align-items: center;
  padding: 0 11px;
}

.transfer-title-icon,
.transfer-overview-icon {
  color: #17b8ed;
}

.transfer-title {
  margin-left: 7px;
  color: #f1f4f6;
  font-size: 12px;
  font-weight: 600;
  letter-spacing: -0.01em;
}

.transfer-close {
  display: grid;
  width: 24px;
  height: 24px;
  margin-left: auto;
  cursor: pointer;
  place-items: center;
  border-radius: 5px;
  color: #89929b;
  outline: none;
  transition: color 150ms ease, background-color 150ms ease;
}

.transfer-close:hover,
.transfer-close:focus-visible {
  background: rgb(255 255 255 / 6%);
  color: #e7ebee;
}

.transfer-overview {
  display: grid;
  grid-template-columns: 14px auto 30px minmax(0, 1fr);
  height: 24px;
  align-items: center;
  column-gap: 5px;
  padding: 0 12px 3px;
}

.transfer-overview-label,
.transfer-overview-percent {
  color: #9ba5ad;
  font-size: 9.5px;
  line-height: 1;
}

.transfer-overview-percent {
  text-align: right;
}

.transfer-overview-track {
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: #171c20;
}

.transfer-overview-bar {
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #4387ff, #5ca6ff);
  transition: width 180ms ease;
}

.transfer-tabs {
  display: flex;
  height: 34px;
  align-items: stretch;
  gap: 5px;
  padding-left: 10px;
}

.transfer-tab {
  position: relative;
  min-width: 58px;
  cursor: pointer;
  padding: 1px 8px 0;
  color: #707982;
  font-size: 10.5px;
  font-weight: 500;
  outline: none;
  transition: color 150ms ease;
}

.transfer-tab::after {
  position: absolute;
  right: 0;
  bottom: -1px;
  left: 0;
  height: 2px;
  border-radius: 999px 999px 0 0;
  background: transparent;
  content: '';
}

.transfer-tab:hover,
.transfer-tab:focus-visible,
.transfer-tab-active {
  color: #e9edef;
}

.transfer-tab-active::after {
  background: #4e9eff;
}

@media (prefers-reduced-motion: reduce) {
  .transfer-close,
  .transfer-overview-bar,
  .transfer-tab {
    transition: none;
  }
}
</style>
