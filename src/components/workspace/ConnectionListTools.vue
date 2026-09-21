<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import {
  computed,
  nextTick,
  reactive,
  shallowRef,
  toRefs,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppContextMenu from '@/components/ui/AppContextMenu.vue'
import {
  CONNECTION_SORT_OPTIONS,
  type ConnectionSort,
} from '@/utils/connection-list'

const { t } = useI18n()

defineProps<{
  label: string
  expanded: boolean
  transferable?: boolean
  /** 当前关键词命中的连接数，仅搜索时显示 */
  matchCount?: number
}>()
const keyword = defineModel<string>('keyword', { required: true })
const sort = defineModel<ConnectionSort>('sort', { required: true })
/**
 * 新建分组输入行的开关。
 *
 * 工具行的按钮和分组右键菜单是同一个入口的两个触发点，
 * 状态放在父级，两边都只改这一个布尔值。
 */
const creatingGroup = defineModel<boolean>('creatingGroup', { required: true })
const emit = defineEmits<{
  createGroup: [name: string]
  toggleAll: []
  transfer: []
}>()
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
const groupInput = useTemplateRef<HTMLInputElement>('groupInput')
const searchId = useId()
const groupName = shallowRef('')
// 响应式状态
const state = reactive({
  // 搜索行是否展开
  searchOpen: false,
  // 排序菜单是否显示
  open: false,
  // 排序菜单的横坐标
  x: 0,
  // 排序菜单的纵坐标
  y: 0,
})
const { open, x, y, searchOpen } = toRefs(state)
/**
 * 关闭即清空。
 *
 * 留着关键词收起搜索行，列表会保持被过滤的样子却没有任何可见线索，
 * 用户只会以为连接丢了。
 */
function closeSearch(): void {
  state.searchOpen = false
  keyword.value = ''
}
async function toggleSearch(): Promise<void> {
  if (state.searchOpen) {
    closeSearch()
    return
  }
  // 一行只放得下一个输入框，两种模式互斥。
  creatingGroup.value = false
  state.searchOpen = true
  await nextTick()
  searchInput.value?.focus()
}

function submitGroup(): void {
  const name = groupName.value.trim()
  if (!name) return
  creatingGroup.value = false
  emit('createGroup', name)
}

// 聚焦和清空集中在这里，工具行按钮与右键菜单就都只负责翻开关。
watch(creatingGroup, async opened => {
  if (!opened) {
    groupName.value = ''
    return
  }
  closeSearch()
  await nextTick()
  groupInput.value?.focus()
  groupInput.value?.select()
})

const options = computed(() =>
  CONNECTION_SORT_OPTIONS.map(option => ({
    id: option.value,
    label: t(option.label),
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
  <div
    ref="root"
    class="mt-5 mb-2"
  >
    <div class="mb-2 flex min-h-8 items-center gap-0.5">
      <form
        v-if="creatingGroup"
        class="field field-inline w-full"
        @submit.prevent="submitGroup"
        @keydown.esc.stop.prevent="creatingGroup = false"
      >
        <AppIcon
          name="lucide:folder-plus"
          :size="13"
          class="text-txt-4 shrink-0"
        />
        <input
          ref="groupInput"
          v-model="groupName"
          type="text"
          autocomplete="off"
          spellcheck="false"
          maxlength="64"
          :aria-label="t('分组名称')"
          :placeholder="t('New group')"
          class="min-w-0 flex-1"
        />
        <button
          type="submit"
          class="field-action"
          :disabled="!groupName.trim()"
          :title="t('确认')"
          :aria-label="t('确认')"
        >
          <AppIcon
            name="lucide:check"
            :size="12"
          />
        </button>
        <button
          type="button"
          class="field-action"
          :title="t('取消')"
          :aria-label="t('取消')"
          @click="creatingGroup = false"
        >
          <AppIcon
            name="lucide:x"
            :size="12"
          />
        </button>
      </form>

      <label
        v-else-if="searchOpen"
        :id="searchId"
        class="field field-inline w-full"
        @keydown.esc.stop.prevent="closeSearch"
      >
        <AppIcon
          name="lucide:search"
          :size="13"
          class="text-txt-4 shrink-0"
        />
        <input
          ref="searchInput"
          v-model="keyword"
          type="text"
          autocomplete="off"
          spellcheck="false"
          :aria-label="t('搜索连接')"
          :placeholder="t('搜索名称、地址、分组…')"
          class="min-w-0 flex-1"
        />
        <span
          v-if="keyword.trim()"
          class="search-count"
          role="status"
          >{{ matchCount ?? 0 }}</span
        >
        <button
          type="button"
          class="field-action"
          :title="t('取消搜索')"
          :aria-label="t('取消搜索')"
          @click="closeSearch"
        >
          <AppIcon
            name="lucide:x"
            :size="12"
          />
        </button>
      </label>

      <template v-else>
        <p class="group-label min-w-0 flex-1 truncate">{{ label }}</p>
        <IconButton
          icon="lucide:search"
          :size="13"
          :title="t('搜索连接')"
          :aria-expanded="searchOpen"
          :aria-controls="searchId"
          @click="toggleSearch"
        />
        <IconButton
          icon="lucide:arrow-down-up"
          :size="13"
          :title="t('排序连接')"
          @click="showSort"
        />
        <IconButton
          v-if="transferable"
          icon="lucide:arrow-left-right"
          :size="13"
          :title="t('导入 / 导出 SSH 配置')"
          @click="emit('transfer')"
        />
        <IconButton
          :icon="expanded ? 'lucide:chevrons-up' : 'lucide:chevrons-down'"
          :size="13"
          :title="expanded ? t('全部折叠') : t('全部展开')"
          @click="emit('toggleAll')"
        />
        <IconButton
          icon="lucide:folder-plus"
          :size="13"
          :title="t('新建分组')"
          :aria-expanded="creatingGroup"
          @click="creatingGroup = true"
        />
      </template>
    </div>
    <AppContextMenu
      :open="open"
      :x="x"
      :y="y"
      :items="options"
      :label="t('连接排序')"
      @close="open = false"
      @select="selectSort"
    />
  </div>
</template>

<style scoped>
.search-count {
  flex-shrink: 0;
  color: var(--color-txt-4);
  font-size: 10px;
  font-variant-numeric: tabular-nums;
  line-height: 1;
}
</style>
