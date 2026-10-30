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
export { errorMessage, isAppError } from './ssh'

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
  await invoke('db_test_connection', { config })
}

export async function connect(
  config: DatabaseConfig
): Promise<DatabaseSession> {
  ensureTauri()
  return invoke<DatabaseSession>('db_connect', { config })
}

export async function describeSession(
  sessionId: string
): Promise<DatabaseSession> {
  ensureTauri()
  return invoke<DatabaseSession>('db_describe_session', { sessionId })
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
  return invoke<string[]>('db_alter_table_options', {
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
  await invoke('db_truncate_table', { sessionId, schema, name })
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
  await invoke('db_create_database', { sessionId, name })
}

export async function renameDatabase(
  sessionId: string,
  oldName: string,
  newName: string
): Promise<void> {
  ensureTauri()
  await invoke('db_rename_database', { sessionId, oldName, newName })
}

export async function dropDatabase(
  sessionId: string,
  name: string
): Promise<void> {
  ensureTauri()
  await invoke('db_drop_database', { sessionId, name })
}

export async function renameObject(
  sessionId: string,
  object: Pick<DatabaseObject, 'schema' | 'name' | 'kind' | 'identity'>,
  newName: string
): Promise<void> {
  ensureTauri()
  await invoke('db_rename_object', {
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
  await invoke('db_drop_object', {
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
  return invoke<MutationResult>('db_mutate_rows', { sessionId, request })
}

export async function execute(
  sessionId: string,
  sql: string,
  maxRows = 500
): Promise<DatabaseExecution> {
  ensureTauri()
  return invoke<DatabaseExecution>('db_execute', {
    sessionId,
    sql,
    maxRows,
    timeoutSecs: settingNumber('sqlExecutionTimeout', 300),
  })
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
    ...(taskId ? { taskId } : {}),
    sessionId,
    path,
    includeData: options.content !== 'structure',
    includeStructure: options.content !== 'data',
    includeDatabase: options.content !== 'data' && options.includeDatabase,
    dropExisting: options.content !== 'data' && options.dropExisting,
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
  return invoke('db_import_rows', { sessionId, tables, taskId })
}

export async function importSql(
  sessionId: string,
  path: string,
  options: DatabaseImportOptions
): Promise<DatabaseImportResult> {
  ensureTauri()
  return invoke<DatabaseImportResult>('db_import_sql', {
    sessionId,
    path,
    options: {
      ...options,
      includeDatabase: options.content !== 'data' && options.includeDatabase,
    },
  })
}
