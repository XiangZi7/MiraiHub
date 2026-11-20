import { Channel, invoke } from '@tauri-apps/api/core'
import { i18n } from '@/i18n'
import { IS_TAURI } from '@/utils/window'
import type { RdpResolution } from '@/types/connection'

interface RdpTarget {
  host: string
  port: number
  username: string
}

interface RdpRequest {
  sessionId: string
  target: RdpTarget
  credential: string
  desktop: RdpResolution
}

export type RdpEvent =
  | { type: 'connected' }
  | { type: 'certificate'; fingerprint: string; previousFingerprint?: string }
  | { type: 'clipboard'; message: string; error: boolean }
  | { type: 'ended'; error: string | null }

interface PointerPosition {
  x: number
  y: number
}

export type RdpInput =
  | { type: 'key'; code: number; pressed: boolean }
  | ({ type: 'move' } & PointerPosition)
  | ({ type: 'button'; button: number; pressed: boolean } & PointerPosition)
  | ({ type: 'wheel'; vertical: boolean; delta: number } & PointerPosition)
  | ({ type: 'resize' } & RdpResolution)
  | { type: 'clipboardCopy' }
  | { type: 'clipboardPaste' }
  | { type: 'releaseAll' }
  | { type: 'ctrlAltDelete' }

/** 由原生配置窗口将明文密码转换为目标绑定的本机凭据密文。 */
export function protectRdpPassword(
  target: RdpTarget,
  password: string
): Promise<string> {
  if (!IS_TAURI)
    return Promise.reject(
      new Error(i18n.global.t('远程桌面需要在桌面应用中运行'))
    )
  return invoke('rdp_protect_password', { target, password })
}

/** 创建 IronRDP 会话，分别接收状态和原始 RGBA 更新。 */
export async function startRdp(
  request: RdpRequest,
  onEvent: (event: RdpEvent) => void,
  onFrame: (frame: ArrayBuffer) => void
): Promise<void> {
  if (!IS_TAURI) throw new Error(i18n.global.t('远程桌面需要在桌面应用中运行'))
  await invoke('rdp_start', {
    request,
    onEvent: new Channel<RdpEvent>(onEvent),
    onFrame: new Channel<ArrayBuffer>(onFrame),
  })
}

/** 批量发送当前标签页的鼠标和键盘事件。 */
export function sendRdpInput(
  sessionId: string,
  events: RdpInput[]
): Promise<void> {
  return invoke('rdp_input', { sessionId, events })
}

/** 同意当前连接使用刚核对的远程桌面证书，可选记住指纹。 */
export function trustRdpCertificate(
  sessionId: string,
  fingerprint: string,
  remember: boolean
): Promise<void> {
  return invoke('rdp_trust_certificate', { sessionId, fingerprint, remember })
}

/** 取消正在打开的远程桌面或结束活跃会话。 */
export function stopRdp(sessionId: string): Promise<void> {
  return invoke('rdp_stop', { sessionId })
}
