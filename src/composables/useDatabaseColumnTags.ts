import { computed, type Ref } from 'vue'
import { useStorage } from '@vueuse/core'
import { i18n } from '@/i18n'
import { onColumnTagsResult } from '@/api/column-tags'
import { toast } from '@/composables/useToast'
import { CONNECTION_TAG_COLORS } from '@/constants/connection'
import type { ConnectionTagColor } from '@/types/connection'
import type {
  ColumnTagConfig,
  ColumnTagRule,
  ColumnTagStyle,
} from '@/types/database'

/**
 * 记住数据库表格列的标签化显示规则。与列宽一样按「作用域」分组，
 * 表浏览器用表名作作用域，同一张表重开后规则仍在。
 *
 * 只影响显示：单元格值与规则里的 value 精确匹配时渲染成标签，
 * 编辑、筛选与提交仍然使用原始值。
 */
const STORAGE_KEY = 'miraihub:database-column-tags'
const VISIBLE_KEY = 'miraihub:database-column-tags-visible'
/** 超过此数量后淘汰最早写入的作用域，避免 localStorage 无限增长。 */
const MAX_SCOPES = 80

/** 首次打开设置时最多自动带入的取值数，再多就不像枚举列了。 */
export const AUTO_FILL_LIMIT = 12
/** 自动带入的值不能太长：哈希、JSON、长文本都不是标签的料。 */
const AUTO_FILL_MAX_LENGTH = 32
/** 从当前页收集取值样本的上限与单个值的长度上限。 */
export const SAMPLE_VALUE_LIMIT = 50
export const SAMPLE_VALUE_MAX_LENGTH = 64
/** 标签上显示的文字超过此长度时截断，避免一个超长值把整行撑开。 */
export const TAG_LABEL_MAX_LENGTH = 24

type ScopedTags = Record<string, Record<string, ColumnTagConfig>>

const store = useStorage<ScopedTags>(STORAGE_KEY, {})
/** 全局开关：关掉后所有表都按原值显示，规则仍然保留。 */
export const tagsVisible = useStorage<boolean>(VISIBLE_KEY, true)

const COLOR_IDS = CONNECTION_TAG_COLORS.map(option => option.id)
const STYLES: readonly ColumnTagStyle[] = ['badge', 'dot']

export function toggleTagsVisible(): void {
  tagsVisible.value = !tagsVisible.value
}

export function tagColorCss(color: ConnectionTagColor): string {
  return (
    CONNECTION_TAG_COLORS.find(option => option.id === color)?.css ??
    'var(--color-accent)'
  )
}

/** 给第 index 条规则挑一个默认颜色，让自动填充出来的标签一眼能区分。 */
export function defaultTagColor(index: number): ConnectionTagColor {
  return COLOR_IDS[index % COLOR_IDS.length] ?? 'violet'
}

/** 标签文字：优先显示文字，其次原值，过长截断。 */
export function tagLabel(rule: Pick<ColumnTagRule, 'value' | 'label'>): string {
  const text = rule.label.trim() || rule.value
  return text.length > TAG_LABEL_MAX_LENGTH
    ? `${text.slice(0, TAG_LABEL_MAX_LENGTH)}…`
    : text
}

/**
 * 当前页的取值适合直接变成规则吗？
 * 枚举列（状态、方法、分类）取值少且短；哈希、时间戳这类每行不同或很长的值不带入。
 */
export function autoFillCandidates(values: readonly string[]): string[] {
  if (!values.length || values.length > AUTO_FILL_LIMIT) return []
  if (values.some(value => value.length > AUTO_FILL_MAX_LENGTH)) return []
  return [...values]
}

/** 校验来自其他窗口或存储的配置结构。 */
export function isColumnTagConfig(value: unknown): value is ColumnTagConfig {
  if (!value || typeof value !== 'object') return false
  const config = value as Record<string, unknown>
  return (
    typeof config.style === 'string' &&
    Array.isArray(config.rules) &&
    config.rules.every(
      rule =>
        rule &&
        typeof rule === 'object' &&
        typeof (rule as ColumnTagRule).value === 'string' &&
        typeof (rule as ColumnTagRule).label === 'string' &&
        typeof (rule as ColumnTagRule).color === 'string'
    )
  )
}

/** 去掉空值与重复值；重复时保留靠前的规则。 */
export function normalizeTagConfig(
  config: ColumnTagConfig
): ColumnTagConfig | null {
  const seen = new Set<string>()
  const rules: ColumnTagRule[] = []
  for (const rule of config.rules) {
    const value = rule.value.trim()
    if (!value || seen.has(value)) continue
    seen.add(value)
    rules.push({
      value,
      label: rule.label.trim(),
      color: COLOR_IDS.includes(rule.color) ? rule.color : 'violet',
    })
  }
  if (!rules.length) return null
  return {
    style: STYLES.includes(config.style) ? config.style : 'badge',
    rules,
  }
}

function write(scope: string, tags: Record<string, ColumnTagConfig>): void {
  const next: ScopedTags = { ...store.value }
  if (Object.keys(tags).length) next[scope] = tags
  else delete next[scope]
  const scopes = Object.keys(next)
  for (const stale of scopes.slice(0, Math.max(0, scopes.length - MAX_SCOPES)))
    delete next[stale]
  store.value = next
}

/** 写入某个作用域下一列的规则；传 null 取消该列的标签化。 */
export function applyColumnTags(
  scope: string,
  column: string,
  config: ColumnTagConfig | null
): ColumnTagConfig | null {
  if (!scope || !column) return null
  const next = { ...(store.value[scope] ?? {}) }
  const normalized =
    config && isColumnTagConfig(config) ? normalizeTagConfig(config) : null
  if (normalized) next[column] = normalized
  else delete next[column]
  write(scope, next)
  return normalized
}

/** 保存结果的统一提示文案。 */
export function columnTagsMessage(
  column: string,
  applied: ColumnTagConfig | null
): string {
  return applied
    ? i18n.global.t('已为“{value0}”设置 {value1} 条标签规则', {
        value0: column,
        value1: applied.rules.length,
      })
    : i18n.global.t('已取消“{value0}”的标签化显示', { value0: column })
}

let receiver: Promise<() => void> | undefined

/**
 * 主窗口接收原生设置子窗口回传的结果。整个窗口只订阅一次，
 * 多个表格视图同时打开时也不会重复写入或重复提示。
 */
export function startColumnTagsReceiver(): void {
  receiver ??= onColumnTagsResult(result => {
    const applied = applyColumnTags(result.scope, result.column, result.config)
    toast.success(columnTagsMessage(result.column, applied))
  }).catch(error => {
    receiver = undefined
    console.warn('订阅标签设置结果失败：', error)
    return () => {}
  })
}

export function useDatabaseColumnTags(scope: Ref<string>) {
  const tags = computed<Record<string, ColumnTagConfig>>(
    () => (scope.value && store.value[scope.value]) || {}
  )
  /** 每列一张 value → 规则 的查表，渲染时不必逐行遍历规则。 */
  const lookups = computed(() => {
    const result = new Map<string, Map<string, ColumnTagRule>>()
    for (const [column, config] of Object.entries(tags.value)) {
      const lookup = new Map<string, ColumnTagRule>()
      for (const rule of config.rules)
        if (!lookup.has(rule.value)) lookup.set(rule.value, rule)
      result.set(column, lookup)
    }
    return result
  })
  const hasAny = computed(() => Object.keys(tags.value).length > 0)

  function configOf(column: string): ColumnTagConfig | null {
    return tags.value[column] ?? null
  }

  function hasTags(column: string): boolean {
    return Boolean(tags.value[column])
  }

  /** 单元格值命中的规则；NULL 与未配置的列返回 null。 */
  function matchTag(
    column: string,
    value: string | null
  ): ColumnTagRule | null {
    if (value === null) return null
    const lookup = lookups.value.get(column)
    if (!lookup) return null
    return lookup.get(value) ?? lookup.get(value.trim()) ?? null
  }

  function setTags(
    column: string,
    config: ColumnTagConfig | null
  ): ColumnTagConfig | null {
    return applyColumnTags(scope.value, column, config)
  }

  return { tags, lookups, hasAny, configOf, hasTags, matchTag, setTags }
}
