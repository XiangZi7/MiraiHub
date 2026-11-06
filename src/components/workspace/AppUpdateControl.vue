<script setup lang="ts">
import {
  computed,
  onMounted,
  reactive,
  toRefs,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import type { CSSProperties } from 'vue'
import { storeToRefs } from 'pinia'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppMenuSurface from '@/components/ui/AppMenuSurface.vue'
import { useAppUpdaterStore } from '@/stores/app-updater'
import { toast } from '@/composables/useToast'

const { t } = useI18n()
const updater = useAppUpdaterStore()
const { state: update } = storeToRefs(updater)
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const prompt = useTemplateRef<HTMLElement>('prompt')
const promptId = `update-${useId()}`
// 响应式状态
const state = reactive({
  // 下载完成后展开确认气泡，稍后仍可从成功图标重新打开。
  open: false,
  // 气泡使用窗口坐标，避开标题栏裁剪并适配界面缩放。
  promptStyle: {} as CSSProperties,
})
const { open, promptStyle } = toRefs(state)
const visible = computed(
  () =>
    Boolean(update.value.version) &&
    ['available', 'downloading', 'ready', 'installing', 'error'].includes(
      update.value.phase
    )
)
const progress = computed(() =>
  update.value.total > 0
    ? Math.min(
        99,
        Math.round((update.value.downloaded / update.value.total) * 100)
      )
    : undefined
)
const label = computed(() => {
  switch (update.value.phase) {
    case 'ready':
      return t('更新下载完成')
    case 'downloading':
      return `${t('正在下载更新')}${progress.value === undefined ? '' : ` · ${progress.value}%`}`
    case 'installing':
      return t('正在安装，即将重启…')
    case 'error':
      return t('更新失败，请重试')
    default:
      return `${t('下载更新')} · v${update.value.version}`
  }
})

/** 首次挂载即启动检查；实际下载与安装始终由用户点击触发。 */
onMounted(() => void updater.start())

/** 根据按钮的实际位置和缩放定位确认气泡，并让箭头对准更新图标。 */
function positionPrompt(): void {
  if (!state.open || !trigger.value || !prompt.value) return
  const anchor = trigger.value.getBoundingClientRect()
  const bounds = prompt.value.getBoundingClientRect()
  const scale = bounds.width / prompt.value.offsetWidth || 1
  const padding = 8 * scale
  const left = Math.max(
    padding,
    Math.min(
      anchor.right - bounds.width,
      window.innerWidth - bounds.width - padding
    )
  )
  state.promptStyle = {
    left: `${left / scale}px`,
    top: `${(anchor.bottom + 10 * scale) / scale}px`,
    maxWidth: `${Math.max(0, window.innerWidth / scale - 16)}px`,
    '--update-arrow-x': `${((anchor.left + anchor.right) / 2 - left) / scale}px`,
  }
}

/** 有更新时开始下载；下载完成后点击同一图标可再次展开安装选择。 */
function activateUpdate(): void {
  if (update.value.phase === 'available' || update.value.phase === 'error') {
    state.open = false
    void updater.command('download')
  } else if (update.value.phase === 'ready') {
    state.open = !state.open
  }
}

/** 关闭气泡并记录稍后安装，保留已校验的更新包和工具栏入口。 */
function postponeUpdate(): void {
  state.open = false
  void updater.command('defer')
  trigger.value?.focus({ preventScroll: true })
}

/** 用户确认后才启动安装；不关闭连接或替用户作出重启决定。 */
function installUpdate(): void {
  state.open = false
  void updater.command('install')
}

// 下载及签名校验都成功后才显示成功图标和安装选择，不移动正在编辑的输入焦点。
watch(
  () => update.value.phase,
  (phase, previous) => {
    if (phase === 'ready' && previous !== 'ready' && !update.value.dismissed)
      state.open = true
    else if (phase !== 'ready') state.open = false
    if (phase === 'error' && update.value.version)
      toast.error({
        title: t('更新失败，请重试'),
        description: update.value.error,
      })
  },
  { immediate: true }
)
watch(open, positionPrompt, { flush: 'post' })
useResizeObserver([trigger, prompt], positionPrompt)
useEventListener('resize', positionPrompt)
useEventListener('pointerdown', event => {
  const target = event.target as Node
  if (
    state.open &&
    !trigger.value?.contains(target) &&
    !prompt.value?.contains(target)
  ) {
    state.open = false
    void updater.command('dismiss')
  }
})
useEventListener('keydown', event => {
  if (state.open && event.key === 'Escape') {
    event.preventDefault()
    postponeUpdate()
  }
})
</script>

<template>
  <button
    v-if="visible"
    ref="trigger"
    type="button"
    class="icon-btn relative shrink-0"
    :class="update.phase === 'ready' ? 'text-success' : 'text-violet'"
    :title="label"
    :aria-label="label"
    :aria-expanded="open"
    :aria-controls="open ? promptId : undefined"
    :aria-haspopup="update.phase === 'ready' ? 'dialog' : undefined"
    :disabled="update.phase === 'installing'"
    @click="activateUpdate"
  >
    <svg
      v-if="update.phase === 'downloading'"
      class="size-5 -rotate-90"
      viewBox="0 0 24 24"
      role="progressbar"
      :aria-label="t('更新下载进度')"
      :aria-valuenow="progress"
      :aria-valuemin="0"
      :aria-valuemax="100"
    >
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        opacity="0.18"
      />
      <circle
        cx="12"
        cy="12"
        r="9"
        fill="none"
        stroke="currentColor"
        stroke-width="2"
        stroke-linecap="round"
        pathLength="100"
        :stroke-dasharray="progress === undefined ? '25 75' : '100'"
        :stroke-dashoffset="progress === undefined ? 0 : 100 - progress"
        :class="
          progress === undefined &&
          'origin-center animate-spin motion-reduce:animate-none'
        "
      />
    </svg>
    <AppIcon
      v-else
      :name="
        update.phase === 'ready'
          ? 'lucide:circle-check'
          : update.phase === 'installing'
            ? 'lucide:loader-circle'
            : update.phase === 'error'
              ? 'lucide:circle-alert'
              : 'lucide:circle-arrow-up'
      "
      :size="19"
      :class="
        update.phase === 'installing' &&
        'animate-spin motion-reduce:animate-none'
      "
    />
  </button>
  <Teleport
    v-if="open && update.phase === 'ready'"
    to="body"
  >
    <section
      :id="promptId"
      ref="prompt"
      class="update-prompt border-line-strong shadow-pop fixed isolate z-150 w-68 rounded-xl border p-3 font-sans"
      :style="promptStyle"
      role="dialog"
      :aria-label="t('应用更新')"
    >
      <AppMenuSurface />
      <div class="flex items-center gap-2">
        <AppIcon
          name="lucide:circle-check"
          :size="17"
          class="text-success shrink-0"
        />
        <span class="text-txt text-xs font-medium">{{
          t('更新下载完成')
        }}</span>
        <span class="text-txt-4 ml-auto font-mono text-[10px]"
          >v{{ update.version }}</span
        >
      </div>
      <p class="text-txt-3 mt-2 text-[11px] leading-5">
        {{ t('更新包已下载，是否立即更新？') }}
      </p>
      <div class="mt-3 flex justify-end gap-2">
        <AppButton
          size="sm"
          @click="postponeUpdate"
          >{{ t('稍后') }}</AppButton
        >
        <AppButton
          size="sm"
          variant="primary"
          @click="installUpdate"
          >{{ t('立即更新') }}</AppButton
        >
      </div>
    </section>
  </Teleport>
</template>

<style scoped>
.update-prompt::before {
  content: '';
  position: absolute;
  top: -5px;
  left: var(--update-arrow-x);
  width: 9px;
  height: 9px;
  transform: translateX(-50%) rotate(45deg);
  background: color-mix(in oklch, var(--color-panel) 94%, transparent);
  border-top: 1px solid var(--color-line-strong);
  border-left: 1px solid var(--color-line-strong);
}
</style>
