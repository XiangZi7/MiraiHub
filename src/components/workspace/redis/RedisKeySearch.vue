<script setup lang="ts">
import { computed, reactive, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppButton from '@/components/ui/AppButton.vue'
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
const modes = computed(() => [
  {
    value: 'contains',
    label: t('包含'),
    description: t('查找包含输入文字的键，例如 token'),
  },
  {
    value: 'prefix',
    label: t('前缀'),
    description: t('查找以输入文字开头的键，例如 user:'),
  },
  {
    value: 'glob',
    label: t('匹配模式'),
    description: t('user:* 前缀 · *token* 包含 · ? 单字符'),
  },
])
function search() {
  if (!props.disabled)
    emit('search', redisSearchPattern(state.query, state.mode))
}
</script>

<template>
  <form
    class="flex shrink-0 items-center gap-1.5 px-2 pt-2 pb-1"
    @submit.prevent="search"
  >
    <AppSelect
      v-model="mode"
      class="w-22 shrink-0"
      :label="t('键搜索方式')"
      :options="modes"
      :disabled="disabled"
      :menu-min-width="260"
      wrap-descriptions
      compact
      hide-label
    />
    <div class="relative min-w-0 flex-1">
      <AppInput
        v-model="query"
        size="sm"
        class="pr-8"
        :aria-label="t('搜索 Redis 键')"
        :placeholder="t('输入键名，例如 user 或 cache')"
        :title="t('留空搜索全部键，Enter 开始搜索')"
        :disabled="disabled"
        spellcheck="false"
        maxlength="1024"
      />
      <AppButton
        type="submit"
        variant="bare"
        class="icon-btn text-accent absolute top-0 right-0"
        :title="t('搜索')"
        :aria-label="t('搜索 Redis 键')"
        :disabled="disabled"
      >
        <AppIcon
          name="lucide:search"
          :size="13"
        />
      </AppButton>
    </div>
  </form>
</template>
