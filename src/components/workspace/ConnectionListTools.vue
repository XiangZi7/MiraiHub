<script setup lang="ts">
import {
  computed,
  nextTick,
  reactive,
  toRefs,
  useId,
  useTemplateRef,
} from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import AppMenuSurface from '@/components/ui/AppMenuSurface.vue'
import {
  CONNECTION_SORT_OPTIONS,
  type ConnectionSort,
} from '@/utils/connection-list'

defineProps<{ label: string; expanded: boolean }>()
const keyword = defineModel<string>('keyword', { required: true })
const sort = defineModel<ConnectionSort>('sort', { required: true })
const emit = defineEmits<{ createGroup: []; toggleAll: [] }>()
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
const searchId = useId()
// 响应式状态
const state = reactive({
  // 搜索浮层是否显示
  searchOpen: false,
  // 排序菜单是否显示
  open: false,
  // 排序菜单的横坐标
  x: 0,
  // 排序菜单的纵坐标
  y: 0,
})
const { open, x, y, searchOpen } = toRefs(state)
function closeSearch(): void {
  state.searchOpen = false
  keyword.value = ''
}
async function toggleSearch(): Promise<void> {
  if (state.searchOpen) {
    closeSearch()
    return
  }
  state.searchOpen = true
  await nextTick()
  searchInput.value?.focus()
}
const options = computed(() =>
  CONNECTION_SORT_OPTIONS.map(option => ({
    id: option.value,
    label: option.label,
    icon: sort.value === option.value ? 'lucide:check' : undefined,
  }))
)
function showSort(event: MouseEvent): void {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  state.x = rect.left
  state.y = rect.bottom + 4
  state.open = true
}
function selectSort(id: string): void {
  const option = CONNECTION_SORT_OPTIONS.find(option => option.value === id)
  if (option) sort.value = option.value
}
</script>

<template>
  <div class="relative mt-5 mb-2">
    <div class="mb-2 flex items-center gap-0.5">
      <p class="group-label min-w-0 flex-1 truncate">{{ label }}</p>
      <IconButton
        icon="lucide:search"
        :size="13"
        :title="searchOpen ? '取消搜索' : '搜索连接'"
        :aria-expanded="searchOpen"
        :aria-controls="searchId"
        :class="{ 'bg-hover text-txt': searchOpen }"
        @click="toggleSearch"
      />
      <IconButton
        icon="lucide:arrow-down-up"
        :size="13"
        title="排序连接"
        @click="showSort"
      />
      <IconButton
        :icon="expanded ? 'lucide:chevrons-up' : 'lucide:chevrons-down'"
        :size="13"
        :title="expanded ? '全部折叠' : '全部展开'"
        @click="emit('toggleAll')"
      />
      <IconButton
        icon="lucide:folder-plus"
        :size="13"
        title="新建分组"
        @click="emit('createGroup')"
      />
    </div>
    <div
      v-if="searchOpen"
      :id="searchId"
      class="search-popover"
      @keydown.esc.stop.prevent="closeSearch"
    >
      <AppMenuSurface />
      <label class="field flex items-center gap-1.5">
        <AppIcon
          name="lucide:search"
          :size="13"
          class="text-txt-4 shrink-0"
        />
        <input
          ref="searchInput"
          v-model="keyword"
          type="search"
          aria-label="搜索连接"
          placeholder="搜索名称、地址、分组…"
          class="min-w-0 flex-1"
        />
      </label>
    </div>
    <AppContextMenu
      :open="open"
      :x="x"
      :y="y"
      :items="options"
      label="连接排序"
      @close="open = false"
      @select="selectSort"
    />
  </div>
</template>

<style scoped>
.search-popover {
  position: absolute;
  top: calc(100% + 2px);
  left: 0;
  right: 0;
  z-index: 40;
  padding: 6px;
  border: 1px solid var(--color-line-strong);
  border-radius: 8px;
  isolation: isolate;
  box-shadow: var(--shadow-pop);
}
</style>
