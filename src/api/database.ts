import { i18n } from '@/i18n'
/** 数据库 Tauri 命令的前端封装。 */

import { invoke } from '@tauri-apps/api/core'
import type {
  DatabaseColumn,
  DatabaseConfig,
  DatabaseExecution,
  DatabaseExportOptions,
  DatabaseExportResult,
  DatabaseImportOptions,
  DatabaseImportResult,
  DatabaseObject,
  DatabaseObjectKind,
  DatabaseRoutineDetail,
  DatabaseRowPage,
  DatabaseSession,
  DatabaseTableDetail,
  DatabaseTableOptions,
  MutationRequest,
  MutationResult,
  RowPageRequest,
  TableAlterOptions,
} from '@/types/database'
import { IS_TAURI } from '@/utils/window'
import { settingNumber } from '@/composables/useSettings'
import { isAppError, resolveSshRoute } from './ssh'
import { get as getConnection } from './connections'
import { isSshConnection, toSshConfig } from '@/types/connection'
import { requestGuardConfirm } from '@/composables/useDatabaseGuard'
export { errorMessage, isAppError } from './ssh'

type TunnelFields = Pick<DatabaseConfig, 'sshTunnel' | 'sshTunnelConnectionId'>

/** 把隧道引用的已保存 SSH 连接和跳板解析成后端需要的完整配置。 */
export async function resolveTunnel<T extends TunnelFields>(
  config: T
): Promise<T> {
  const { sshTunnelConnectionId: id, ...rest } = config
  let tunnel = config.sshTunnel
  if (id) {
    const connection = await getConnection(id)
    if (!connection || !isSshConnection(connection))
      throw new Error(i18n.global.t('隧道使用的 SSH 连接不存在，请重新选择'))
    tunnel = toSshConfig(connection)
  }
  if (!tunnel) return rest as T
  return { ...rest, sshTunnel: await resolveSshRoute(tunnel) } as T
}

/** 后端要求确认时弹框输入库名，确认后带凭据重试一次；取消则抛回原错误。 */
async function guardedInvoke<T>(
  command: string,
  args: Record<string, unknown>
): Promise<T> {
  ensureTauri()
  try {
    return await invoke<T>(command, args)
  } catch (error) {
    if (!isAppError(error) || error.kind !== 'confirmRequired') throw error
    const confirm = await requestGuardConfirm(
      error.message,
      error.confirm ?? 'CONFIRM'
    )
    if (confirm === null) throw error
    return invoke<T>(command, { ...args, confirm })
  }
}

export async function forkSession(
  sessionId: string,
  database: string
): Promise<DatabaseSession> {
  ensureTauri()
  return invoke('db_fork_session', { sessionId, database })
}
export async function beginExportFile(taskId: string): Promise<void> {
  ensureTauri()
  await invoke('db_begin_export_file', { taskId })
}
export async function finishExportFile(taskId: string): Promise<void> {
  ensureTauri()
  await invoke('db_finish_export_file', { taskId })
}
export async function writeExportFile(
  path: string,
  bytes: Uint8Array,
  taskId: string
): Promise<void> {
  ensureTauri()
  await invoke('db_write_export_file', {
    path,
    bytes: Array.from(bytes),
    taskId,
  })
}

function ensureTauri(): void {
  if (!IS_TAURI)
    throw new Error(i18n.global.t('数据库功能需要在桌面应用中运行'))
}

export async function testConnection(config: DatabaseConfig): Promise<void> {
  ensureTauri()
  await invoke('db_test_connection', { config: await resolveTunnel(config) })
}

export async function connect(
  config: DatabaseConfig
): Promise<DatabaseSession> {
  ensureTauri()
  return invoke<DatabaseSession>('db_connect', {
    config: await resolveTunnel(config),
  })
}

export async function describeSession(
  sessionId: string
): Promise<DatabaseSession> {
  ensureTauri()
  return invoke<DatabaseSession>('db_describe_session', { sessionId })
}

/** 在会话连接池上执行 SELECT 1，返回往返耗时（毫秒）。 */
export async function ping(sessionId: string): Promise<number> {
  ensureTauri()
  return invoke<number>('db_ping', { sessionId })
}

export async function useDatabase(
  sessionId: string,
  database: string
): Promise<DatabaseSession> {
  ensureTauri()
  return invoke<DatabaseSession>('db_use_database', { sessionId, database })
}

export async function disconnect(sessionId: string): Promise<void> {
  ensureTauri()
  await invoke('db_disconnect', { sessionId })
}

export async function listObjects(
  sessionId: string
): Promise<DatabaseObject[]> {
  ensureTauri()
  return invoke<DatabaseObject[]>('db_list_objects', { sessionId })
}

export async function listDatabases(sessionId: string): Promise<string[]> {
  ensureTauri()
  return invoke<string[]>('db_list_databases', { sessionId })
}

export async function describeObject(
  sessionId: string,
  schema: string,
  name: string
): Promise<DatabaseColumn[]> {
  ensureTauri()
  return invoke<DatabaseColumn[]>('db_describe_object', {
    sessionId,
    schema,
    name,
  })
}

export async function tableDetail(
  sessionId: string,
  schema: string,
  name: string,
  kind: DatabaseObjectKind
): Promise<DatabaseTableDetail> {
  ensureTauri()
  return invoke<DatabaseTableDetail>('db_table_detail', {
    sessionId,
    schema,
    name,
    kind,
  })
}

export async function tableOptions(
  sessionId: string,
  schema: string,
  name: string
): Promise<DatabaseTableOptions | null> {
  ensureTauri()
  return invoke<DatabaseTableOptions | null>('db_table_options', {
    sessionId,
    schema,
    name,
  })
}

export async function completionColumns(
  sessionId: string,
  schema: string
): Promise<string[]> {
  ensureTauri()
  return invoke<string[]>('db_completion_columns', { sessionId, schema })
}

/** 读取“表名 → 字段”对，供 SQL 编辑器按别名限定补全字段。 */
export async function completionTableColumns(
  sessionId: string,
  schema: string
): Promise<[string, string][]> {
  ensureTauri()
  return invoke<[string, string][]>('db_completion_table_columns', {
    sessionId,
    schema,
  })
}

export async function tableOptionChoices(sessionId: string): Promise<{
  engines: string[]
  collations: [string, string][]
}> {
  ensureTauri()
  return invoke('db_table_option_choices', { sessionId })
}

export async function alterTableOptions(
  sessionId: string,
  schema: string,
  name: string,
  options: TableAlterOptions
): Promise<string[]> {
  ensureTauri()
  return guardedInvoke<string[]>('db_alter_table_options', {
    sessionId,
    schema,
    name,
    options,
  })
}

export async function truncateTable(
  sessionId: string,
  schema: string,
  name: string
): Promise<void> {
  ensureTauri()
  await guardedInvoke('db_truncate_table', { sessionId, schema, name })
}

export async function routineDetail(
  sessionId: string,
  object: Pick<DatabaseObject, 'schema' | 'name' | 'kind' | 'identity'>
): Promise<DatabaseRoutineDetail> {
  ensureTauri()
  return invoke<DatabaseRoutineDetail>('db_routine_detail', {
    sessionId,
    schema: object.schema,
    name: object.name,
    kind: object.kind,
    identity: object.identity,
  })
}

export async function createDatabase(
  sessionId: string,
  name: string
): Promise<void> {
  ensureTauri()
  await guardedInvoke('db_create_database', { sessionId, name })
}

export async function renameDatabase(
  sessionId: string,
  oldName: string,
  newName: string
): Promise<void> {
  ensureTauri()
  await guardedInvoke('db_rename_database', { sessionId, oldName, newName })
}

export async function dropDatabase(
  sessionId: string,
  name: string
): Promise<void> {
  ensureTauri()
  await guardedInvoke('db_drop_database', { sessionId, name })
}

export async function renameObject(
  sessionId: string,
  object: Pick<DatabaseObject, 'schema' | 'name' | 'kind' | 'identity'>,
  newName: string
): Promise<void> {
  ensureTauri()
  await guardedInvoke('db_rename_object', {
    sessionId,
    schema: object.schema,
    name: object.name,
    newName,
    kind: object.kind,
    identity: object.identity,
  })
}

export async function dropObject(
  sessionId: string,
  object: Pick<DatabaseObject, 'schema' | 'name' | 'kind' | 'identity'>
): Promise<void> {
  ensureTauri()
  await guardedInvoke('db_drop_object', {
    sessionId,
    schema: object.schema,
    name: object.name,
    kind: object.kind,
    identity: object.identity,
  })
}

export async function countRows(
  sessionId: string,
  schema: string,
  name: string
): Promise<number> {
  ensureTauri()
  return invoke<number>('db_count_rows', { sessionId, schema, name })
}

export async function fetchRows(
  sessionId: string,
  request: RowPageRequest
): Promise<DatabaseRowPage> {
  ensureTauri()
  return invoke<DatabaseRowPage>('db_fetch_rows', { sessionId, request })
}

export async function mutateRows(
  sessionId: string,
  request: MutationRequest
): Promise<MutationResult> {
  ensureTauri()
  return guardedInvoke<MutationResult>('db_mutate_rows', { sessionId, request })
}

/** 预览表格改动将要执行的 SQL（只渲染，不提交）。 */
export async function previewMutations(
  sessionId: string,
  request: MutationRequest
): Promise<string[]> {
  ensureTauri()
  return invoke<string[]>('db_preview_mutations', { sessionId, request })
}

export async function execute(
  sessionId: string,
  sql: string,
  maxRows = 500
): Promise<DatabaseExecution> {
  ensureTauri()
  return guardedInvoke<DatabaseExecution>('db_execute', {
    sessionId,
    sql,
    maxRows,
    timeoutSecs: settingNumber('sqlExecutionTimeout', 300),
  })
}

/** 读取单条语句的 JSON 执行计划（只估算，不执行语句）。 */
export async function explain(sessionId: string, sql: string): Promise<string> {
  ensureTauri()
  return invoke<string>('db_explain', { sessionId, sql })
}

export async function cancelQuery(sessionId: string): Promise<boolean> {
  ensureTauri()
  return invoke<boolean>('db_cancel_query', { sessionId })
}

export async function exportSql(
  sessionId: string,
  path: string,
  options: DatabaseExportOptions,
  taskId?: string
): Promise<DatabaseExportResult> {
  ensureTauri()
  return invoke<DatabaseExportResult>('db_export_sql', {
    request: {
      ...(taskId ? { taskId } : {}),
      sessionId,
      path,
      includeData: options.content !== 'structure',
      includeStructure: options.content !== 'data',
      includeDatabase: options.content !== 'data' && options.includeDatabase,
      dropExisting: options.content !== 'data' && options.dropExisting,
    },
  })
}

/** 逐块写入任务临时文件，最后一块完成后才替换目标文件。 */
export async function writeExportChunk(
  path: string,
  bytes: Uint8Array,
  taskId: string,
  complete = false
): Promise<void> {
  ensureTauri()
  await invoke('db_write_export_file', {
    path,
    bytes: Array.from(bytes),
    taskId,
    complete,
  })
}

/** 读取用户选择的本地导入文件，由后端统一限制大小。 */
export async function readImportFile(path: string): Promise<Uint8Array> {
  ensureTauri()
  return new Uint8Array(await invoke<number[]>('db_read_import_file', { path }))
}
/** 只读分析 SQL 的源表和字段，数据导入前必须确认匹配结果。 */
export async function previewImportSql(
  sessionId: string,
  path: string
): Promise<import('@/types/database-import').DatabaseSqlImportPreview> {
  ensureTauri()
  return invoke('db_preview_import_sql', { sessionId, path })
}
/** 获取当前目标库的可写表和字段，用于导入匹配与模板生成。 */
export async function importCatalog(
  sessionId: string
): Promise<import('@/types/database-import').DatabaseImportTarget[]> {
  ensureTauri()
  return invoke('db_import_catalog', { sessionId })
}
/** 在同一事务中追加 Excel 各工作表的数据，任务进度由文件传输中心接收。 */
export async function importRows(
  sessionId: string,
  tables: import('@/types/database-import').DatabaseImportRowsTable[],
  taskId: string
): Promise<DatabaseImportResult> {
  ensureTauri()
  return guardedInvoke('db_import_rows', { sessionId, tables, taskId })
}

export async function importSql(
  sessionId: string,
  path: string,
  options: DatabaseImportOptions
): Promise<DatabaseImportResult> {
  ensureTauri()
  return guardedInvoke<DatabaseImportResult>('db_import_sql', {
    sessionId,
    path,
    options: {
      ...options,
      includeDatabase: options.content !== 'data' && options.includeDatabase,
    },
  })
}
