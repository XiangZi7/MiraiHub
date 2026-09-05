/** 数据库 Tauri 命令的前端封装。 */

import { invoke } from '@tauri-apps/api/core'
import type {
  DatabaseColumn,
  DatabaseConfig,
  DatabaseExecution,
  DatabaseExportResult,
  DatabaseImportResult,
  DatabaseObject,
  DatabaseObjectKind,
  DatabaseRoutineDetail,
  DatabaseRowPage,
  DatabaseSession,
  DatabaseTableDetail,
  MutationRequest,
  MutationResult,
  RowPageRequest,
} from '@/types/database'
import { IS_TAURI } from '@/utils/window'
import { settingNumber } from '@/composables/useSettings'
export { errorMessage, isAppError } from './ssh'

function ensureTauri(): void {
  if (!IS_TAURI) throw new Error('数据库功能需要在桌面应用中运行')
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
  includeData: boolean,
  dropExisting: boolean
): Promise<DatabaseExportResult> {
  ensureTauri()
  return invoke<DatabaseExportResult>('db_export_sql', {
    sessionId,
    path,
    includeData,
    dropExisting,
  })
}

export async function importSql(
  sessionId: string,
  path: string
): Promise<DatabaseImportResult> {
  ensureTauri()
  return invoke<DatabaseImportResult>('db_import_sql', { sessionId, path })
}
