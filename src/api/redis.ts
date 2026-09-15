import { invoke } from '@tauri-apps/api/core'
import { i18n } from '@/i18n'
import { IS_TAURI } from '@/utils/window'
import type {
  RedisConfig,
  RedisSession,
  RedisKeyPage,
  RedisKeyDetail,
  RedisCommandResult,
} from '@/types/redis'
export { errorMessage, isAppError } from './ssh'

function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI)
    return Promise.reject(
      new Error(i18n.global.t('数据库功能需要在桌面应用中运行'))
    )
  return invoke<T>(command, args)
}
export const testConnection = (config: RedisConfig) =>
  call<void>('redis_test_connection', { config })
export const connect = (config: RedisConfig) =>
  call<RedisSession>('redis_connect', { config })
export const disconnect = (sessionId: string) =>
  call<void>('redis_disconnect', { sessionId })
export const useDatabase = (sessionId: string, database: string) =>
  call<RedisSession>('redis_use_database', { sessionId, database })
export const scan = (sessionId: string, cursor: string, pattern: string) =>
  call<RedisKeyPage>('redis_scan', { sessionId, cursor, pattern })
export const inspect = (sessionId: string, key: string) =>
  call<RedisKeyDetail>('redis_inspect', { sessionId, key })
export const execute = (sessionId: string, command: string) =>
  call<RedisCommandResult>('redis_execute', { sessionId, command })
export const saveString = (sessionId: string, key: string, value: string) =>
  call<void>('redis_save_string', { sessionId, key, value })
export const deleteKey = (sessionId: string, key: string) =>
  call<void>('redis_delete_key', { sessionId, key })
export const expireKey = (sessionId: string, key: string, ttlSecs: number) =>
  call<void>('redis_expire_key', { sessionId, key, ttlSecs })
