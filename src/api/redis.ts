import { Channel, invoke } from '@tauri-apps/api/core'
import { i18n } from '@/i18n'
import { IS_TAURI } from '@/utils/window'
import type {
  RedisConfig,
  RedisSession,
  RedisKeyPage,
  RedisKeyDetail,
  RedisCommandResult,
  RedisKey,
  RedisCollectionPage,
  RedisCollectionOp,
  RedisPatternPreview,
  RedisInfoSection,
  RedisSlowlog,
  RedisBigKeyProgress,
  RedisPubSubEvent,
} from '@/types/redis'
import { resolveTunnel } from './database'
export { errorMessage, isAppError } from './ssh'

function call<T>(command: string, args: Record<string, unknown>): Promise<T> {
  if (!IS_TAURI)
    return Promise.reject(
      new Error(i18n.global.t('数据库功能需要在桌面应用中运行'))
    )
  return invoke<T>(command, args)
}
export const testConnection = (config: RedisConfig) =>
  resolveTunnel(config).then(resolved =>
    call<void>('redis_test_connection', { config: resolved })
  )
export const connect = (config: RedisConfig) =>
  resolveTunnel(config).then(resolved =>
    call<RedisSession>('redis_connect', { config: resolved })
  )
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
export const collectionPage = (
  sessionId: string,
  key: string,
  cursor: string,
  pattern: string,
  count: number
) =>
  call<RedisCollectionPage>('redis_collection_page', {
    sessionId,
    key,
    cursor,
    pattern,
    count,
  })
export const collectionWrite = (
  sessionId: string,
  key: string,
  op: RedisCollectionOp,
  create = false
) => call<number>('redis_collection_write', { sessionId, key, op, create })
export const createString = (
  sessionId: string,
  key: string,
  value: string,
  ttlSecs: number
) => call<void>('redis_create_string', { sessionId, key, value, ttlSecs })
export const renameKey = (
  sessionId: string,
  key: string,
  newName: string,
  overwrite: boolean
) => call<RedisKey>('redis_rename_key', { sessionId, key, newName, overwrite })
export const previewPattern = (sessionId: string, pattern: string) =>
  call<RedisPatternPreview>('redis_preview_pattern', { sessionId, pattern })
export const deletePattern = (sessionId: string, pattern: string) =>
  call<number>('redis_delete_pattern', { sessionId, pattern })
export const serverInfo = (sessionId: string) =>
  call<RedisInfoSection[]>('redis_server_info', { sessionId })
export const slowlog = (sessionId: string, count: number) =>
  call<RedisSlowlog>('redis_slowlog', { sessionId, count })
export const slowlogReset = (sessionId: string) =>
  call<void>('redis_slowlog_reset', { sessionId })
/** 后台扫描大 key，返回任务 ID；用 stopJob 取消，最终进度 done=true。 */
export const bigKeyScan = (
  sessionId: string,
  pattern: string,
  onProgress: (progress: RedisBigKeyProgress) => void
) =>
  call<number>('redis_big_key_scan', {
    sessionId,
    pattern,
    onProgress: new Channel<RedisBigKeyProgress>(onProgress),
  })
/** 独立连接订阅频道/模式，返回任务 ID；用 stopJob 退订。 */
export const pubsubSubscribe = (
  sessionId: string,
  channels: string[],
  patterns: string[],
  onEvent: (event: RedisPubSubEvent) => void
) =>
  call<number>('redis_pubsub_subscribe', {
    sessionId,
    channels,
    patterns,
    onEvent: new Channel<RedisPubSubEvent>(onEvent),
  })
export const publish = (sessionId: string, channel: string, message: string) =>
  call<number>('redis_publish', { sessionId, channel, message })
export const stopJob = (jobId: number) => call<void>('redis_stop_job', { jobId })
