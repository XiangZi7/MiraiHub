<script setup lang="ts">
import { computed, reactive } from 'vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import type { ConnectionGroupView, SavedConnection } from '@/types/connection'
import type { ContextMenuItem } from '@/types/context-menu'
import { endpointOf } from '@/types/connection'
import { connectionTagColorCss } from '@/constants/connection'
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
  remove: [connection: SavedConnection]
}>()

const state = reactive({
  collapsed: {} as Record<string, boolean>,
  creatingGroup: false,
  editingGroupId: '',
  draggedConnectionId: '',
  dropGroupId: '',
  menuOpen: false,
  menuX: 0,
  menuY: 0,
  menuConnection: null as SavedConnection | null,
  menuGroup: null as ConnectionGroupView | null,
})

const contextItems = computed<ContextMenuItem[]>(() => {
  if (state.menuConnection) {
    return [
      { id: 'open', label: '打开连接', icon: 'lucide:square-terminal' },
      { id: 'edit', label: '编辑连接', icon: 'lucide:pencil' },
      { id: 'duplicate', label: '复制连接', icon: 'lucide:copy' },
      { id: 'delete', label: '删除连接', icon: 'lucide:trash-2', danger: true, separatorBefore: true },
    ]
  }

  return [
    { id: 'rename-group', label: '重命名分组', icon: 'lucide:pencil' },
    { id: 'delete-group', label: '删除分组', icon: 'lucide:trash-2', danger: true, separatorBefore: true },
  ]
})

function isExpanded(groupId: string): boolean {
  return !state.collapsed[groupId]
}

function toggleGroup(groupId: string): void {
  state.collapsed[groupId] = !state.collapsed[groupId]
}

function toneOf(connection: SavedConnection): 'accent' | 'amber' | 'txt-3' {
  if (props.connectedIds.has(connection.id))
    return 'accent'
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

function startDrag(event: DragEvent, connection: SavedConnection): void {
  if (connection.kind !== 'ssh') {
    event.preventDefault()
    return
  }

  state.draggedConnectionId = connection.id
  event.dataTransfer?.setData('text/plain', connection.id)
  if (event.dataTransfer)
    event.dataTransfer.effectAllowed = 'move'
}

function dragOver(event: DragEvent, group: ConnectionGroupView): void {
  if (!state.draggedConnectionId || group.kind !== 'ssh')
    return

  event.preventDefault()
  state.dropGroupId = group.id
  if (event.dataTransfer)
    event.dataTransfer.dropEffect = 'move'
}

function dropOnGroup(event: DragEvent, group: ConnectionGroupView): void {
  if (!state.draggedConnectionId || group.kind !== 'ssh')
    return

  event.preventDefault()
  const connectionId = state.draggedConnectionId
  state.collapsed[group.id] = false
  clearDrag()
  emit('move', connectionId, group.name === 'Ungrouped' ? '' : group.name)
}

function clearDrag(): void {
  state.draggedConnectionId = ''
  state.dropGroupId = ''
}

function eventPoint(event: MouseEvent): { x: number, y: number } {
  if (event.clientX || event.clientY)
    return { x: event.clientX, y: event.clientY }

  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  return { x: rect.left + 20, y: rect.top + rect.height / 2 }
}

function openConnectionMenu(event: MouseEvent, connection: SavedConnection): void {
  if (connection.kind !== 'ssh')
    return

  const point = eventPoint(event)
  state.menuConnection = connection
  state.menuGroup = null
  state.menuX = point.x
  state.menuY = point.y
  state.menuOpen = true
}

function openGroupMenu(event: MouseEvent, group: ConnectionGroupView): void {
  if (group.virtual)
    return

  const point = eventPoint(event)
  state.menuConnection = null
  state.menuGroup = group
  state.menuX = point.x
  state.menuY = point.y
  state.menuOpen = true
}

function runContextAction(action: string): void {
  const connection = state.menuConnection
  if (connection) {
    if (action === 'open')
      emit('open', connection)
    else if (action === 'edit')
      emit('edit', connection)
    else if (action === 'duplicate')
      emit('duplicate', connection)
    else if (action === 'delete')
      emit('remove', connection)
    return
  }

  const group = state.menuGroup
  if (!group)
    return

  if (action === 'rename-group')
    state.editingGroupId = group.id
  else if (action === 'delete-group')
    emit('removeGroup', group)
}
</script>

<template>
  <section>
    <div class="mb-1.5 mt-5 flex items-center justify-between pr-1">
      <p class="group-label">
        {{ label }}
      </p>
      <IconButton icon="lucide:folder-plus" :size="13" title="新建分组" @click="state.creatingGroup = true" />
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
        :class="['sidebar-group', state.dropGroupId === group.id && 'sidebar-group-drop']"
        @dragover="dragOver($event, group)"
        @drop="dropOnGroup($event, group)"
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
          @click="toggleGroup(group.id)"
          @contextmenu.prevent.stop="openGroupMenu($event, group)"
        >
          <AppIcon
            name="lucide:chevron-right"
            :size="13"
            :class="cn('text-txt-4 transition-transform duration-150 motion-reduce:transition-none', isExpanded(group.id) && 'rotate-90')"
          />
          <AppIcon name="lucide:folder" :size="13" class="text-txt-3" />
          <span class="flex-1 truncate text-left">{{ group.name }}</span>
          <span class="shrink-0 text-[10px] text-txt-4">{{ group.items.length }}</span>
        </button>

        <div v-show="isExpanded(group.id)" class="space-y-0.5">
          <button
            v-for="node in group.items"
            :key="node.id"
            type="button"
            :draggable="node.kind === 'ssh'"
            :class="cn('connection-node w-full pl-7', activeId === node.id && 'nav-item-active')"
            :title="endpointOf(node)"
            @click="emit('open', node)"
            @contextmenu.prevent.stop="openConnectionMenu($event, node)"
            @dragstart="startDrag($event, node)"
            @dragend="clearDrag"
          >
            <StatusDot
              :tone="toneOf(node)"
              :size="6"
              :glow="toneOf(node) !== 'txt-3'"
              class="mt-1.5 self-start"
            />
            <span class="min-w-0 flex-1 text-left">
              <span class="block truncate text-[11.5px] text-txt">{{ node.name }}</span>
              <span class="mt-0.5 block truncate font-mono text-[9.5px] text-txt-4">
                {{ node.kind === 'local' ? endpointOf(node) : node.host }}
              </span>
            </span>
            <span v-if="node.tags.length" class="flex max-w-20 shrink-0 flex-col items-end gap-0.5">
              <span
                v-for="tag in node.tags.slice(0, 2)"
                :key="tag"
                class="connection-tag"
                :style="{ '--tag-color': connectionTagColorCss(node.tagColor) }"
              >
                {{ tag }}
              </span>
            </span>
          </button>
        </div>
      </div>

      <button
        v-if="loaded && !groups.length"
        type="button"
        class="w-full rounded-lg border border-dashed border-line px-3 py-4 text-center text-[11px] text-txt-4 transition-colors hover:border-line-strong hover:text-txt-3"
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
      :label="state.menuConnection ? `${state.menuConnection.name} 操作` : '分组操作'"
      @select="runContextAction"
      @close="state.menuOpen = false"
    />
  </section>
</template>

<style scoped>
.sidebar-group {
  border-radius: 6px;
  transition: background-color 120ms ease, box-shadow 120ms ease;
}

.sidebar-group-drop {
  background: color-mix(in oklch, var(--color-violet) 11%, transparent);
  box-shadow: inset 0 0 0 1px color-mix(in oklch, var(--color-violet) 50%, transparent);
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
  transition: color 120ms ease, background-color 120ms ease;
}

.connection-node:hover,
.connection-node:focus-visible {
  background: var(--color-hover);
  color: var(--color-txt);
}

.connection-tag {
  max-width: 80px;
  overflow: hidden;
  border: 1px solid color-mix(in oklch, var(--tag-color) 34%, transparent);
  border-radius: 4px;
  background: color-mix(in oklch, var(--tag-color) 10%, transparent);
  padding: 0 4px;
  color: var(--tag-color);
  font-size: 8.5px;
  line-height: 15px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (prefers-reduced-motion: reduce) {
  .sidebar-group {
    transition: none;
  }
}
</style>
