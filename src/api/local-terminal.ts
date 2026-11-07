import { i18n } from '@/i18n'
import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  LocalTerminalConfig,
  LocalTerminalStatusEvent,
} from '@/types/local-terminal'
import { IS_TAURI } from '@/utils/window'
import { outputChannel } from './ssh'

const EVENT_STATUS = 'local-terminal://status'

function ensureTauri(): void {
  if (!IS_TAURI) throw new Error(i18n.global.t('本地终端需要在桌面应用中运行'))
}

/**
 * 启动本地 Shell。输出通道在进程启动前就交给后端，
 * 创建命令返回前输出的提示符也会经 onOutput 送达，不会丢首屏。
 */
export async function create(
  config: LocalTerminalConfig,
  onOutput: (data: Uint8Array) => void
): Promise<string> {
  ensureTauri()
  return invoke<string>('local_terminal_create', {
    config,
    onOutput: outputChannel(onOutput),
  })
}

export async function write(sessionId: string, data: string): Promise<void> {
  ensureTauri()
  await invoke('local_terminal_write', { sessionId, data })
}

export async function resize(
  sessionId: string,
  cols: number,
  rows: number
): Promise<void> {
  ensureTauri()
  await invoke('local_terminal_resize', { sessionId, cols, rows })
}

export async function close(sessionId: string): Promise<void> {
  ensureTauri()
  await invoke('local_terminal_close', { sessionId })
}

export function onStatus(
  handler: (payload: LocalTerminalStatusEvent) => void
): Promise<UnlistenFn> {
  return listen<LocalTerminalStatusEvent>(EVENT_STATUS, event =>
    handler(event.payload)
  )
}
