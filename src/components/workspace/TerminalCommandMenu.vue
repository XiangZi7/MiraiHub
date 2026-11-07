<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  nextTick,
  reactive,
  toRefs,
  useId,
  useTemplateRef,
} from 'vue'
import { storeToRefs } from 'pinia'
import { onClickOutside, useEventListener } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppMenuSurface from '@/components/ui/AppMenuSurface.vue'
import TerminalCommandEditor from '@/components/workspace/TerminalCommandEditor.vue'
import TerminalSnippetDialog from '@/components/workspace/terminal-snippet-dialog.vue'
import BatchOperationDialog from '@/components/operations/BatchOperationDialog.vue'
import { snippetVariables } from '@/utils/terminal-snippets'
import { toast } from '@/composables/useToast'
import { useTerminalCommandsStore } from '@/stores/terminal-commands'
import { terminalCommandLabel } from '@/constants/terminal-commands'
import { useTabReorder } from '@/composables/useTabReorder'
import type { TerminalCommand } from '@/types/terminal-command'

const { t } = useI18n()

defineProps<{ connected: boolean }>()
const emit = defineEmits<{ insert: [command: string] }>()
const store = useTerminalCommandsStore()
const { commands, error: loadError } = storeToRefs(store)
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const menu = useTemplateRef<HTMLElement>('menu')
const commandList = useTemplateRef<HTMLElement>('commandList')
const titleId = useId()
// 响应式状态
const state = reactive({
  // 是否显示常用指令菜单
  open: false,
  // 名称、命令、分组和标签的检索词
  search: '',
  // 需要用户填写变量的片段
  snippet: null as TerminalCommand | null,
  // 等待批量预览的完整命令
  batchCommand: '',
  // 是否显示编辑、排序和删除按钮
  managing: false,
  // 是否显示指令编辑表单
  editing: false,
  // 正在修改的指令；为空时创建新指令
  current: null as TerminalCommand | null,
  // 保存或排序失败的提示
  error: '',
  // 浮层横坐标
  left: 0,
  // 浮层纵坐标
  top: 0,
  // 浮层适配窗口后的宽度
  width: 340,
  // 浮层适配窗口后的最大高度
  maxHeight: 500,
})
const {
  open,
  managing,
  editing,
  current,
  error,
  search,
  snippet,
  batchCommand,
} = toRefs(state)
const filteredCommands = computed(() => {
  const words = state.search.toLowerCase().trim().split(/\s+/u).filter(Boolean)
  return commands.value.filter(item =>
    words.every(word =>
      `${item.name} ${item.command} ${item.folder ?? ''} ${item.tags?.join(' ') ?? ''} ${item.description ?? ''}`
        .toLowerCase()
        .includes(word)
    )
  )
})
const style = computed(() => ({
  left: `${state.left}px`,
  top: `${state.top}px`,
  width: `${state.width}px`,
  maxHeight: `${state.maxHeight}px`,
}))
const reorder = useTabReorder({
  tabs: () => filteredCommands.value,
  container: () => (state.open && !state.editing ? commandList.value : null),
  axis: 'vertical',
  handle: '[data-command-drag-handle]',
  onReorder: (from, to) => {
    const source = filteredCommands.value[from]
    const target = filteredCommands.value[to]
    if (source && target)
      update(() =>
        store.reorder(source.id, target.id, from < to ? 'after' : 'before')
      )
  },
})
// 原数组中的真实位置，排序按钮按它判断边界
const commandIndex = computed(
  () => new Map(commands.value.map((command, index) => [command.id, index]))
)
// 过滤时只展示部分指令，相邻移动会跨越隐藏项，因此仅在未过滤时允许按钮排序
const sortable = computed(() => !state.search.trim())
/** 按原数组索引移动指令，过滤状态或已到边界时忽略。 */
function moveCommand(command: TerminalCommand, offset: -1 | 1): void {
  const index = commandIndex.value.get(command.id)
  if (!sortable.value || index === undefined) return
  const target = index + offset
  if (target < 0 || target >= commands.value.length) return
  update(() => store.move(command.id, offset))
}
const draggedCommand = computed(() =>
  commands.value.find(command => command.id === reorder.draggedId.value)
)
function position(): void {
  const rect = trigger.value?.getBoundingClientRect()
  if (!rect) return
  state.width = Math.min(360, window.innerWidth - 16)
  state.left = Math.max(
    8,
    Math.min(rect.right - state.width, window.innerWidth - state.width - 8)
  )
  const below = window.innerHeight - rect.bottom - 14
  const above = rect.top - 14
  const placeAbove = below < 260 && above > below
  state.maxHeight = Math.max(100, Math.min(520, placeAbove ? above : below))
  state.top = placeAbove
    ? Math.max(8, rect.top - state.maxHeight - 6)
    : rect.bottom + 6
}
async function toggle(): Promise<void> {
  if (state.open) {
    close()
    return
  }
  state.error = ''
  state.editing = false
  state.open = true
  position()
  await nextTick()
  menu.value?.focus()
}
function close(restoreFocus = true): void {
  reorder.cancel()
  state.open = false
  state.editing = false
  if (restoreFocus) trigger.value?.focus()
}
function edit(command: TerminalCommand | null): void {
  reorder.cancel()
  state.current = command
  state.editing = true
  state.error = ''
}
/** 保存片段名称、正文和分类，错误通过公共通知展示。 */
function save(
  name: string,
  command: string,
  metadata: Pick<TerminalCommand, 'folder' | 'tags' | 'description'>
): void {
  try {
    store.save(name, command, state.current?.id, metadata)
    state.editing = false
    state.error = ''
    void nextTick(() => menu.value?.focus())
  } catch (error) {
    toast.error(String(error))
  }
}
/** 执行片段管理操作，失败统一发送公共通知。 */
function update(action: () => void): void {
  try {
    action()
    state.error = ''
  } catch (error) {
    toast.error(String(error))
  }
}
/** 带变量的片段先填写，再交给终端手动执行。 */
function insert(command: TerminalCommand): void {
  if (reorder.consumeSuppressedClick(command.id)) return
  close(false)
  if (snippetVariables(command.command).length) state.snippet = command
  else emit('insert', command.command)
}
/** 接收已填写的片段，关闭变量表单后回填终端。 */
function insertRendered(command: string): void {
  state.snippet = null
  emit('insert', command)
}
/** 把填写后的片段送到批量执行预览。 */
function batchRendered(command: string): void {
  state.snippet = null
  state.batchCommand = command
}
/** 变量片段先填写，普通片段直接打开多主机执行预览。 */
function batch(command: TerminalCommand): void {
  close(false)
  if (snippetVariables(command.command).length) state.snippet = command
  else state.batchCommand = command.command
}
function escape(): void {
  if (state.editing) {
    state.editing = false
    void nextTick(() => menu.value?.focus())
  } else close()
}
onClickOutside(
  menu,
  () => {
    if (state.open && !state.editing) close(false)
  },
  { ignore: [trigger] }
)
useEventListener(window, 'resize', () => {
  if (state.open) position()
})
</script>

<template>
  <button
    ref="trigger"
    type="button"
    class="command-trigger"
    :title="t('常用指令')"
    :aria-expanded="open"
    aria-haspopup="dialog"
    @click="toggle"
  >
    <AppIcon
      name="lucide:square-terminal"
      :size="14"
    />
  </button>
  <Teleport to="body">
    <TerminalSnippetDialog
      v-if="snippet"
      :command="snippet.command"
      @close="snippet = null"
      @insert="insertRendered"
      @batch="batchRendered"
    />
    <BatchOperationDialog
      v-if="batchCommand"
      :initial-command="batchCommand"
      @close="batchCommand = ''"
    />
    <Transition
      enter-active-class="transition duration-150 ease-out motion-reduce:transition-none"
      enter-from-class="-translate-y-1 opacity-0"
      leave-active-class="transition duration-100 ease-in motion-reduce:transition-none"
      leave-to-class="-translate-y-1 opacity-0"
    >
      <section
        v-if="open"
        ref="menu"
        class="terminal-command-menu"
        :style="style"
        role="dialog"
        :aria-labelledby="titleId"
        tabindex="-1"
        @keydown.esc.prevent.stop="escape"
      >
        <AppMenuSurface />
        <header
          class="border-line-soft flex shrink-0 items-center gap-2 border-b px-3 py-2"
        >
          <h3
            :id="titleId"
            class="flex-1 text-xs font-medium"
          >
            {{
              editing
                ? current
                  ? t('编辑指令')
                  : t('添加指令')
                : t('常用指令')
            }}
          </h3>
          <AppButton
            v-if="!editing"
            size="sm"
            variant="ghost"
            :aria-pressed="managing"
            @click="managing = !managing"
            >{{ managing ? t('完成') : t('管理 / 排序') }}</AppButton
          >
          <IconButton
            icon="lucide:x"
            :size="13"
            :title="t('关闭常用指令')"
            @click="close()"
          />
        </header>
        <input
          v-if="!editing"
          v-model="search"
          class="field mx-3 my-2"
          :placeholder="t('搜索命令、分组或标签')"
          :aria-label="t('搜索命令、分组或标签')"
        />
        <div
          ref="commandList"
          class="scroll-thin min-h-0 overflow-y-auto"
        >
          <TerminalCommandEditor
            v-if="editing"
            :key="current?.id ?? 'new'"
            :command="current"
            @save="save"
            @cancel="escape"
          />
          <ol
            v-else
            class="p-1.5"
            :aria-label="t('常用指令列表')"
          >
            <li
              v-for="command in filteredCommands"
              :key="command.id"
              class="command-row transition-colors duration-150 motion-reduce:transition-none"
              :data-reorderable-tab-id="command.id"
              :class="{
                'command-dragging': reorder.draggedId.value === command.id,
                'command-drop-before':
                  reorder.targetId.value === command.id &&
                  reorder.targetPosition.value === 'before',
                'command-drop-after':
                  reorder.targetId.value === command.id &&
                  reorder.targetPosition.value === 'after',
              }"
            >
              <button
                type="button"
                data-command-drag-handle
                class="command-drag-handle text-txt-4 hover:text-txt flex shrink-0 items-center justify-center self-stretch rounded px-1"
                :title="t('拖动排序（Alt + ↑/↓）')"
                :aria-label="
                  t('排序 {value0}', { value0: terminalCommandLabel(command) })
                "
                @pointerdown="reorder.start($event, command.id)"
                @click="reorder.consumeSuppressedClick(command.id)"
                @keydown.alt.up.prevent.stop="moveCommand(command, -1)"
                @keydown.alt.down.prevent.stop="moveCommand(command, 1)"
              >
                <AppIcon
                  name="lucide:grip-vertical"
                  :size="12"
                />
              </button>
              <button
                type="button"
                class="command-insert flex min-w-0 flex-1 flex-col items-start gap-0.5 px-2 py-2 text-left text-[11px] select-none"
                data-command-drag-handle
                :disabled="!connected"
                :title="`${terminalCommandLabel(command)}\n${command.command}`"
                @pointerdown="reorder.start($event, command.id)"
                @click="insert(command)"
              >
                <span
                  v-if="command.folder"
                  class="text-accent text-[10px]"
                  >{{ command.folder }}</span
                >
                <span
                  class="text-txt w-full min-w-0 wrap-anywhere whitespace-normal"
                  >{{ terminalCommandLabel(command) }}</span
                >
                <code class="text-txt-4 w-full min-w-0 truncate text-[10px]">{{
                  command.command
                }}</code>
              </button>
              <IconButton
                icon="lucide:send"
                :size="12"
                :title="t('发送到多台主机')"
                @click="batch(command)"
              />
              <div
                v-if="managing"
                class="flex shrink-0 items-center"
              >
                <IconButton
                  icon="lucide:chevron-up"
                  :size="12"
                  :title="t('上移 {value0}', { value0: command.name })"
                  :disabled="!sortable || commandIndex.get(command.id) === 0"
                  @click="moveCommand(command, -1)"
                />
                <IconButton
                  icon="lucide:chevron-down"
                  :size="12"
                  :title="t('下移 {value0}', { value0: command.name })"
                  :disabled="
                    !sortable ||
                    commandIndex.get(command.id) === commands.length - 1
                  "
                  @click="moveCommand(command, 1)"
                />
                <IconButton
                  icon="lucide:pencil"
                  :size="12"
                  :title="t('编辑 {value0}', { value0: command.name })"
                  @click="edit(command)"
                />
                <IconButton
                  icon="lucide:x"
                  :size="12"
                  :title="t('删除 {value0}', { value0: command.name })"
                  @click="update(() => store.remove(command.id))"
                />
              </div>
            </li>
          </ol>
          <p
            v-if="!editing && !commands.length"
            class="text-txt-4 p-4 text-center text-xs"
          >
            {{ t('还没有常用指令，点击下方添加。') }}
          </p>
        </div>
        <p
          v-if="error || loadError"
          role="alert"
          class="text-danger px-3 py-2 text-[11px]"
        >
          {{ error || loadError }}
        </p>
        <footer
          v-if="!editing"
          class="border-line-soft grid shrink-0 gap-2 border-t p-2"
        >
          <AppButton
            size="sm"
            @click="edit(null)"
            ><AppIcon
              name="lucide:plus"
              :size="13"
            />
            {{ t('添加命令') }}
          </AppButton>
          <p class="text-txt-4 text-center text-[10px]">
            {{
              connected
                ? t('点击填入终端，按回车执行')
                : t('连接 SSH 后可填入指令')
            }}
          </p>
        </footer>
      </section>
    </Transition>
    <div
      v-if="open && reorder.dragging.value && draggedCommand"
      class="command-drag-preview text-txt fixed z-200 flex max-w-64 items-center gap-2 rounded-md border px-3 py-2 text-xs shadow-lg"
      :style="reorder.dragStyle.value"
      aria-hidden="true"
    >
      <AppIcon
        name="lucide:grip-vertical"
        :size="12"
      />
      <span class="truncate">{{ terminalCommandLabel(draggedCommand) }}</span>
    </div>
  </Teleport>
</template>

<style scoped>
.command-trigger {
  display: flex;
  align-items: center;
  gap: 5px;
  padding: 4px 7px;
  border-radius: 5px;
  font-size: 10px;
  color: var(--color-txt-3);
}
.command-trigger:hover,
.command-trigger[aria-expanded='true'] {
  background: var(--color-hover);
  color: var(--color-txt);
}
.terminal-command-menu {
  position: fixed;
  z-index: 100;
  display: flex;
  flex-direction: column;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  box-shadow: var(--shadow-pop);
  isolation: isolate;
  outline: none;
  overflow: hidden;
}
.command-row {
  position: relative;
  display: flex;
  align-items: center;
  border-radius: 5px;
}
.command-row:hover {
  background: var(--color-hover);
}
.command-drag-handle {
  cursor: grab;
  touch-action: none;
  user-select: none;
}
.command-drag-handle:active {
  cursor: grabbing;
}
.command-dragging {
  opacity: 0.42;
}
.command-drop-before::before,
.command-drop-after::after {
  position: absolute;
  right: 0;
  left: 0;
  height: 2px;
  border-radius: 999px;
  background: var(--color-accent);
  pointer-events: none;
  content: '';
}
.command-drop-before::before {
  top: -1px;
}
.command-drop-after::after {
  bottom: -1px;
}
.command-drag-preview {
  border-color: var(--color-accent);
  background: var(--color-panel);
  pointer-events: none;
}
.command-insert:disabled {
  opacity: 0.5;
  cursor: default;
}
.command-insert:focus-visible {
  outline: 1px solid var(--color-accent);
  outline-offset: -1px;
  border-radius: 5px;
}
</style>
