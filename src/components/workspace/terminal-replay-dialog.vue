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
import { Terminal } from '@xterm/xterm'
import '@xterm/xterm/css/xterm.css'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
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
const { position, playing, speed } = toRefs(state)
const duration = computed(() => props.cast.events.at(-1)?.[0] ?? 0)
let terminal: Terminal | undefined
let frame = 0
let index = 0
let previous = 0
let seeking = false
let seekSequence = 0
/** 按事件时间回放输出和尺寸变化，播放结束后停在最后一帧。 */
function tick(now: number): void {
  if (state.playing && !seeking)
    state.position = Math.min(
      duration.value,
      state.position + ((now - previous) / 1000) * Number(state.speed)
    )
  previous = now
  while (
    !seeking &&
    index < props.cast.events.length &&
    props.cast.events[index]![0] <= state.position
  ) {
    const [, type, data] = props.cast.events[index++]!
    if (type === 'o') terminal?.write(data)
    else {
      const [cols, rows] = data.split('x').map(Number)
      if (cols && rows && cols > 0 && rows > 0 && cols <= 500 && rows <= 200)
        terminal?.resize(cols, rows)
    }
  }
  if (!seeking && state.position >= duration.value) state.playing = false
  frame = requestAnimationFrame(tick)
}
/** 定位时间轴时清空终端并重建当前位置之前的输出。 */
function seekTo(position: number): void {
  const token = ++seekSequence
  seeking = true
  terminal?.write('', () => {
    if (token !== seekSequence) return
    terminal?.reset()
    terminal?.resize(props.cast.width, props.cast.height)
    state.position = position
    index = 0
    previous = performance.now()
    seeking = false
  })
}
/** 将滑块输入转换为时间轴定位。 */
function seek(event: Event): void {
  seekTo(Number((event.target as HTMLInputElement).value))
}
/** 播放结束后再次播放会从开头重建终端。 */
function togglePlayback(): void {
  if (!state.playing && state.position >= duration.value) seekTo(0)
  state.playing = !state.playing
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
  previous = performance.now()
  frame = requestAnimationFrame(tick)
})
// 关闭浮层时释放动画循环和 xterm 资源。
onBeforeUnmount(() => {
  seekSequence += 1
  cancelAnimationFrame(frame)
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
        class="bg-terminal h-72 overflow-auto rounded"
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
        <select
          v-model="speed"
          class="field w-20"
          :aria-label="t('播放速度')"
        >
          <option
            v-for="rate in [0.5, 1, 2, 4]"
            :key="rate"
            :value="rate"
          >
            {{ rate }}×
          </option>
        </select>
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
