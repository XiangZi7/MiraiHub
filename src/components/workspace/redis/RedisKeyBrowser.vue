<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import RedisKeySearch from './RedisKeySearch.vue'
import RedisKeyList from './RedisKeyList.vue'
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
    <RedisKeySearch
      :disabled="busy || !connected"
      @search="emit('search', $event)"
    />
    <RedisKeyList
      :keys="keys"
      :disabled="busy || !connected"
      :selected="selected"
      @select="emit('select', $event)"
    >
      <template #heading>
        <div
          class="text-txt-2 flex min-w-0 items-center gap-1.5 pl-1 text-[11px]"
        >
          <AppIcon
            name="lucide:layers"
            :size="13"
            class="text-blue"
          />
          <span class="truncate">DB {{ database }}</span>
        </div>
      </template>
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
    </RedisKeyList>
    <footer
      class="border-line-soft text-txt-4 flex min-h-8 shrink-0 flex-wrap items-center justify-between gap-1 border-t px-2 py-1 text-[10px]"
    >
      <span :title="t('数量与分组仅统计已加载的键')">{{
        t('已加载 {count} 个键', { count: keys.length })
      }}</span>
      <AppButton
        v-if="hasMore"
        variant="ghost"
        size="sm"
        :disabled="busy || !connected"
        @click="emit('more')"
        >{{ t('继续扫描') }}</AppButton
      >
      <span v-else-if="connected && !busy">{{ t('扫描完成') }}</span>
    </footer>
  </aside>
</template>
