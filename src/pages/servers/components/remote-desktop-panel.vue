<script setup lang="ts">
import {
  computed,
  nextTick,
  onBeforeUnmount,
  reactive,
  toRefs,
  useTemplateRef,
  watch,
} from 'vue'
import {
  useDebounceFn,
  useElementSize,
  useEventListener,
  useTimeoutFn,
} from '@vueuse/core'
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
const toolbarHeader = useTemplateRef<HTMLElement>('toolbarHeader')
const { width: viewportWidth, height: viewportHeight } =
  useElementSize(viewport)
const canFullscreen = IS_TAURI || document.fullscreenEnabled
type Zoom = 'fit' | 'fill' | number
type DisplayMenu = 'resolution' | 'zoom' | 'more'
interface ToolbarMenuContext {
  id: number
  connectionId: string
  sessionId: string
  menu: DisplayMenu
}
// 响应式状态
const state = reactive({
  // 当前连接、凭据补齐或证书核对阶段。
  phase: 'idle' as
    'idle' | 'setup' | 'connecting' | 'certificate' | 'connected',
  // 当前会话的主机和端口，供顶栏与证书对话框展示。
  endpoint: '',
  // 本次连接等待用户核对的证书指纹。
  fingerprint: '',
  // 已记住但与本次连接不一致的证书指纹。
  previousFingerprint: '',
  // 是否已经收到并绘制当前会话的首帧。
  frameReady: false,
  // 服务端当前实际桌面宽度。
  width: 0,
  // 服务端当前实际桌面高度。
  height: 0,
  // 当前面板是否占用会话全屏区域。
  fullscreen: false,
  // 鼠标离开后在缓冲时间内继续显示全屏工具栏。
  toolbarVisible: false,
  // 鼠标是否处于工具栏按钮或拉手范围内。
  toolbarHovered: false,
  // 鼠标是否处于独立的顶部感应区，跨区域移动时不互相覆盖悬停状态。
  toolbarTriggerHovered: false,
  // 键盘焦点留在工具栏时保持可见，不在导航途中收起。
  toolbarFocused: false,
  // 本标签页是否固定显示全屏工具栏，退出再进入全屏时保留选择。
  toolbarPinned: false,
  // 本标签页临时选择的远端分辨率。
  resolution: undefined as RdpResolution | 'auto' | undefined,
  // 本标签页普通窗口中的临时缩放模式。
  zoom: undefined as Zoom | undefined,
  // 全屏缩放与普通窗口独立，默认等比适应并保留用户选择。
  fullscreenZoom: 'fit' as Zoom,
  // 当前展开的显示设置菜单。
  menu: null as DisplayMenu | null,
  // 每次打开锁定连接和会话，旧菜单回调不能影响后来打开的菜单。
  menuContext: null as ToolbarMenuContext | null,
  // 显示菜单的触发按钮，用于点击外部与焦点管理。
  menuTrigger: null as HTMLElement | null,
  // 显示菜单相对于窗口的横坐标。
  menuX: 0,
  // 显示菜单相对于窗口的纵坐标。
  menuY: 0,
  // 服务端尚未应用请求的分辨率，可通过重连回退。
  pendingResolution: false,
})
const {
  phase,
  endpoint,
  fingerprint,
  previousFingerprint,
  frameReady,
  width,
  height,
  fullscreen,
  toolbarPinned,
  menu,
  menuTrigger,
  menuX,
  menuY,
} = toRefs(state)
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
const zoomControlLabel = computed(
  () => `${t('画面缩放')} · ${zoomLabel(zoom.value)}`
)
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
    id: `zoom:${mode}`,
    label: zoomLabel(mode),
    checked: zoom.value === mode,
  }))
)
// 窄工具栏的更多菜单复用相同的缩放与分辨率选项。
const moreItems = computed<ContextMenuItem[]>(() => [
  ...(state.frameReady
    ? [
        {
          id: 'more-resolution',
          label: t('远端分辨率'),
          icon: 'lucide:monitor',
          children: resolutionItems.value,
        },
        {
          id: 'more-zoom',
          label: zoomControlLabel.value,
          icon: 'lucide:scaling',
          children: zoomItems.value,
        },
      ]
    : []),
  ...(state.phase === 'connected'
    ? [
        {
          id: 'more-ctrl-alt-delete',
          label: t('发送 Ctrl+Alt+Delete'),
          icon: 'lucide:keyboard',
        },
      ]
    : []),
  {
    id: 'more-edit',
    label: t('编辑连接配置'),
    icon: 'lucide:settings-2',
    separatorBefore: state.frameReady || state.phase === 'connected',
  },
  ...(state.fullscreen
    ? [
        {
          id: 'more-pin',
          label: state.toolbarPinned
            ? t('取消固定全屏工具栏')
            : t('固定全屏工具栏'),
          icon: state.toolbarPinned ? 'lucide:pin-off' : 'lucide:pin',
          checked: state.toolbarPinned,
        },
      ]
    : []),
])
const toolbarMenuItems = computed(() => {
  if (state.menu === 'more') return moreItems.value
  return state.menu === 'zoom' ? zoomItems.value : resolutionItems.value
})
const toolbarMenuLabel = computed(() => {
  if (state.menu === 'more') return t('更多')
  return state.menu === 'zoom' ? t('画面缩放') : t('远端分辨率')
})
// 事件处理闭包与菜单实例共用打开时的快照，旧实例的 select / close 不接管新菜单。
const toolbarMenuHandlers = computed(() => {
  const context = state.menuContext
  return {
    select: (id: string) => selectToolbarOption(id, context),
    close: () => closeToolbarMenu(context),
  }
})

// 菜单代次只控制工具栏，不改变原生连接或输入队列。
let menuSequence = 0
// 会话生命周期与原生异步边界。
let sessionId = ''
let sessionKey = ''
let lastRequested: RdpResolution | undefined
let disposed = false
let connectionGeneration = 0
let stoppingSession: Promise<void> = Promise.resolve()
const startingSessions = new Map<string, Promise<void>>()
const stoppingSessions = new Map<string, Promise<void>>()
// 全屏请求与窗口恢复状态，允许在进入过程中撤销请求。
let windowWasFullscreen = false
let fullscreenBusy = false
let fullscreenRequested = false
let fullscreenTransition: Promise<void> | undefined
// 输入队列只归属当前会话，旧 IPC 完成时不得接管新队列。
let inputFrame = 0
let flushingSession = ''
let inputFlush: Promise<void> | undefined
let capturedPointer: number | undefined
const pressedButtons = new Set<number>()
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
  flushingSession = ''
  inputFlush = undefined
  clearPointerCapture()
  state.phase = 'idle'
  state.endpoint = ''
  state.fingerprint = ''
  state.previousFingerprint = ''
  state.frameReady = false
  state.width = 0
  state.height = 0
  state.pendingResolution = false
  state.menu = null
  void setDesktopFullscreen(false)
  const surface = canvas.value
  surface?.getContext('2d')?.clearRect(0, 0, surface.width, surface.height)
  emit('status', 'disconnected', '')
}

/** 先取消原生任务，若启动回执尚未到达则等其完成后再停止，防止晚启动泄漏。 */
function stopSession(id: string): Promise<void> {
  const existing = stoppingSessions.get(id)
  if (existing) return existing
  const starting = startingSessions.get(id)
  const stopped = (async () => {
    await stopRdp(id).catch(() => undefined)
    if (starting) {
      await starting.catch(() => undefined)
      await stopRdp(id).catch(() => undefined)
    }
  })()
  stoppingSessions.set(id, stopped)
  stoppingSession = Promise.all([stoppingSession, stopped]).then(
    () => undefined
  )
  void stopped.then(() => stoppingSessions.delete(id))
  return stopped
}

/** 立即还原面板，并将旧会话停止纳入下一次启动必须等待的屏障。 */
function closeSession(): Promise<void> {
  const id = sessionId
  resetSession()
  if (id) void stopSession(id)
  return stoppingSession
}

/** 断开或取消当前 IronRDP 会话，同时使等待中的连接与重连流程失效。 */
async function disconnect(): Promise<void> {
  connectionGeneration++
  await closeSession()
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
    connectionGeneration++
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
  state.pendingResolution =
    !!lastRequested &&
    (desktopWidth !== lastRequested.width ||
      desktopHeight !== lastRequested.height)
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

/** 为用户的连接请求分配代次，取消可使 nextTick 中尚未启动的请求失效。 */
async function connect(): Promise<void> {
  const generation = ++connectionGeneration
  await connectSession(generation)
}

/** 使用当前代次的凭据打开会话，并等待旧停止完成后才创建新的原生会话。 */
async function connectSession(generation: number): Promise<void> {
  await nextTick()
  if (disposed || generation !== connectionGeneration) return
  const current = profile.value
  const credential = current?.settings.rdpCredential
  if (!current?.username || !credential) {
    void closeSession()
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
  if (sessionId) void closeSession()
  await stoppingSession
  if (disposed || generation !== connectionGeneration) return

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
    const starting = startRdp(
      request,
      event => handleEvent(id, event),
      frame => draw(id, frame)
    )
    startingSessions.set(id, starting)
    await starting
  } catch (error) {
    if (sessionId !== id) return
    void closeSession()
    notifyError(errorMessage(error))
    return
  } finally {
    startingSessions.delete(id)
  }
  if (sessionId !== id) await stopSession(id)
}

// 全屏工具栏：保留缓冲时间，悬停、下拉菜单、键盘焦点和固定模式优先于自动隐藏。
const toolbarInteractionActive = computed(
  () =>
    state.toolbarHovered ||
    state.toolbarTriggerHovered ||
    state.toolbarFocused ||
    state.toolbarPinned ||
    state.menu !== null
)
const toolbarExpanded = computed(
  () =>
    !state.fullscreen || state.toolbarVisible || toolbarInteractionActive.value
)

/** 鼠标离开一秒后才收起；触发前再次确认交互状态，过期回调不能隐藏正在操作的菜单。 */
const toolbarHide = useTimeoutFn(
  () => {
    if (!disposed && state.fullscreen && !toolbarInteractionActive.value)
      state.toolbarVisible = false
  },
  1000,
  { immediate: false }
)

/** 从本次离开时刻重新计时，菜单、焦点和固定模式仍活跃时取消自动收起。 */
function scheduleToolbarHide(): void {
  toolbarHide.stop()
  if (
    state.fullscreen &&
    state.toolbarVisible &&
    !toolbarInteractionActive.value
  )
    toolbarHide.start()
}

/** 顶部感应区与工具栏各自记录悬停，进入任一区域立即显示并撤销旧的收起任务。 */
function showFullscreenToolbar(source: 'header' | 'trigger'): void {
  if (!state.fullscreen) return
  if (source === 'header') state.toolbarHovered = true
  else state.toolbarTriggerHovered = true
  state.toolbarVisible = true
  toolbarHide.stop()
}

/** 离开当前区域后仍给鼠标一秒回到按钮，跨越感应区或移入下拉菜单不会立即消失。 */
function leaveFullscreenToolbar(source: 'header' | 'trigger'): void {
  if (source === 'header') state.toolbarHovered = false
  else state.toolbarTriggerHovered = false
  scheduleToolbarHide()
}

/** 键盘导航进入工具栏时保持显示，不因鼠标位置在远端画布上而收起按钮。 */
function focusFullscreenToolbar(): void {
  if (!state.fullscreen) return
  state.toolbarFocused = true
  state.toolbarVisible = true
  toolbarHide.stop()
}

/** 工具栏按钮之间移动焦点不收起，真正离开后再按菜单和固定状态安排隐藏。 */
function blurFullscreenToolbar(event: FocusEvent): void {
  if (toolbarHeader.value?.contains(event.relatedTarget as Node)) return
  state.toolbarFocused = false
  scheduleToolbarHide()
}

/** 切换本标签页的固定显示偏好，操作完成后恢复远端键盘焦点而不重置缩放或连接。 */
function toggleToolbarPinned(): void {
  if (!state.fullscreen) return
  const id = sessionId
  state.toolbarPinned = !state.toolbarPinned
  void nextTick(() => {
    if (
      props.active &&
      state.fullscreen &&
      state.frameReady &&
      sessionId === id
    )
      canvas.value?.focus()
  })
}

// 进入全屏先展示工具栏便于发现操作，退出时撤销计时；固定偏好留在本标签页。
watch(
  () => state.fullscreen,
  fullscreen => {
    toolbarHide.stop()
    state.toolbarHovered = false
    state.toolbarTriggerHovered = false
    state.toolbarFocused = false
    state.toolbarVisible = fullscreen
    if (fullscreen) scheduleToolbarHide()
  },
  { flush: 'sync' }
)

// 下拉菜单即使 Teleport 到工具栏之外也保持顶栏，关闭或取消固定后再留出完整缓冲时间。
watch(
  [() => state.menu, () => state.toolbarPinned],
  () => {
    if (!state.fullscreen) return
    if (toolbarInteractionActive.value) {
      toolbarHide.stop()
      state.toolbarVisible = true
    } else scheduleToolbarHide()
  },
  { flush: 'sync' }
)

// 全屏与显示设置。
/** 串行应用最新全屏请求，进入中取消也会恢复原窗口状态，且不覆盖用户缩放。 */
async function setDesktopFullscreen(enabled: boolean): Promise<void> {
  fullscreenRequested =
    enabled && !disposed && props.active && state.phase === 'connected'
  state.menu = null
  if (fullscreenBusy) return fullscreenTransition
  if (fullscreenRequested === state.fullscreen) return
  fullscreenBusy = true
  fullscreenTransition = (async () => {
    try {
      while (true) {
        if (fullscreenRequested !== state.fullscreen) {
          if (fullscreenRequested) {
            windowWasFullscreen = await isWindowFullscreen()
            if (!fullscreenRequested) continue
            await setWindowFullscreen(true)
            state.fullscreen = true
          } else {
            await setWindowFullscreen(windowWasFullscreen)
            state.fullscreen = false
          }
        } else {
          await nextTick()
          if (fullscreenRequested !== state.fullscreen) continue
          if (!disposed && props.active && state.frameReady)
            canvas.value?.focus()
          break
        }
      }
    } catch (error) {
      fullscreenRequested = false
      state.fullscreen = false
      toast.error({
        title: t('切换全屏失败'),
        description: errorMessage(error),
      })
    } finally {
      fullscreenBusy = false
      fullscreenTransition = undefined
    }
  })()
  await fullscreenTransition
}

/** 切换最新的全屏意图，连续点击或 F11 可取消尚未完成的进入操作。 */
function toggleFullscreen(): void {
  void setDesktopFullscreen(!fullscreenRequested)
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
  if (!IS_TAURI && !document.fullscreenElement) {
    fullscreenRequested = false
    state.fullscreen = false
  }
})

/** 以顶栏按钮为锚点打开共用菜单，并锁定本次菜单所属连接和会话。 */
function openDisplayMenu(menu: DisplayMenu, event: MouseEvent): void {
  if (!props.active) return
  if (state.menu === menu) {
    state.menu = null
    return
  }
  const button = event.currentTarget as HTMLElement
  const rect = button.getBoundingClientRect()
  state.menuTrigger = button
  state.menuX = rect.left
  state.menuY = rect.bottom + 5
  state.menuContext = {
    id: ++menuSequence,
    connectionId: props.connection.id,
    sessionId,
    menu,
  }
  state.menu = menu
}

/** 只关闭仍属于原快照的菜单，避免旧菜单的 close 回调覆盖后来打开的菜单。 */
function closeToolbarMenu(context: ToolbarMenuContext | null): void {
  if (context === state.menuContext) state.menu = null
}

/** 路由当前菜单的显示选项与次要动作，失活或切换目标后的旧选择不再执行。 */
function selectToolbarOption(
  id: string,
  context: ToolbarMenuContext | null
): void {
  if (
    !context ||
    context !== state.menuContext ||
    !props.active ||
    state.menu !== context.menu ||
    props.connection.id !== context.connectionId ||
    sessionId !== context.sessionId
  )
    return
  const selected = toolbarMenuItems.value
    .flatMap(item => item.children ?? [item])
    .find(item => item.id === id)
  if (!selected || selected.disabled) return
  if (id.startsWith('zoom:'))
    selectDisplayOption(id.slice('zoom:'.length), 'zoom')
  else if (id === 'more-ctrl-alt-delete') sendCtrlAltDelete()
  else if (id === 'more-edit') editConfiguration()
  else if (id === 'more-pin') toggleToolbarPinned()
  else selectDisplayOption(id, 'resolution')
}

/** 应用菜单选择的远端分辨率或当前窗口模式的画面缩放。 */
function selectDisplayOption(id: string, group: 'resolution' | 'zoom'): void {
  if (group === 'zoom') {
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

// 键鼠输入与会话隔离。
/** 逐批有序排空当前会话输入，失焦时立即发送，旧 IPC 不阻塞或清理新会话。 */
function flushInput(): Promise<void> {
  cancelAnimationFrame(inputFrame)
  inputFrame = 0
  const id = sessionId
  if (!id || !pendingInputs.length) return inputFlush ?? Promise.resolve()
  if (flushingSession === id) return inputFlush ?? Promise.resolve()
  flushingSession = id
  inputFlush = (async () => {
    try {
      while (sessionId === id && pendingInputs.length)
        await sendRdpInput(id, pendingInputs.splice(0, 64))
    } catch (error) {
      if (sessionId === id) {
        void disconnect()
        notifyError(errorMessage(error))
      }
    } finally {
      if (flushingSession === id) {
        flushingSession = ''
        inputFlush = undefined
      }
    }
  })()
  return inputFlush
}

/** 下一帧合并连续移动；隐藏窗口或正在发送时不依赖暂停的 RAF。 */
function queueInput(event: RdpInput): void {
  if (state.phase !== 'connected' || !sessionId) return
  if (event.type === 'move' && pendingInputs.at(-1)?.type === 'move')
    pendingInputs[pendingInputs.length - 1] = event
  else pendingInputs.push(event)
  if (document.hidden) void flushInput()
  else if (flushingSession !== sessionId && !inputFrame)
    inputFrame = requestAnimationFrame(() => void flushInput())
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

/** 清除本地按钮和捕获记录，主动释放捕获时忽略浏览器已完成的释放。 */
function clearPointerCapture(): void {
  const pointer = capturedPointer
  capturedPointer = undefined
  pressedButtons.clear()
  const surface = canvas.value
  if (pointer === undefined || !surface?.hasPointerCapture(pointer)) return
  try {
    surface.releasePointerCapture(pointer)
  } catch {
    // 指针取消或窗口失焦时，浏览器可能已先释放捕获。
  }
}

/** 发送鼠标按下或释放，最后一个按钮松开后归还捕获，拖出画布仍可释放。 */
function handleButton(event: PointerEvent, pressed: boolean): void {
  const position = pointerPosition(event)
  if (!position || event.button < 0 || event.button > 4) return
  if (pressed) {
    if (capturedPointer !== undefined && capturedPointer !== event.pointerId)
      releaseInput()
    canvas.value?.focus()
    canvas.value?.setPointerCapture(event.pointerId)
    capturedPointer = event.pointerId
    pressedButtons.add(event.button)
  } else pressedButtons.delete(event.button)
  queueInput({ type: 'button', button: event.button, pressed, ...position })
  if (!pressed && !pressedButtons.size) clearPointerCapture()
}

/** 非主动丢失捕获时释放全部键鼠输入，避免拖动中断留下远端按下状态。 */
function handleLostPointerCapture(event: PointerEvent): void {
  if (capturedPointer === event.pointerId) releaseInput()
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

/** 失焦或指针中断时立即有序释放全部键鼠，不等待隐藏窗口中暂停的 RAF。 */
function releaseInput(): void {
  clearPointerCapture()
  queueInput({ type: 'releaseAll' })
  void flushInput()
}

/** 用专用原生消息发送安全组合键，由 Rust 先释放旧输入再生成完整序列。 */
function sendCtrlAltDelete(): void {
  const id = sessionId
  clearPointerCapture()
  queueInput({ type: 'ctrlAltDelete' })
  void flushInput()
  void nextTick(() => {
    if (props.active && sessionId === id && state.frameReady)
      canvas.value?.focus()
  })
}

/** 处理标签栏操作，重连保留同一代次，等待停止期间的取消不能重新启动。 */
async function actionFor(id: string, action: string): Promise<void> {
  if (id !== props.connection.id) return
  if (action === 'disconnect') await disconnect()
  else if (action === 'reconnect') {
    const generation = ++connectionGeneration
    await closeSession()
    if (disposed || generation !== connectionGeneration) return
    await connectSession(generation)
  }
}

// 全局失焦与隐藏通知独立于画布焦点，覆盖切换窗口和最小化到托盘。
useEventListener(window, 'blur', releaseInput)
useEventListener(document, 'visibilitychange', () => {
  if (document.hidden) releaseInput()
})

// 生命周期监听与父工作区操作入口。
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

/** 合并窗口尺寸变化，并复用待应用标记为不支持动态分辨率的服务端提供重连回退。 */
const resizeRemote = useDebounceFn(() => {
  if (
    !props.active ||
    !Number.isFinite(viewportWidth.value) ||
    !Number.isFinite(viewportHeight.value) ||
    viewportWidth.value <= 0 ||
    viewportHeight.value <= 0 ||
    state.phase !== 'connected'
  )
    return
  const size = requestedDesktop.value
  state.pendingResolution =
    state.frameReady &&
    (size.width !== state.width || size.height !== state.height)
  if (
    size.width === lastRequested?.width &&
    size.height === lastRequested.height
  )
    return
  lastRequested = size
  queueInput({ type: 'resize', ...size })
}, 350)
watch(
  [viewportWidth, viewportHeight, () => state.phase, () => props.active],
  () => void resizeRemote()
)
// 菜单只属于打开时的连接，切换配置目标后立即关闭，不触碰原连接生命周期。
watch(
  () => props.connection.id,
  () => {
    state.menu = null
  },
  { flush: 'sync' }
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
// 卸载时立即取消顶栏隐藏计时，不让回调作用于关闭的标签或下一次全屏会话。
onBeforeUnmount(() => {
  toolbarHide.stop()
  disposed = true
  void setDesktopFullscreen(false)
  void disconnect()
})
</script>

<template>
  <div class="contents">
    <Teleport
      to="body"
      :disabled="!fullscreen"
    >
      <section
        class="terminal-pane pane h-full"
        :class="{ 'rdp-fullscreen': fullscreen }"
        :aria-busy="desktopLoading"
      >
        <!-- 全屏顶部感应区：从屏幕顶边即可找回工具栏，不占远端画面的布局空间。 -->
        <div
          v-if="fullscreen"
          class="rdp-toolbar-trigger"
          aria-hidden="true"
          @pointerenter="showFullscreenToolbar('trigger')"
          @pointerleave="leaveFullscreenToolbar('trigger')"
          @pointercancel="leaveFullscreenToolbar('trigger')"
          @pointerdown.prevent="showFullscreenToolbar('trigger')"
        />
        <!-- 全屏顶栏：悬停、菜单和键盘焦点期间保持展开，离开后缓冲一秒再收起。 -->
        <header
          ref="toolbarHeader"
          class="terminal-header"
          :data-menu-open="menu !== null"
          :data-toolbar-visible="toolbarExpanded"
          @pointerenter="showFullscreenToolbar('header')"
          @pointerleave="leaveFullscreenToolbar('header')"
          @focusin="focusFullscreenToolbar"
          @focusout="blurFullscreenToolbar"
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
              :glow="phase === 'connected'"
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
            :title="endpoint || endpointOf(profile ?? connection)"
          >
            {{ profile?.name ?? connection.name }}
          </span>
          <!-- 显示控制区：分辨率和画面缩放相邻，各自打开选项。 -->
          <div
            v-if="frameReady"
            class="rdp-toolbar-secondary flex shrink-0 items-center gap-1"
            role="group"
            :aria-label="t('远程桌面显示')"
          >
            <!-- 分辨率按钮：显示实际远端像素尺寸并选择远端分辨率。 -->
            <button
              type="button"
              class="text-txt-3 hover:bg-hover hover:text-txt flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[11px]"
              :title="t('远端分辨率')"
              :aria-label="t('远端分辨率')"
              aria-haspopup="menu"
              :aria-expanded="menu === 'resolution'"
              @click="openDisplayMenu('resolution', $event)"
            >
              <AppIcon
                name="lucide:monitor"
                :size="12"
              />
              {{ width }} × {{ height }}
              <AppIcon
                name="lucide:chevron-down"
                :size="11"
              />
            </button>
            <!-- 画面缩放按钮：紧邻分辨率，显示当前模式并打开缩放选项。 -->
            <button
              type="button"
              class="text-txt-3 hover:bg-hover hover:text-txt flex h-6 items-center gap-1 rounded px-1.5 font-mono text-[11px] whitespace-nowrap"
              :title="zoomControlLabel"
              :aria-label="zoomControlLabel"
              aria-haspopup="menu"
              :aria-expanded="menu === 'zoom'"
              @click="openDisplayMenu('zoom', $event)"
            >
              <AppIcon
                name="lucide:scaling"
                :size="12"
              />
              {{ zoomLabel(zoom) }}
              <AppIcon
                name="lucide:chevron-down"
                :size="11"
              />
            </button>
          </div>
          <div class="ml-auto flex shrink-0 items-center gap-1">
            <!-- 全屏工具栏固定按钮：可关闭自动收起，偏好只属于当前远程桌面标签。 -->
            <IconButton
              v-if="fullscreen"
              class="rdp-toolbar-secondary"
              :icon="toolbarPinned ? 'lucide:pin-off' : 'lucide:pin'"
              :size="14"
              :title="
                toolbarPinned ? t('取消固定全屏工具栏') : t('固定全屏工具栏')
              "
              :aria-pressed="toolbarPinned"
              :class="toolbarPinned && 'text-accent bg-accent/10'"
              @click="toggleToolbarPinned"
            />
            <IconButton
              v-if="phase === 'connected'"
              icon="lucide:keyboard"
              class="rdp-toolbar-secondary"
              :size="14"
              :title="t('发送 Ctrl+Alt+Delete')"
              @click="sendCtrlAltDelete"
            />
            <!-- 窄面板更多入口：次要动作在共用菜单中可达，全屏与断开保留直接按钮。 -->
            <IconButton
              icon="lucide:ellipsis"
              class="rdp-toolbar-more"
              :size="14"
              :title="t('更多')"
              aria-haspopup="menu"
              :aria-expanded="menu === 'more'"
              @click="openDisplayMenu('more', $event)"
            />
            <IconButton
              v-if="canFullscreen && (frameReady || fullscreen)"
              :icon="fullscreen ? 'lucide:minimize' : 'lucide:maximize'"
              :size="14"
              :title="t('全屏 / 退出')"
              @click="toggleFullscreen"
            />
            <IconButton
              icon="lucide:settings-2"
              class="rdp-toolbar-secondary"
              :size="14"
              :title="t('编辑连接配置')"
              @click="editConfiguration"
            />
            <IconButton
              v-if="endpoint"
              icon="lucide:unplug"
              :size="14"
              :title="phase === 'connected' ? t('断开连接') : t('取消')"
              @click="disconnect"
            />
          </div>
        </header>

        <!-- 远程桌面画布：绘制 IronRDP 的更新并收集键鼠事件。 -->
        <div
          ref="viewport"
          class="terminal-output [container-type:size] flex"
          :class="{
            'overflow-auto': frameReady && typeof zoom === 'number',
          }"
          :aria-busy="desktopLoading"
        >
          <canvas
            v-show="phase === 'connected' && frameReady"
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
                    width: (width * zoom) / 100 + 'px',
                    height: (height * zoom) / 100 + 'px',
                  }
                : {
                    '--rdp-aspect': height ? width / height : 1,
                  }
            "
            @keydown="handleKey($event, true)"
            @keyup="handleKey($event, false)"
            @pointermove="handleMove"
            @pointerdown.prevent="handleButton($event, true)"
            @pointerup.prevent="handleButton($event, false)"
            @pointercancel="releaseInput"
            @lostpointercapture="handleLostPointerCapture"
            @wheel.prevent="handleWheel"
            @contextmenu.prevent
            @blur="releaseInput"
          />

          <!-- 未连接状态：旧记录只引导到统一配置窗口，普通断开后可直接重连。 -->
          <div
            v-if="phase === 'idle' || phase === 'setup'"
            class="m-auto flex max-w-72 flex-col items-center gap-3 p-4 text-center"
          >
            <AppIcon
              name="lucide:monitor"
              :size="22"
              class="text-txt-3"
            />
            <p class="text-txt-3 text-xs">
              {{
                phase === 'setup'
                  ? t('请在配置窗口保存远程桌面凭据')
                  : t('远程桌面已断开')
              }}
            </p>
            <AppButton
              v-if="phase === 'setup'"
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
              phase === 'connected' ? t('正在加载远程桌面…') : t('连接中…')
            "
          />
        </div>

        <!-- 工具栏共用菜单：实例和回调锁定打开时的连接与会话，旧选项不能误操作新目标。 -->
        <AppContextMenu
          :key="state.menuContext?.id"
          :open="active && menu !== null"
          :x="menuX"
          :y="menuY"
          :items="toolbarMenuItems"
          :label="toolbarMenuLabel"
          :trigger="menuTrigger"
          appearance="bubble"
          @close="toolbarMenuHandlers.close"
          @select="toolbarMenuHandlers.select"
        />

        <Teleport to="body">
          <AppDialog
            v-if="active && phase === 'certificate'"
            :title="
              previousFingerprint
                ? t('远程桌面证书已变化')
                : t('核对远程桌面证书')
            "
            :description="t('正在连接 {value0}', { value0: endpoint })"
            @close="disconnect"
          >
            <p
              v-if="previousFingerprint"
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
                {{ previousFingerprint ? t('新指纹') : t('指纹') }}
              </dt>
              <dd class="text-txt font-mono break-all select-text">
                {{ fingerprint }}
              </dd>
              <template v-if="previousFingerprint">
                <dt class="text-txt-3">{{ t('旧指纹') }}</dt>
                <dd class="text-txt-3 font-mono break-all select-text">
                  {{ previousFingerprint }}
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
                :variant="previousFingerprint ? 'danger' : 'primary'"
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

.rdp-toolbar-trigger {
  position: absolute;
  inset: 0 0 auto;
  z-index: 1;
  height: 6px;
  cursor: pointer;
}

.rdp-fullscreen .terminal-header {
  position: absolute;
  inset: 0 0 auto;
  width: min(100%, 880px);
  margin-inline: auto;
  z-index: 2;
  background: inherit;
  transform: translateY(-100%);
  transition: transform 160ms ease-out;
}

.rdp-fullscreen .terminal-header::after {
  position: absolute;
  top: 100%;
  left: 50%;
  width: 8rem;
  height: 0.625rem;
  border-radius: 0 0 0.4rem 0.4rem;
  background: var(--color-txt-3);
  transform: translateX(-50%);
  content: '';
}

.rdp-fullscreen .terminal-header[data-toolbar-visible='true'] {
  transform: translateY(0);
}

@media (prefers-reduced-motion: reduce) {
  .rdp-fullscreen .terminal-header {
    transition: none;
  }
}

.rdp-fit {
  width: min(100cqw, calc(100cqh * var(--rdp-aspect)));
  height: auto;
}

.rdp-toolbar-more {
  display: none;
}

/* 跟随所属远程桌面面板宽度，而不是窗口宽度，分屏时同样保留关键操作。 */
@container terminal (max-width: 560px) {
  .rdp-toolbar-secondary {
    display: none;
  }
  .rdp-toolbar-more {
    display: inline-flex;
  }
  .terminal-endpoint {
    flex: 1;
    max-width: none;
  }
}
</style>
