/**
 * SSH 终端会话。
 *
 * 把 xterm.js 实例与一条 SSH 会话绑在一起：
 * 用户按键 → ssh_write，远端输出 → xterm.write，尺寸变化 → ssh_resize。
 *
 * 组件只负责给一个挂载容器和调用 connect/dispose，
 * 事件订阅、生命周期清理都在这里收口。
 */

import { onBeforeUnmount, reactive, shallowRef, toRefs } from 'vue'
import { useDebounceFn } from '@vueuse/core'
import type { UnlistenFn } from '@tauri-apps/api/event'
import { FitAddon } from '@xterm/addon-fit'
import { Terminal } from '@xterm/xterm'
import * as ssh from '@/api/ssh'
import type { SshConfig, SshSessionStatus } from '@/types/ssh'
import { TERMINAL_THEME } from '@/constants/terminal'

export function useSshTerminal() {
  // xterm 实例不参与响应式：它内部持有大量 DOM 与缓冲区，
  // 被 Vue 深度代理会显著拖慢渲染
  const term = shallowRef<Terminal>()
  const fitAddon = shallowRef<FitAddon>()

  // 响应式状态
  const state = reactive({
    // 会话 id，未连接时为空
    sessionId: '',
    // 连接状态，驱动工具条上的状态点
    status: 'disconnected' as SshSessionStatus,
    // 连接失败或异常断开的原因
    error: '',
  })

  const { sessionId, status, error } = toRefs(state)

  // 事件订阅的取消函数，断开时逐个调用
  let unlisteners: UnlistenFn[] = []

  /**
   * 挂载 xterm 到容器。
   * 与 connect 分开：先把终端画出来，用户能看到"正在连接"，而不是一片空白。
   */
  function mount(container: HTMLElement): void {
    const terminal = new Terminal({
      fontFamily: '"JetBrains Mono Variable", ui-monospace, monospace',
      fontSize: 12.5,
      lineHeight: 1.4,
      cursorBlink: true,
      // 回滚缓冲给足：排查日志时经常要往回翻很多屏
      scrollback: 10000,
      theme: TERMINAL_THEME,
      // 让 xterm 自己吞掉 Ctrl+C 之类的组合键交给远端，而不是被浏览器截走
      macOptionIsMeta: true,
    })

    const fit = new FitAddon()
    terminal.loadAddon(fit)
    terminal.open(container)
    fit.fit()

    term.value = terminal
    fitAddon.value = fit

    // 用户输入直接转发给远端。未连接时丢弃：
    // 否则在断开的终端里敲字会攒下一堆无处可去的 invoke
    terminal.onData((data) => {
      if (state.status === 'connected' && state.sessionId)
        void ssh.writeToShell(state.sessionId, data).catch(handleWriteError)
    })
  }

  /** 建立连接并打开交互式 shell */
  async function connect(config: SshConfig): Promise<void> {
    const terminal = term.value
    if (!terminal)
      throw new Error('终端尚未挂载')

    state.status = 'connecting'
    state.error = ''
    terminal.writeln(`\x1b[90m正在连接 ${config.username}@${config.host}:${config.port} …\x1b[0m`)

    try {
      const id = await ssh.connect(config)
      state.sessionId = id

      // 先订阅再开 shell：反过来的话 shell 启动瞬间的输出（登录 banner、
      // 提示符）会在订阅建立前就推送出来，前几行就丢了
      unlisteners = await Promise.all([
        ssh.onOutput(id, (payload) => {
          terminal.write(ssh.decodeBase64(payload.data))
        }),
        ssh.onStatus(id, (payload) => {
          state.status = payload.status

          if (payload.status === 'disconnected') {
            state.error = payload.reason ?? ''
            const suffix = payload.exitCode === null ? '' : `（退出码 ${payload.exitCode}）`
            terminal.writeln(`\r\n\x1b[90m连接已断开${suffix}\x1b[0m`)
          }
        }),
      ])

      await ssh.openShell(id, {
        cols: terminal.cols,
        rows: terminal.rows,
      })

      state.status = 'connected'
      terminal.focus()
    }
    catch (err) {
      state.status = 'disconnected'
      state.error = ssh.errorMessage(err)
      terminal.writeln(`\r\n\x1b[31m连接失败：${state.error}\x1b[0m`)
      // 订阅可能已部分建立，清掉避免泄漏
      await cleanup()
      throw err
    }
  }

  /**
   * 重新适配容器尺寸，并把新尺寸同步给远端。
   *
   * 防抖是因为拖拽窗口或面板会连续触发几十次，
   * 每次都往远端发 window_change 既浪费，也会让 vim/top 这类程序反复重绘闪烁。
   */
  const resize = useDebounceFn(() => {
    const fit = fitAddon.value
    const terminal = term.value
    if (!fit || !terminal)
      return

    fit.fit()

    if (state.status === 'connected' && state.sessionId) {
      void ssh
        .resizeShell(state.sessionId, terminal.cols, terminal.rows)
        .catch(err => console.warn('同步终端尺寸失败：', ssh.errorMessage(err)))
    }
  }, 120)

  /** 主动断开 */
  async function disconnect(): Promise<void> {
    if (state.sessionId) {
      await ssh
        .disconnect(state.sessionId)
        .catch(err => console.warn('断开会话失败：', ssh.errorMessage(err)))
    }

    await cleanup()
    state.status = 'disconnected'
  }

  /** 取消所有事件订阅，重置会话 id */
  async function cleanup(): Promise<void> {
    for (const unlisten of unlisteners) unlisten()

    unlisteners = []
    state.sessionId = ''
  }

  /** 写入失败通常意味着连接已断，提示一次即可，不必每个按键都刷屏 */
  function handleWriteError(err: unknown): void {
    if (state.status !== 'connected')
      return

    state.status = 'disconnected'
    state.error = ssh.errorMessage(err)
    term.value?.writeln(`\r\n\x1b[31m发送失败：${state.error}\x1b[0m`)
  }

  // 组件卸载时必须清理：xterm 持有 DOM 引用，事件订阅握着 Tauri 侧的回调，
  // 漏掉任何一个都会在反复开关标签页时累积泄漏
  onBeforeUnmount(() => {
    void disconnect()
    term.value?.dispose()
  })

  return {
    term,
    sessionId,
    status,
    error,
    mount,
    connect,
    disconnect,
    resize,
  }
}
