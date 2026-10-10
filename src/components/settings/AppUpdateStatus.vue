<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAppUpdaterStore } from '@/stores/app-updater'
import { useSettingsStore } from '@/stores/settings'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

defineProps<{ floating?: boolean }>()
const { t } = useI18n()
const updater = useAppUpdaterStore()
const settings = useSettingsStore()
const { state } = storeToRefs(updater)
onMounted(() => void updater.start())
const busy = computed(() =>
  ['checking', 'downloading', 'installing'].includes(state.value.phase)
)
const progress = computed(() =>
  state.value.total > 0
    ? Math.min(
        100,
        Math.round((state.value.downloaded / state.value.total) * 100)
      )
    : undefined
)
const noticeable = computed(() =>
  ['downloading', 'ready', 'installing', 'error'].includes(state.value.phase)
)
const statusIcon = computed(() => {
  switch (state.value.phase) {
    case 'checking':
    case 'installing':
      return 'lucide:loader-circle'
    case 'latest':
      return 'lucide:circle-check'
    case 'downloading':
      return 'lucide:download'
    case 'ready':
      return state.value.deferred ? 'lucide:pause' : 'lucide:package-check'
    case 'error':
      return 'lucide:circle-alert'
    case 'unsupported':
      return 'lucide:info'
    default:
      return 'lucide:refresh-cw'
  }
})
const label = computed(() => {
  switch (state.value.phase) {
    case 'checking':
      return t('正在检查更新…')
    case 'latest':
      return t('当前已是最新版本')
    case 'downloading':
      return t('正在下载更新')
    case 'ready':
      return state.value.deferred ? t('已暂停本次自动安装') : t('更新已就绪')
    case 'installing':
      return t('正在安装，即将重启…')
    case 'error':
      if (state.value.errorStage === 'check')
        return state.value.error.includes(
          'Could not fetch a valid release JSON'
        )
          ? t('更新服务暂不可用，请稍后重试')
          : t('检查更新失败，请检查网络或代理设置')
      if (state.value.errorStage === 'download')
        return t('更新下载或校验失败，请重试')
      if (state.value.errorStage === 'install') return t('更新安装失败，请重试')
      return t('更新失败，请重试')
    case 'unsupported':
      return state.value.reason === 'portable'
        ? t('免安装版请从 Releases 下载更新')
        : t('自动更新仅支持 Windows x64 正式安装版')
    default:
      return t('从 GitHub Releases 获取最新正式版')
  }
})
function openReleases() {
  void openUrl('https://github.com/XiangZi7/MiraiHub/releases').catch(
    console.warn
  )
}
</script>

<template>
  <section
    v-if="!floating || (noticeable && !state.dismissed)"
    :class="[
      'update-status',
      { 'update-floating': floating, 'update-error': state.phase === 'error' },
    ]"
    :aria-label="t('应用更新')"
  >
    <button
      v-if="floating"
      type="button"
      class="update-close"
      :aria-label="t('关闭提示')"
      :title="t('关闭提示')"
      @click="updater.command('dismiss')"
    >
      <AppIcon
        name="lucide:x"
        :size="14"
      />
    </button>
    <div class="update-summary">
      <div
        class="update-icon"
        aria-hidden="true"
      >
        <AppIcon
          :name="statusIcon"
          :size="19"
          :class="{
            'update-spin': ['checking', 'installing'].includes(state.phase),
          }"
        />
      </div>
      <div
        class="update-copy"
        role="status"
        aria-live="polite"
      >
        <p class="update-title">
          {{ label }}
          <span
            v-if="state.version"
            class="update-version"
            >v{{ state.version }}</span
          >
        </p>
        <p
          v-if="state.phase === 'latest'"
          class="update-description"
        >
          {{ t('从 GitHub Releases 获取最新正式版') }}
        </p>
        <p
          v-if="
            state.phase === 'error' &&
            state.errorStage === 'check' &&
            settings.values.autoUpdate
          "
          class="update-description"
        >
          {{ t('将自动重试，也可手动重试。') }}
        </p>
        <p
          v-if="state.phase === 'ready'"
          class="update-description"
        >
          {{ t('请关闭连接标签和其他窗口，随后将自动安装并重启。') }}
        </p>
        <p
          v-if="state.phase === 'downloading'"
          class="update-description update-download"
        >
          {{ (state.downloaded / 1024 / 1024).toFixed(1) }} MB
          <span v-if="progress !== undefined">· {{ progress }}%</span>
        </p>
      </div>
    </div>
    <div class="update-actions">
      <AppButton
        v-if="state.phase !== 'ready'"
        size="sm"
        variant="primary"
        :disabled="busy || state.phase === 'unsupported'"
        :title="state.phase === 'unsupported' ? label : undefined"
        class="update-action"
        @click="updater.command('check')"
      >
        <AppIcon
          name="lucide:refresh-cw"
          :size="12"
          aria-hidden="true"
        />
        {{ state.phase === 'error' ? t('重试') : t('检查并下载更新') }}
      </AppButton>
      <AppButton
        v-if="state.phase === 'ready'"
        size="sm"
        :variant="state.deferred ? 'primary' : 'default'"
        class="update-action"
        @click="updater.command(state.deferred ? 'resume' : 'defer')"
      >
        <AppIcon
          :name="state.deferred ? 'lucide:play' : 'lucide:pause'"
          :size="12"
          aria-hidden="true"
        />
        {{ state.deferred ? t('恢复自动安装') : t('本次暂不安装') }}
      </AppButton>
      <AppButton
        v-if="state.phase === 'ready' && !settings.values.autoUpdate"
        size="sm"
        variant="primary"
        class="update-action"
        @click="updater.command('resume')"
      >
        <AppIcon
          name="lucide:download"
          :size="12"
          aria-hidden="true"
        />
        {{ t('空闲后安装本次更新') }}
      </AppButton>
      <AppButton
        size="sm"
        class="update-action"
        @click="openReleases"
      >
        {{ t('查看发行说明') }}
        <AppIcon
          name="lucide:arrow-up-right"
          :size="12"
          aria-hidden="true"
        />
      </AppButton>
    </div>
    <div
      v-if="state.phase === 'downloading'"
      class="update-progress-track"
    >
      <progress
        :value="progress"
        max="100"
        :aria-label="t('更新下载进度')"
        class="update-progress"
      />
    </div>
    <details
      v-if="state.error"
      class="update-details"
    >
      <summary>{{ t('错误详情') }}</summary>
      <p class="update-error-message scroll-thin">{{ state.error }}</p>
    </details>
  </section>
</template>

<style scoped>
.update-status {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px 18px;
  margin: 14px 18px 2px;
  padding: 14px;
  border: 1px solid var(--color-line-soft);
  border-radius: 9px;
  background: color-mix(in oklch, var(--color-card) 55%, transparent);
  box-shadow: var(--shadow-card);
}
.update-summary {
  display: flex;
  flex: 1 1 230px;
  min-width: 0;
  align-items: center;
  gap: 11px;
}
.update-icon {
  display: grid;
  width: 36px;
  height: 36px;
  flex-shrink: 0;
  place-items: center;
  border: 1px solid color-mix(in oklch, var(--color-violet) 20%, transparent);
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-violet) 10%, transparent);
  color: var(--color-violet);
}
.update-error .update-icon {
  border-color: color-mix(in oklch, var(--color-danger) 20%, transparent);
  background: color-mix(in oklch, var(--color-danger) 10%, transparent);
  color: var(--color-danger);
}
.update-copy {
  min-width: 0;
}
.update-title {
  color: var(--color-txt);
  font-size: 11.5px;
  font-weight: 600;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.update-version {
  display: inline-block;
  margin-left: 5px;
  padding: 0 5px;
  border: 1px solid var(--color-line);
  border-radius: 4px;
  color: var(--color-txt-2);
  font-family: var(--font-mono);
  font-size: 10px;
  font-weight: 400;
  vertical-align: middle;
}
.update-description {
  margin-top: 3px;
  color: var(--color-txt-2);
  font-size: 10.5px;
  line-height: 1.6;
  overflow-wrap: anywhere;
}
.update-download {
  font-family: var(--font-mono);
  font-variant-numeric: tabular-nums;
}
.update-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 7px;
}
.update-action {
  min-height: 28px;
  max-width: 100%;
  justify-content: center;
  gap: 5px;
  line-height: 1.5;
}
.update-progress-track {
  flex-basis: 100%;
  height: 4px;
  overflow: hidden;
  border-radius: 999px;
  background: var(--color-hover);
}
.update-progress {
  display: block;
  width: 100%;
  height: 100%;
  appearance: none;
  border: 0;
  background: transparent;
  accent-color: var(--color-violet);
}
.update-progress::-webkit-progress-bar {
  background: transparent;
}
.update-progress::-webkit-progress-value {
  border-radius: 999px;
  background: var(--color-violet);
}
.update-progress::-moz-progress-bar {
  border-radius: 999px;
  background: var(--color-violet);
}
.update-progress:indeterminate {
  width: 35%;
  border-radius: 999px;
  background: var(--color-violet);
  animation: update-progress-slide 1.4s ease-in-out infinite alternate;
}
.update-details {
  flex-basis: 100%;
  min-width: 0;
  padding-top: 10px;
  border-top: 1px solid var(--color-line-soft);
  color: var(--color-txt-2);
  font-size: 10.5px;
  line-height: 1.6;
}
.update-details summary {
  width: fit-content;
  border-radius: 3px;
  cursor: pointer;
}
.update-details summary:hover {
  color: var(--color-txt);
}
.update-error-message {
  max-height: 96px;
  overflow: auto;
  margin-top: 8px;
  padding: 8px 10px;
  border-radius: 6px;
  background: var(--color-hover);
  font-family: var(--font-mono);
  font-size: 10px;
  overflow-wrap: anywhere;
}
.update-floating {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 60;
  width: min(360px, calc(100vw - 36px));
  max-height: calc(100vh - 36px);
  overflow-y: auto;
  margin: 0;
  padding: 16px 44px 16px 16px;
  border: 1px solid var(--color-line-strong);
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-panel) 94%, transparent);
  box-shadow: var(--shadow-pop);
  -webkit-backdrop-filter: blur(30px) saturate(175%);
  backdrop-filter: blur(30px) saturate(175%);
}
.update-floating .update-actions {
  flex-basis: 100%;
}
.update-close {
  position: absolute;
  top: 8px;
  right: 8px;
  display: grid;
  width: 28px;
  height: 28px;
  place-items: center;
  border-radius: 6px;
  color: var(--color-txt-2);
  cursor: pointer;
}
.update-close:hover {
  color: var(--color-txt);
  background: var(--color-hover);
}
html.material-solid .update-floating {
  background: var(--color-panel);
  -webkit-backdrop-filter: none;
  backdrop-filter: none;
}
.update-action:focus-visible,
.update-close:focus-visible,
.update-details summary:focus-visible {
  outline: 2px solid var(--color-violet);
  outline-offset: 3px;
}
.update-spin {
  animation: update-spin 1s linear infinite;
}
@keyframes update-spin {
  to {
    transform: rotate(360deg);
  }
}
@keyframes update-progress-slide {
  to {
    transform: translateX(185%);
  }
}
@container settings (max-width: 560px) {
  .update-status:not(.update-floating) {
    margin-right: 10px;
    margin-left: 10px;
    padding: 12px;
  }
}
@media (prefers-reduced-motion: reduce) {
  .update-spin,
  .update-progress:indeterminate {
    animation: none;
  }
}
@supports not (backdrop-filter: blur(1px)) {
  .update-floating {
    background: var(--color-canvas);
  }
}
</style>
