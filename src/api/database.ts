/** 数据库 Tauri 命令的前端封装。 */

import { invoke } from '@tauri-apps/api/core'
import type {
  DatabaseColumn,
  DatabaseConfig,
  DatabaseObject,
  DatabaseQueryResult,
} from '@/types/database'
import { IS_TAURI } from '@/utils/window'
export { errorMessage, isAppError } from './ssh'

function ensureTauri(): void {
  if (!IS_TAURI)
    throw new Error('数据库功能需要在桌面应用中运行')
}

export async function testConnection(config: DatabaseConfig): Promise<void> {
  ensureTauri()
  await invoke('db_test_connection', { config })
}

export async function connect(config: DatabaseConfig): Promise<string> {
  ensureTauri()
  return invoke<string>('db_connect', { config })
}

export async function disconnect(sessionId: string): Promise<void> {
  ensureTauri()
  await invoke('db_disconnect', { sessionId })
}

export async function listObjects(sessionId: string): Promise<DatabaseObject[]> {
  ensureTauri()
  return invoke<DatabaseObject[]>('db_list_objects', { sessionId })
}

export async function describeObject(
  sessionId: string,
  schema: string,
  name: string,
): Promise<DatabaseColumn[]> {
  ensureTauri()
  return invoke<DatabaseColumn[]>('db_describe_object', { sessionId, schema, name })
}

export async function execute(sessionId: string, sql: string): Promise<DatabaseQueryResult> {
  ensureTauri()
  return invoke<DatabaseQueryResult>('db_execute', { sessionId, sql })
}
