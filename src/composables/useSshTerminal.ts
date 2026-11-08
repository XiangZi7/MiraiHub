import { i18n } from '@/i18n'
import { translateNativeMessage } from '@/i18n/native'
/**
 * SSH 终端会话。
 *
 * 把 xterm.js 实例与一条 SSH 会话绑在一起：
 * 用户按键 → ssh_write，远端输出 → xterm.write，尺寸变化 → ssh_resize。
 *
 * 组件只负责给一个挂载容器和调用 connect/dispose，
 * 事件订阅、生命周期清理都在这里收口。
 */

import { onBeforeUnmount, reactive, toRefs } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import * as ssh from '@/api/ssh'
import type { SshConfig, SshSessionStatus, SshRouteProgress } from '@/types/ssh'
import { recordOutput, recordResize } from '@/utils/terminal-recording'
import { useXterm } from '@/composables/useXterm'

interface TerminalConnectOptions {
  terminalType?: string
  startupCommand?: string
}

type InputInterceptor = (data: string) => boolean
type SubmitHandler = (line: string) => void

export function useSshTerminal() {
  const { term, fitAddon, open, stopSettingsWatch } = useXterm(() => resize())

  // 响应式状态
  const state = reactive({
    // 会话 id，未连接时为空
    sessionId: '',
    // 当前连接请求的逐跳状态
    route: [] as SshRouteProgress[],
    // 连接状态，驱动工具条上的状态点
    status: 'disconnected' as SshSessionStatus,
    // 连接失败或异常断开的原因
    error: '',
    // 当前 shell 提示符后由用户输入的文本，仅用于前端补全，不写入历史。
    inputLine: '',
  })

  const { sessionId, status, error, inputLine, route } = toRefs(state)

  // 事件订阅的取消函数，断开时逐个调用
  let unlisteners: UnlistenFn[] = []
  // 连接是多段异步流程。关闭标签或改配置时递增序号，让尚未返回的旧流程自行回收。
  let operation = 0
  let disposed = false
  let inputInterceptor: InputInterceptor | undefined
  let submitHandler: SubmitHandler | undefined

  /**
   * 挂载 xterm 到容器。
   * 与 connect 分开：先把终端画出来，用户能看到"正在连接"，而不是一片空白。
   */
  function mount(container: HTMLElement): void {
    const terminal = open(container)

    // 用户输入直接转发给远端。未连接时丢弃：
    // 否则在断开的终端里敲字会攒下一堆无处可去的 invoke
    terminal.onResize(({ cols, rows }) => recordResize(terminal, cols, rows))
    terminal.onData(data => {
      // vim/top 等切到 alternate buffer 后，按键属于应用本身，不做 shell 补全。
      if (terminal.buffer.active.type === 'alternate') {
        state.inputLine = ''
        sendInput(data)
        return
      }

      if (inputInterceptor?.(data)) return

      sendInput(data)
    })
  }

  /** 建立连接并打开交互式 shell */
  async function connect(
    config: SshConfig,
    options: TerminalConnectOptions = {}
  ): Promise<void> {
    const terminal = term.value
    if (!terminal) throw new Error(i18n.global.t('终端尚未挂载'))

    // 配置在独立窗口里可能被修改后重新打开同一标签。
    // 先清掉旧会话，避免一个终端同时订阅两条连接的输出。
    if (state.sessionId) await disconnect()

    const currentOperation = ++operation
    state.route = []
    state.status = 'connecting'
    state.error = ''
    state.inputLine = ''

    let id = ''

    try {
      id = await ssh.connect(config, progress => {
        if (isActive(currentOperation)) state.route[progress.hop] = progress
      })

      if (!isActive(currentOperation)) {
        await discardSession(id)
        return
      }

      state.sessionId = id

      const stopStatus = await ssh.onStatus(id, payload => {
        if (state.sessionId !== id) return

        state.status = payload.status

        if (payload.status === 'disconnected') {
          // 断线原因是后端的中文文案，按当前语言翻译后再显示
          const reason = payload.reason
            ? translateNativeMessage(payload.reason)
            : ''
          state.error = reason
          // 没有退出码时把断线原因（远端关闭连接 / 网络超时 / 认证失败）写进提示行
          const suffix =
            payload.exitCode === null
              ? reason
                ? i18n.global.t('（{value0}）', { value0: reason })
                : ''
              : i18n.global.t('（退出码 {value0}）', {
                  value0: payload.exitCode,
                })
          terminal.writeln(
            `\r\n\x1b[90m${i18n.global.t('terminal.disconnected', { suffix })}\x1b[0m`
          )
        }
      })

      if (!isActive(currentOperation)) {
        stopStatus()
        await discardSession(id)
        return
      }

      unlisteners.push(stopStatus)

      // 输出通道随 openShell 一起交给后端，shell 启动瞬间的登录 banner 也能收到。
      // 断开或换会话后 sessionId 变了，迟到的输出直接丢弃。
      await ssh.openShell(
        id,
        {
          term: options.terminalType || 'xterm-256color',
          cols: terminal.cols,
          rows: terminal.rows,
        },
        data => {
          if (state.sessionId !== id) return
          recordOutput(terminal, data)
          terminal.write(data)
        }
      )

      if (!isActive(currentOperation)) {
        await discardSession(id)
        return
      }

      state.status = 'connected'
      syncedSize = `${id}:${terminal.cols}x${terminal.rows}`
      // 连接期间容器可能已变化，补一次适配
      resize()

      const startupCommand = options.startupCommand?.trim()
      if (startupCommand) await ssh.writeToShell(id, `${startupCommand}\r`)

      if (isActive(currentOperation)) terminal.focus()
    } catch (err) {
      // 关闭标签/改配置导致的过期流程不应覆盖新连接的状态或打印伪错误。
      if (!isActive(currentOperation)) {
        if (id) await discardSession(id)
        return
      }

      state.status = 'disconnected'
      // Shown as a notice above the terminal. Writing it into xterm breaks CJK
      // glyphs, because the cell grid cannot match the fallback font's width.
      state.error = translateNativeMessage(ssh.errorMessage(err))

      // TCP 已连上但订阅、PTY 或启动命令失败时，后端会话已经登记进管理器；
      // 只清前端订阅会把它永久留在会话表里，所以这里也要主动断开。
      // 订阅可能已部分建立，清掉避免泄漏
      await cleanup()

      if (id) await discardSession(id)

      throw err
    }
  }

  /**
   * 重新适配容器尺寸，并把新尺寸同步给远端。
   *
   * 防抖是因为拖拽窗口或面板会连续触发几十次，
   * 每次都往远端发 window_change 既浪费，也会让 vim/top 这类程序反复重绘闪烁。
   */
  // 本地 fit 用 rAF 合并到下一帧；远端同步单独防抖，并记住上次发送的尺寸
  let fitFrame = 0
  let syncedSize = ''

  // 容器尺寸变化：下一帧立即本地适配，再防抖把新尺寸同步给远端
  function resize(): void {
    cancelAnimationFrame(fitFrame)
    fitFrame = requestAnimationFrame(() => {
      fitFrame = 0
      const fit = fitAddon.value
      const terminal = term.value
      if (!fit || !terminal) return
      if (!terminal.element?.clientWidth || !terminal.element?.clientHeight)
        return
      fit.fit()
      syncRemoteSize()
    })
  }

  // 仅在 cols/rows 与上次发送不同时才通知远端
  const syncRemoteSize = useDebounceFn(() => {
    const terminal = term.value
    if (!terminal || state.status !== 'connected' || !state.sessionId) return
    const size = `${state.sessionId}:${terminal.cols}x${terminal.rows}`
    if (size === syncedSize) return
    syncedSize = size
    void ssh
      .resizeShell(state.sessionId, terminal.cols, terminal.rows)
      .catch(err => {
        syncedSize = ''
        console.warn('同步终端尺寸失败：', ssh.errorMessage(err))
      })
  }, 120)

  // 广播输入使用：原样写入远端，不参与补全的输入镜像
  function writeRaw(data: string): void {
    if (state.status !== 'connected' || !state.sessionId) return
    void ssh.writeToShell(state.sessionId, data).catch(handleWriteError)
  }

  /** 主动断开 */
  async function disconnect(): Promise<void> {
    operation += 1
    const id = state.sessionId

    await cleanup()
    state.status = 'disconnected'
    state.inputLine = ''

    if (id) await discardSession(id)
  }

  function isActive(currentOperation: number): boolean {
    return !disposed && operation === currentOperation
  }

  async function discardSession(id: string): Promise<void> {
    await ssh
      .disconnect(id)
      .catch(err => console.warn('断开会话失败：', ssh.errorMessage(err)))
  }

  /** 取消所有事件订阅，重置会话 id */
  async function cleanup(): Promise<void> {
    for (const unlisten of unlisteners) unlisten()

    unlisteners = []
    state.sessionId = ''
  }

  /** 写入失败通常意味着连接已断，提示一次即可，不必每个按键都刷屏 */
  function handleWriteError(err: unknown): void {
    if (state.status !== 'connected') return

    state.status = 'disconnected'
    state.error = translateNativeMessage(ssh.errorMessage(err))
  }

  /** 统一发送用户输入，并同步维护一份轻量的当前行镜像供补全使用。 */
  function sendInput(data: string): void {
    if (state.status !== 'connected' || !state.sessionId) return

    trackInput(data)
    void ssh.writeToShell(state.sessionId, data).catch(handleWriteError)
  }

  function trackInput(data: string): void {
    if (data === '\r' || data === '\n') {
      const submitted = state.inputLine
      state.inputLine = ''
      submitHandler?.(submitted)
      return
    }

    if (data === '\x7f' || data === '\b') {
      state.inputLine = [...state.inputLine].slice(0, -1).join('')
      return
    }

    if (data === '\x15') {
      state.inputLine = ''
      return
    }

    if (data === '\x17') {
      state.inputLine = state.inputLine.replace(/\S+\s*$/, '')
      return
    }

    // 历史、Home/End、光标左右移动后无法可靠镜像 readline 的行状态，暂时关闭本轮补全。
    if (data.startsWith('\x1b')) {
      state.inputLine = ''
      return
    }

    if (![...data].some(character => character < ' ' || character === '\x7f'))
      state.inputLine += data
  }

  function setInputInterceptor(handler?: InputInterceptor): void {
    inputInterceptor = handler
  }

  function setSubmitHandler(handler?: SubmitHandler): void {
    submitHandler = handler
  }

  // 组件卸载时必须清理：xterm 持有 DOM 引用，事件订阅握着 Tauri 侧的回调，
  // 漏掉任何一个都会在反复开关标签页时累积泄漏
  onBeforeUnmount(() => {
    stopSettingsWatch()
    cancelAnimationFrame(fitFrame)
    disposed = true
    void disconnect()
    term.value?.dispose()
  })

  return {
    term,
    route,
    sessionId,
    status,
    error,
    inputLine,
    mount,
    connect,
    disconnect,
    resize,
    sendInput,
    writeRaw,
    setInputInterceptor,
    setSubmitHandler,
  }
}
