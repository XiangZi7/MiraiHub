<script setup lang="ts">
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
import TerminalCommandEditor from './TerminalCommandEditor.vue'
import { useTerminalCommandsStore } from '@/stores/terminal-commands'
import type { TerminalCommand } from '@/types/terminal-command'

defineProps<{ connected: boolean }>()
const emit = defineEmits<{ insert: [command: string] }>()
const store = useTerminalCommandsStore()
const { commands, error: loadError } = storeToRefs(store)
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const menu = useTemplateRef<HTMLElement>('menu')
const titleId = useId()
// 响应式状态
const state = reactive({
  // 是否显示常用指令菜单
  open: false,
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
const { open, managing, editing, current, error } = toRefs(state)
const style = computed(() => ({
  left: `${state.left}px`,
  top: `${state.top}px`,
  width: `${state.width}px`,
  maxHeight: `${state.maxHeight}px`,
}))
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
  state.open = false
  state.editing = false
  if (restoreFocus) trigger.value?.focus()
}
function edit(command: TerminalCommand | null): void {
  state.current = command
  state.editing = true
  state.error = ''
}
function save(name: string, command: string): void {
  try {
    store.save(name, command, state.current?.id)
    state.editing = false
    state.error = ''
    void nextTick(() => menu.value?.focus())
  } catch (error) {
    state.error = String(error)
  }
}
function update(action: () => void): void {
  try {
    action()
    state.error = ''
  } catch (error) {
    state.error = String(error)
  }
}
function insert(command: string): void {
  close(false)
  emit('insert', command)
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
    title="常用指令"
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
          {{ editing ? (current ? '编辑指令' : '添加指令') : '常用指令' }}
        </h3>
        <AppButton
          v-if="!editing"
          size="sm"
          variant="ghost"
          :aria-pressed="managing"
          @click="managing = !managing"
          >{{ managing ? '完成' : '管理 / 排序' }}</AppButton
        >
        <IconButton
          icon="lucide:x"
          :size="13"
          title="关闭常用指令"
          @click="close()"
        />
      </header>
      <div class="scroll-thin min-h-0 overflow-y-auto">
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
          aria-label="常用指令列表"
        >
          <li
            v-for="(command, index) in commands"
            :key="command.id"
            class="command-row"
          >
            <button
              type="button"
              class="command-insert"
              :disabled="!connected"
              :title="`填入终端：${command.command}`"
              @click="insert(command.command)"
            >
              <span class="min-w-0 truncate">{{ command.name }}</span>
              <code class="text-txt-4 min-w-0 truncate text-[10px]">{{
                command.command
              }}</code>
            </button>
            <div
              v-if="managing"
              class="flex shrink-0 items-center"
            >
              <IconButton
                icon="lucide:chevron-up"
                :size="12"
                :title="`上移 ${command.name}`"
                :disabled="index === 0"
                @click="update(() => store.move(command.id, -1))"
              />
              <IconButton
                icon="lucide:chevron-down"
                :size="12"
                :title="`下移 ${command.name}`"
                :disabled="index === commands.length - 1"
                @click="update(() => store.move(command.id, 1))"
              />
              <IconButton
                icon="lucide:pencil"
                :size="12"
                :title="`编辑 ${command.name}`"
                @click="edit(command)"
              />
              <IconButton
                icon="lucide:x"
                :size="12"
                :title="`删除 ${command.name}`"
                @click="update(() => store.remove(command.id))"
              />
            </div>
          </li>
        </ol>
        <p
          v-if="!editing && !commands.length"
          class="text-txt-4 p-4 text-center text-xs"
        >
          还没有常用指令，点击下方添加。
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
          />添加命令</AppButton
        >
        <p class="text-txt-4 text-center text-[10px]">
          {{ connected ? '点击填入终端，按回车执行' : '连接 SSH 后可填入指令' }}
        </p>
      </footer>
    </section>
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
  display: flex;
  align-items: center;
  border-radius: 5px;
}
.command-row:hover {
  background: var(--color-hover);
}
.command-insert {
  display: flex;
  flex: 1;
  min-width: 0;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px;
  font-size: 11px;
  text-align: left;
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
