import { i18n } from '@/i18n'
import { onBeforeUnmount, reactive, toRefs } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import * as localTerminal from '@/api/local-terminal'
import { errorMessage } from '@/api/ssh'
import { useXterm } from '@/composables/useXterm'
import type { LocalConnectionSettings } from '@/types/connection'
import type { LocalTerminalStatusEvent } from '@/types/local-terminal'
import type { SshSessionStatus } from '@/types/ssh'

export function useLocalTerminal() {
  const { term, fitAddon, open, stopSettingsWatch } = useXterm(() => resize())
  const state = reactive({
    sessionId: '',
    status: 'disconnected' as SshSessionStatus,
    error: '',
  })
  const { sessionId, status, error } = toRefs(state)

  let unlisteners: UnlistenFn[] = []
  let disposed = false
  let operation = 0

  function mount(container: HTMLElement): void {
    const terminal = open(container)
    terminal.onData(data => {
      if (state.status === 'connected' && state.sessionId)
        void localTerminal.write(state.sessionId, data).catch(handleWriteError)
    })
  }

  async function connect(settings: LocalConnectionSettings): Promise<void> {
    const terminal = term.value
    if (!terminal) throw new Error(i18n.global.t('终端尚未挂载'))
    // PTY 使用回车提交命令；统一多行输入，避免 Windows CRLF 被提交两次。
    const startupCommand = settings.startupCommand
      ?.trim()
      .replace(/\r\n|\n/g, '\r')

    await disconnect()
    const currentOperation = ++operation
    state.status = 'connecting'
    state.error = ''

    const pendingStatus: LocalTerminalStatusEvent[] = []

    try {
      const stopStatus = await localTerminal.onStatus(payload => {
        if (!state.sessionId) {
          pendingStatus.push(payload)
          return
        }
        if (payload.sessionId === state.sessionId) applyStatus(payload)
      })
      if (disposed || operation !== currentOperation) {
        stopStatus()
        return
      }
      unlisteners.push(stopStatus)

      // 输出通道只属于这一次创建，create 返回前的提示符也直接写入；
      // 断开、重连或启动失败清理后停止接收，迟到的输出直接丢弃。
      let receiving = true
      unlisteners.push(() => {
        receiving = false
      })
      const id = await localTerminal.create(
        {
          shell: settings.shell,
          workingDirectory: settings.workingDirectory,
          cols: terminal.cols,
          rows: terminal.rows,
        },
        data => {
          if (receiving) terminal.write(data)
        }
      )

      if (disposed || operation !== currentOperation) {
        await localTerminal.close(id).catch(() => {})
        return
      }

      state.sessionId = id
      state.status = 'connected'
      pendingStatus
        .filter(payload => payload.sessionId === id)
        .forEach(applyStatus)
      if (state.status === 'connected' && startupCommand)
        await localTerminal.write(id, `${startupCommand}\r`)

      if (!disposed && operation === currentOperation) terminal.focus()
    } catch (err) {
      if (disposed || operation !== currentOperation) return

      state.status = 'disconnected'
      state.error = errorMessage(err)
      terminal.writeln(
        `\r\n\x1b[31m${i18n.global.t('terminal.localStartFailed', { error: state.error })}\x1b[0m`
      )
      const id = state.sessionId
      await cleanup()
      if (id) await localTerminal.close(id).catch(() => {})
      throw err
    }
  }

  function applyStatus(payload: LocalTerminalStatusEvent): void {
    state.status = payload.status
    if (payload.status !== 'disconnected') return

    state.error = payload.reason ?? ''
    const suffix =
      payload.exitCode === null
        ? ''
        : i18n.global.t('（退出码 {value0}）', { value0: payload.exitCode })
    term.value?.writeln(
      `\r\n\x1b[90m${i18n.global.t('terminal.localExit', { suffix })}\x1b[0m`
    )
  }

  const resize = useDebounceFn(() => {
    const terminal = term.value
    const fit = fitAddon.value
    if (!terminal || !fit) return

    if (!terminal.element?.clientWidth || !terminal.element?.clientHeight)
      return
    const cols = terminal.cols,
      rows = terminal.rows
    fit.fit()
    if (terminal.cols === cols && terminal.rows === rows) return
    if (state.status === 'connected' && state.sessionId) {
      void localTerminal
        .resize(state.sessionId, terminal.cols, terminal.rows)
        .catch(err => console.warn('同步本地终端尺寸失败：', errorMessage(err)))
    }
  }, 120)

  async function disconnect(): Promise<void> {
    operation += 1
    const id = state.sessionId
    await cleanup()
    state.status = 'disconnected'
    if (id) await localTerminal.close(id).catch(() => {})
  }

  async function cleanup(): Promise<void> {
    for (const unlisten of unlisteners) unlisten()
    unlisteners = []
    state.sessionId = ''
  }

  function handleWriteError(err: unknown): void {
    if (state.status !== 'connected') return
    state.status = 'disconnected'
    state.error = errorMessage(err)
    term.value?.writeln(
      `\r\n\x1b[31m${i18n.global.t('terminal.localWriteFailed', { error: state.error })}\x1b[0m`
    )
  }

  onBeforeUnmount(() => {
    stopSettingsWatch()
    disposed = true
    void disconnect()
    term.value?.dispose()
  })

  return { term, sessionId, status, error, mount, connect, disconnect, resize }
}
