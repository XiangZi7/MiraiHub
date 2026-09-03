import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  LocalTerminalConfig,
  LocalTerminalOutputEvent,
  LocalTerminalStatusEvent,
} from '@/types/local-terminal'
import { IS_TAURI } from '@/utils/window'
import { decodeBase64 } from './ssh'

const EVENT_OUTPUT = 'local-terminal://output'
const EVENT_STATUS = 'local-terminal://status'

function ensureTauri(): void {
  if (!IS_TAURI)
    throw new Error('本地终端需要在桌面应用中运行')
}

export async function create(config: LocalTerminalConfig): Promise<string> {
  ensureTauri()
  return invoke<string>('local_terminal_create', { config })
}

export async function write(sessionId: string, data: string): Promise<void> {
  ensureTauri()
  await invoke('local_terminal_write', { sessionId, data })
}

export async function resize(sessionId: string, cols: number, rows: number): Promise<void> {
  ensureTauri()
  await invoke('local_terminal_resize', { sessionId, cols, rows })
}

export async function close(sessionId: string): Promise<void> {
  ensureTauri()
  await invoke('local_terminal_close', { sessionId })
}

/**
 * 本地 Shell 启动极快，创建命令返回前就可能输出提示符；因此先订阅全局事件，
 * 由调用方在拿到 sessionId 后过滤并回放极短暂的缓冲，避免丢首屏。
 */
export function onOutput(handler: (payload: LocalTerminalOutputEvent) => void): Promise<UnlistenFn> {
  return listen<LocalTerminalOutputEvent>(EVENT_OUTPUT, event => handler(event.payload))
}

export function onStatus(handler: (payload: LocalTerminalStatusEvent) => void): Promise<UnlistenFn> {
  return listen<LocalTerminalStatusEvent>(EVENT_STATUS, event => handler(event.payload))
}

export { decodeBase64 }
