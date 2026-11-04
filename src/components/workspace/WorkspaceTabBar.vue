<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, reactive } from 'vue'
import TabBar, { type TabItem } from '@/components/ui/TabBar.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import type { WorkspaceTab } from '@/composables/useWorkspaceTabs'
import type { ContextMenuItem } from '@/types/context-menu'
import { copyText } from '@/utils/clipboard'
import { openConnectionWindow } from '@/utils/window'
import { toast } from '@/composables/useToast'
import { isDatabaseConnection } from '@/types/connection'
import { DATABASE_CONNECTION_ICONS } from '@/constants/connection'
import type { TabDragEvent } from '@/composables/useTabReorder'
import {
  databaseWorkspaceTabId,
  useDatabaseWorkspaceTabs,
} from '@/composables/useDatabaseWorkspaceTabs'

const { t } = useI18n()
defineOptions({ inheritAttrs: false })
const props = defineProps<{
  tabs: readonly WorkspaceTab[]
  active: string
  closeWarning: (ids: string[]) => string
}>()
const emit = defineEmits<{
  'update:active': [id: string]
  add: []
  closeMany: [ids: string[]]
  reorder: [from: number, to: number]
  action: [id: string, action: string]
  tabDragMove: [drag: TabDragEvent]
  tabDrop: [drag: TabDragEvent]
  tabDragEnd: []
}>()
const state = reactive({ closingIds: [] as string[], warning: '' })
const databaseTabs = useDatabaseWorkspaceTabs()
const connectionItems = computed<TabItem[]>(() =>
  props.tabs.map(tab => ({
    id: tab.id,
    label: tab.connection.name,
    ...(isDatabaseConnection(tab.connection)
      ? {
          icon: DATABASE_CONNECTION_ICONS[tab.connection.kind].name,
          iconSize: 18,
        }
      : {
          dot:
            tab.status === 'connected'
              ? ('success' as const)
              : tab.status === 'connecting'
                ? ('amber' as const)
                : ('txt-3' as const),
        }),
    tooltip: [
      { label: t('连接'), value: tab.connection.name },
      { label: 'Host', value: `${tab.connection.host}:${tab.connection.port}` },
      ...(isDatabaseConnection(tab.connection)
        ? [{ label: 'Db', value: tab.connection.settings.database || '—' }]
        : [{ label: t('用户名'), value: tab.connection.username || '—' }]),
      { label: t('备注'), value: tab.connection.description || '—' },
    ],
    closable: true,
  }))
)
const contentTargets = computed(() => {
  const targets = new Map<string, { connectionId: string; tabId: string }>()
  for (const connection of props.tabs)
    for (const tab of databaseTabs?.get(connection.id)?.tabs() ?? [])
      targets.set(databaseWorkspaceTabId(connection.id, tab.id), {
        connectionId: connection.id,
        tabId: tab.id,
      })
  return targets
})
const items = computed<TabItem[]>(() =>
  connectionItems.value.flatMap(connection => [
    connection,
    ...(databaseTabs?.get(connection.id)?.tabs() ?? []).map(tab => ({
      ...tab,
      id: databaseWorkspaceTabId(connection.id, tab.id),
    })),
  ])
)
const displayedActive = computed(() => {
  const current = databaseTabs?.get(props.active)?.activeId()
  return current ? databaseWorkspaceTabId(props.active, current) : props.active
})

// 主标签栏的查询和表入口切换所属连接中的内容，不重建连接或后台 Agent。
function activate(id: string): void {
  const target = contentTargets.value.get(id)
  if (target) {
    databaseTabs?.get(target.connectionId)?.select(target.tabId)
    emit('update:active', target.connectionId)
  } else {
    databaseTabs?.get(id)?.select('')
    emit('update:active', id)
  }
}

// 数据库分组的加号直接新建查询，其他分组沿用新增连接入口。
function add(): void {
  const current = databaseTabs?.get(props.active)
  if (current) current.add()
  else emit('add')
}

// 查询操作菜单保留复制、保存等现有动作，连接菜单继续管理连接。
function contextItems(id: string): ContextMenuItem[] {
  const content = contentTargets.value.get(id)
  if (content)
    return (
      databaseTabs?.get(content.connectionId)?.contextItems(content.tabId) ?? []
    )
  const tab = props.tabs.find(tab => tab.id === id)
  if (!tab) return []
  const local = tab.connection.kind === 'local'
  return [
    {
      id: 'reconnect',
      label:
        tab.status === 'connected'
          ? local
            ? t('重启本地终端')
            : t('重新连接')
          : local
            ? t('启动本地终端')
            : t('连接'),
      icon: 'lucide:refresh-cw',
      disabled: tab.status === 'connecting',
    },
    {
      id: 'disconnect',
      label: local ? t('停止本地终端') : t('断开连接'),
      icon: 'lucide:unplug',
      disabled: tab.status !== 'connected',
    },
    ...(tab.connection.kind === 'ssh'
      ? [
          {
            id: 'split',
            label: t('新建分屏终端'),
            icon: 'lucide:columns-2',
          },
          { id: 'files', label: t('打开远端文件'), icon: 'lucide:folder-open' },
        ]
      : []),
    {
      id: 'edit',
      label: t('编辑连接配置'),
      icon: 'lucide:settings-2',
      separatorBefore: true,
    },
    {
      id: 'copy-connection',
      label: t('复制连接信息'),
      icon: 'lucide:clipboard',
    },
  ]
}
// 内容标签交给数据库工作区处理，连接标签沿用连接配置和会话操作。
async function action(id: string, action: string): Promise<void> {
  const content = contentTargets.value.get(id)
  if (content) {
    emit('update:active', content.connectionId)
    await databaseTabs?.get(content.connectionId)?.action(content.tabId, action)
    return
  }
  const tab = props.tabs.find(tab => tab.id === id)
  if (
    !tab ||
    !contextItems(id).some(item => item.id === action && !item.disabled)
  )
    return
  if (action === 'edit') {
    openConnectionWindow(
      tab.connection.kind === 'local'
        ? 'local'
        : tab.connection.kind === 'ssh'
          ? 'ssh'
          : 'database',
      id
    )
    return
  }
  if (action === 'copy-connection') {
    const c = tab.connection
    const text =
      c.kind === 'local' && 'shell' in c.settings
        ? `${c.name}\n${c.settings.shell}\n${c.settings.workingDirectory || t('默认工作目录')}`
        : `${c.name}\n${c.kind.toUpperCase()} ${c.username}@${c.host}:${c.port}`
    try {
      await copyText(text)
      toast.success(t('连接信息已复制（不含密码和密钥）'))
    } catch {
      toast.error(t('复制失败，请检查剪贴板权限'))
    }
    return
  }
  emit('action', id, action)
}
// 按标签类型关闭；内容标签沿用未保存草稿确认，连接仍使用连接级确认。
function requestClose(ids: string[]): void {
  let current = ids.filter(id => items.value.some(tab => tab.id === id))
  if (current.length > 1)
    current = current.filter(
      id =>
        !props.tabs.some(tab => tab.id === id) ||
        ![...contentTargets.value].some(
          ([contentId, target]) =>
            target.connectionId === id && !current.includes(contentId)
        )
    )
  if (!current.length) return
  const warning = props.closeWarning(
    current.filter(id => !contentTargets.value.has(id))
  )
  if (warning) {
    state.closingIds = current
    state.warning = warning
  } else closeItems(current)
}
// 关闭连接时由连接卸载统一释放内容；仅关闭查询时保留同连接的其他标签。
function closeItems(ids: string[]): void {
  const connections = ids.filter(id => !contentTargets.value.has(id))
  for (const connection of props.tabs) {
    if (connections.includes(connection.id)) continue
    const contentIds = ids.flatMap(id => {
      const target = contentTargets.value.get(id)
      return target?.connectionId === connection.id ? [target.tabId] : []
    })
    if (contentIds.length) databaseTabs?.get(connection.id)?.close(contentIds)
  }
  if (connections.length) emit('closeMany', connections)
}
function cancelClose(): void {
  state.closingIds = []
  state.warning = ''
}
// 连接级确认完成后，按原始标签集合执行关闭。
function confirmClose(): void {
  const ids = [...state.closingIds]
  cancelClose()
  closeItems(ids)
}

// 同连接内容拖动调整查询顺序，跨连接拖动则移动所属连接及其内容标签。
function reorder(from: number, to: number): void {
  const source = items.value[from]
  const destination = items.value[to]
  if (!source || !destination) return
  const a = contentTargets.value.get(source.id)
  const b = contentTargets.value.get(destination.id)
  if (a && b && a.connectionId === b.connectionId) {
    const current = databaseTabs?.get(a.connectionId)
    const tabs = current?.tabs() ?? []
    current?.reorder(
      tabs.findIndex(tab => tab.id === a.tabId),
      tabs.findIndex(tab => tab.id === b.tabId)
    )
  } else
    emit(
      'reorder',
      props.tabs.findIndex(tab => tab.id === (a?.connectionId ?? source.id)),
      props.tabs.findIndex(
        tab => tab.id === (b?.connectionId ?? destination.id)
      )
    )
}

// 内容标签随所属连接移动到主分屏，避免把同一个会话挂载为多个实例。
function connectionDrag(drag: TabDragEvent): TabDragEvent {
  return {
    ...drag,
    id: contentTargets.value.get(drag.id)?.connectionId ?? drag.id,
  }
}
</script>
<template>
  <TabBar
    v-bind="$attrs"
    :tabs="items"
    :active="displayedActive"
    :context-items="contextItems"
    addable
    split-draggable
    @update:active="activate"
    @add="add"
    @close="requestClose([$event])"
    @close-many="requestClose"
    @reorder="reorder"
    @context-action="action"
    @tab-drag-move="emit('tabDragMove', connectionDrag($event))"
    @tab-drop="emit('tabDrop', connectionDrag($event))"
    @tab-drag-end="emit('tabDragEnd')"
  />
  <AppConfirmDialog
    :open="!!state.closingIds.length"
    :title="t('关闭含建表草稿的连接？')"
    :description="state.warning"
    :confirm-label="t('放弃草稿并关闭')"
    danger
    @close="cancelClose"
    @confirm="confirmClose"
  />
</template>
