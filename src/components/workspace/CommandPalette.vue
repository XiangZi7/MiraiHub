<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import {
  computed,
  nextTick,
  onMounted,
  reactive,
  ref,
  toRefs,
  watch,
} from 'vue'
import { useStorage } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import {
  COMMAND_GROUPS,
  COMMAND_SHORTCUT_SETTINGS,
} from '@/constants/workspace'
import { terminalCommandLabel } from '@/constants/terminal-commands'
import type { CommandItem } from '@/types'
import { cn } from '@/utils/cn'
import { translateLabel } from '@/i18n'
import { useConnectionsStore } from '@/stores/connections'
import { useDatabaseCommandSource } from '@/composables/useDatabaseCommandSource'
import { fuzzyScore } from '@/utils/fuzzy'
import { useSettings } from '@/composables/useSettings'
import { useWorkspaceNavigation } from '@/composables/useWorkspaceNavigation'
import { toast } from '@/composables/useToast'
import { useTerminalCommandsStore } from '@/stores/terminal-commands'
import { useWorkspaceStore } from '@/stores/workspace'
import {
  insertToTerminal,
  requestTerminalTarget,
} from '@/composables/useTerminalInsert'
import { formatShortcutForPlatform } from '@/utils/shortcut'
import { copyText } from '@/utils/clipboard'

const { t } = useI18n()

const emit = defineEmits<{
  /** 请求关闭面板 */
  close: []
  /** 执行某条全局命令 */
  run: [item: CommandItem]
  /** 切换到某个数据库连接 */
  openConnection: [id: string]
}>()

/** 面板里的一行。全局命令、数据库动作、对象与已保存查询统一成这一种 */
interface PaletteEntry {
  key: string
  label: string
  icon: string
  hint?: string
  shortcut?: string
  disabled?: boolean
  /** 返回 true 表示面板保持打开（例如切换到挑表模式） */
  exec: () => boolean | void
}

interface PaletteGroup {
  id: string
  label: string
  items: PaletteEntry[]
}

type Mode = 'all' | 'object' | 'query' | 'action'

/** 前缀 → 模式 */
const PREFIXES: Record<string, Mode> = {
  '#': 'object',
  '@': 'query',
  '>': 'action',
}
const MAX_RECENT = 20
const MAX_OBJECTS = 80

const inputRef = ref<HTMLInputElement>()
const listRef = ref<HTMLElement>()
const source = useDatabaseCommandSource()
const connections = useConnectionsStore()
const terminalCommands = useTerminalCommandsStore()
const workspace = useWorkspaceStore()
const { settings } = useSettings()
const { openConnection } = useWorkspaceNavigation()
// 最近使用的条目 key，越靠前越新
const recent = useStorage<string[]>('miraihub:palette-recent', [])

const state = reactive({
  keyword: '',
  cursor: 0,
  // "#" 模式下选中对象是打开数据还是进入表设计
  objectIntent: 'open' as 'open' | 'design',
})

const { keyword, cursor } = toRefs(state)

const mode = computed<Mode>(() => PREFIXES[state.keyword[0] ?? ''] ?? 'all')
const query = computed(() =>
  (mode.value === 'all' ? state.keyword : state.keyword.slice(1)).trim()
)

/** 进入挑表模式（切到 "#" 前缀），按意图决定选中后打开数据还是表设计，面板保持打开 */
function pickObjects(intent: 'open' | 'design'): boolean {
  state.objectIntent = intent
  state.keyword = '#'
  void nextTick(() => inputRef.value?.focus())
  return true
}

/** 取命令的快捷键：优先读用户设置，再按平台格式化显示 */
function commandShortcut(item: CommandItem): string {
  const key = COMMAND_SHORTCUT_SETTINGS[item.id]
  const value = key ? settings[key] : item.shortcut
  return typeof value === 'string' && value
    ? formatShortcutForPlatform(value)
    : ''
}

const globalEntries = computed<PaletteGroup[]>(() =>
  COMMAND_GROUPS.map(group => ({
    id: group.id,
    label: translateLabel(group.label),
    items: group.items.map(item => ({
      key: `cmd:${item.id}`,
      label: translateLabel(item.label),
      icon: item.icon,
      shortcut: commandShortcut(item) || undefined,
      exec: () => emit('run', item),
    })),
  }))
)

const actionEntries = computed<PaletteEntry[]>(() => {
  const current = source.value
  if (!current) return []
  return current.actions.map(action => ({
    key: `db:${action.id}`,
    label: translateLabel(action.label),
    icon: action.icon,
    hint: current.connectionName,
    disabled: action.enabled ? !action.enabled() : false,
    exec: () => {
      if (action.run === 'pick-object') return pickObjects('open')
      if (action.run === 'pick-design') return pickObjects('design')
      action.run()
    },
  }))
})

const connectionEntries = computed<PaletteEntry[]>(() =>
  connections.databaseConnections
    .filter(item => item.id !== source.value?.connectionId)
    .map(item => ({
      key: `conn:${item.id}`,
      label: item.name,
      icon: item.kind === 'redis' ? 'lucide:layers' : 'lucide:database',
      hint: item.kind,
      exec: () => emit('openConnection', item.id),
    }))
)

/** SSH 主机：选择后复用侧栏的打开连接逻辑 */
const sshEntries = computed<PaletteEntry[]>(() =>
  connections.sshConnections
    .filter(item => item.kind === 'ssh')
    .map(item => ({
      key: `ssh:${item.id}`,
      label: item.name,
      icon: 'lucide:server',
      hint: item.username ? `${item.username}@${item.host}` : item.host,
      exec: () => {
        void openConnection(item)
      },
    }))
)

/** 没有可插入的终端时，把命令片段复制到剪贴板并提示 */
async function copySnippet(command: string): Promise<void> {
  try {
    await copyText(command)
    toast.success(t('命令片段已复制，可粘贴到终端'))
  } catch (error) {
    console.warn('复制命令片段失败：', error)
    toast.error(t('复制失败'))
  }
}

/** 把命令片段插入当前标签页的终端（不执行），完成后把焦点还给终端；没有已连接的终端时退回复制 */
async function runSnippet(command: string): Promise<void> {
  const target = requestTerminalTarget(workspace.activeId)
  if (!target) {
    await copySnippet(command)
    return
  }
  try {
    if (await insertToTerminal(target.paste, command))
      toast.success(t('已插入终端，确认后按回车执行'))
  } catch (error) {
    toast.error({ title: t('插入终端失败'), description: String(error) })
  } finally {
    target.focus()
  }
}

/** 常用命令片段，与终端“常用指令”菜单共用一份数据 */
const snippetEntries = computed<PaletteEntry[]>(() =>
  terminalCommands.commands.map(item => ({
    key: `snippet:${item.id}`,
    label: terminalCommandLabel(item),
    icon: 'lucide:code-xml',
    hint: item.command,
    exec: () => {
      void runSnippet(item.command)
    },
  }))
)

const objectEntries = computed<PaletteEntry[]>(() => {
  const current = source.value
  if (!current) return []
  const design = state.objectIntent === 'design'
  return current.objects.value
    .filter(object => !design || object.kind === 'table')
    .map(object => ({
      key: `obj:${current.connectionId}:${object.schema}.${object.name}`,
      label: object.name,
      icon: object.kind === 'view' ? 'lucide:eye' : 'lucide:table',
      hint: object.schema,
      exec: () =>
        design ? current.designObject(object) : current.openObject(object),
    }))
})

const queryEntries = computed<PaletteEntry[]>(() => {
  const current = source.value
  if (!current) return []
  return current.savedQueries.value
    .filter(item => item.connectionId === current.connectionId)
    .map(item => ({
      key: `sq:${item.id}`,
      label: item.name,
      icon: 'lucide:file-code',
      hint: item.database,
      exec: () => current.openSavedQuery(item),
    }))
})

/** 模糊匹配并按分数排序；无关键词时最近使用置顶，其余保持原序 */
function rank(items: PaletteEntry[], limit = Infinity): PaletteEntry[] {
  const kw = query.value
  if (!kw) {
    const order = new Map(recent.value.map((key, index) => [key, index]))
    return [...items]
      .sort(
        (a, b) =>
          (order.get(a.key) ?? MAX_RECENT) - (order.get(b.key) ?? MAX_RECENT)
      )
      .slice(0, limit)
  }
  return items
    .map(item => ({
      item,
      score: Math.max(
        fuzzyScore(kw, item.label),
        item.hint ? fuzzyScore(kw, `${item.hint}.${item.label}`) - 5 : -1
      ),
    }))
    .filter(entry => entry.score >= 0)
    .map(entry => {
      // 最近使用的条目在分数上给一点加成
      const index = recent.value.indexOf(entry.item.key)
      return index < 0 ? entry : { ...entry, score: entry.score + 20 - index }
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(entry => entry.item)
}

const filteredGroups = computed<PaletteGroup[]>(() => {
  const groups: PaletteGroup[] = []
  const push = (id: string, label: string, items: PaletteEntry[]): void => {
    if (items.length) groups.push({ id, label, items })
  }
  const name = source.value?.connectionName ?? ''

  if (mode.value === 'object')
    push(
      'objects',
      state.objectIntent === 'design' ? t('设计表') : t('表与视图'),
      rank(objectEntries.value, MAX_OBJECTS)
    )
  else if (mode.value === 'query')
    push('saved-queries', t('已保存查询'), rank(queryEntries.value))
  else if (mode.value === 'action') {
    push('db-actions', name || t('数据库'), rank(actionEntries.value))
    push('db-connections', t('切换连接'), rank(connectionEntries.value))
  } else {
    const all = [
      ...actionEntries.value,
      ...globalEntries.value.flatMap(group => group.items),
      ...sshEntries.value,
      ...snippetEntries.value,
    ]
    // 无关键词时单独列出最近使用
    if (!query.value) {
      const byKey = new Map(all.map(item => [item.key, item]))
      const recentItems = recent.value
        .map(key => byKey.get(key))
        .filter((item): item is PaletteEntry => !!item)
        .slice(0, 5)
      push('recent', t('最近使用'), recentItems)
      push('db-actions', name || t('数据库'), actionEntries.value)
      for (const group of globalEntries.value)
        push(group.id, group.label, group.items)
    } else {
      push('db-actions', name || t('数据库'), rank(actionEntries.value))
      for (const group of globalEntries.value)
        push(group.id, group.label, rank(group.items))
      push('ssh-hosts', t('SSH 主机'), rank(sshEntries.value, 6))
      push('db-connections', t('切换连接'), rank(connectionEntries.value, 6))
      push('snippets', t('命令片段'), rank(snippetEntries.value, 6))
      // 普通模式也顺带搜表，少打一个前缀
      push('objects', t('表与视图'), rank(objectEntries.value, 8))
    }
  }
  return groups
})

/** 扁平列表，用于上下键定位 */
const flatItems = computed<PaletteEntry[]>(() =>
  filteredGroups.value.flatMap(group => group.items)
)

watch(filteredGroups, () => {
  state.cursor = 0
})

// 离开 "#" 模式后恢复默认意图
watch(mode, next => {
  if (next !== 'object') state.objectIntent = 'open'
})

watch(cursor, index => {
  void nextTick(() =>
    listRef.value
      ?.querySelector(`[data-index="${index}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  )
})

const placeholder = computed(() => {
  if (mode.value === 'object') return t('搜索表或视图…')
  if (mode.value === 'query') return t('搜索已保存查询…')
  if (mode.value === 'action') return t('搜索数据库动作或连接…')
  return t("输入命令…（# 表 · {'@'} 已保存查询 · > 数据库动作）")
})

// 打开时聚焦搜索框
onMounted(() => {
  void nextTick(() => inputRef.value?.focus())
})

/** 记录最近使用的条目，置顶并截断到上限 */
function remember(key: string): void {
  recent.value = [key, ...recent.value.filter(item => item !== key)].slice(
    0,
    MAX_RECENT
  )
}

/** 执行选中条目；exec 返回 true 时保持面板打开 */
function run(item: PaletteEntry): void {
  if (item.disabled) return
  remember(item.key)
  if (item.exec() === true) return
  emit('close')
}

/** 上下移动高亮光标，首尾循环 */
function move(step: number): void {
  const total = flatItems.value.length
  if (!total) return
  state.cursor = (state.cursor + step + total) % total
}

/** 面板键盘处理：上下切换、回车执行、退格删前缀回到普通模式 */
function onKeydown(event: KeyboardEvent): void {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    move(1)
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    move(-1)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    const item = flatItems.value[state.cursor]
    if (item) run(item)
  } else if (
    event.key === 'Backspace' &&
    mode.value !== 'all' &&
    state.keyword.length === 1
  ) {
    // 删掉前缀时回到普通模式
    state.objectIntent = 'open'
  }
}

/** 条目在扁平列表中的序号，用于高亮与 data-index 定位 */
function indexOf(item: PaletteEntry): number {
  return flatItems.value.indexOf(item)
}
</script>

<template>
  <div
    class="overlay-surface flex h-fit max-h-full w-130 max-w-full flex-col overflow-hidden"
    @keydown="onKeydown"
  >
    <Transition
      appear
      enter-active-class="transition-[opacity,translate] duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="opacity-0 -translate-y-1"
    >
      <div class="flex min-h-0 flex-col">
        <!-- 搜索框 -->
        <label
          class="border-line flex h-12 shrink-0 items-center gap-2.5 border-b px-4"
        >
          <AppIcon
            name="lucide:search"
            :size="15"
            class="text-txt-4"
          />
          <input
            ref="inputRef"
            v-model="keyword"
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-controls="command-palette-list"
            :aria-expanded="true"
            :placeholder="placeholder"
            class="text-txt placeholder:text-txt-4 w-full bg-transparent text-[13px] outline-none"
          />
          <button
            type="button"
            class="icon-btn size-6"
            :title="t('关闭 (Esc)')"
            @click="emit('close')"
          >
            <AppIcon
              name="lucide:x"
              :size="13"
            />
          </button>
        </label>

        <!-- 命令列表 -->
        <div
          id="command-palette-list"
          ref="listRef"
          role="listbox"
          class="scroll-thin max-h-100 min-h-0 overflow-y-auto p-1.5"
        >
          <div
            v-for="group in filteredGroups"
            :key="group.id"
            class="mb-1 last:mb-0"
          >
            <p class="group-label py-1.5">
              {{ group.label }}
            </p>

            <button
              v-for="item in group.items"
              :key="`${group.id}-${item.key}`"
              type="button"
              role="option"
              :data-index="indexOf(item)"
              :aria-selected="indexOf(item) === cursor"
              :aria-disabled="item.disabled"
              :class="
                cn(
                  'row-item relative w-full transition-colors duration-100 motion-reduce:transition-none',
                  indexOf(item) === cursor && 'bg-raised',
                  item.disabled && 'opacity-45'
                )
              "
              @click="run(item)"
              @mouseenter="cursor = indexOf(item)"
            >
              <span
                aria-hidden="true"
                :class="
                  cn(
                    'bg-accent absolute top-1.5 bottom-1.5 left-0 w-0.5 rounded-full transition-[opacity,scale] duration-150 motion-reduce:transition-none',
                    indexOf(item) === cursor
                      ? 'scale-y-100 opacity-100'
                      : 'scale-y-50 opacity-0'
                  )
                "
              />
              <AppIcon
                :name="item.icon"
                :size="14"
                class="text-txt-3 shrink-0"
              />
              <span
                class="text-txt-2 min-w-0 flex-1 truncate text-left text-xs"
                >{{ item.label }}</span
              >
              <span
                v-if="item.hint"
                class="text-txt-4 max-w-40 shrink-0 truncate text-[10.5px]"
                >{{ item.hint }}</span
              >
              <span
                v-if="item.shortcut"
                class="kbd"
                >{{ item.shortcut }}</span
              >
            </button>
          </div>

          <p
            v-if="!flatItems.length"
            class="text-txt-4 py-8 text-center text-xs"
          >
            {{
              mode !== 'all' && !source
                ? t('请先打开并连接一个数据库')
                : t('没有匹配的命令')
            }}
          </p>
        </div>

        <!-- 底部提示 -->
        <footer
          class="border-line text-txt-4 flex shrink-0 items-center gap-3 border-t px-4 py-2 text-[10.5px]"
        >
          <span class="flex items-center gap-1">
            <AppIcon
              name="lucide:corner-down-left"
              :size="11"
            />
            {{ t('执行') }}
          </span>
          <span class="flex items-center gap-1">
            <AppIcon
              name="lucide:arrow-up-down"
              :size="11"
            />
            {{ t('切换') }}
          </span>
          <span class="flex items-center gap-1.5">
            <span class="kbd">#</span>{{ t('表') }} <span class="kbd">@</span
            >{{ t('查询') }} <span class="kbd">&gt;</span>{{ t('动作') }}
          </span>
          <div class="flex-1" />
          <span>{{ t('Esc 关闭') }}</span>
        </footer>
      </div>
    </Transition>
  </div>
</template>
