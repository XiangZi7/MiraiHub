<script setup lang="ts">
import { reactive, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { RedisKey } from '@/types/redis'
defineProps<{
  name: string
  database: string
  connected: boolean
  keys: RedisKey[]
  busy: boolean
  hasMore: boolean
  selected?: string
}>()
const emit = defineEmits<{
  search: [pattern: string]
  more: []
  select: [key: RedisKey]
  refresh: []
  command: []
}>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // Redis glob 搜索草稿
  pattern: '*',
})
const { pattern } = toRefs(state)
</script>

<template>
  <aside
    class="border-line-soft bg-panel flex min-h-0 min-w-0 shrink-0 flex-col overflow-hidden border-r"
  >
    <header
      class="border-line-soft flex h-10 shrink-0 items-center gap-1 border-b px-2"
    >
      <AppIcon
        name="lucide:database"
        :size="14"
        class="text-pink mr-1 shrink-0"
      />
      <span
        class="text-txt-2 min-w-0 flex-1 truncate text-xs"
        :title="name"
        >{{ name }}</span
      >
      <IconButton
        icon="lucide:square-terminal"
        :size="13"
        :title="t('Redis 命令')"
        :aria-label="t('打开 Redis 命令')"
        @click="emit('command')"
      />
      <IconButton
        icon="lucide:refresh-cw"
        :size="13"
        :title="t('刷新')"
        :aria-label="t('刷新键列表')"
        :disabled="busy || !connected"
        :class="busy && '[&_svg]:animate-spin'"
        @click="emit('refresh')"
      />
    </header>
    <form
      class="shrink-0 p-1.5"
      @submit.prevent="connected && !busy && emit('search', pattern)"
    >
      <label class="field h-7 gap-1.5 rounded-md px-2">
        <AppIcon
          name="lucide:search"
          :size="12"
          class="text-txt-4 shrink-0"
        />
        <input
          v-model="pattern"
          :aria-label="t('搜索 Redis 键')"
          placeholder="user:*"
          :disabled="busy || !connected"
          spellcheck="false"
        />
        <button
          type="submit"
          class="text-txt-4 hover:text-txt shrink-0 disabled:opacity-35"
          :disabled="busy || !connected"
          :title="t('扫描键')"
          :aria-label="t('扫描键')"
        >
          <AppIcon
            name="lucide:corner-down-left"
            :size="12"
          />
        </button>
      </label>
    </form>
    <div
      class="scroll-thin min-h-0 flex-1 overflow-auto p-1.5"
      :aria-label="t('Redis 键列表')"
    >
      <div class="text-txt-2 flex h-7 items-center gap-1.5 px-2 text-xs">
        <AppIcon
          name="lucide:chevron-down"
          :size="12"
        />
        <AppIcon
          name="lucide:layers"
          :size="13"
          class="text-blue"
        />
        <span>DB {{ database }}</span>
        <span
          v-if="connected"
          class="bg-accent ml-auto size-1.5 rounded-full"
        />
      </div>
      <div
        class="text-txt-3 flex h-7 items-center gap-1.5 pr-2 pl-6 text-[11px]"
      >
        <AppIcon
          name="lucide:folder-key"
          :size="12"
        />
        <span>{{ t('键') }}</span
        ><span class="text-txt-4 ml-auto font-mono text-[10px]">{{
          keys.length
        }}</span>
      </div>
      <button
        v-for="key in keys"
        :key="key.id"
        type="button"
        :disabled="busy || !connected"
        :title="key.name"
        :aria-pressed="selected === key.id"
        :class="[
          'nav-item h-7 w-full gap-1.5 pl-8 text-xs disabled:cursor-wait',
          selected === key.id && 'nav-item-active',
        ]"
        @click="emit('select', key)"
      >
        <AppIcon
          name="lucide:key-round"
          :size="12"
          class="text-accent shrink-0"
        />
        <span class="truncate">{{ key.name || t('空字符串键') }}</span>
      </button>
      <p
        v-if="!keys.length"
        class="text-txt-4 px-3 py-5 text-center text-[11px] leading-relaxed"
      >
        {{
          !connected
            ? t('请先连接数据库。')
            : busy
              ? t('正在扫描…')
              : hasMore
                ? t('本批无匹配键，可继续扫描')
                : t('没有匹配的 Redis 键')
        }}
      </p>
    </div>
    <footer
      class="border-line-soft text-txt-4 flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-1 border-t px-2 py-1 text-[10px]"
    >
      <span>{{ t('已加载 {count} 个键', { count: keys.length }) }}</span>
      <AppButton
        v-if="hasMore"
        variant="ghost"
        size="sm"
        :disabled="busy || !connected"
        @click="emit('more')"
        >{{ t('继续扫描') }}</AppButton
      >
    </footer>
  </aside>
</template>
