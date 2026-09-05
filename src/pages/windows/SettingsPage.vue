<script setup lang="ts">
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  reactive,
  useTemplateRef,
  watch,
} from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { useEventListener } from '@vueuse/core'
import { getTauriVersion, getVersion } from '@tauri-apps/api/app'
import AppButton from '@/components/ui/AppButton.vue'
import IconButton from '@/components/ui/IconButton.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import WindowResizeHandles from '@/components/ui/WindowResizeHandles.vue'
import NavigationControls from '@/components/workspace/NavigationControls.vue'
import { useSettings } from '@/composables/useSettings'
import { toast } from '@/composables/useToast'
import { SETTINGS_PAGES } from '@/constants/settings'
import type {
  SettingKey,
  SettingValue,
  SettingsPageId,
  SettingsValues,
} from '@/types/settings'
import { closeWindow, IS_TAURI, toggleMaximizeWindow } from '@/utils/window'
import { applyZoom } from '@/utils/settings-runtime'
import SettingsPanel from '@/components/settings/SettingsPanel.vue'
import SettingsSidebar from '@/components/settings/SettingsSidebar.vue'
import ThemeSkinPanel from '@/components/settings/ThemeSkinPanel.vue'
import { useSkinPreview } from '@/composables/useSkinPreview'
import packageInfo from '../../../package.json'

const AiSettingsPanel = defineAsyncComponent(
  () => import('@/components/settings/AiSettingsPanel.vue')
)
const ConnectionBackupPanel = defineAsyncComponent(
  () => import('@/components/settings/ConnectionBackupPanel.vue')
)

const { settings, save, defaults } = useSettings()
const aiPanel = useTemplateRef<InstanceType<typeof AiSettingsPanel>>('aiPanel')

const route = useRoute()
const router = useRouter()
const activePageId = computed<SettingsPageId>({
  get: () => route.params.section as SettingsPageId,
  set: section => {
    void router.push({ name: 'settings', params: { section } })
  },
})
const draft = reactive<SettingsValues>({ ...settings })
const skinPreview = useSkinPreview(draft, settings)
// 界面缩放仅在设置窗口预览。
watch(
  () => draft.uiScale,
  value => void applyZoom(value)
)
onBeforeUnmount(() => {
  void applyZoom(settings.uiScale)
})

const runtimeValues = reactive<Record<string, string>>({
  version: packageInfo.version,
  tauriVersion: IS_TAURI ? '读取中…' : '浏览器预览',
  platform: describePlatform(),
})

const activePage = computed(
  () =>
    SETTINGS_PAGES.find(page => page.id === activePageId.value) ??
    SETTINGS_PAGES[0]
)

const isDirty = computed(() =>
  (Object.keys(draft) as SettingKey[]).some(key => draft[key] !== settings[key])
)

/** 数值输入逐项校验；只对带 range 的文本框生效。 */
const errors = computed<Partial<Record<SettingKey, string>>>(() => {
  const result: Partial<Record<SettingKey, string>> = {}

  for (const page of SETTINGS_PAGES) {
    for (const group of page.groups) {
      for (const field of group.fields) {
        if (field.control !== 'text' || !field.range) continue

        const raw = String(draft[field.key]).trim()
        const value = Number(raw)
        if (
          !raw ||
          !Number.isInteger(value) ||
          value < field.range.min ||
          value > field.range.max
        )
          result[field.key] =
            `请输入 ${field.range.min}–${field.range.max} 之间的整数`
      }
    }
  }

  return result
})

function describePlatform(): string {
  const agent = navigator.userAgent
  if (/Windows NT 10\.0/.test(agent)) return 'Windows 10 / 11'
  if (/Windows/.test(agent)) return 'Windows'
  if (/Mac OS X/.test(agent)) return 'macOS'
  if (/Linux/.test(agent)) return 'Linux'
  return navigator.platform || '—'
}

function pageOf(key: SettingKey): SettingsPageId | undefined {
  return SETTINGS_PAGES.find(page =>
    page.groups.some(group =>
      group.fields.some(
        field => field.control !== 'display' && field.key === key
      )
    )
  )?.id
}

async function closeDialog(): Promise<void> {
  await skinPreview.finish()
  void applyZoom(settings.uiScale)
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
  if (activePageId.value === 'ai') {
    void aiPanel.value?.save()
    return
  }
  const firstInvalid = (Object.keys(errors.value) as SettingKey[])[0]
  if (firstInvalid) {
    const page = pageOf(firstInvalid)
    if (page) activePageId.value = page
    toast.warning({
      title: '有设置项不合法',
      description: errors.value[firstInvalid],
    })
    return
  }

  // 数值型文本框统一按整数存，避免 "30 " 这类带空白的值流到消费方
  const normalized = { ...draft }
  for (const page of SETTINGS_PAGES) {
    for (const group of page.groups) {
      for (const field of group.fields) {
        if (field.control === 'text' && field.range)
          Object.assign(normalized, {
            [field.key]: String(Number(String(draft[field.key]).trim())),
          })
      }
    }
  }

  try {
    save(normalized)
  } catch (error) {
    toast.error({
      title: '设置保存失败',
      description:
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? '本地存储空间不足，请移除背景图或换用更小的图片后重试'
          : String(error),
    })
    return
  }
  toast.success('设置已保存')
  closeDialog()
}

onMounted(async () => {
  if (!IS_TAURI) return

  try {
    const [version, tauriVersion] = await Promise.all([
      getVersion(),
      getTauriVersion(),
    ])
    runtimeValues.version = version
    runtimeValues.tauriVersion = tauriVersion
  } catch (error) {
    runtimeValues.tauriVersion = '—'
    console.warn('读取版本信息失败：', error)
  }
})

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') closeDialog()
  else if (
    (event.ctrlKey || event.metaKey) &&
    event.key.toLowerCase() === 's'
  ) {
    event.preventDefault()
    submit()
  }
})
</script>

<template>
  <WindowFrame
    class="settings-window h-screen w-screen"
    role="dialog"
    aria-modal="true"
    aria-labelledby="settings-title"
  >
    <header
      class="settings-titlebar"
      data-tauri-drag-region
      @dblclick.self="toggleMaximizeWindow"
    >
      <h1
        id="settings-title"
        class="text-txt text-[13px] font-semibold tracking-tight"
        data-tauri-drag-region
      >
        设置
      </h1>
      <NavigationControls class="ml-3" />
      <div
        class="flex-1"
        data-tauri-drag-region
      />
      <IconButton
        icon="lucide:x"
        :size="15"
        title="关闭 (Esc)"
        @click="closeDialog"
      />
    </header>

    <div class="relative z-10 flex min-h-0 flex-1">
      <SettingsSidebar :active="activePageId" />

      <div class="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <AiSettingsPanel
          v-if="activePageId === 'ai'"
          ref="aiPanel"
        />
        <ConnectionBackupPanel v-else-if="activePageId === 'backup'" />
        <ThemeSkinPanel
          v-else-if="activePageId === 'skin'"
          :values="draft"
          @update="Object.assign(draft, $event)"
        />
        <SettingsPanel
          v-else
          :key="activePage.id"
          :page="activePage"
          :values="draft"
          :errors="errors"
          :runtime-values="runtimeValues"
          @update="updateSetting"
        />

        <footer
          v-if="activePageId !== 'ai' && activePageId !== 'backup'"
          class="settings-footer"
        >
          <AppButton
            size="sm"
            @click="resetToDefaults"
          >
            重置为默认
          </AppButton>
          <span
            v-if="isDirty"
            class="text-txt-4 text-[10.5px]"
            >有未保存的修改</span
          >
          <div class="flex-1" />
          <AppButton
            size="sm"
            @click="closeDialog"
          >
            取消
          </AppButton>
          <AppButton
            size="sm"
            variant="primary"
            title="Ctrl+S"
            @click="submit"
          >
            保存设置
          </AppButton>
        </footer>
      </div>
    </div>
    <WindowResizeHandles />
  </WindowFrame>
</template>

<style scoped>
.settings-window {
  container-type: inline-size;
  container-name: settings;
}
@container settings (max-width: 560px) {
  .settings-footer > span {
    display: none;
  }
  .settings-footer {
    flex-wrap: wrap;
    padding: 8px;
  }
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
