<script setup lang="ts">
import {
  computed,
  nextTick,
  reactive,
  toRefs,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import { onClickOutside, useEventListener } from '@vueuse/core'
import type { AgentConversation } from '@/types/agent'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppMenuSurface from '@/components/ui/AppMenuSurface.vue'

const props = defineProps<{
  conversations: AgentConversation[]
  activeId: string
  loading: boolean
  disabled: boolean
  mutating: boolean
  error: string
  contextKey: string
}>()
const emit = defineEmits<{
  select: [id: string]
  remove: [id: string]
  rename: [id: string, title: string]
  refresh: []
}>()
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const menu = useTemplateRef<HTMLElement>('menu')
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
const titleId = useId()
const menuId = useId()
// 响应式状态
const state = reactive({
  // 是否展开历史气泡
  open: false,
  // 会话搜索关键词
  search: '',
  // 正在改名的会话 ID
  editingId: '',
  // 编辑中的会话名称
  draft: '',
  // 等待后端确认的名称，避免列表刷新打断编辑
  submittedName: '',
  // 等待确认删除的会话
  deleting: null as AgentConversation | null,
  // 气泡适配窗口后的横坐标
  left: 0,
  // 气泡适配窗口后的纵坐标
  top: 0,
  // 气泡宽度
  width: 340,
  // 气泡可用高度
  maxHeight: 420,
  // 是否向上展开
  above: false,
  // 气泡尖角对齐图标的位置
  arrow: 310,
})
const { open, search, editingId, draft, deleting, above } = toRefs(state)
const visible = computed(() => {
  const term = state.search.trim().toLocaleLowerCase()
  return props.conversations.filter(item =>
    `${item.title} ${item.model}`.toLocaleLowerCase().includes(term)
  )
})
const unavailable = computed(() => props.disabled || props.mutating)
const style = computed(() => ({
  left: `${state.left}px`,
  top: `${state.top}px`,
  width: `${state.width}px`,
  maxHeight: `${state.maxHeight}px`,
  '--history-arrow': `${state.arrow}px`,
  transform: state.above ? 'translateY(-100%)' : undefined,
}))
function date(value: number): string {
  return new Date(value).toLocaleString([], {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}
function position(): void {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  state.width = Math.min(360, window.innerWidth - 16)
  state.left = Math.max(
    8,
    Math.min(rect.right - state.width, window.innerWidth - state.width - 8)
  )
  const below = window.innerHeight - rect.bottom - 16
  const upper = rect.top - 16
  state.above = below < 230 && upper > below
  state.maxHeight = Math.max(100, Math.min(460, state.above ? upper : below))
  state.top = state.above ? rect.top - 8 : rect.bottom + 8
  state.arrow = Math.max(
    16,
    Math.min(state.width - 16, rect.left + rect.width / 2 - state.left)
  )
}
function close(restoreFocus = true): void {
  state.open = false
  state.editingId = ''
  state.submittedName = ''
  state.deleting = null
  if (restoreFocus) trigger.value?.focus()
}
async function toggle(): Promise<void> {
  if (state.open) {
    close()
    return
  }
  state.search = ''
  state.open = true
  position()
  emit('refresh')
  await nextTick()
  searchInput.value?.focus()
}
function select(id: string): void {
  if (unavailable.value) return
  close()
  emit('select', id)
}
async function edit(item: AgentConversation): Promise<void> {
  state.deleting = null
  state.editingId = item.id
  state.submittedName = ''
  state.draft = item.title
  await nextTick()
  const input = menu.value?.querySelector<HTMLInputElement>(
    '[data-rename-input]'
  )
  input?.focus()
  input?.select()
}
function cancelEdit(): void {
  state.editingId = ''
  state.submittedName = ''
  void nextTick(() => searchInput.value?.focus())
}
function save(): void {
  if (!state.draft.trim() || unavailable.value) return
  const original = props.conversations.find(item => item.id === state.editingId)
  if (original?.title === state.draft.trim()) {
    cancelEdit()
    return
  }
  state.submittedName = state.draft.trim()
  emit('rename', state.editingId, state.submittedName)
}
function askDelete(item: AgentConversation): void {
  state.editingId = ''
  state.deleting = item
}
function escape(): void {
  if (props.mutating) return
  if (state.editingId) cancelEdit()
  else if (state.deleting) state.deleting = null
  else close()
}
watch(
  () => props.conversations,
  items => {
    if (
      state.editingId &&
      state.submittedName &&
      items.find(item => item.id === state.editingId)?.title ===
        state.submittedName
    )
      cancelEdit()
    if (state.deleting && !items.some(item => item.id === state.deleting?.id)) {
      state.deleting = null
      void nextTick(() => searchInput.value?.focus())
    }
  }
)
watch(
  () => props.contextKey,
  () => close(false)
)
watch(
  () => props.mutating,
  value => {
    if (!value && state.open && !state.editingId && !state.deleting) {
      void nextTick(() => searchInput.value?.focus())
    }
  }
)
onClickOutside(
  menu,
  () => {
    if (state.open && !state.editingId && !props.mutating) close(false)
  },
  { ignore: [trigger] }
)
useEventListener(window, 'resize', () => {
  if (state.open) position()
})
useEventListener(
  window,
  'scroll',
  () => {
    if (state.open) position()
  },
  { capture: true }
)
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="icon-btn history-trigger"
    :class="{ 'text-accent': open, 'text-danger': error }"
    title="聊天记录"
    aria-label="聊天记录"
    aria-haspopup="dialog"
    :aria-expanded="open"
    :aria-controls="open ? menuId : undefined"
    :disabled="disabled"
    @click="toggle"
  >
    <AppIcon
      name="lucide:history"
      :size="14"
    />
  </button>
  <Teleport to="body">
    <section
      v-if="open"
      :id="menuId"
      ref="menu"
      role="dialog"
      :aria-labelledby="titleId"
      class="history-menu"
      :class="above && 'above'"
      :style="style"
      tabindex="-1"
      @keydown.esc.prevent.stop="escape"
    >
      <AppMenuSurface />
      <header class="history-header">
        <h3
          :id="titleId"
          class="flex-1 text-xs font-medium"
        >
          聊天记录
        </h3>
        <span class="text-txt-4 text-[10px]">{{ conversations.length }}</span>
        <IconButton
          icon="lucide:refresh-cw"
          title="刷新聊天记录"
          :size="13"
          :disabled="loading || unavailable"
          @click="emit('refresh')"
        />
        <IconButton
          icon="lucide:x"
          title="关闭聊天记录"
          :size="13"
          @click="close()"
        />
      </header>
      <label class="history-search">
        <AppIcon
          name="lucide:search"
          :size="13"
        />
        <input
          ref="searchInput"
          v-model="search"
          aria-label="搜索聊天记录"
          placeholder="搜索会话"
          :disabled="Boolean(editingId) || mutating"
        />
      </label>
      <div class="scroll-thin min-h-0 overflow-y-auto px-1.5 pb-1.5">
        <p
          v-if="loading && !conversations.length"
          class="history-empty"
          role="status"
        >
          正在加载…
        </p>
        <ul
          v-else
          aria-label="历史会话列表"
        >
          <li
            v-for="item in visible"
            :key="item.id"
            class="history-row"
            :class="item.id === activeId && 'selected'"
          >
            <form
              v-if="editingId === item.id"
              class="history-edit"
              @submit.prevent="save"
            >
              <input
                data-rename-input
                v-model="draft"
                aria-label="会话名称"
                maxlength="60"
                :disabled="unavailable"
              />
              <button
                class="icon-btn"
                type="submit"
                title="保存名称"
                aria-label="保存名称"
                :disabled="unavailable || !draft.trim()"
              >
                <AppIcon
                  name="lucide:check"
                  :size="13"
                />
              </button>
              <IconButton
                icon="lucide:x"
                title="取消改名"
                :size="13"
                :disabled="mutating"
                @click="cancelEdit"
              />
            </form>
            <template v-else>
              <button
                type="button"
                class="history-select"
                :aria-current="item.id === activeId ? 'true' : undefined"
                :title="item.title"
                :disabled="unavailable"
                @click="select(item.id)"
              >
                <span class="flex min-w-0 items-center gap-1.5"
                  ><span class="truncate">{{ item.title }}</span
                  ><AppIcon
                    v-if="item.id === activeId"
                    name="lucide:check"
                    :size="12"
                    class="text-accent shrink-0"
                /></span>
                <span class="text-txt-4 truncate text-[10px]"
                  >{{ date(item.updatedAt) }} · {{ item.model }}</span
                >
              </button>
              <div class="history-actions">
                <IconButton
                  icon="lucide:pencil"
                  :title="`重命名 ${item.title}`"
                  :size="12"
                  :disabled="unavailable"
                  @click="edit(item)"
                />
                <IconButton
                  icon="lucide:trash-2"
                  :title="`删除 ${item.title}`"
                  :size="12"
                  :disabled="unavailable"
                  @click="askDelete(item)"
                />
              </div>
            </template>
          </li>
        </ul>
        <p
          v-if="!loading && !visible.length"
          class="history-empty"
        >
          {{ search.trim() ? '没有匹配的会话' : '还没有聊天记录' }}
        </p>
      </div>
      <div
        v-if="deleting"
        class="history-delete"
      >
        <p>删除「{{ deleting.title }}」及其聊天记录？此操作无法撤销。</p>
        <div class="mt-2 flex justify-end gap-2">
          <AppButton
            size="sm"
            variant="ghost"
            :disabled="mutating"
            @click="deleting = null"
            >取消</AppButton
          >
          <AppButton
            size="sm"
            class="text-danger"
            :disabled="mutating"
            @click="emit('remove', deleting.id)"
            >确认删除</AppButton
          >
        </div>
      </div>
      <p
        v-if="error"
        role="alert"
        class="text-danger px-3 py-2 text-[11px]"
      >
        {{ error }}
      </p>
    </section>
  </Teleport>
</template>

<style scoped>
.history-trigger {
  flex-shrink: 0;
}
.history-trigger:disabled {
  opacity: 0.35;
  cursor: default;
}
.history-menu {
  position: fixed;
  z-index: 90;
  display: flex;
  flex-direction: column;
  isolation: isolate;
  border: 1px solid var(--color-line-strong);
  border-radius: 10px;
  color: var(--color-txt);
  font-size: 12px;
  box-shadow: var(--shadow-pop);
}
.history-menu::before {
  content: '';
  position: absolute;
  top: -5px;
  left: var(--history-arrow);
  width: 8px;
  height: 8px;
  transform: translateX(-50%) rotate(45deg);
  background: var(--color-panel);
  border-top: 1px solid var(--color-line-strong);
  border-left: 1px solid var(--color-line-strong);
}
.history-menu.above::before {
  top: auto;
  bottom: -5px;
  transform: translateX(-50%) rotate(225deg);
}
.history-header {
  display: flex;
  align-items: center;
  flex-shrink: 0;
  gap: 6px;
  padding: 8px 10px;
}
.history-search {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  gap: 7px;
  margin: 0 9px 7px;
  padding: 7px 9px;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  color: var(--color-txt-3);
  background: var(--color-card);
}
.history-search input {
  width: 100%;
  min-width: 0;
  outline: none;
  color: var(--color-txt);
}
.history-row {
  display: flex;
  align-items: center;
  gap: 3px;
  border: 1px solid transparent;
  border-radius: 7px;
  margin-block: 2px;
}
.history-row:hover {
  background: var(--color-hover);
}
.history-row.selected {
  background: color-mix(in srgb, var(--color-accent) 12%, transparent);
  border-color: color-mix(in srgb, var(--color-accent) 20%, transparent);
}
.history-select {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  gap: 4px;
  padding: 8px;
  text-align: left;
  cursor: pointer;
}
.history-actions {
  display: flex;
  flex-shrink: 0;
  align-items: center;
  padding-right: 4px;
}
.history-actions :deep(.icon-btn) {
  width: 25px;
  height: 27px;
}
.history-edit {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  gap: 3px;
  padding: 7px;
}
.history-edit input {
  flex: 1;
  width: 0;
  min-width: 0;
  padding: 5px 6px;
  border: 1px solid var(--color-accent);
  border-radius: 5px;
  background: var(--color-card);
  outline: none;
}
.history-empty {
  padding: 22px 8px;
  text-align: center;
  font-size: 11px;
  color: var(--color-txt-4);
}
.history-delete {
  flex-shrink: 0;
  padding: 10px 12px;
  border-top: 1px solid var(--color-line);
  color: var(--color-txt-2);
  font-size: 11px;
  overflow-wrap: anywhere;
}
.history-menu :focus-visible {
  outline: 1px solid var(--color-accent);
  outline-offset: -1px;
}
.history-search:focus-within {
  border-color: var(--color-accent);
}
.history-menu .history-search input:focus-visible {
  outline: none;
}
</style>
