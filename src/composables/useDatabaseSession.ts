import {
  computed,
  onBeforeUnmount,
  reactive,
  toRefs,
  watch,
  type Ref,
} from 'vue'
import * as database from '@/api/database'
import type { SavedConnection } from '@/types/connection'
import { isDatabaseConnection, toDatabaseConfig } from '@/types/connection'
import type {
  DatabaseColumn,
  DatabaseExecution,
  DatabaseObject,
  DatabaseSession,
} from '@/types/database'
import type { SshSessionStatus } from '@/types/ssh'

interface UseDatabaseSessionOptions {
  onStatus?: (status: SshSessionStatus, sessionId: string) => void
}

export function databaseObjectKey(
  object: Pick<DatabaseObject, 'schema' | 'name'> &
    Partial<Pick<DatabaseObject, 'kind' | 'identity'>>
): string {
  return `${object.schema}\u0000${object.kind ?? ''}\u0000${object.name}\u0000${object.identity ?? ''}`
}

/**
 * 一条数据库标签的完整生命周期：连接池、元数据、查询与卸载清理。
 * 组件只消费只读状态并调用动作，不直接接触 IPC 命令名。
 */
export function useDatabaseSession(
  connection: Ref<SavedConnection | undefined>,
  options: UseDatabaseSessionOptions = {}
) {
  const state = reactive({
    sessionId: '',
    session: null as DatabaseSession | null,
    status: 'disconnected' as SshSessionStatus,
    connectionError: '',
    needsPassword: false,
    databases: [] as string[],
    databasesLoading: false,
    objects: [] as DatabaseObject[],
    objectsLoading: false,
    objectsError: '',
    columnsByObject: {} as Record<string, DatabaseColumn[] | undefined>,
    inspectingKeys: new Set<string>(),
    queryExecution: null as DatabaseExecution | null,
    queryLoading: false,
    queryError: '',
  })

  let generation = 0
  let runtimePassword: string | undefined

  const connected = computed(
    () => state.status === 'connected' && Boolean(state.sessionId)
  )

  function emitStatus(): void {
    options.onStatus?.(state.status, state.sessionId)
  }

  function setStatus(status: SshSessionStatus, sessionId = ''): void {
    state.status = status
    state.sessionId = status === 'connected' ? sessionId : ''
    if (status !== 'connected') state.session = null
    emitStatus()
  }

  async function release(sessionId: string): Promise<void> {
    if (!sessionId) return

    try {
      await database.disconnect(sessionId)
    } catch (error) {
      // 会话可能已因应用退出或后端错误被清理；前端状态已完成释放。
      console.warn('释放数据库连接失败：', database.errorMessage(error))
    }
  }

  function resetData(): void {
    state.objects = []
    state.databases = []
    state.databasesLoading = false
    state.objectsLoading = false
    state.objectsError = ''
    state.columnsByObject = {}
    state.inspectingKeys.clear()
    state.queryExecution = null
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
      const session = await database.connect(
        toDatabaseConfig(target, runtimePassword)
      )
      if (request !== generation) {
        void release(session.sessionId)
        return
      }

      state.session = session
      setStatus('connected', session.sessionId)
      await Promise.all([refreshDatabases(), refreshObjects()])
    } catch (error) {
      if (request !== generation) return

      setStatus('disconnected')
      state.connectionError = database.errorMessage(error)
      state.needsPassword = database.isAppError(error) && error.kind === 'auth'
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
    if (!sessionId) return

    state.objectsLoading = true
    state.objectsError = ''
    try {
      const objects = await database.listObjects(sessionId)
      if (state.sessionId === sessionId) state.objects = objects
    } catch (error) {
      if (state.sessionId === sessionId)
        state.objectsError = database.errorMessage(error)
    } finally {
      if (state.sessionId === sessionId) state.objectsLoading = false
    }
  }

  async function refreshDatabases(): Promise<void> {
    const sessionId = state.sessionId
    if (!sessionId) return

    state.databasesLoading = true
    try {
      const databases = await database.listDatabases(sessionId)
      if (state.sessionId === sessionId) state.databases = databases
    } catch (error) {
      if (state.sessionId === sessionId)
        state.objectsError = database.errorMessage(error)
    } finally {
      if (state.sessionId === sessionId) state.databasesLoading = false
    }
  }

  async function switchDatabase(name: string): Promise<void> {
    const sessionId = state.sessionId
    if (!sessionId || !name || name === state.session?.database) return

    state.objectsLoading = true
    state.objectsError = ''
    try {
      const session = await database.useDatabase(sessionId, name)
      if (state.sessionId !== sessionId) return
      state.session = session
      state.columnsByObject = {}
      await refreshObjects()
    } catch (error) {
      if (state.sessionId === sessionId)
        state.objectsError = database.errorMessage(error)
    } finally {
      if (state.sessionId === sessionId) state.objectsLoading = false
    }
  }

  async function inspectObject(object: DatabaseObject): Promise<void> {
    const sessionId = state.sessionId
    const key = databaseObjectKey(object)
    if (
      !sessionId ||
      state.inspectingKeys.has(key) ||
      state.columnsByObject[key]
    )
      return

    state.inspectingKeys.add(key)
    try {
      const columns = await database.describeObject(
        sessionId,
        object.schema,
        object.name
      )
      if (state.sessionId === sessionId) state.columnsByObject[key] = columns
    } catch (error) {
      if (state.sessionId === sessionId)
        state.objectsError = database.errorMessage(error)
    } finally {
      state.inspectingKeys.delete(key)
    }
  }

  async function executeSql(sql: string): Promise<void> {
    const sessionId = state.sessionId
    if (!sessionId || state.queryLoading) return

    state.queryLoading = true
    state.queryError = ''
    state.queryExecution = null
    try {
      const result = await database.execute(sessionId, sql)
      if (state.sessionId !== sessionId) return

      state.queryExecution = result
      // DDL/DML 可能改变对象结构；异步刷新，不阻塞结果展示。
      if (
        result.statements.some(
          statement => !statement.error && !statement.columns.length
        )
      )
        void refreshObjects()
    } catch (error) {
      if (state.sessionId === sessionId)
        state.queryError = database.errorMessage(error)
    } finally {
      if (state.sessionId === sessionId) state.queryLoading = false
    }
  }

  async function cancelQuery(): Promise<void> {
    if (!state.sessionId || !state.queryLoading) return

    try {
      await database.cancelQuery(state.sessionId)
    } catch (error) {
      state.queryError = database.errorMessage(error)
    }
  }

  watch(
    connection,
    () => {
      runtimePassword = undefined
      void connect()
    },
    { immediate: true, deep: true }
  )

  onBeforeUnmount(() => void disconnect())

  return {
    ...toRefs(state),
    connected,
    connect,
    disconnect,
    refreshObjects,
    refreshDatabases,
    switchDatabase,
    inspectObject,
    executeSql,
    cancelQuery,
  }
}
