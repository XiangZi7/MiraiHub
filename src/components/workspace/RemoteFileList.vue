<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, nextTick, toRef, useId, watch } from 'vue'
import { useVirtualList } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import { fileIcon } from '@/constants/files'
import { formatBytes } from '@/utils/format'
import { formatDateTime } from '@/utils/time'
import type { SshRemoteFile } from '@/types/ssh'
import { useRemoteFileSelection } from '@/components/workspace/useRemoteFileSelection'
import { useFilePaneDrag } from '@/components/workspace/useFilePaneDrag'

const { t } = useI18n()

const props = defineProps<{
  dragSessionId?: string
  local?: boolean
  files: SshRemoteFile[]
  selected: string
  selection: string[]
}>()
const emit = defineEmits<{
  select: [paths: string[], focus: string]
  open: [file: SshRemoteFile]
  contextmenu: [event: MouseEvent, file: SshRemoteFile]
}>()
const rowHeight = 32
const id = useId()
const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(
  toRef(props, 'files'),
  { itemHeight: rowHeight, overscan: 6 }
)
const { box, selectedSet, select, pointerDown, pointerMove, stopDrag } =
  useRemoteFileSelection(
    toRef(props, 'files'),
    toRef(props, 'selection'),
    toRef(props, 'selected'),
    containerProps.ref,
    (paths, focus) => emit('select', paths, focus),
    rowHeight
  )
const transferDrag = useFilePaneDrag({
  source: () => (props.local ? 'local' : 'remote'),
  sessionId: () => props.dragSessionId,
  files: () => props.files,
  selection: () => props.selection,
  container: containerProps.ref,
  select,
})
// 名称区域用于拖动文件，大小、日期和空白区域支持拖动框选。
function handlePointerDown(event: PointerEvent): void {
  if (!transferDrag.start(event)) pointerDown(event)
}
// 优先处理跨栏拖拽，未开始文件拖动时交给框选。
function handlePointerMove(event: PointerEvent): void {
  if (!transferDrag.move(event)) pointerMove(event)
}
// 完成传输手势并释放框选状态。
function handlePointerUp(event: PointerEvent): void {
  transferDrag.finish(event)
  stopDrag()
}
// 取消手势时同时清理选择框和文件预览。
function cancelGestures(): void {
  transferDrag.cancel()
  stopDrag()
}
const selectedIndex = computed(() =>
  props.files.findIndex(file => file.path === props.selected)
)
const activeDescendant = computed(() =>
  list.value.some(row => row.index === selectedIndex.value)
    ? `${id}-${selectedIndex.value}`
    : undefined
)
const rows = computed(() =>
  list.value.map(({ data: file, index }) => ({
    file,
    index,
    meta: fileIcon(file.name, file.kind),
    size: file.kind === 'directory' ? '–' : formatBytes(file.size),
    modified: file.modifiedAt ? formatDateTime(file.modifiedAt) : '—',
  }))
)
watch(
  () => props.files,
  () => {
    scrollTo(0)
    cancelGestures()
  },
  { flush: 'post' }
)
// 键盘支持全选、取消选择和 Shift 连选，焦点移动后滚动到可见位置。
async function navigate(event: KeyboardEvent): Promise<void> {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
    event.preventDefault()
    emit(
      'select',
      props.files.map(file => file.path),
      props.selected || props.files[0]?.path || ''
    )
    return
  }
  if (event.key === 'Escape') {
    cancelGestures()
    emit('select', [], '')
    return
  }
  if (!props.files.length) return
  if (event.key === 'Enter' && selectedIndex.value >= 0) {
    event.preventDefault()
    emit('open', props.files[selectedIndex.value])
    return
  }
  const page = Math.max(
    1,
    Math.floor(
      (containerProps.ref.value?.clientHeight || rowHeight) / rowHeight
    )
  )
  const current = selectedIndex.value
  const targets: Record<string, number> = {
    ArrowDown: current + 1,
    ArrowUp: current < 0 ? 0 : current - 1,
    Home: 0,
    End: props.files.length - 1,
    PageDown: current + page,
    PageUp: current - page,
  }
  if (!(event.key in targets)) return
  event.preventDefault()
  const index = Math.max(
    0,
    Math.min(props.files.length - 1, targets[event.key])
  )
  select(index, event.shiftKey, event.ctrlKey || event.metaKey)
  const container = containerProps.ref.value
  if (
    container &&
    (index * rowHeight < container.scrollTop ||
      (index + 1) * rowHeight > container.scrollTop + container.clientHeight)
  ) {
    scrollTo(index < current ? index : Math.max(0, index - page + 1))
  }
  await nextTick()
}
</script>

<template>
  <div
    v-bind="containerProps"
    class="scroll-thin relative min-h-0 flex-1 outline-none select-none"
    role="listbox"
    aria-multiselectable="true"
    :aria-label="local ? t('本地文件') : t('远端文件')"
    :aria-activedescendant="activeDescendant"
    tabindex="0"
    @keydown="navigate"
    @pointerdown="handlePointerDown"
    @pointermove="handlePointerMove"
    @pointerup="handlePointerUp"
    @pointercancel="cancelGestures"
    @lostpointercapture="cancelGestures"
    @click.capture="transferDrag.consumeClick"
    @dragstart.prevent
  >
    <div v-bind="wrapperProps">
      <div
        v-for="row in rows"
        :id="`${id}-${row.index}`"
        :key="row.file.path"
        role="option"
        :aria-selected="selectedSet.has(row.file.path)"
        :data-file-index="row.index"
        :aria-posinset="row.index + 1"
        :aria-setsize="files.length"
        class="remote-file-columns grid w-full cursor-default grid-cols-[1fr_80px_130px] items-center gap-3 px-3 text-left text-xs"
        :class="
          selectedSet.has(row.file.path)
            ? 'bg-accent/20 ring-accent/30 ring-1 ring-inset'
            : 'hover:bg-hover'
        "
        :style="{ height: `${rowHeight}px` }"
        :title="
          local
            ? row.file.path
            : `${row.file.name}\n${row.file.permissions}  ${row.file.owner}:${row.file.group}`
        "
        @dblclick="emit('open', row.file)"
        @contextmenu.prevent.stop="emit('contextmenu', $event, row.file)"
      >
        <span
          data-file-drag-handle
          class="flex min-w-0 items-center gap-2"
        >
          <AppIcon
            :name="row.meta.icon"
            :size="17"
            :class="row.meta.tone"
          />
          <span class="text-txt truncate">{{ row.file.name }}</span>
          <span
            v-if="row.file.linkTarget"
            class="text-txt-4 shrink-0 truncate text-[10.5px]"
            >→ {{ row.file.linkTarget }}</span
          >
        </span>
        <span class="text-txt-3 text-right">{{ row.size }}</span>
        <span class="remote-file-modified text-txt-3 truncate">{{
          row.modified
        }}</span>
      </div>
    </div>
    <slot />
    <div
      v-if="box"
      class="border-accent bg-accent/15 pointer-events-none absolute z-10 border"
      :style="{
        left: `${box.left}px`,
        top: `${box.top}px`,
        width: `${box.width}px`,
        height: `${box.height}px`,
      }"
      aria-hidden="true"
    />
  </div>
  <Teleport to="body">
    <div
      v-if="transferDrag.preview.visible"
      class="bg-panel border-line text-txt pointer-events-none fixed z-100 flex max-w-64 items-center gap-2 rounded-lg border px-3 py-2 text-xs shadow-xl"
      :style="{
        left: `${transferDrag.preview.x}px`,
        top: `${transferDrag.preview.y}px`,
      }"
    >
      <AppIcon
        name="lucide:files"
        :size="16"
        class="text-accent"
      /><span class="truncate">{{ transferDrag.preview.name }}</span
      ><span class="bg-accent shrink-0 rounded-full px-1.5 text-white">{{
        transferDrag.preview.count
      }}</span>
    </div>
  </Teleport>
</template>
