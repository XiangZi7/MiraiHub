import { computed, onBeforeUnmount, reactive, toRefs, watch, type Ref } from 'vue'
import * as database from '@/api/database'
import type { SavedConnection } from '@/types/connection'
import { isDatabaseConnection, toDatabaseConfig } from '@/types/connection'
import type {
  DatabaseColumn,
  DatabaseObject,
  DatabaseQueryResult,
} from '@/types/database'
import type { SshSessionStatus } from '@/types/ssh'

interface UseDatabaseSessionOptions {
  onStatus?: (status: SshSessionStatus, sessionId: string) => void
}

export function databaseObjectKey(object: Pick<DatabaseObject, 'schema' | 'name'>): string {
  return `${object.schema}\u0000${object.name}`
}

/**
 * 一条数据库标签的完整生命周期：连接池、元数据、查询与卸载清理。
 * 组件只消费只读状态并调用动作，不直接接触 IPC 命令名。
 */
export function useDatabaseSession(
  connection: Ref<SavedConnection | undefined>,
  options: UseDatabaseSessionOptions = {},
) {
  const state = reactive({
    sessionId: '',
    status: 'disconnected' as SshSessionStatus,
    connectionError: '',
    needsPassword: false,
    objects: [] as DatabaseObject[],
    objectsLoading: false,
    objectsError: '',
    columnsByObject: {} as Record<string, DatabaseColumn[] | undefined>,
    inspectingKeys: new Set<string>(),
    queryResult: null as DatabaseQueryResult | null,
    queryLoading: false,
    queryError: '',
  })

  let generation = 0
  let runtimePassword: string | undefined

  const connected = computed(() => state.status === 'connected' && Boolean(state.sessionId))

  function emitStatus(): void {
    options.onStatus?.(state.status, state.sessionId)
  }

  function setStatus(status: SshSessionStatus, sessionId = ''): void {
    state.status = status
    state.sessionId = status === 'connected' ? sessionId : ''
    emitStatus()
  }

  async function release(sessionId: string): Promise<void> {
    if (!sessionId)
      return

    try {
      await database.disconnect(sessionId)
    }
    catch (error) {
      // 会话可能已因应用退出或后端错误被清理；前端状态已完成释放。
      console.warn('释放数据库连接失败：', database.errorMessage(error))
    }
  }

  function resetData(): void {
    state.objects = []
    state.objectsLoading = false
    state.objectsError = ''
    state.columnsByObject = {}
    state.inspectingKeys.clear()
    state.queryResult = null
    state.queryLoading = false
    state.queryError = ''
  }

  async function connect(password?: string): Promise<void> {
    const target = connection.value
    const request = ++generation
    const previousSession = state.sessionId

    runtimePassword = password ?? runtimePassword
    setStatus('connecting')
    state.connectionError = ''
    state.needsPassword = false
    resetData()
    void release(previousSession)

    if (!target || !isDatabaseConnection(target)) {
      setStatus('disconnected')
      return
    }

    try {
      const sessionId = await database.connect(toDatabaseConfig(target, runtimePassword))
      if (request !== generation) {
        void release(sessionId)
        return
      }

      setStatus('connected', sessionId)
      await refreshObjects()
    }
    catch (error) {
      if (request !== generation)
        return

      setStatus('disconnected')
      state.connectionError = database.errorMessage(error)
      state.needsPassword = database.isAppError(error)
        && error.kind === 'auth'
    }
  }

  async function disconnect(): Promise<void> {
    generation++
    const sessionId = state.sessionId
    setStatus('disconnected')
    await release(sessionId)
  }

  async function refreshObjects(): Promise<void> {
    const sessionId = state.sessionId
    if (!sessionId)
      return

    state.objectsLoading = true
    state.objectsError = ''
    try {
      const objects = await database.listObjects(sessionId)
      if (state.sessionId === sessionId)
        state.objects = objects
    }
    catch (error) {
      if (state.sessionId === sessionId)
        state.objectsError = database.errorMessage(error)
    }
    finally {
      if (state.sessionId === sessionId)
        state.objectsLoading = false
    }
  }

  async function inspectObject(object: DatabaseObject): Promise<void> {
    const sessionId = state.sessionId
    const key = databaseObjectKey(object)
    if (!sessionId || state.inspectingKeys.has(key) || state.columnsByObject[key])
      return

    state.inspectingKeys.add(key)
    try {
      const columns = await database.describeObject(sessionId, object.schema, object.name)
      if (state.sessionId === sessionId)
        state.columnsByObject[key] = columns
    }
    catch (error) {
      if (state.sessionId === sessionId)
        state.objectsError = database.errorMessage(error)
    }
    finally {
      state.inspectingKeys.delete(key)
    }
  }

  async function executeSql(sql: string): Promise<void> {
    const sessionId = state.sessionId
    if (!sessionId || state.queryLoading)
      return

    state.queryLoading = true
    state.queryError = ''
    state.queryResult = null
    try {
      const result = await database.execute(sessionId, sql)
      if (state.sessionId !== sessionId)
        return

      state.queryResult = result
      // DDL/DML 可能改变对象结构；异步刷新，不阻塞结果展示。
      if (!result.columns.length)
        void refreshObjects()
    }
    catch (error) {
      if (state.sessionId === sessionId)
        state.queryError = database.errorMessage(error)
    }
    finally {
      if (state.sessionId === sessionId)
        state.queryLoading = false
    }
  }

  watch(
    connection,
    () => {
      runtimePassword = undefined
      void connect()
    },
    { immediate: true, deep: true },
  )

  onBeforeUnmount(() => void disconnect())

  return {
    ...toRefs(state),
    connected,
    connect,
    disconnect,
    refreshObjects,
    inspectObject,
    executeSql,
  }
}
