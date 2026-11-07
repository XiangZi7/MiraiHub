import { shallowRef } from 'vue'
import type { DatabaseKind } from '@/types/database'
import {
  bindSqlParams,
  rememberSqlParams,
  rememberedSqlParams,
  scanSqlParams,
  type RememberedSqlParam,
  type SqlParamScan,
} from '@/utils/sql-params'

export interface SqlParamsRequest {
  sql: string
  keys: string[]
  initial: Record<string, RememberedSqlParam>
  resolve: (values: Record<string, RememberedSqlParam> | null) => void
}

/** 当前等待填写的参数面板；同一时间只有一个，面板组件挂在数据库视图里。 */
const request = shallowRef<SqlParamsRequest | null>(null)

export function useSqlParamsPrompt() {
  /**
   * SQL 含占位符时弹出变量面板，确认后返回改写后的 SQL 与绑定值；
   * 不含占位符原样返回，取消返回 null。
   */
  async function prepare(
    sql: string,
    kind: DatabaseKind,
    scope: string
  ): Promise<{ sql: string; params: (string | null)[] } | null> {
    const scan: SqlParamScan = scanSqlParams(sql, kind)
    if (!scan.keys.length) return { sql, params: [] }
    request.value?.resolve(null)
    const values = await new Promise<Record<
      string,
      RememberedSqlParam
    > | null>(resolve => {
      request.value = {
        sql,
        keys: scan.keys,
        initial: rememberedSqlParams(scope, scan.keys),
        resolve,
      }
    })
    request.value = null
    if (!values) return null
    rememberSqlParams(scope, values)
    return bindSqlParams(
      sql,
      kind,
      scan,
      Object.fromEntries(
        Object.entries(values).map(([key, item]) => [
          key,
          item.isNull ? null : item.value,
        ])
      )
    )
  }

  return { request, prepare }
}
