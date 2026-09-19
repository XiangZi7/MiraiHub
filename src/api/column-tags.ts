/** 列「标签化显示」原生设置窗口的前端封装。 */

import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import type { ColumnTagConfig } from '@/types/database'
import { IS_TAURI } from '@/utils/window'
export { errorMessage } from './ssh'

export interface ColumnTagsRequest {
  /** 列宽/标签共用的作用域（通常是表标识），原样回传。 */
  scope: string
  column: string
  initial: ColumnTagConfig | null
  /** 当前页里该列出现过的值，供“从当前页取值”使用。 */
  sampleValues: string[]
}

export interface ColumnTagsResult {
  scope: string
  column: string
  /** null 表示取消该列的标签化。 */
  config: ColumnTagConfig | null
}

/** 与 Rust `platform/column_tags.rs` 的 RESULT_EVENT 一致。 */
const RESULT_EVENT = 'database-column-tags'

/** 主窗口请求 Rust 打开设置子窗口。 */
export function openColumnTagsWindow(
  request: ColumnTagsRequest
): Promise<void> {
  return invoke<void>('open_column_tags_window', { request })
}

/** 子窗口读取自己要编辑的列。 */
export function columnTagsTarget(): Promise<ColumnTagsRequest> {
  return invoke<ColumnTagsRequest>('column_tags_target')
}

/** 子窗口提交结果；Rust 会转发给主窗口并关闭子窗口。 */
export function columnTagsSubmit(
  config: ColumnTagConfig | null
): Promise<void> {
  return invoke<void>('column_tags_submit', { config })
}

/** 主窗口订阅设置结果。浏览器预览没有子窗口，返回空的取消函数。 */
export async function onColumnTagsResult(
  handler: (result: ColumnTagsResult) => void
): Promise<() => void> {
  if (!IS_TAURI) return () => {}
  return listen<ColumnTagsResult>(RESULT_EVENT, event => handler(event.payload))
}
