import { i18n } from '@/i18n'
/**
 * ~/.ssh/config 导入预览与公钥部署的前端封装。
 */

import { invoke } from '@tauri-apps/api/core'
import { get as getConnection } from '@/api/connections'
import { connect, disconnect } from '@/api/ssh'
import { isSshConnection, toSshConfig } from '@/types/connection'
import type {
  DeployKeyResult,
  OpenSshImportPreview,
} from '@/types/ssh-keys-config'
import { IS_TAURI } from '@/utils/window'

// 浏览器预览没有 Tauri 后端时给出明确报错
function ensureTauri(): void {
  if (!IS_TAURI) throw new Error(i18n.global.t('SSH 功能需要在桌面应用中运行'))
}

// 读取并解析本机 ~/.ssh/config，返回可导入的主机预览
export async function previewOpenSshConfig(): Promise<OpenSshImportPreview> {
  ensureTauri()
  return invoke<OpenSshImportPreview>('ssh_config_preview')
}

// 临时连接到已保存的 SSH 连接，把本地公钥追加到远端 authorized_keys，结束后断开
export async function deployPublicKey(
  connectionId: string,
  keyId: string
): Promise<DeployKeyResult> {
  ensureTauri()
  const connection = await getConnection(connectionId)
  if (!connection || !isSshConnection(connection))
    throw new Error(i18n.global.t('目标 SSH 连接不存在'))

  const sessionId = await connect(toSshConfig(connection))
  try {
    return await invoke<DeployKeyResult>('ssh_deploy_public_key', {
      sessionId,
      keyId,
    })
  } finally {
    await disconnect(sessionId).catch(() => undefined)
  }
}
