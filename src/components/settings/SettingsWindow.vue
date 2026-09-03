<script setup lang="ts">
import { computed, reactive, shallowRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import * as settingsStore from '@/api/settings'
import AppButton from '@/components/ui/AppButton.vue'
import IconButton from '@/components/ui/IconButton.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import { SETTINGS_PAGES } from '@/constants/settings'
import type { SettingKey, SettingValue, SettingsPageId, SettingsValues } from '@/types/settings'
import { closeWindow, IS_TAURI } from '@/utils/window'
import SettingsPanel from './SettingsPanel.vue'
import SettingsSidebar from './SettingsSidebar.vue'

const activePageId = shallowRef<SettingsPageId>('general')
const draft = reactive<SettingsValues>(settingsStore.loadSettings())

const activePage = computed(() => (
  SETTINGS_PAGES.find(page => page.id === activePageId.value) ?? SETTINGS_PAGES[0]
))

function closeDialog(): void {
  if (IS_TAURI) {
    closeWindow()
    return
  }

  window.close()
}

function updateSetting(key: SettingKey, value: SettingValue): void {
  Object.assign(draft, { [key]: value })
}

function resetToDefaults(): void {
  Object.assign(draft, settingsStore.defaultSettings())
}

function save(): void {
  settingsStore.saveSettings({ ...draft })
  closeDialog()
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape')
    closeDialog()
})
</script>

<template>
  <WindowFrame ambient surface="dialog" class="h-screen w-screen" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <header class="settings-titlebar" data-tauri-drag-region>
      <h1 id="settings-title" class="text-[13px] font-semibold tracking-tight text-txt" data-tauri-drag-region>
        设置
      </h1>
      <div class="flex-1" data-tauri-drag-region />
      <IconButton icon="lucide:x" :size="15" title="关闭" @click="closeDialog" />
    </header>

    <div class="relative z-10 flex min-h-0 flex-1">
      <SettingsSidebar :active="activePageId" @select="activePageId = $event" />

      <div class="flex min-w-0 flex-1 flex-col">
        <SettingsPanel
          :key="activePage.id"
          :page="activePage"
          :values="draft"
          @update="updateSetting"
        />

        <footer class="settings-footer">
          <AppButton size="sm" @click="resetToDefaults">
            重置为默认
          </AppButton>
          <div class="flex-1" />
          <AppButton size="sm" @click="closeDialog">
            取消
          </AppButton>
          <AppButton size="sm" variant="primary" @click="save">
            保存设置
          </AppButton>
        </footer>
      </div>
    </div>
  </WindowFrame>
</template>

<style scoped>
.settings-titlebar {
  position: relative;
  z-index: 10;
  display: flex;
  height: 44px;
  flex-shrink: 0;
  align-items: center;
  border-bottom: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-card) 24%, transparent);
  padding: 0 11px 0 17px;
}

.settings-footer {
  display: flex;
  height: 50px;
  flex-shrink: 0;
  align-items: center;
  gap: 8px;
  border-top: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-panel) 34%, transparent);
  padding: 0 14px;
}
</style>
