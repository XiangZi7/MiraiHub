<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  computed,
  defineAsyncComponent,
  onBeforeUnmount,
  onMounted,
  reactive,
  toRefs,
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
import { useLocalizedSettings } from '@/composables/useLocalizedSettings'
import type {
  SettingKey,
  SettingValue,
  SettingsPageId,
  SettingsValues,
} from '@/types/settings'
import { closeWindow, IS_TAURI, toggleMaximizeWindow } from '@/utils/window'
import { applyZoom } from '@/utils/settings-runtime'
import { applyWindowBackgroundOpacity } from '@/utils/window-appearance'
import SettingsPanel from '@/pages/settings/components/settings-panel.vue'
import SettingsSidebar from '@/pages/settings/components/settings-sidebar.vue'
import ThemeSkinPanel from '@/pages/settings/components/theme-skin-panel.vue'
import { useSkinPreview } from '@/composables/useSkinPreview'
import packageInfo from '../../../package.json'

const { t } = useI18n()

const AiSettingsPanel = defineAsyncComponent(
  () => import('@/pages/settings/components/ai-settings-panel.vue')
)
const ConnectionBackupPanel = defineAsyncComponent(
  () => import('@/pages/settings/components/connection-backup-panel.vue')
)

const { settings, save, defaults } = useSettings()
const pages = useLocalizedSettings()
const aiPanel = useTemplateRef<InstanceType<typeof AiSettingsPanel>>('aiPanel')

const route = useRoute()
const router = useRouter()
/** 设置分类以路由为准，侧栏切换同时进入浏览器导航历史。 */
const activePageId = computed<SettingsPageId>({
  get: () => route.params.section as SettingsPageId,
  set: section => {
    void router.push({ name: 'settings', params: { section } })
  },
})
// 响应式状态
const state = reactive({
  // 常规设置草稿；切换分类时保留，保存前统一校验和归一化。
  draft: { ...settings } as SettingsValues,
  // 关于页面展示的应用版本、Tauri 版本与运行平台。
  runtimeValues: {
    version: packageInfo.version,
    tauriVersion: IS_TAURI ? t('读取中…') : t('浏览器预览'),
    platform: describePlatform(),
  } as Record<string, string>,
})
const { draft, runtimeValues } = toRefs(state)
const skinPreview = useSkinPreview(state.draft, settings)
// 界面缩放仅在设置窗口预览。
watch(
  () => state.draft.uiScale,
  value => void applyZoom(value)
)
// 背景透明度随草稿即时预览，首次挂载也同步到当前设置窗口。
watch(
  () => state.draft.windowBackgroundOpacity,
  value => applyWindowBackgroundOpacity(value),
  { immediate: true }
)
// 关闭或重建设置窗口时恢复已保存的外观，撤销未提交的预览。
onBeforeUnmount(() => {
  void applyZoom(settings.uiScale)
  applyWindowBackgroundOpacity(settings.windowBackgroundOpacity)
})

const activePage = computed(
  () =>
    pages.value.find(page => page.id === activePageId.value) ?? pages.value[0]
)

const isDirty = computed(() =>
  (Object.keys(state.draft) as SettingKey[]).some(
    key => state.draft[key] !== settings[key]
  )
)

/** 数值输入逐项校验；只对带 range 的文本框生效。 */
const errors = computed<Partial<Record<SettingKey, string>>>(() => {
  const result: Partial<Record<SettingKey, string>> = {}

  for (const page of SETTINGS_PAGES) {
    for (const group of page.groups) {
      for (const field of group.fields) {
        if (field.control !== 'text' || !field.range) continue

        const raw = String(state.draft[field.key]).trim()
        const value = Number(raw)
        if (
          !raw ||
          !Number.isInteger(value) ||
          value < field.range.min ||
          value > field.range.max
        )
          result[field.key] = t('settings.integerRange', { ...field.range })
      }
    }
  }

  return result
})

/** 识别当前运行平台，供关于页面展示；未知平台保留浏览器提供的标识。 */
function describePlatform(): string {
  const agent = navigator.userAgent
  if (/Windows NT 10\.0/.test(agent)) return 'Windows 10 / 11'
  if (/Windows/.test(agent)) return 'Windows'
  if (/Mac OS X/.test(agent)) return 'macOS'
  if (/Linux/.test(agent)) return 'Linux'
  return navigator.platform || '—'
}

/** 按设置字段查找所属分类，校验失败时将用户带回对应设置面板。 */
function pageOf(key: SettingKey): SettingsPageId | undefined {
  return SETTINGS_PAGES.find(page =>
    page.groups.some(group =>
      group.fields.some(
        field => field.control !== 'display' && field.key === key
      )
    )
  )?.id
}

/** 结束皮肤预览并恢复已保存的缩放，然后关闭原生设置窗口或浏览器预览。 */
async function closeDialog(): Promise<void> {
  await skinPreview.finish()
  void applyZoom(settings.uiScale)
  if (IS_TAURI) {
    closeWindow()
    return
  }

  window.close()
}

/** 将设置面板发出的字段更新合并到本地草稿，等待用户应用或保存。 */
function updateSetting(key: SettingKey, value: SettingValue): void {
  Object.assign(state.draft, { [key]: value })
}

/** 将常规设置草稿重置为默认值，并提示用户保存后才会生效。 */
function resetToDefaults(): void {
  Object.assign(state.draft, defaults())
  toast.info(t('已恢复默认值，保存后生效'))
}

/** 校验并归一化常规设置草稿后保存；失败保留草稿，成功同步已持久化的值。 */
function persistDraft(): boolean {
  const firstInvalid = (Object.keys(errors.value) as SettingKey[])[0]
  if (firstInvalid) {
    const page = pageOf(firstInvalid)
    if (page) activePageId.value = page
    toast.warning({
      title: t('有设置项不合法'),
      description: errors.value[firstInvalid],
    })
    return false
  }

  // 数值型文本框统一按整数存，避免 "30 " 这类带空白的值流到消费方
  const normalized = { ...state.draft }
  for (const page of SETTINGS_PAGES) {
    for (const group of page.groups) {
      for (const field of group.fields) {
        if (field.control === 'text' && field.range)
          Object.assign(normalized, {
            [field.key]: String(Number(String(state.draft[field.key]).trim())),
          })
      }
    }
  }

  try {
    save(normalized)
  } catch (error) {
    toast.error({
      title: t('设置保存失败'),
      description:
        error instanceof DOMException && error.name === 'QuotaExceededError'
          ? t('本地存储空间不足，请移除背景图或换用更小的图片后重试')
          : String(error),
    })
    return false
  }

  // 应用后窗口继续存在，草稿必须跟随已归一化的持久值，避免误报未保存。
  Object.assign(state.draft, settings)
  return true
}

/** 保存有效的常规设置并显示应用成功通知，保留设置窗口。 */
function applySettings(): void {
  if (!persistDraft()) return
  toast.success(t('设置已应用'))
}

/** 按当前分类保存设置：AI 面板自行保存，常规设置保存成功后关闭窗口。 */
function submit(): void {
  if (activePageId.value === 'backup') return
  if (activePageId.value === 'ai') {
    void aiPanel.value?.save()
    return
  }
  if (!persistDraft()) return
  toast.success(t('设置已保存'))
  void closeDialog()
}

// 桌面窗口挂载后读取实际版本，浏览器预览继续使用包版本与预览标识。
onMounted(async () => {
  if (!IS_TAURI) return

  try {
    const [version, tauriVersion] = await Promise.all([
      getVersion(),
      getTauriVersion(),
    ])
    state.runtimeValues.version = version
    state.runtimeValues.tauriVersion = tauriVersion
  } catch (error) {
    state.runtimeValues.tauriVersion = '—'
    console.warn('读取版本信息失败：', error)
  }
})

// 设置窗口支持 Esc 取消和 Ctrl/Cmd+S 保存，监听随页面卸载清理。
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
    class="dialog-window settings-window h-screen w-screen"
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
        {{ t('设置') }}
      </h1>
      <NavigationControls class="ml-3" />
      <div
        class="flex-1"
        data-tauri-drag-region
      />
      <IconButton
        icon="lucide:x"
        :size="15"
        :title="t('关闭 (Esc)')"
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
            {{ t('重置为默认') }}
          </AppButton>
          <span
            v-if="isDirty"
            class="text-txt-4 text-[10.5px]"
            >{{ t('有未保存的修改') }}</span
          >
          <div class="flex-1" />
          <AppButton
            size="sm"
            @click="closeDialog"
          >
            {{ t('取消') }}
          </AppButton>
          <AppButton
            size="sm"
            :disabled="!isDirty"
            @click="applySettings"
          >
            {{ t('应用') }}
          </AppButton>
          <AppButton
            size="sm"
            variant="primary"
            title="Ctrl+S"
            @click="submit"
          >
            {{ t('保存设置') }}
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
