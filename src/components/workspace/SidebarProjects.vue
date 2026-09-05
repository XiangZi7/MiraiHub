<script setup lang="ts">
import { computed, reactive } from 'vue'
import ConnectionTagBadge from '@/components/connection/ConnectionTagBadge.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import type { ConnectionGroupView, SavedConnection } from '@/types/connection'
import type { ContextMenuItem } from '@/types/context-menu'
import { endpointOf, isDatabaseConnection } from '@/types/connection'
import { connectionTagColorCss } from '@/constants/connection'
import { useConnectionGroupDrag } from '@/composables/useConnectionGroupDrag'
import { cn } from '@/utils/cn'
import SidebarGroupEditor from './SidebarGroupEditor.vue'

const props = defineProps<{
  label: string
  groups: readonly ConnectionGroupView[]
  loaded: boolean
  activeId?: string
  connectedIds: ReadonlySet<string>
  openIds: ReadonlySet<string>
}>()

const emit = defineEmits<{
  open: [connection: SavedConnection]
  addConnection: []
  createGroup: [name: string]
  renameGroup: [groupId: string, name: string]
  removeGroup: [group: ConnectionGroupView]
  move: [connectionId: string, groupName: string]
  edit: [connection: SavedConnection]
  duplicate: [connection: SavedConnection]
  newDatabaseQuery: [connection: SavedConnection]
  exportDatabase: [connection: SavedConnection]
  importDatabase: [connection: SavedConnection]
  remove: [connection: SavedConnection]
}>()

const state = reactive({
  collapsed: {} as Record<string, boolean>,
  creatingGroup: false,
  editingGroupId: '',
  menuOpen: false,
  menuX: 0,
  menuY: 0,
  menuConnection: null as SavedConnection | null,
  menuGroup: null as ConnectionGroupView | null,
})
let menuTrigger: HTMLElement | null = null

const contextItems = computed<ContextMenuItem[]>(() => {
  if (state.menuConnection) {
    const connection = state.menuConnection
    const database = isDatabaseConnection(connection)
    const connected = props.connectedIds.has(connection.id)

    return [
      {
        id: 'open',
        label: props.openIds.has(connection.id) ? '切换到连接' : '打开连接',
        icon: database ? 'lucide:database' : 'lucide:square-terminal',
      },
      ...(database
        ? [
            {
              id: 'new-database-query',
              label: '新建查询',
              icon: 'lucide:square-terminal',
              iconTone: 'blue' as const,
            },
          ]
        : []),
      { id: 'edit', label: '编辑连接', icon: 'lucide:pencil' },
      { id: 'duplicate', label: '复制连接', icon: 'lucide:copy' },
      ...(database
        ? [
            {
              id: 'database-transfer',
              label: '导入 / 导出',
              icon: 'lucide:arrow-left-right',
              separatorBefore: true,
              children: [
                {
                  id: 'export-database',
                  label: connected ? '导出为 SQL…' : '导出为 SQL（请先连接）',
                  icon: 'lucide:database-backup',
                  disabled: !connected,
                },
                {
                  id: 'import-database',
                  label: connected ? '从 SQL 导入…' : '从 SQL 导入（请先连接）',
                  icon: 'lucide:file-input',
                  disabled: !connected,
                },
              ],
            } satisfies ContextMenuItem,
          ]
        : []),
      {
        id: 'delete',
        label: '删除连接',
        icon: 'lucide:trash-2',
        danger: true,
        separatorBefore: true,
      },
    ]
  }

  const group = props.groups.find(group => group.id === state.menuGroup?.id)
  if (!group) return []

  const items: ContextMenuItem[] = [
    {
      id: 'add-connection',
      label: group.kind === 'database' ? '新建数据库连接' : '新建 SSH 连接',
      icon: group.kind === 'database' ? 'lucide:database' : 'lucide:server',
    },
    { id: 'create-group', label: '新建分组', icon: 'lucide:folder-plus' },
    {
      id: 'toggle-group',
      label: isExpanded(group.id) ? '收起分组' : '展开分组',
      icon: isExpanded(group.id)
        ? 'lucide:folder-closed'
        : 'lucide:folder-open',
      separatorBefore: true,
    },
  ]

  // 默认分组是未分组连接的归属桶，仅持久化分组支持重命名和删除。
  if (!group.virtual) {
    items.push(
      { id: 'rename-group', label: '重命名分组', icon: 'lucide:pencil' },
      {
        id: 'delete-group',
        label: '删除分组',
        icon: 'lucide:trash-2',
        danger: true,
        separatorBefore: true,
      }
    )
  }
  return items
})

function isExpanded(groupId: string): boolean {
  return !state.collapsed[groupId]
}

function toggleGroup(groupId: string): void {
  state.collapsed[groupId] = !state.collapsed[groupId]
}

function toneOf(connection: SavedConnection): 'success' | 'amber' | 'txt-3' {
  if (props.connectedIds.has(connection.id)) return 'success'
  return props.openIds.has(connection.id) ? 'amber' : 'txt-3'
}

function createGroup(name: string): void {
  state.creatingGroup = false
  emit('createGroup', name)
}

function renameGroup(groupId: string, name: string): void {
  state.editingGroupId = ''
  emit('renameGroup', groupId, name)
}

const groupDrag = useConnectionGroupDrag({
  groups: () => props.groups,
  onDrop(connectionId, group) {
    state.collapsed[group.id] = false
    emit('move', connectionId, group.name === 'Ungrouped' ? '' : group.name)
  },
})

function openConnection(connection: SavedConnection): void {
  if (groupDrag.consumeSuppressedClick(connection.id)) return
  emit('open', connection)
}

function eventPoint(event: MouseEvent | KeyboardEvent): {
  x: number
  y: number
} {
  if ('clientX' in event && (event.clientX || event.clientY))
    return { x: event.clientX, y: event.clientY }

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: rect.left + 20, y: rect.top + rect.height / 2 }
}

function openConnectionMenu(
  event: MouseEvent,
  connection: SavedConnection
): void {
  const point = eventPoint(event)
  menuTrigger = event.currentTarget as HTMLElement
  state.menuConnection = connection
  state.menuGroup = null
  state.menuX = point.x
  state.menuY = point.y
  state.menuOpen = true
}

function openGroupMenu(
  event: MouseEvent | KeyboardEvent,
  group: ConnectionGroupView
): void {
  const point = eventPoint(event)
  menuTrigger = event.currentTarget as HTMLElement
  state.menuConnection = null
  state.menuGroup = group
  state.menuX = point.x
  state.menuY = point.y
  state.menuOpen = true
}

function handleGroupKeydown(
  event: KeyboardEvent,
  group: ConnectionGroupView
): void {
  if (event.key !== 'ContextMenu' && !(event.shiftKey && event.key === 'F10'))
    return
  event.preventDefault()
  event.stopPropagation()
  openGroupMenu(event, group)
}

function closeContextMenu(): void {
  state.menuOpen = false
  // 同步恢复焦点，让随后挂载的分组编辑框或确认框接管焦点。
  if (document.hasFocus()) menuTrigger?.focus()
  menuTrigger = null
}

function runContextAction(action: string): void {
  const connection = state.menuConnection
  if (connection) {
    if (action === 'open') emit('open', connection)
    else if (action === 'new-database-query')
      emit('newDatabaseQuery', connection)
    else if (action === 'edit') emit('edit', connection)
    else if (action === 'duplicate') emit('duplicate', connection)
    else if (action === 'export-database') emit('exportDatabase', connection)
    else if (action === 'import-database') emit('importDatabase', connection)
    else if (action === 'delete') emit('remove', connection)
    return
  }

  const group = props.groups.find(group => group.id === state.menuGroup?.id)
  if (!group) return

  if (action === 'add-connection') emit('addConnection')
  else if (action === 'create-group') state.creatingGroup = true
  else if (action === 'toggle-group') toggleGroup(group.id)
  else if (action === 'rename-group' && !group.virtual)
    state.editingGroupId = group.id
  else if (action === 'delete-group' && !group.virtual)
    emit('removeGroup', group)
}
</script>

<template>
  <section>
    <div class="mt-5 mb-1.5 flex items-center justify-between pr-1">
      <p class="group-label">
        {{ label }}
      </p>
      <IconButton
        icon="lucide:folder-plus"
        :size="13"
        title="新建分组"
        @click="state.creatingGroup = true"
      />
    </div>

    <SidebarGroupEditor
      v-if="state.creatingGroup"
      placeholder="New group"
      @submit="createGroup"
      @cancel="state.creatingGroup = false"
    />

    <div class="space-y-0.5">
      <div
        v-for="group in groups"
        :key="group.id"
        :data-connection-group-id="group.id"
        :class="[
          'sidebar-group',
          groupDrag.targetGroupId.value === group.id && 'sidebar-group-drop',
        ]"
      >
        <SidebarGroupEditor
          v-if="state.editingGroupId === group.id"
          :initial-value="group.name"
          @submit="renameGroup(group.id, $event)"
          @cancel="state.editingGroupId = ''"
        />

        <button
          v-else
          type="button"
          class="nav-item w-full"
          :aria-expanded="isExpanded(group.id)"
          aria-haspopup="menu"
          aria-keyshortcuts="Shift+F10"
          @click="toggleGroup(group.id)"
          @contextmenu.prevent.stop="openGroupMenu($event, group)"
          @keydown="handleGroupKeydown($event, group)"
        >
          <AppIcon
            name="lucide:chevron-right"
            :size="13"
            :class="
              cn(
                'text-txt-4 transition-transform duration-150 motion-reduce:transition-none',
                isExpanded(group.id) && 'rotate-90'
              )
            "
          />
          <AppIcon
            name="lucide:folder"
            :size="13"
            class="text-txt-3"
          />
          <span class="flex-1 truncate text-left">{{ group.name }}</span>
          <span class="text-txt-4 shrink-0 text-[10px]">{{
            group.items.length
          }}</span>
        </button>

        <div
          v-show="isExpanded(group.id)"
          class="space-y-0.5"
        >
          <button
            v-for="node in group.items"
            :key="node.id"
            type="button"
            :class="
              cn(
                'connection-node w-full pl-7',
                'connection-node-draggable',
                groupDrag.draggedConnectionId.value === node.id &&
                  'connection-node-dragging',
                activeId === node.id && 'nav-item-active'
              )
            "
            :title="endpointOf(node)"
            @click="openConnection(node)"
            @contextmenu.prevent.stop="openConnectionMenu($event, node)"
            @pointerdown="groupDrag.start($event, node, group)"
          >
            <StatusDot
              :tone="toneOf(node)"
              :size="6"
              :glow="toneOf(node) !== 'txt-3'"
              class="mt-1.5 self-start"
            />
            <span class="min-w-0 flex-1 text-left">
              <span class="text-txt block truncate text-[11.5px]">{{
                node.name
              }}</span>
              <span
                class="text-txt-4 mt-0.5 block truncate font-mono text-[9.5px]"
              >
                {{ node.kind === 'local' ? endpointOf(node) : node.host }}
              </span>
            </span>
            <span
              v-if="node.tags.length"
              class="connection-tags-preview"
            >
              <ConnectionTagBadge
                :label="node.tags[0]"
                :color="connectionTagColorCss(node.tagColor)"
                compact
              />
              <span
                v-if="node.tags.length > 1"
                class="connection-tags-more"
              >
                +{{ node.tags.length - 1 }}
              </span>
            </span>
          </button>
        </div>
      </div>

      <button
        v-if="loaded && !groups.length"
        type="button"
        class="border-line text-txt-4 hover:border-line-strong hover:text-txt-3 w-full rounded-lg border border-dashed px-3 py-4 text-center text-[11px] transition-colors"
        @click="emit('addConnection')"
      >
        还没有连接，点这里新建
      </button>
    </div>

    <AppContextMenu
      :open="state.menuOpen"
      :x="state.menuX"
      :y="state.menuY"
      :items="contextItems"
      :label="
        state.menuConnection
          ? `${state.menuConnection.name} 操作`
          : `${state.menuGroup?.name ?? ''} 分组操作`
      "
      @select="runContextAction"
      @close="closeContextMenu"
    />

    <Teleport to="body">
      <div
        v-if="groupDrag.dragging.value"
        class="connection-drag-ghost"
        :style="groupDrag.dragStyle.value"
      >
        <AppIcon
          name="lucide:server"
          :size="13"
        />
        <span>{{ groupDrag.draggedLabel.value }}</span>
      </div>
    </Teleport>
  </section>
</template>

<style scoped>
.sidebar-group {
  border-radius: 6px;
  transition:
    background-color 120ms ease,
    box-shadow 120ms ease;
}

.sidebar-group-drop {
  background: color-mix(in oklch, var(--color-violet) 11%, transparent);
  box-shadow: inset 0 0 0 1px
    color-mix(in oklch, var(--color-violet) 50%, transparent);
}

.connection-node {
  display: flex;
  min-height: 42px;
  cursor: pointer;
  align-items: center;
  gap: 8px;
  border-radius: 6px;
  padding-top: 5px;
  padding-right: 8px;
  padding-bottom: 5px;
  color: var(--color-txt-2);
  outline: none;
  transition:
    color 120ms ease,
    background-color 120ms ease;
}

.connection-node-draggable {
  cursor: default;
  touch-action: pan-y;
}

.connection-node-draggable:active {
  cursor: default;
}

.connection-node-dragging {
  background: var(--color-hover);
  opacity: 0.45;
}

.connection-drag-ghost {
  position: fixed;
  z-index: 200;
  display: flex;
  max-width: 240px;
  pointer-events: none;
  align-items: center;
  gap: 7px;
  border: 1px solid
    color-mix(in oklch, var(--color-violet) 48%, var(--color-line));
  border-radius: 7px;
  background: var(--color-panel);
  box-shadow: 0 10px 28px rgb(0 0 0 / 28%);
  padding: 7px 10px;
  color: var(--color-txt);
  font-size: 11.5px;
  line-height: 1;
  transform: translateY(-50%);
  white-space: nowrap;
}

.connection-node:hover,
.connection-node:focus-visible {
  background: var(--color-hover);
  color: var(--color-txt);
}

.connection-tags-preview {
  display: flex;
  min-width: 0;
  max-width: 92px;
  flex: 0 1 auto;
  align-items: center;
  gap: 3px;
}

.connection-tags-preview > :first-child {
  min-width: 0;
}

.connection-tags-more {
  flex: 0 0 auto;
  color: var(--color-txt-4);
  font-size: 8px;
  line-height: 17px;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-group {
    transition: none;
  }
}
</style>
