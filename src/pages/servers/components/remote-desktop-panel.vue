<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  useTemplateRef,
  watch,
} from 'vue'
import { useDebounceFn, useElementSize, useEventListener } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import { sendRdpInput, startRdp, stopRdp, trustRdpCertificate } from '@/api/rdp'
import type { RdpEvent, RdpInput } from '@/api/rdp'
import { errorMessage } from '@/api/ssh'
import AppButton from '@/components/ui/AppButton.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { toast } from '@/composables/useToast'
import { translateNativeMessage } from '@/i18n/native'
import { useConnectionsStore } from '@/stores/connections'
import {
  endpointOf,
  isRdpConnection,
  type RdpResolution,
  type SavedConnection,
} from '@/types/connection'
import type { ContextMenuItem } from '@/types/context-menu'
import type { SshSessionStatus } from '@/types/ssh'
import { RDP_SCAN_CODES } from '@/utils/rdp-keys'
import { fitRdpResolution, RDP_RESOLUTIONS } from '@/utils/rdp-display'
import {
  IS_TAURI,
  isWindowFullscreen,
  openConnectionWindow,
  setWindowFullscreen,
} from '@/utils/window'

const props = defineProps<{
  connection: SavedConnection
  active: boolean
  connectRequest?: number
}>()
const emit = defineEmits<{
  status: [status: SshSessionStatus, sessionId: string]
}>()
const { t } = useI18n()
const connections = useConnectionsStore()
const profile = computed(() => {
  const connection = connections.find(props.connection.id) ?? props.connection
  return isRdpConnection(connection) ? connection : undefined
})
const viewport = useTemplateRef<HTMLElement>('viewport')
const canvas = useTemplateRef<HTMLCanvasElement>('canvas')
const { width: viewportWidth, height: viewportHeight } =
  useElementSize(viewport)
const canFullscreen = IS_TAURI || document.fullscreenEnabled
type Zoom = 'fit' | 'fill' | number
type DisplayMenu = 'resolution' | 'zoom'
const state = reactive({
  phase: 'idle' as
    'idle' | 'setup' | 'connecting' | 'certificate' | 'connected',
  endpoint: '',
  fingerprint: '',
  previousFingerprint: '',
  frameReady: false,
  width: 0,
  height: 0,
  fullscreen: false,
  resolution: undefined as RdpResolution | 'auto' | undefined,
  zoom: undefined as Zoom | undefined,
  fullscreenZoom: 'fill' as Zoom,
  menu: null as DisplayMenu | null,
  menuTrigger: null as HTMLElement | null,
  menuX: 0,
  menuY: 0,
  pendingResolution: false,
})
// 连接协商和等待首帧共用 SSH 的顶部进度条，证书确认期间不显示加载反馈。
const desktopLoading = computed(
  () =>
    state.phase === 'connecting' ||
    (state.phase === 'connected' && !state.frameReady)
)
const statusMeta = computed(() => {
  if (state.phase === 'connected')
    return { text: t('已连接'), tone: 'success' } as const
  if (state.phase === 'certificate')
    return { text: t('核对远程桌面证书'), tone: 'amber' } as const
  if (state.phase === 'connecting')
    return { text: t('连接中…'), tone: 'accent' } as const
  return { text: t('已断开'), tone: 'txt-3' } as const
})
const statusTone = {
  success: 'text-success',
  amber: 'text-amber',
  accent: 'text-accent',
  'txt-3': 'text-txt-3',
}
const fixedResolution = computed(() =>
  state.resolution === 'auto'
    ? undefined
    : (state.resolution ?? profile.value?.settings.resolution)
)
const requestedDesktop = computed(
  () =>
    fixedResolution.value ??
    fitRdpResolution(viewportWidth.value, viewportHeight.value)
)
const zoom = computed(() =>
  state.fullscreen
    ? state.fullscreenZoom
    : (state.zoom ?? (profile.value?.settings.scale === 'actual' ? 100 : 'fit'))
)
const zoomOptions = ['fit', 'fill', 50, 75, 100, 125, 150, 200] as const
const zoomLabel = (mode: Zoom): string =>
  mode === 'fit' ? t('适应窗口') : mode === 'fill' ? t('拉伸铺满') : `${mode}%`
const resolutionLabel = ({ width, height }: RdpResolution): string =>
  `${width} × ${height}`
const resolutionItems = computed<ContextMenuItem[]>(() => {
  const fixed = fixedResolution.value
  const presets = RDP_RESOLUTIONS.map(size => ({
    id: resolutionLabel(size),
    label: resolutionLabel(size),
    checked: fixed?.width === size.width && fixed?.height === size.height,
  }))
  if (fixed && !presets.some(item => item.checked))
    presets.push({ id: 'custom', label: resolutionLabel(fixed), checked: true })
  const items: ContextMenuItem[] = [
    { id: 'auto', label: t('跟随窗口'), checked: !fixed },
    ...presets,
  ]
  if (state.pendingResolution)
    items.push({
      id: 'reconnect',
      label: t('重连以应用分辨率'),
      icon: 'lucide:rotate-cw',
      separatorBefore: true,
    })
  return items
})
const zoomItems = computed<ContextMenuItem[]>(() =>
  zoomOptions.map(mode => ({
    id: String(mode),
    label: zoomLabel(mode),
    checked: zoom.value === mode,
  }))
)

let sessionId = ''
let sessionKey = ''
let lastRequested: RdpResolution | undefined
let windowWasFullscreen = false
let fullscreenBusy = false
let disposed = false
let inputFrame = 0
let flushingInput = false
const pendingInputs: RdpInput[] = []

/** 显示连接异常，由工作区的公共通知组件提供细节。 */
function notifyError(message: string): void {
  toast.error({
    title: t('远程桌面连接失败'),
    description: translateNativeMessage(message),
  })
}

/** 清空当前连接及排队输入，避免旧会话的更新进入下一次连接。 */
function resetSession(): void {
  sessionId = ''
  sessionKey = ''
  lastRequested = undefined
  cancelAnimationFrame(inputFrame)
  inputFrame = 0
  pendingInputs.length = 0
  state.phase = 'idle'
  state.endpoint = ''
  state.fingerprint = ''
  state.previousFingerprint = ''
  state.frameReady = false
  state.width = 0
  state.height = 0
  state.pendingResolution = false
  state.menu = null
  const surface = canvas.value
  surface?.getContext('2d')?.clearRect(0, 0, surface.width, surface.height)
  emit('status', 'disconnected', '')
}

/** 断开或取消当前 IronRDP 会话，将面板还原成可连接状态。 */
async function disconnect(): Promise<void> {
  const id = sessionId
  resetSession()
  if (id) await stopRdp(id).catch(() => undefined)
}

/** 只处理当前连接的证书、连接状态和剪贴板回执。 */
function handleEvent(id: string, event: RdpEvent): void {
  if (sessionId !== id) return
  if (event.type === 'certificate') {
    state.fingerprint = event.fingerprint
    state.previousFingerprint = event.previousFingerprint ?? ''
    state.phase = 'certificate'
  } else if (event.type === 'connected') {
    state.phase = 'connected'
    emit('status', 'connected', id)
  } else if (event.type === 'clipboard') {
    const message = translateNativeMessage(event.message)
    if (event.error) toast.error(message)
    else toast.info(message)
  } else {
    resetSession()
    if (event.error) notifyError(event.error)
    else toast.info(t('远程桌面已断开'))
  }
}

/** 将 Rust 标记的变化区域直接画进当前桌面。 */
function draw(id: string, frame: ArrayBuffer): void {
  const surface = canvas.value
  if (sessionId !== id || !surface || frame.byteLength < 12) return
  const header = new DataView(frame, 0, 12)
  const desktopWidth = header.getUint16(0, true)
  const desktopHeight = header.getUint16(2, true)
  const x = header.getUint16(4, true)
  const y = header.getUint16(6, true)
  const width = header.getUint16(8, true)
  const height = header.getUint16(10, true)
  if (
    !width ||
    !height ||
    x + width > desktopWidth ||
    y + height > desktopHeight ||
    frame.byteLength !== 12 + width * height * 4
  )
    return

  if (surface.width !== desktopWidth || surface.height !== desktopHeight) {
    surface.width = desktopWidth
    surface.height = desktopHeight
  }
  state.width = desktopWidth
  state.height = desktopHeight
  if (
    desktopWidth === lastRequested?.width &&
    desktopHeight === lastRequested.height
  )
    state.pendingResolution = false
  const context = surface.getContext('2d', { alpha: false })
  if (!context) return
  const pixels = new Uint8ClampedArray(frame, 12)
  context.putImageData(new ImageData(pixels, width, height), x, y)
  if (!state.frameReady) {
    state.frameReady = true
    void nextTick(() => {
      if (props.active && sessionId === id) surface.focus()
    })
  }
}

/** 打开统一配置窗口，处理初次保存或更换 Windows 凭据。 */
function editConfiguration(): void {
  openConnectionWindow('rdp', props.connection.id)
}

/** 使用已保存的凭据和尺寸打开会话，旧配置引导至配置窗口。 */
async function connect(): Promise<void> {
  await nextTick()
  if (disposed) return
  const current = profile.value
  const credential = current?.settings.rdpCredential
  if (!current?.username || !credential) {
    void disconnect()
    state.phase = 'setup'
    editConfiguration()
    return
  }
  const { host, port, username, settings } = current
  const key = JSON.stringify([
    host,
    port,
    username,
    credential,
    settings.resolution,
  ])
  if (sessionId && sessionKey === key) return
  if (sessionId) void disconnect()

  const id = crypto.randomUUID()
  sessionId = id
  sessionKey = key
  const desktop = requestedDesktop.value
  lastRequested = desktop
  state.endpoint = endpointOf(current)
  state.phase = 'connecting'
  emit('status', 'connecting', '')
  const request = {
    sessionId: id,
    target: { host, port, username },
    credential,
    desktop,
  }
  try {
    await startRdp(
      request,
      event => handleEvent(id, event),
      frame => draw(id, frame)
    )
    if (sessionId !== id) await stopRdp(id).catch(() => undefined)
  } catch (error) {
    if (sessionId !== id) return
    resetSession()
    notifyError(errorMessage(error))
  }
}

/** 进入原生全屏后将会话移到窗口上层，退出时恢复之前的窗口状态。 */
async function setDesktopFullscreen(enabled: boolean): Promise<void> {
  if (fullscreenBusy || enabled === state.fullscreen) return
  fullscreenBusy = true
  state.menu = null
  try {
    if (enabled) {
      windowWasFullscreen = await isWindowFullscreen()
      state.fullscreenZoom = 'fill'
    }
    await setWindowFullscreen(enabled || windowWasFullscreen)
    state.fullscreen = enabled
    if (enabled && (disposed || !props.active)) {
      await setWindowFullscreen(windowWasFullscreen)
      state.fullscreen = false
    } else {
      await nextTick()
      if (state.frameReady) canvas.value?.focus()
    }
  } catch (error) {
    toast.error({ title: t('切换全屏失败'), description: errorMessage(error) })
  } finally {
    fullscreenBusy = false
  }
}

function toggleFullscreen(): void {
  void setDesktopFullscreen(!state.fullscreen)
}

// 在工作区的 F11 / Esc 之前处理会话全屏，显示菜单仍可优先使用 Esc。
useEventListener(
  window,
  'keydown',
  event => {
    if (
      !props.active ||
      (!state.fullscreen && document.activeElement !== canvas.value)
    )
      return
    if (event.key !== 'F11' && !(event.key === 'Escape' && state.fullscreen))
      return
    event.preventDefault()
    event.stopImmediatePropagation()
    if (event.repeat) return
    if (state.phase === 'certificate' && event.key === 'Escape') {
      void disconnect()
    } else if (state.menu && event.key === 'Escape') {
      state.menu = null
      canvas.value?.focus()
    } else toggleFullscreen()
  },
  { capture: true }
)

useEventListener(document, 'fullscreenchange', () => {
  if (!IS_TAURI && !document.fullscreenElement) state.fullscreen = false
})

/** 以顶栏按钮为锚点打开项目共用的玻璃菜单。 */
function openDisplayMenu(menu: DisplayMenu, event: MouseEvent): void {
  const button = event.currentTarget as HTMLElement
  const rect = button.getBoundingClientRect()
  state.menuTrigger = button
  state.menuX = rect.left
  state.menuY = rect.bottom + 5
  state.menu = state.menu === menu ? null : menu
}

/** 远端分辨率和本地缩放分别生效，配置窗口保存的默认值用于新标签。 */
function selectDisplayOption(id: string): void {
  if (state.menu === 'zoom') {
    const selected = zoomOptions.find(mode => String(mode) === id)
    if (selected !== undefined) {
      if (state.fullscreen) state.fullscreenZoom = selected
      else state.zoom = selected
    }
  } else if (id === 'reconnect') {
    void actionFor(props.connection.id, 'reconnect')
  } else if (id !== 'custom') {
    state.resolution =
      id === 'auto'
        ? 'auto'
        : RDP_RESOLUTIONS.find(size => resolutionLabel(size) === id)
    const { width, height } = requestedDesktop.value
    state.pendingResolution =
      state.frameReady && (width !== state.width || height !== state.height)
    void resizeRemote()
  }
  void nextTick(() => canvas.value?.focus())
}

/** 用户核对指纹后，允许正在等待的 TLS 会话继续登录。 */
async function acceptCertificate(remember: boolean): Promise<void> {
  const id = sessionId
  if (!id || state.phase !== 'certificate') return
  state.phase = 'connecting'
  try {
    await trustRdpCertificate(id, state.fingerprint, remember)
  } catch (error) {
    if (sessionId !== id) return
    await disconnect()
    notifyError(errorMessage(error))
  }
}

/** 保持输入 IPC 的发送顺序，连续移动合并，只等待一批发送完成。 */
async function flushInput(): Promise<void> {
  inputFrame = 0
  if (flushingInput || !sessionId || !pendingInputs.length) return
  const id = sessionId
  flushingInput = true
  try {
    await sendRdpInput(id, pendingInputs.splice(0, 64))
  } catch (error) {
    if (sessionId === id) {
      await disconnect()
      notifyError(errorMessage(error))
    }
  } finally {
    flushingInput = false
    if (pendingInputs.length && !inputFrame)
      inputFrame = requestAnimationFrame(() => void flushInput())
  }
}

/** 在下一帧发送输入，既保留点击与按键顺序，也避免重复发送每个移动采样点。 */
function queueInput(event: RdpInput): void {
  if (state.phase !== 'connected' || !sessionId) return
  if (event.type === 'move' && pendingInputs.at(-1)?.type === 'move')
    pendingInputs[pendingInputs.length - 1] = event
  else pendingInputs.push(event)
  if (!inputFrame) inputFrame = requestAnimationFrame(() => void flushInput())
}

/** 把聚焦桌面上收到的物理按键交给 Windows，阻止工作区快捷键重复处理。 */
function handleKey(event: KeyboardEvent, pressed: boolean): void {
  const code = RDP_SCAN_CODES[event.code]
  if (code === undefined) return
  event.preventDefault()
  event.stopPropagation()
  if (
    pressed &&
    event.ctrlKey &&
    !event.altKey &&
    !event.shiftKey &&
    !event.metaKey
  ) {
    if (event.code === 'KeyC' || event.code === 'KeyV') {
      if (!event.repeat)
        queueInput({
          type: event.code === 'KeyC' ? 'clipboardCopy' : 'clipboardPaste',
        })
      return
    }
  }
  queueInput({ type: 'key', code, pressed })
}

/** 把缩放后的鼠标位置还原成远程帧缓冲区坐标。 */
function pointerPosition(
  event: MouseEvent
): { x: number; y: number } | undefined {
  const surface = canvas.value
  const rect = surface?.getBoundingClientRect()
  if (!surface || !rect?.width || !rect.height || !state.frameReady) return
  const x = Math.floor(
    ((event.clientX - rect.left) * surface.width) / rect.width
  )
  const y = Math.floor(
    ((event.clientY - rect.top) * surface.height) / rect.height
  )
  return {
    x: Math.max(0, Math.min(surface.width - 1, x)),
    y: Math.max(0, Math.min(surface.height - 1, y)),
  }
}

/** 在桌面内移动指针，并在拖出画布时继续向远端同步坐标。 */
function handleMove(event: PointerEvent): void {
  const position = pointerPosition(event)
  if (position) queueInput({ type: 'move', ...position })
}

/** 发送鼠标按下或释放，在拖动期间用指针捕获保证释放可送达。 */
function handleButton(event: PointerEvent, pressed: boolean): void {
  const position = pointerPosition(event)
  if (!position || event.button < 0 || event.button > 4) return
  if (pressed) {
    canvas.value?.focus()
    canvas.value?.setPointerCapture(event.pointerId)
  }
  queueInput({ type: 'button', button: event.button, pressed, ...position })
}

/** 将滚轮转换成 Windows 远程桌面的轮刻度。 */
function handleWheel(event: WheelEvent): void {
  const position = pointerPosition(event)
  if (!position) return
  const vertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX)
  const delta = vertical ? event.deltaY : event.deltaX
  if (delta)
    queueInput({
      type: 'wheel',
      vertical,
      delta: (vertical ? -1 : 1) * Math.sign(delta) * 120,
      ...position,
    })
}

/** 失去焦点或指针中断时释放远端按键，避免修饰键保持按下。 */
function releaseInput(): void {
  queueInput({ type: 'releaseAll' })
}

/** 处理标签栏的连接操作，重连时重新读取已保存配置。 */
async function actionFor(id: string, action: string): Promise<void> {
  if (id !== props.connection.id) return
  if (action === 'disconnect') await disconnect()
  else if (action === 'reconnect') {
    await disconnect()
    await connect()
  }
}

defineExpose({ actionFor })

// 双击侧栏时直接连接，恢复和切换已有标签时保留当前状态。
watch(
  () => props.connectRequest,
  requested => {
    if (requested) void connect()
  },
  { immediate: true, flush: 'post' }
)
// 补齐旧连接的密码后继续用户已经发起的连接。
watch(
  () => profile.value?.settings.rdpCredential,
  credential => {
    if (credential && state.phase === 'setup') void connect()
  }
)

/** 合并拖动窗口产生的连续变化，只给当前自适应会话发送最后一个尺寸。 */
const resizeRemote = useDebounceFn(() => {
  if (!props.active || !viewportWidth.value || !viewportHeight.value) return
  const size = requestedDesktop.value
  if (
    size.width === lastRequested?.width &&
    size.height === lastRequested.height
  )
    return
  if (state.phase !== 'connected') return
  lastRequested = size
  queueInput({ type: 'resize', ...size })
}, 350)
watch(
  [viewportWidth, viewportHeight, () => state.phase, () => props.active],
  () => void resizeRemote()
)
// 分屏或标签切换时也释放按键，保持后台 RDP 会话。
watch(
  () => props.active,
  active => {
    if (!active) {
      state.menu = null
      releaseInput()
      void setDesktopFullscreen(false)
    }
  }
)
onBeforeUnmount(() => {
  disposed = true
  void setDesktopFullscreen(false)
  void disconnect()
})
</script>

<template>
  <div class="contents">
    <Teleport
      to="body"
      :disabled="!state.fullscreen"
    >
      <section
        class="terminal-pane pane h-full"
        :class="{ 'rdp-fullscreen': state.fullscreen }"
        :aria-busy="desktopLoading"
      >
        <!-- 全屏顶栏浮于画面上方，鼠标移到顶部拉手或键盘聚焦时展开。 -->
        <header
          class="terminal-header"
          :data-menu-open="state.menu !== null"
        >
          <span
            v-if="!desktopLoading"
            :class="[
              'flex shrink-0 items-center gap-1.5 text-[11px]',
              statusTone[statusMeta.tone],
            ]"
          >
            <StatusDot
              :tone="statusMeta.tone"
              :size="6"
              :glow="state.phase === 'connected'"
            />
            <span class="terminal-state-label">{{ statusMeta.text }}</span>
          </span>
          <span
            class="terminal-kind border-line bg-card text-txt-2 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium"
          >
            RDP
          </span>
          <span
            class="terminal-endpoint text-txt-2 max-w-36 min-w-0 truncate text-[11px]"
            :title="state.endpoint || endpointOf(profile ?? connection)"
          >
            {{ profile?.name ?? connection.name }}
          </span>
          <button
            v-if="state.frameReady"
            type="button"
            class="text-txt-3 hover:bg-hover hover:text-txt flex h-6 shrink-0 items-center gap-1 rounded px-1.5 font-mono text-[11px]"
            :title="t('远端分辨率')"
            :aria-label="t('远端分辨率')"
            aria-haspopup="menu"
            :aria-expanded="state.menu === 'resolution'"
            @click="openDisplayMenu('resolution', $event)"
          >
            <AppIcon
              name="lucide:monitor"
              :size="12"
            />
            {{ state.width }} × {{ state.height }}
            <AppIcon
              name="lucide:chevron-down"
              :size="11"
            />
          </button>
          <div class="ml-auto flex shrink-0 items-center gap-1">
            <IconButton
              v-if="state.frameReady"
              icon="lucide:scaling"
              :size="14"
              :title="t('画面缩放') + ' · ' + zoomLabel(zoom)"
              aria-haspopup="menu"
              :aria-expanded="state.menu === 'zoom'"
              @click="openDisplayMenu('zoom', $event)"
            />
            <IconButton
              v-if="canFullscreen && (state.frameReady || state.fullscreen)"
              :icon="state.fullscreen ? 'lucide:minimize' : 'lucide:maximize'"
              :size="14"
              :title="t('全屏 / 退出')"
              @click="toggleFullscreen"
            />
            <IconButton
              icon="lucide:settings-2"
              :size="14"
              :title="t('编辑连接配置')"
              @click="editConfiguration"
            />
            <IconButton
              v-if="state.endpoint"
              icon="lucide:unplug"
              :size="14"
              :title="state.phase === 'connected' ? t('断开连接') : t('取消')"
              @click="disconnect"
            />
          </div>
        </header>

        <!-- 远程桌面画布：绘制 IronRDP 的更新并收集键鼠事件。 -->
        <div
          ref="viewport"
          class="terminal-output [container-type:size] flex"
          :class="{
            'overflow-auto': state.frameReady && typeof zoom === 'number',
          }"
          :aria-busy="desktopLoading"
        >
          <canvas
            v-show="state.phase === 'connected' && state.frameReady"
            ref="canvas"
            tabindex="0"
            :aria-label="t('Windows 远程桌面（RDP）')"
            class="m-auto block max-w-none shrink-0 touch-none outline-none"
            :class="{
              'rdp-fit': zoom === 'fit',
              'h-full w-full': zoom === 'fill',
            }"
            :style="
              typeof zoom === 'number'
                ? {
                    width: (state.width * zoom) / 100 + 'px',
                    height: (state.height * zoom) / 100 + 'px',
                  }
                : {
                    '--rdp-aspect': state.height
                      ? state.width / state.height
                      : 1,
                  }
            "
            @keydown="handleKey($event, true)"
            @keyup="handleKey($event, false)"
            @pointermove="handleMove"
            @pointerdown.prevent="handleButton($event, true)"
            @pointerup.prevent="handleButton($event, false)"
            @pointercancel="releaseInput"
            @wheel.prevent="handleWheel"
            @contextmenu.prevent
            @blur="releaseInput"
          />

          <!-- 未连接状态：旧记录只引导到统一配置窗口，普通断开后可直接重连。 -->
          <div
            v-if="state.phase === 'idle' || state.phase === 'setup'"
            class="m-auto flex max-w-72 flex-col items-center gap-3 p-4 text-center"
          >
            <AppIcon
              name="lucide:monitor"
              :size="22"
              class="text-txt-3"
            />
            <p class="text-txt-3 text-xs">
              {{
                state.phase === 'setup'
                  ? t('请在配置窗口保存远程桌面凭据')
                  : t('远程桌面已断开')
              }}
            </p>
            <AppButton
              v-if="state.phase === 'setup'"
              size="sm"
              @click="editConfiguration"
              >{{ t('编辑连接配置') }}</AppButton
            >
            <AppButton
              v-else
              size="sm"
              variant="primary"
              @click="connect"
              >{{ t('连接') }}</AppButton
            >
          </div>

          <!-- 顶部加载进度条：沿用 SSH 的细条，覆盖连接协商与首帧等待，不占用画面中央。 -->
          <div
            v-if="desktopLoading"
            class="progress-indeterminate"
            role="progressbar"
            :aria-label="
              state.phase === 'connected'
                ? t('正在加载远程桌面…')
                : t('连接中…')
            "
          />
        </div>

        <AppContextMenu
          :open="state.menu !== null"
          :x="state.menuX"
          :y="state.menuY"
          :items="state.menu === 'zoom' ? zoomItems : resolutionItems"
          :label="t(state.menu === 'zoom' ? '画面缩放' : '远端分辨率')"
          :trigger="state.menuTrigger"
          @close="state.menu = null"
          @select="selectDisplayOption"
        />

        <Teleport to="body">
          <AppDialog
            v-if="active && state.phase === 'certificate'"
            :title="
              state.previousFingerprint
                ? t('远程桌面证书已变化')
                : t('核对远程桌面证书')
            "
            :description="t('正在连接 {value0}', { value0: state.endpoint })"
            @close="disconnect"
          >
            <p
              v-if="state.previousFingerprint"
              class="border-danger/40 bg-danger/10 text-danger mb-3 rounded-lg border px-3 py-2.5 text-[11px] leading-relaxed"
              role="alert"
            >
              {{ t('当前证书与已信任的证书不同，请核对新指纹后再继续。') }}
            </p>
            <p
              v-else
              class="text-txt-2 mb-3 text-[11px] leading-relaxed"
            >
              {{
                t(
                  '系统无法验证此证书。请通过可信渠道核对 SHA-256 指纹后再继续登录。'
                )
              }}
            </p>
            <dl class="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1.5 text-[11px]">
              <dt class="text-txt-3">{{ t('算法') }}</dt>
              <dd class="text-txt font-mono">SHA-256</dd>
              <dt class="text-txt-3">
                {{ state.previousFingerprint ? t('新指纹') : t('指纹') }}
              </dt>
              <dd class="text-txt font-mono break-all select-text">
                {{ state.fingerprint }}
              </dd>
              <template v-if="state.previousFingerprint">
                <dt class="text-txt-3">{{ t('旧指纹') }}</dt>
                <dd class="text-txt-3 font-mono break-all select-text">
                  {{ state.previousFingerprint }}
                </dd>
              </template>
            </dl>
            <template #footer>
              <div class="flex-1" />
              <AppButton @click="disconnect">{{ t('取消') }}</AppButton>
              <AppButton @click="acceptCertificate(false)">{{
                t('仅本次')
              }}</AppButton>
              <AppButton
                :variant="state.previousFingerprint ? 'danger' : 'primary'"
                @click="acceptCertificate(true)"
                >{{ t('总是信任') }}</AppButton
              >
            </template>
          </AppDialog>
        </Teleport>
      </section>
    </Teleport>
  </div>
</template>

<style scoped>
.rdp-fullscreen {
  position: fixed;
  inset: 0;
  height: auto;
  z-index: 40;
  border: 0;
  border-radius: 0;
  background: oklch(from var(--color-terminal) l c h / 1);
  box-shadow: none;
}

.rdp-fullscreen .terminal-header {
  position: absolute;
  inset: 0 0 auto;
  z-index: 1;
  background: inherit;
  transform: translateY(-100%);
  transition: transform 160ms ease-out;
}

.rdp-fullscreen .terminal-header::after {
  position: absolute;
  top: 100%;
  left: 50%;
  width: 5rem;
  height: 0.4rem;
  border-radius: 0 0 0.4rem 0.4rem;
  background: var(--color-txt-3);
  transform: translateX(-50%);
  content: '';
}

.rdp-fullscreen .terminal-header:hover,
.rdp-fullscreen .terminal-header:focus-within,
.rdp-fullscreen .terminal-header[data-menu-open='true'] {
  transform: translateY(0);
}

.rdp-fit {
  width: min(100cqw, calc(100cqh * var(--rdp-aspect)));
  height: auto;
}
</style>
