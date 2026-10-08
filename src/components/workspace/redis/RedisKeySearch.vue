<script setup lang="ts">
import { reactive, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import { redisSearchPattern, type RedisSearchMode } from '@/utils/redis-browser'

const props = defineProps<{ disabled: boolean }>()
const emit = defineEmits<{ search: [pattern: string] }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 搜索词保留键名中的空格
  query: '',
  // 默认按包含搜索，通配符模式供熟悉 Redis 的用户使用
  mode: 'contains' as RedisSearchMode,
})
const { query, mode } = toRefs(state)
function search() {
  if (!props.disabled)
    emit('search', redisSearchPattern(state.query, state.mode))
}
</script>

<template>
  <form
    class="border-line-soft shrink-0 space-y-2 border-b p-2"
    @submit.prevent="search"
  >
    <label class="field h-8 gap-1.5 rounded-md px-2">
      <AppIcon
        name="lucide:search"
        :size="13"
        class="text-txt-4 shrink-0"
      />
      <input
        v-model="query"
        :aria-label="t('搜索 Redis 键')"
        :placeholder="t('输入键名，例如 user 或 cache')"
        :disabled="disabled"
        spellcheck="false"
        maxlength="1024"
      />
      <button
        type="submit"
        class="text-accent shrink-0 text-[11px] disabled:opacity-35"
        :disabled="disabled"
      >
        {{ t('搜索') }}
      </button>
    </label>
    <div class="flex items-center gap-2 text-[10px]">
      <select
        v-model="mode"
        class="field h-6 shrink-0 rounded px-1"
        :aria-label="t('键搜索方式')"
        :disabled="disabled"
      >
        <option value="contains">{{ t('包含') }}</option>
        <option value="prefix">{{ t('前缀') }}</option>
        <option value="glob">{{ t('匹配模式') }}</option>
      </select>
      <span class="text-txt-4 min-w-0 leading-relaxed">{{
        mode === 'glob'
          ? t('user:* 前缀 · *token* 包含 · ? 单字符')
          : t('留空搜索全部键，Enter 开始搜索')
      }}</span>
    </div>
  </form>
</template>
