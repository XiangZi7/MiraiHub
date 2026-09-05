<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, shallowRef, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import { getTauriVersion, getVersion } from '@tauri-apps/api/app'
import AppButton from '@/components/ui/AppButton.vue'
import IconButton from '@/components/ui/IconButton.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import { useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import { SETTINGS_PAGES } from '@/constants/settings'
import type { SettingKey, SettingValue, SettingsPageId, SettingsValues } from '@/types/settings'
import { closeWindow, IS_TAURI } from '@/utils/window'
import { applyZoom } from '@/utils/settings-runtime'
import SettingsPanel from './SettingsPanel.vue'
import AiSettingsPanel from './AiSettingsPanel.vue'
import ConnectionBackupPanel from './ConnectionBackupPanel.vue'
import SettingsSidebar from './SettingsSidebar.vue'
import packageInfo from '../../../package.json'

const { settings, save, defaults } = useSettings()
const aiPanel = useTemplateRef<InstanceType<typeof AiSettingsPanel>>('aiPanel')

const activePageId = shallowRef<SettingsPageId>('general')
const draft = reactive<SettingsValues>({ ...settings })
// 仅在设置窗口预览，取消时不更改已保存值或其他窗口。
watch(() => draft.uiScale, value => void applyZoom(value))
onBeforeUnmount(() => { void applyZoom(settings.uiScale) })

const runtimeValues = reactive<Record<string, string>>({
  version: packageInfo.version,
  tauriVersion: IS_TAURI ? '读取中…' : '浏览器预览',
  platform: describePlatform(),
})

const activePage = computed(() => (
  SETTINGS_PAGES.find(page => page.id === activePageId.value) ?? SETTINGS_PAGES[0]
))

const isDirty = computed(() => (
  (Object.keys(draft) as SettingKey[]).some(key => draft[key] !== settings[key])
))

/** 数值输入逐项校验；只对带 range 的文本框生效。 */
const errors = computed<Partial<Record<SettingKey, string>>>(() => {
  const result: Partial<Record<SettingKey, string>> = {}

  for (const page of SETTINGS_PAGES) {
    for (const group of page.groups) {
      for (const field of group.fields) {
        if (field.control !== 'text' || !field.range)
          continue

        const raw = String(draft[field.key]).trim()
        const value = Number(raw)
        if (!raw || !Number.isInteger(value) || value < field.range.min || value > field.range.max)
          result[field.key] = `请输入 ${field.range.min}–${field.range.max} 之间的整数`
      }
    }
  }

  return result
})

function describePlatform(): string {
  const agent = navigator.userAgent
  if (/Windows NT 10\.0/.test(agent))
    return 'Windows 10 / 11'
  if (/Windows/.test(agent))
    return 'Windows'
  if (/Mac OS X/.test(agent))
    return 'macOS'
  if (/Linux/.test(agent))
    return 'Linux'
  return navigator.platform || '—'
}

function pageOf(key: SettingKey): SettingsPageId | undefined {
  return SETTINGS_PAGES.find(page => (
    page.groups.some(group => group.fields.some(field => field.control !== 'display' && field.key === key))
  ))?.id
}

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
  Object.assign(draft, defaults())
  toast.info('已恢复默认值，保存后生效')
}

function submit(): void {
  if (activePageId.value === 'backup') return
  if (activePageId.value === 'ai') { void aiPanel.value?.save(); return }
  const firstInvalid = (Object.keys(errors.value) as SettingKey[])[0]
  if (firstInvalid) {
    const page = pageOf(firstInvalid)
    if (page)
      activePageId.value = page
    toast.warning({ title: '有设置项不合法', description: errors.value[firstInvalid] })
    return
  }

  // 数值型文本框统一按整数存，避免 "30 " 这类带空白的值流到消费方
  const normalized = { ...draft }
  for (const page of SETTINGS_PAGES) {
    for (const group of page.groups) {
      for (const field of group.fields) {
        if (field.control === 'text' && field.range)
          Object.assign(normalized, { [field.key]: String(Number(String(draft[field.key]).trim())) })
      }
    }
  }

  save(normalized)
  toast.success('设置已保存')
  closeDialog()
}

onMounted(async () => {
  if (!IS_TAURI)
    return

  try {
    const [version, tauriVersion] = await Promise.all([getVersion(), getTauriVersion()])
    runtimeValues.version = version
    runtimeValues.tauriVersion = tauriVersion
  }
  catch (error) {
    runtimeValues.tauriVersion = '—'
    console.warn('读取版本信息失败：', error)
  }
})

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape')
    closeDialog()
  else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
    event.preventDefault()
    submit()
  }
})
</script>

<template>
  <WindowFrame class="settings-window h-screen w-screen" role="dialog" aria-modal="true" aria-labelledby="settings-title">
    <header class="settings-titlebar" data-tauri-drag-region>
      <h1 id="settings-title" class="text-[13px] font-semibold tracking-tight text-txt" data-tauri-drag-region>
        设置
      </h1>
      <div class="flex-1" data-tauri-drag-region />
      <IconButton icon="lucide:x" :size="15" title="关闭 (Esc)" @click="closeDialog" />
    </header>

    <div class="relative z-10 flex min-h-0 flex-1">
      <SettingsSidebar :active="activePageId" @select="activePageId = $event" />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AiSettingsPanel v-if="activePageId === 'ai'" ref="aiPanel" />
        <ConnectionBackupPanel v-else-if="activePageId === 'backup'" />
        <SettingsPanel v-else
          :key="activePage.id"
          :page="activePage"
          :values="draft"
          :errors="errors"
          :runtime-values="runtimeValues"
          @update="updateSetting"
        />

        <footer v-if="activePageId !== 'ai' && activePageId !== 'backup'" class="settings-footer">
          <AppButton size="sm" @click="resetToDefaults">
            重置为默认
          </AppButton>
          <span v-if="isDirty" class="text-[10.5px] text-txt-4">有未保存的修改</span>
          <div class="flex-1" />
          <AppButton size="sm" @click="closeDialog">
            取消
          </AppButton>
          <AppButton size="sm" variant="primary" title="Ctrl+S" @click="submit">
            保存设置
          </AppButton>
        </footer>
      </div>
    </div>
  </WindowFrame>
</template>

<style scoped>
.settings-window { container-type: inline-size; container-name: settings; }
@container settings (max-width: 560px) {
  .settings-footer > span { display: none; }
  .settings-footer { flex-wrap: wrap; padding: 8px; }
}

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
  gap: 10px;
  border-top: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-panel) 34%, transparent);
  padding: 0 14px;
}
</style>
