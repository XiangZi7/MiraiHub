<script setup lang="ts">
import { computed, nextTick, toRef, useId, watch } from 'vue'
import { useVirtualList } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import { FILE_KIND_META, extensionOf } from '@/constants/files'
import { formatBytes } from '@/utils/format'
import { formatDateTime } from '@/utils/time'
import type { SshRemoteFile } from '@/types/ssh'

const props = defineProps<{ files: SshRemoteFile[]; selected: string }>()
const emit = defineEmits<{
  select: [path: string]
  open: [file: SshRemoteFile]
  contextmenu: [event: MouseEvent, file: SshRemoteFile]
}>()
const rowHeight = 32
const id = useId()
const { list, containerProps, wrapperProps, scrollTo } = useVirtualList(
  toRef(props, 'files'),
  { itemHeight: rowHeight, overscan: 6 }
)
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
    meta:
      file.kind === 'directory'
        ? FILE_KIND_META.folder
        : file.kind === 'symlink'
          ? { icon: 'lucide:link', tone: 'text-violet' }
          : FILE_KIND_META[extensionOf(file.name)],
    size: file.kind === 'directory' ? '–' : formatBytes(file.size),
    modified: file.modifiedAt ? formatDateTime(file.modifiedAt) : '—',
  }))
)
watch(
  () => props.files,
  () => scrollTo(0),
  { flush: 'post' }
)
function select(file: SshRemoteFile): void {
  emit('select', file.path)
  containerProps.ref.value?.focus({ preventScroll: true })
}
async function navigate(event: KeyboardEvent): Promise<void> {
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
  emit('select', props.files[index].path)
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
    class="scroll-thin focus-visible:ring-accent/60 min-h-0 flex-1 outline-none focus-visible:ring-1 focus-visible:ring-inset"
    role="listbox"
    aria-label="远端文件"
    :aria-activedescendant="activeDescendant"
    tabindex="0"
    @keydown="navigate"
  >
    <div v-bind="wrapperProps">
      <div
        v-for="row in rows"
        :id="`${id}-${row.index}`"
        :key="row.file.path"
        role="option"
        :aria-selected="selected === row.file.path"
        :aria-posinset="row.index + 1"
        :aria-setsize="files.length"
        class="grid w-full cursor-default grid-cols-[1fr_80px_130px] items-center gap-3 px-3 text-left text-xs"
        :class="selected === row.file.path ? 'bg-raised' : 'hover:bg-hover'"
        :style="{ height: `${rowHeight}px` }"
        :title="`${row.file.permissions}  ${row.file.owner}:${row.file.group}`"
        @click="select(row.file)"
        @dblclick="emit('open', row.file)"
        @contextmenu.prevent.stop="emit('contextmenu', $event, row.file)"
      >
        <span class="flex min-w-0 items-center gap-2">
          <AppIcon
            :name="row.meta.icon"
            :size="15"
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
        <span class="text-txt-3 truncate">{{ row.modified }}</span>
      </div>
    </div>
    <slot />
  </div>
</template>
