import { onBeforeUnmount, reactive, shallowRef, toRefs, watch } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import * as localTerminal from '@/api/local-terminal'
import { errorMessage } from '@/api/ssh'
import { TERMINAL_THEME } from '@/constants/terminal'
import { settingNumber, settings } from '@/composables/useSettings'
import type { LocalConnectionSettings } from '@/types/connection'
import type {
  LocalTerminalOutputEvent,
  LocalTerminalStatusEvent,
} from '@/types/local-terminal'
import type { SshSessionStatus } from '@/types/ssh'

function terminalFontFamily(): string {
  const families: Record<string, string> = {
    'jetbrains-mono': '"JetBrains Mono Variable", ui-monospace, monospace',
    'cascadia-code': '"Cascadia Code", ui-monospace, monospace',
    'consolas': 'Consolas, ui-monospace, monospace',
  }
  return families[settings.terminalFont] ?? families['jetbrains-mono']!
}

export function useLocalTerminal() {
  const term = shallowRef<Terminal>()
  const fitAddon = shallowRef<FitAddon>()
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
    const terminal = new Terminal({
      fontFamily: terminalFontFamily(),
      fontSize: settingNumber('terminalFontSize', 13),
      lineHeight: 1.4,
      cursorStyle: settings.terminalCursor as 'block' | 'bar' | 'underline',
      cursorBlink: settings.terminalCursorBlink,
      scrollback: settingNumber('terminalScrollback', 5000),
      theme: TERMINAL_THEME,
      macOptionIsMeta: true,
    })
    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    fit.fit()
    terminal.onData((data) => {
      if (state.status === 'connected' && state.sessionId)
        void localTerminal.write(state.sessionId, data).catch(handleWriteError)
    })

    term.value = terminal
    fitAddon.value = fit
  }

  const stopSettingsWatch = watch(
    () => [
      settings.terminalFont,
      settings.terminalFontSize,
      settings.terminalCursor,
      settings.terminalCursorBlink,
      settings.terminalScrollback,
    ] as const,
    () => {
      const terminal = term.value
      if (!terminal)
        return
      terminal.options.fontFamily = terminalFontFamily()
      terminal.options.fontSize = settingNumber('terminalFontSize', 13)
      terminal.options.cursorStyle = settings.terminalCursor as 'block' | 'bar' | 'underline'
      terminal.options.cursorBlink = settings.terminalCursorBlink
      terminal.options.scrollback = settingNumber('terminalScrollback', 5000)
      resize()
    },
  )

  async function connect(settings: LocalConnectionSettings): Promise<void> {
    const terminal = term.value
    if (!terminal)
      throw new Error('终端尚未挂载')

    await disconnect()
    const currentOperation = ++operation
    state.status = 'connecting'
    state.error = ''

    const pendingOutput: LocalTerminalOutputEvent[] = []
    const pendingStatus: LocalTerminalStatusEvent[] = []

    try {
      const stopOutput = await localTerminal.onOutput((payload) => {
        if (!state.sessionId) {
          pendingOutput.push(payload)
          return
        }
        if (payload.sessionId === state.sessionId)
          terminal.write(localTerminal.decodeBase64(payload.data))
      })
      unlisteners.push(stopOutput)

      const stopStatus = await localTerminal.onStatus((payload) => {
        if (!state.sessionId) {
          pendingStatus.push(payload)
          return
        }
        if (payload.sessionId === state.sessionId)
          applyStatus(payload)
      })
      unlisteners.push(stopStatus)

      const id = await localTerminal.create({
        ...settings,
        cols: terminal.cols,
        rows: terminal.rows,
      })

      if (disposed || operation !== currentOperation) {
        await localTerminal.close(id).catch(() => {})
        return
      }

      state.sessionId = id
      state.status = 'connected'
      pendingOutput
        .filter(payload => payload.sessionId === id)
        .forEach(payload => terminal.write(localTerminal.decodeBase64(payload.data)))
      pendingStatus
        .filter(payload => payload.sessionId === id)
        .forEach(applyStatus)
      terminal.focus()
    }
    catch (err) {
      if (disposed || operation !== currentOperation)
        return

      state.status = 'disconnected'
      state.error = errorMessage(err)
      terminal.writeln(`\r\n\x1b[31m启动本地终端失败：${state.error}\x1b[0m`)
      await cleanup()
      throw err
    }
  }

  function applyStatus(payload: LocalTerminalStatusEvent): void {
    state.status = payload.status
    if (payload.status !== 'disconnected')
      return

    state.error = payload.reason ?? ''
    const suffix = payload.exitCode === null ? '' : `（退出码 ${payload.exitCode}）`
    term.value?.writeln(`\r\n\x1b[90m本地终端已退出${suffix}\x1b[0m`)
  }

  const resize = useDebounceFn(() => {
    const terminal = term.value
    const fit = fitAddon.value
    if (!terminal || !fit)
      return

    fit.fit()
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
    if (id)
      await localTerminal.close(id).catch(() => {})
  }

  async function cleanup(): Promise<void> {
    for (const unlisten of unlisteners) unlisten()
    unlisteners = []
    state.sessionId = ''
  }

  function handleWriteError(err: unknown): void {
    if (state.status !== 'connected')
      return
    state.status = 'disconnected'
    state.error = errorMessage(err)
    term.value?.writeln(`\r\n\x1b[31m写入本地终端失败：${state.error}\x1b[0m`)
  }

  onBeforeUnmount(() => {
    stopSettingsWatch()
    disposed = true
    void disconnect()
    term.value?.dispose()
  })

  return { term, sessionId, status, error, mount, connect, disconnect, resize }
}
