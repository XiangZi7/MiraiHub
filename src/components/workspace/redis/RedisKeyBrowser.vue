<script setup lang="ts">
import { shallowRef } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import type { RedisKey } from '@/types/redis'
defineProps<{
  keys: RedisKey[]
  busy: boolean
  hasMore: boolean
  selected?: string
}>()
const emit = defineEmits<{
  search: [pattern: string]
  more: []
  select: [key: RedisKey]
}>()
const { t } = useI18n()
const pattern = shallowRef('*')
</script>

<template>
  <aside
    class="border-line bg-panel flex min-h-0 w-64 shrink-0 flex-col border-r max-lg:w-52"
  >
    <form
      class="border-line-soft grid gap-2 border-b p-3"
      @submit.prevent="emit('search', pattern)"
    >
      <AppTextField
        v-model="pattern"
        :label="t('搜索 Redis 键')"
        placeholder="user:*"
        :disabled="busy"
      />
      <AppButton
        type="submit"
        :disabled="busy"
      >
        <AppIcon
          name="lucide:search"
          :size="13"
        />{{ t('扫描键') }}
      </AppButton>
    </form>
    <div
      class="scroll-thin min-h-0 flex-1 overflow-auto p-1.5"
      :aria-label="t('Redis 键列表')"
    >
      <button
        v-for="key in keys"
        :key="key.id"
        type="button"
        :disabled="busy"
        :title="key.name"
        :aria-pressed="selected === key.id"
        :class="[
          'flex w-full cursor-pointer items-center gap-2 rounded-md px-2 py-2 text-left text-xs disabled:cursor-wait',
          selected === key.id ? 'bg-card text-txt' : 'text-txt-2 hover:bg-card',
        ]"
        @click="emit('select', key)"
      >
        <AppIcon
          name="lucide:key-round"
          :size="13"
          class="text-amber shrink-0"
        />
        <span class="truncate font-mono">{{
          key.name || t('空字符串键')
        }}</span>
      </button>
      <p
        v-if="!keys.length"
        class="text-txt-3 px-3 py-6 text-center text-xs"
      >
        {{
          busy
            ? t('正在扫描…')
            : hasMore
              ? t('本批无匹配键，可继续扫描')
              : t('没有匹配的 Redis 键')
        }}
      </p>
    </div>
    <footer class="border-line-soft text-txt-3 grid gap-2 border-t p-3 text-xs">
      <span>{{ t('已加载 {count} 个键', { count: keys.length }) }}</span>
      <AppButton
        v-if="hasMore"
        :disabled="busy"
        @click="emit('more')"
        >{{ t('继续扫描') }}</AppButton
      >
    </footer>
  </aside>
</template>
