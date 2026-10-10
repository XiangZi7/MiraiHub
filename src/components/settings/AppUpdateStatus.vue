<script setup lang="ts">
import { computed, onMounted } from 'vue'
import { useI18n } from 'vue-i18n'
import { storeToRefs } from 'pinia'
import { openUrl } from '@tauri-apps/plugin-opener'
import { useAppUpdaterStore } from '@/stores/app-updater'
import { useSettingsStore } from '@/stores/settings'

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
      return t('更新失败，请检查网络后重试')
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
    v-if="!floating || noticeable"
    :class="['update-status', { 'update-floating': floating }]"
    :aria-label="t('应用更新')"
  >
    <div
      role="status"
      aria-live="polite"
    >
      <p class="text-txt text-[11.5px] font-medium">
        {{ label }} <span v-if="state.version">v{{ state.version }}</span>
      </p>
      <p
        v-if="state.phase === 'ready'"
        class="text-txt-3 mt-1 text-[10.5px]"
      >
        {{ t('请关闭连接标签和其他窗口，随后将自动安装并重启。') }}
      </p>
      <p
        v-if="state.phase === 'downloading'"
        class="text-txt-3 mt-1 text-[10.5px]"
      >
        {{ (state.downloaded / 1024 / 1024).toFixed(1) }} MB
        <span v-if="progress !== undefined">· {{ progress }}%</span>
      </p>
      <progress
        v-if="state.phase === 'downloading'"
        :value="progress"
        max="100"
        :aria-label="t('更新下载进度')"
        class="mt-2 h-1 w-full"
      />
    </div>
    <details
      v-if="state.error"
      class="text-txt-3 mt-1 text-[10px]"
    >
      <summary>{{ t('错误详情') }}</summary>
      <p class="max-h-24 overflow-auto break-all">{{ state.error }}</p>
    </details>
    <div class="mt-2 flex flex-wrap gap-3 text-[11px]">
      <button
        v-if="state.phase !== 'ready' && state.phase !== 'unsupported'"
        type="button"
        :disabled="busy"
        class="update-action"
        @click="updater.command('check')"
      >
        {{ state.phase === 'error' ? t('重试') : t('检查并下载更新') }}
      </button>
      <button
        v-if="state.phase === 'ready'"
        type="button"
        class="update-action"
        @click="updater.command(state.deferred ? 'resume' : 'defer')"
      >
        {{ state.deferred ? t('恢复自动安装') : t('本次暂不安装') }}
      </button>
      <button
        v-if="state.phase === 'ready' && !settings.values.autoUpdate"
        type="button"
        class="update-action"
        @click="updater.command('resume')"
      >
        {{ t('空闲后安装本次更新') }}
      </button>
      <button
        type="button"
        class="update-action"
        @click="openReleases"
      >
        {{ t('查看发行说明') }}
      </button>
    </div>
  </section>
</template>

<style scoped>
.update-status {
  padding: 12px 18px;
  border-top: 1px solid var(--color-line-soft);
}
.update-floating {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 60;
  width: min(360px, calc(100vw - 36px));
  border: 1px solid var(--color-line);
  border-radius: 10px;
  background: var(--color-panel);
  box-shadow: var(--shadow-card);
}
.update-action {
  color: var(--color-violet);
  cursor: pointer;
}
.update-action:hover {
  text-decoration: underline;
}
.update-action:disabled {
  opacity: 0.45;
  cursor: default;
}
.update-action:focus-visible {
  outline: 2px solid var(--color-violet);
  outline-offset: 3px;
}
</style>
