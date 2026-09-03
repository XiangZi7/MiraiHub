/**
 * SSH 能力的前端封装。
 *
 * 这一层是 Vue 组件与 Tauri 命令之间唯一的通道：
 * 组件不直接写 `invoke('ssh_xxx')`，命令名与参数形状只在这里出现一次，
 * 后端改签名时只需要动这个文件。
 *
 * 命令名统一 `ssh_` 前缀，与后续数据库模块的 `db_` 区分开。
 */

import { invoke } from '@tauri-apps/api/core'
import { listen, type UnlistenFn } from '@tauri-apps/api/event'
import type {
  AppError,
  GenerateKeyRequest,
  PtyOptions,
  SshCommandOutput,
  SshConfig,
  SshKeyInfo,
  SshOutputEvent,
  SshSessionInfo,
  SshStatusEvent,
} from '@/types/ssh'
import { IS_TAURI } from '@/utils/window'

/** 事件名，与 Rust 侧 `ssh/events.rs` 的常量对应 */
const EVENT_OUTPUT = 'ssh://output'
const EVENT_STATUS = 'ssh://status'

/**
 * 判断错误是否是后端抛回的结构化 AppError。
 *
 * Tauri 的 invoke 在命令返回 Err 时会把序列化后的负载原样 reject，
 * 但网络层/序列化层自身的故障抛的是普通 Error，两者要分开处理。
 */
export function isAppError(err: unknown): err is AppError {
  return (
    typeof err === 'object'
    && err !== null
    && 'kind' in err
    && 'message' in err
    && typeof (err as AppError).message === 'string'
  )
}

/** 从任意异常里取出可展示的文案 */
export function errorMessage(err: unknown): string {
  if (isAppError(err))
    return err.message

  if (err instanceof Error)
    return err.message

  return String(err)
}

/** 浏览器里直接预览时没有 Tauri 后端，给出明确报错而不是让 invoke 抛底层异常 */
function ensureTauri(): void {
  if (!IS_TAURI)
    throw new Error('SSH 功能需要在桌面应用中运行')
}

/**
 * 建立 SSH 连接，返回会话 id。
 * 后续所有针对该会话的操作都靠这个 id 寻址。
 */
export async function connect(config: SshConfig): Promise<string> {
  ensureTauri()
  return invoke<string>('ssh_connect', { config })
}

/** 断开并清理会话。对已不存在的会话调用是安全的 */
export async function disconnect(sessionId: string): Promise<void> {
  ensureTauri()
  await invoke('ssh_disconnect', { sessionId })
}

/** 列出当前所有活跃会话 */
export async function listSessions(): Promise<SshSessionInfo[]> {
  ensureTauri()
  return invoke<SshSessionInfo[]>('ssh_list_sessions')
}

/**
 * 在会话上开一个带 PTY 的交互式 shell。
 * 开好之后远端输出会通过 `ssh://output` 事件持续推来，用 onOutput 订阅。
 */
export async function openShell(sessionId: string, pty: PtyOptions): Promise<void> {
  ensureTauri()
  await invoke('ssh_open_shell', { sessionId, pty })
}

/**
 * 向 shell 写入用户输入。
 *
 * 传 string 而非字节数组：xterm.js 的 onData 给的就是 string，
 * 且用户输入必然是合法 UTF-8，不存在输出流那种跨包截断问题。
 */
export async function writeToShell(sessionId: string, data: string): Promise<void> {
  ensureTauri()
  await invoke('ssh_write', { sessionId, data })
}

/** 终端尺寸变化时同步给远端，否则 vim/top 这类全屏程序会画错 */
export async function resizeShell(sessionId: string, cols: number, rows: number): Promise<void> {
  ensureTauri()
  await invoke('ssh_resize', { sessionId, cols, rows })
}

/**
 * 执行单条命令并等待结果。
 * 与 openShell 相互独立：走的是新开的一次性通道，不影响交互式 shell。
 */
export async function exec(sessionId: string, command: string): Promise<SshCommandOutput> {
  ensureTauri()
  return invoke<SshCommandOutput>('ssh_exec', { sessionId, command })
}

/** 扫描 ~/.ssh 下的本地密钥 */
export async function listKeys(): Promise<SshKeyInfo[]> {
  ensureTauri()
  return invoke<SshKeyInfo[]>('ssh_list_keys')
}

/** 生成新密钥，写入 ~/.ssh 并返回其信息 */
export async function generateKey(request: GenerateKeyRequest): Promise<SshKeyInfo> {
  ensureTauri()
  return invoke<SshKeyInfo>('ssh_generate_key', { request })
}

/** 删除密钥对（私钥与同名 .pub）。keyId 即私钥绝对路径 */
export async function deleteKey(keyId: string): Promise<void> {
  ensureTauri()
  await invoke('ssh_delete_key', { keyId })
}

/**
 * 订阅终端输出。返回取消订阅函数。
 *
 * 事件是全局广播的，每个会话都会推到同一个通道，
 * 所以这里按 sessionId 过滤，让调用方只拿自己关心的那份。
 */
export function onOutput(
  sessionId: string,
  handler: (payload: SshOutputEvent) => void,
): Promise<UnlistenFn> {
  return listen<SshOutputEvent>(EVENT_OUTPUT, (event) => {
    if (event.payload.sessionId === sessionId)
      handler(event.payload)
  })
}

/** 订阅会话状态变更。返回取消订阅函数 */
export function onStatus(
  sessionId: string,
  handler: (payload: SshStatusEvent) => void,
): Promise<UnlistenFn> {
  return listen<SshStatusEvent>(EVENT_STATUS, (event) => {
    if (event.payload.sessionId === sessionId)
      handler(event.payload)
  })
}

/**
 * base64 → Uint8Array。
 *
 * 终端输出以 base64 过 IPC（见 Rust 侧 events.rs 的说明），
 * 这里解回字节交给 xterm.js —— 它自己会处理跨块的不完整 UTF-8 字符。
 */
export function decodeBase64(data: string): Uint8Array {
  const binary = atob(data)
  const bytes = new Uint8Array(binary.length)

  for (let i = 0; i < binary.length; i++)
    bytes[i] = binary.charCodeAt(i)

  return bytes
}
