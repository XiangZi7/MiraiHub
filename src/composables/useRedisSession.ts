import {
  computed,
  onBeforeUnmount,
  reactive,
  toRefs,
  watch,
  type Ref,
} from 'vue'
import * as redis from '@/api/redis'
import {
  toDatabaseConnectionConfig,
  type SavedConnection,
} from '@/types/connection'
import type {
  RedisSession,
  RedisKey,
  RedisKeyDetail,
  RedisCommandResult,
} from '@/types/redis'
import type { SshSessionStatus } from '@/types/ssh'

export function useRedisSession(
  connection: Ref<SavedConnection>,
  onStatus: (status: SshSessionStatus, sessionId: string) => void
) {
  // 响应式状态
  const state = reactive({
    // 当前原生连接
    session: null as RedisSession | null,
    // 连接生命周期状态
    status: 'disconnected' as SshSessionStatus,
    // 当前操作的错误信息
    error: '',
    // 认证失败后临时输入密码
    needsPassword: false,
    // 同一会话串行操作，避免切库时读取旧库
    busy: false,
    // 已扫描到的键
    keys: [] as RedisKey[],
    // Redis 返回的无损十进制游标
    cursor: '0',
    // 是否已执行首次扫描
    scanned: false,
    // 当前扫描使用的匹配模式
    pattern: '*',
    // 当前选中的键详情
    detail: null as RedisKeyDetail | null,
    // 最近一次手动命令的结果
    result: null as RedisCommandResult | null,
  })
  let generation = 0
  let runtimePassword: string | undefined
  const connected = computed(
    () => state.status === 'connected' && !!state.session
  )

  function status(value: SshSessionStatus) {
    state.status = value
    onStatus(value, state.session?.sessionId ?? '')
  }
  function clearData() {
    state.keys = []
    state.cursor = '0'
    state.scanned = false
    state.detail = null
    state.result = null
  }
  async function release(id?: string) {
    if (!id) return
    try {
      await redis.disconnect(id)
    } catch {
      /* 原生会话可能已释放。 */
    }
  }
  async function disconnect() {
    generation++
    const id = state.session?.sessionId
    state.session = null
    state.busy = false
    clearData()
    status('disconnected')
    await release(id)
  }
  async function connect(password?: string) {
    const request = ++generation
    const previous = state.session?.sessionId
    state.session = null
    state.busy = false
    state.error = ''
    state.needsPassword = false
    clearData()
    status('connecting')
    void release(previous)
    runtimePassword = password ?? runtimePassword
    try {
      const session = await redis.connect(
        toDatabaseConnectionConfig(connection.value, runtimePassword)
      )
      if (request !== generation) {
        void release(session.sessionId)
        return
      }
      state.session = session
      status('connected')
      await scan(true)
    } catch (error) {
      if (request !== generation) return
      state.error = redis.errorMessage(error)
      state.needsPassword = redis.isAppError(error) && error.kind === 'auth'
      status('disconnected')
    }
  }
  async function perform<T>(
    work: (id: string) => Promise<T>,
    apply: (value: T) => void
  ): Promise<boolean> {
    const id = state.session?.sessionId
    if (!id || state.busy) return false
    const request = generation
    state.busy = true
    state.error = ''
    try {
      const result = await work(id)
      if (request !== generation) return false
      apply(result)
      return true
    } catch (error) {
      if (request !== generation) return false
      state.error = redis.errorMessage(error)
      if (
        redis.isAppError(error) &&
        (error.kind === 'network' || error.kind === 'auth')
      ) {
        state.needsPassword = error.kind === 'auth'
        void disconnect()
      }
      return false
    } finally {
      if (request === generation) state.busy = false
    }
  }
  async function scan(reset = false, pattern = state.pattern) {
    if (
      !connected.value ||
      state.busy ||
      (!reset && state.scanned && state.cursor === '0')
    )
      return
    const cursor = reset ? '0' : state.cursor
    await perform(
      id => redis.scan(id, cursor, reset ? pattern : state.pattern),
      page => {
        if (reset) {
          state.keys = []
          state.pattern = pattern
        }
        const seen = new Set(state.keys.map(key => key.id))
        state.keys.push(
          ...page.keys.filter(key => {
            if (seen.has(key.id)) return false
            seen.add(key.id)
            return true
          })
        )
        state.cursor = page.cursor
        state.scanned = true
      }
    )
  }
  async function inspect(key: RedisKey) {
    if (state.busy) return
    state.detail = null
    await perform(
      id => redis.inspect(id, key.id),
      detail => {
        state.detail = detail
      }
    )
  }
  async function switchDatabase(database: string) {
    const request = generation
    if (
      (await perform(
        id => redis.useDatabase(id, database),
        session => {
          state.session = session
          clearData()
        }
      )) &&
      request === generation
    )
      await scan(true)
  }
  async function execute(command: string) {
    if (state.busy) return
    state.result = null
    const request = generation
    if (
      (await perform(
        id => redis.execute(id, command),
        result => {
          state.result = result
        }
      )) &&
      request === generation
    ) {
      state.detail = null
      await scan(true)
    }
  }
  async function saveString(value: string) {
    const detail = state.detail
    if (!detail) return
    const request = generation
    if (
      (await perform(
        id => redis.saveString(id, detail.key.id, value),
        () => {}
      )) &&
      request === generation
    )
      await inspect(detail.key)
  }
  async function deleteKey() {
    const detail = state.detail
    if (!detail) return
    const request = generation
    if (
      (await perform(
        id => redis.deleteKey(id, detail.key.id),
        () => {
          state.detail = null
        }
      )) &&
      request === generation
    )
      await scan(true)
  }
  async function expireKey(ttlSecs: number) {
    const detail = state.detail
    if (!detail) return
    const request = generation
    if (
      (await perform(
        id => redis.expireKey(id, detail.key.id, ttlSecs),
        () => {}
      )) &&
      request === generation
    )
      await inspect(detail.key)
  }
  watch(
    connection,
    () => {
      runtimePassword = undefined
      void connect()
    },
    { immediate: true, deep: true }
  )
  onBeforeUnmount(() => {
    runtimePassword = undefined
    void disconnect()
  })
  return {
    ...toRefs(state),
    connected,
    connect,
    disconnect,
    scan,
    inspect,
    switchDatabase,
    execute,
    saveString,
    deleteKey,
    expireKey,
  }
}
