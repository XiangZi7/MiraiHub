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
import { isSqlConnection, toDatabaseConfig } from '@/types/connection'
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
    selectedDatabase: '',
    objects: [] as DatabaseObject[],
    // 已读取的数据库，即使没有对象也保留已加载状态。
    loadedDatabases: new Set<string>(),
    objectsLoading: false,
    objectsError: '',
    columnsByObject: {} as Record<string, DatabaseColumn[] | undefined>,
    inspectingKeys: new Set<string>(),
    queryExecution: null as DatabaseExecution | null,
    queryLoading: false,
    queryError: '',
  })

  let generation = 0
  let objectsRequest = 0
  let databaseRequest = 0
  let databaseSwitch = Promise.resolve()
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
    objectsRequest++
    databaseRequest++
    databaseSwitch = Promise.resolve()
    state.selectedDatabase = ''
    state.objects = []
    state.loadedDatabases.clear()
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

    if (!target || !isSqlConnection(target)) {
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
      // MySQL 先只读取库名，用户选择后才读取对应库的对象。
      // PostgreSQL 需要先读取当前库的 schema，供侧栏选择。
      if (target.kind === 'postgresql')
        state.selectedDatabase = session.database
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
    resetData()
    await release(sessionId)
  }

  /** 刷新当前库结构，只替换该库的对象与字段缓存；空库也记为已加载，并忽略过期响应。 */
  async function refreshObjects(): Promise<void> {
    const sessionId = state.sessionId
    const selectedDatabase = state.selectedDatabase
    if (
      !sessionId ||
      !selectedDatabase ||
      selectedDatabase !== state.session?.database
    )
      return
    const request = ++objectsRequest

    state.objectsLoading = true
    state.objectsError = ''
    try {
      const objects = await database.listObjects(sessionId)
      if (state.sessionId === sessionId && request === objectsRequest) {
        if (connection.value?.kind === 'mysql') {
          state.objects = [
            ...state.objects.filter(
              object => object.schema !== selectedDatabase
            ),
            ...objects.filter(object => object.schema === selectedDatabase),
          ]
        } else state.objects = objects
        state.loadedDatabases.add(selectedDatabase)
        // 刷新当前库时使其字段缓存失效，其他库的字段仍可展开。
        const schemas = new Set(
          connection.value?.kind === 'mysql'
            ? [selectedDatabase]
            : objects.map(object => object.schema)
        )
        for (const key of Object.keys(state.columnsByObject)) {
          const schema = key.split('\u0000')[0]
          if (schema === selectedDatabase || schemas.has(schema ?? ''))
            delete state.columnsByObject[key]
        }
      }
    } catch (error) {
      if (state.sessionId === sessionId && request === objectsRequest)
        state.objectsError = database.errorMessage(error)
    } finally {
      if (state.sessionId === sessionId && request === objectsRequest)
        state.objectsLoading = false
    }
  }

  /** 更新库列表并清理已经被删除的库缓存，保留其他库已展开的元数据。 */
  async function refreshDatabases(): Promise<void> {
    const sessionId = state.sessionId
    if (!sessionId) return

    state.databasesLoading = true
    try {
      const databases = await database.listDatabases(sessionId)
      if (state.sessionId === sessionId) {
        state.databases = databases
        if (connection.value?.kind === 'mysql') {
          const available = new Set(databases)
          state.objects = state.objects.filter(object =>
            available.has(object.schema)
          )
          for (const name of state.loadedDatabases)
            if (!available.has(name)) state.loadedDatabases.delete(name)
        }
      }
    } catch (error) {
      if (state.sessionId === sessionId)
        state.objectsError = database.errorMessage(error)
    } finally {
      if (state.sessionId === sessionId) state.databasesLoading = false
    }
  }

  /** 串行切换连接池，优先使用已缓存结构；快速连续点击时只应用最后一次选择，避免旧响应覆盖新库。 */
  async function switchDatabase(name: string): Promise<void> {
    const sessionId = state.sessionId
    if (!sessionId || !name) return
    if (name === state.selectedDatabase && !state.objectsError) {
      await databaseSwitch
      return
    }

    const request = ++databaseRequest
    objectsRequest++
    state.selectedDatabase = name
    if (connection.value?.kind !== 'mysql') {
      state.objects = []
      state.columnsByObject = {}
      state.inspectingKeys.clear()
    }
    const cached = state.loadedDatabases.has(name)
    state.objectsLoading = !cached
    state.objectsError = ''
    // 仅串行替换连接池，旧库的元数据请求不阻塞下一次切库。
    const switched = databaseSwitch.then(async () => {
      if (state.sessionId !== sessionId || request !== databaseRequest) return
      if (name !== state.session?.database) {
        const session = await database.useDatabase(sessionId, name)
        if (state.sessionId !== sessionId) return
        state.session = session
      }
    })
    databaseSwitch = switched.catch(() => {})
    try {
      await switched
      if (state.sessionId !== sessionId || request !== databaseRequest) return
      if (!cached) await refreshObjects()
    } catch (error) {
      if (state.sessionId === sessionId && request === databaseRequest)
        state.objectsError = database.errorMessage(error)
    } finally {
      if (state.sessionId === sessionId && request === databaseRequest)
        state.objectsLoading = false
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

  async function executeSql(sql: string, maxRows = 500): Promise<void> {
    const sessionId = state.sessionId
    if (!sessionId || state.queryLoading) return

    state.queryLoading = true
    state.queryError = ''
    state.queryExecution = null
    try {
      const result = await database.execute(sessionId, sql, maxRows)
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
