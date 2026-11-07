<script setup lang="ts">
import {
  computed,
  onBeforeUnmount,
  onMounted,
  reactive,
  toRefs,
  useTemplateRef,
} from 'vue'
import { useI18n } from 'vue-i18n'
import { useEventListener, useResizeObserver } from '@vueuse/core'
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { currentTerminalTheme } from '@/constants/terminal'
import { serializeCast, type TerminalCast } from '@/utils/terminal-recording'
const props = defineProps<{ cast: TerminalCast }>()
const emit = defineEmits<{ close: [] }>()
const { t } = useI18n()
const container = useTemplateRef<HTMLElement>('container')
// 响应式状态
const state = reactive({
  // 播放位置，单位秒
  position: 0,
  // 是否按时间轴播放
  playing: false,
  // 播放倍率
  speed: 1,
})
const { position, playing } = toRefs(state)
const speedOptions = [0.5, 1, 2, 4].map(rate => ({
  value: String(rate),
  label: `${rate}×`,
}))
// AppSelect 只处理字符串值，倍率在这里换算回数字。
const speedValue = computed({
  get: () => String(state.speed),
  set: value => {
    state.speed = Number(value)
  },
})
const duration = computed(() => props.cast.events.at(-1)?.[0] ?? 0)
// 回放字号上下限：过小不可读时改为容器滚动
const MIN_FONT = 6
const MAX_FONT = 15
let terminal: Terminal | undefined
let frame = 0
let fitFrame = 0
let index = 0
let previous = 0
let seeking = false
let disposed = false
/** 从当前事件索引写到指定时间，连续输出合并成一次 write，尺寸事件处单独切分。 */
function applyUntil(position: number): void {
  if (seeking || !terminal) return
  const { events } = props.cast
  let buffer = ''
  while (index < events.length && events[index]![0] <= position) {
    const [, type, data] = events[index++]!
    if (type === 'o') {
      buffer += data
      continue
    }
    const [cols, rows] = data.split('x').map(Number)
    if (cols && rows && cols > 0 && rows > 0 && cols <= 500 && rows <= 200) {
      if (buffer) terminal.write(buffer)
      buffer = ''
      terminal.resize(cols, rows)
    }
  }
  if (buffer) terminal.write(buffer)
}
/** 播放中按帧推进时间轴，暂停或播完后立即停止帧循环。 */
function tick(now: number): void {
  frame = 0
  if (!state.playing) return
  state.position = Math.min(
    duration.value,
    state.position + ((now - previous) / 1000) * state.speed
  )
  previous = now
  applyUntil(state.position)
  if (state.position >= duration.value) state.playing = false
  else frame = requestAnimationFrame(tick)
}
/** 启动帧循环，已在运行时不重复注册。 */
function startLoop(): void {
  previous = performance.now()
  if (!frame) frame = requestAnimationFrame(tick)
}
/** 停止帧循环，避免暂停时后台空转。 */
function stopLoop(): void {
  cancelAnimationFrame(frame)
  frame = 0
}
/** 向后跳转增量写入；向前跳转等待已排队输出后重置终端，再一次性重建。 */
function seekTo(position: number): void {
  state.position = position
  previous = performance.now()
  if (seeking) return
  const applied = index ? props.cast.events[index - 1]![0] : 0
  if (position >= applied) {
    applyUntil(position)
    return
  }
  seeking = true
  terminal?.write('', () => {
    if (disposed || !terminal) return
    terminal.reset()
    terminal.resize(props.cast.width, props.cast.height)
    index = 0
    seeking = false
    applyUntil(state.position)
  })
}
/** 将滑块输入转换为时间轴定位。 */
function seek(event: Event): void {
  seekTo(Number((event.target as HTMLInputElement).value))
}
/** 切换播放暂停；播放结束后再次播放会从开头重建终端。 */
function togglePlayback(): void {
  if (!duration.value) return
  if (state.playing) {
    state.playing = false
    stopLoop()
    return
  }
  if (state.position >= duration.value) seekTo(0)
  state.playing = true
  startLoop()
}
/** 空格键播放暂停，焦点在可输入或可点击控件上时保留原生行为。 */
function onKeydown(event: KeyboardEvent): void {
  if (event.code !== 'Space' || event.repeat || event.defaultPrevented) return
  const target = event.target as HTMLElement | null
  // 回放终端只读，焦点在 xterm 隐藏输入框时也应切换播放
  const inTerminal = target?.classList.contains('xterm-helper-textarea')
  if (
    !inTerminal &&
    target?.closest(
      'button, select, textarea, [contenteditable="true"], [role="listbox"], [role="combobox"], input:not([type="range"])'
    )
  )
    return
  event.preventDefault()
  togglePlayback()
}
/** 按录制的列数和行数缩放字号，使整个终端画面适配容器。 */
function fit(): void {
  fitFrame = 0
  const screen = terminal?.element?.querySelector<HTMLElement>('.xterm-screen')
  if (!terminal || !container.value || !screen) return
  const width = screen.offsetWidth
  const height = screen.offsetHeight
  if (!width || !height) return
  const scale = Math.min(
    container.value.clientWidth / width,
    container.value.clientHeight / height
  )
  const current = terminal.options.fontSize ?? 12
  const next = Math.max(
    MIN_FONT,
    Math.min(MAX_FONT, Math.floor(current * scale * 0.98 * 2) / 2)
  )
  if (Math.abs(next - current) >= 0.5) terminal.options.fontSize = next
}
/** 在下一帧合并多次尺寸变化，只执行一次适配。 */
function scheduleFit(): void {
  if (!fitFrame) fitFrame = requestAnimationFrame(fit)
}
/** 将当前录制下载为可被 asciinema 读取的 cast 文件。 */
function download(): void {
  const url = URL.createObjectURL(
    new Blob([serializeCast(props.cast)], { type: 'application/x-asciicast' })
  )
  const link = document.createElement('a')
  link.href = url
  link.download = `terminal-${Date.now()}.cast`
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
useEventListener(window, 'keydown', onKeydown)
useResizeObserver(container, scheduleFit)
// 仅创建只读回放终端，不接入任何 SSH 输入通道。
onMounted(() => {
  terminal = new Terminal({
    cols: props.cast.width,
    rows: props.cast.height,
    disableStdin: true,
    theme: currentTerminalTheme(),
    fontSize: 12,
    scrollback: 10000,
  })
  if (container.value) terminal.open(container.value)
  terminal.onResize(scheduleFit)
  applyUntil(0)
  scheduleFit()
})
// 关闭浮层时释放动画循环和 xterm 资源。
onBeforeUnmount(() => {
  disposed = true
  stopLoop()
  cancelAnimationFrame(fitFrame)
  terminal?.dispose()
  terminal = undefined
})
</script>
<template>
  <AppDialog
    :title="t('终端录制回放')"
    wide
    @close="emit('close')"
  >
    <div class="grid min-h-0 gap-3 overflow-auto p-4">
      <p
        v-if="cast.truncated"
        class="text-warning text-xs"
      >
        {{ t('录制达到容量上限，已保留前面的内容') }}
      </p>
      <div
        ref="container"
        class="bg-terminal h-[min(60vh,32rem)] min-h-48 min-w-0 overflow-auto rounded"
      />
      <input
        type="range"
        :aria-label="t('回放进度')"
        min="0"
        :max="duration"
        step="0.1"
        :value="position"
        @input="seek"
      />
      <div class="flex items-center gap-2 text-xs">
        <AppButton
          :disabled="!duration"
          @click="togglePlayback"
          >{{ playing ? t('暂停') : t('播放') }}</AppButton
        >
        <AppSelect
          v-model="speedValue"
          class="w-20"
          :label="t('播放速度')"
          :options="speedOptions"
          hide-label
          compact
        />
        <span class="text-txt-3"
          >{{ position.toFixed(1) }} / {{ duration.toFixed(1) }}s</span
        >
        <AppButton
          class="ml-auto"
          @click="download"
          >{{ t('导出录制') }}</AppButton
        >
      </div>
    </div>
  </AppDialog>
</template>
