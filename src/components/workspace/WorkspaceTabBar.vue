<script setup lang="ts">
import { computed, reactive } from 'vue'
import TabBar, { type TabItem } from '@/components/ui/TabBar.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import type { WorkspaceTab } from '@/composables/useWorkspaceTabs'
import type { ContextMenuItem } from '@/types/context-menu'
import { copyText } from '@/utils/clipboard'
import { openConnectionWindow } from '@/utils/window'
import { toast } from '@/composables/useToast'
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
}>()
const state = reactive({ closingIds: [] as string[], warning: '' })
const items = computed<TabItem[]>(() =>
  props.tabs.map(tab => ({
    id: tab.id,
    label: tab.connection.name,
    dot:
      tab.status === 'connected'
        ? 'success'
        : tab.status === 'connecting'
          ? 'amber'
          : 'txt-3',
    closable: true,
  }))
)
function contextItems(id: string): ContextMenuItem[] {
  const tab = props.tabs.find(tab => tab.id === id)
  if (!tab) return []
  const local = tab.connection.kind === 'local'
  return [
    {
      id: 'reconnect',
      label:
        tab.status === 'connected'
          ? local
            ? '重启本地终端'
            : '重新连接'
          : local
            ? '启动本地终端'
            : '连接',
      icon: 'lucide:refresh-cw',
      disabled: tab.status === 'connecting',
    },
    {
      id: 'disconnect',
      label: local ? '停止本地终端' : '断开连接',
      icon: 'lucide:unplug',
      disabled: tab.status !== 'connected',
    },
    ...(tab.connection.kind === 'ssh'
      ? [
          {
            id: 'split',
            label: '新建 / 关闭分屏终端',
            icon: 'lucide:columns-2',
          },
          { id: 'files', label: '打开远端文件', icon: 'lucide:folder-open' },
        ]
      : []),
    {
      id: 'edit',
      label: '编辑连接配置',
      icon: 'lucide:settings-2',
      separatorBefore: true,
    },
    { id: 'copy-connection', label: '复制连接信息', icon: 'lucide:clipboard' },
  ]
}
async function action(id: string, action: string): Promise<void> {
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
        ? `${c.name}\n${c.settings.shell}\n${c.settings.workingDirectory || '默认工作目录'}`
        : `${c.name}\n${c.kind.toUpperCase()} ${c.username}@${c.host}:${c.port}`
    try {
      await copyText(text)
      toast.success('连接信息已复制（不含密码和密钥）')
    } catch {
      toast.error('复制失败，请检查剪贴板权限')
    }
    return
  }
  emit('action', id, action)
}
function requestClose(ids: string[]): void {
  const current = ids.filter(id => props.tabs.some(tab => tab.id === id))
  if (!current.length) return
  const warning = props.closeWarning(current)
  if (warning) {
    state.closingIds = current
    state.warning = warning
  } else emit('closeMany', current)
}
function cancelClose(): void {
  state.closingIds = []
  state.warning = ''
}
function confirmClose(): void {
  const ids = [...state.closingIds]
  cancelClose()
  emit('closeMany', ids)
}
</script>
<template>
  <TabBar
    v-bind="$attrs"
    :tabs="items"
    :active="active"
    :context-items="contextItems"
    addable
    @update:active="emit('update:active', $event)"
    @add="emit('add')"
    @close="requestClose([$event])"
    @close-many="requestClose"
    @reorder="(from, to) => emit('reorder', from, to)"
    @context-action="action"
  />
  <AppConfirmDialog
    :open="!!state.closingIds.length"
    title="关闭含建表草稿的连接？"
    :description="state.warning"
    confirm-label="放弃草稿并关闭"
    danger
    @close="cancelClose"
    @confirm="confirmClose"
  />
</template>
