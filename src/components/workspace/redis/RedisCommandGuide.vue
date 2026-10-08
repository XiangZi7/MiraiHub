<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import {
  REDIS_COMMAND_GROUPS,
  REDIS_COMMAND_TEMPLATES,
  quoteRedisArgument,
  quoteRedisKey,
  type RedisCommandGroup,
} from '@/utils/redis-commands'
import type { RedisKey } from '@/types/redis'

const props = defineProps<{
  busy: boolean
  selectedKey?: RedisKey
  keyType?: string
}>()
const emit = defineEmits<{ insert: [command: string] }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 命令速查默认展开，可收起以留出编辑空间
  open: true,
  // 当前命令分类
  group: '常用查询' as RedisCommandGroup,
  // 模板使用的键名；选择键时同步，允许手动修改
  keyName: 'your:key',
  // SCAN 模板使用的匹配模式
  pattern: '*',
})
const { open, group, keyName, pattern } = toRefs(state)
watch(
  () => props.selectedKey?.id,
  () => {
    state.keyName = props.selectedKey?.name ?? 'your:key'
  },
  { immediate: true }
)
const keyArgument = computed(() =>
  props.selectedKey && state.keyName === props.selectedKey.name
    ? quoteRedisKey(props.selectedKey)
    : quoteRedisArgument(state.keyName)
)
const templates = computed(() =>
  REDIS_COMMAND_TEMPLATES.filter(
    template => template.group === state.group
  ).map(template => ({
    ...template,
    command: template.build(keyArgument.value, state.pattern || '*'),
  }))
)
</script>

<template>
  <div
    class="border-line-soft bg-panel flex min-h-0 shrink-0 flex-col border-b"
  >
    <button
      type="button"
      class="text-txt-2 hover:bg-hover flex h-8 shrink-0 items-center gap-2 px-3 text-left text-[11px]"
      :aria-expanded="open"
      @click="open = !open"
    >
      <AppIcon
        name="lucide:book-open"
        :size="13"
        class="text-accent"
      />
      <span>{{ t('常用命令速查') }}</span>
      <span class="text-txt-4 ml-auto text-[10px]">{{
        t('点击填入，修改后执行')
      }}</span>
      <AppIcon
        :name="open ? 'lucide:chevron-up' : 'lucide:chevron-down'"
        :size="12"
      />
    </button>
    <div
      v-if="open"
      class="scroll-thin max-h-64 overflow-auto px-3 pb-3"
    >
      <div
        class="flex flex-wrap gap-1 pb-2"
        role="group"
        :aria-label="t('命令分类')"
      >
        <button
          v-for="category in REDIS_COMMAND_GROUPS"
          :key="category"
          type="button"
          :aria-pressed="group === category"
          :class="[
            'rounded px-2 py-1 text-[10px] transition-colors',
            group === category
              ? 'bg-accent/15 text-accent'
              : 'text-txt-3 hover:bg-hover',
            category === '写入与删除' && 'text-amber',
          ]"
          @click="group = category"
        >
          {{ t(category) }}
        </button>
      </div>
      <div class="mb-2 flex flex-wrap items-center gap-2">
        <label class="field h-7 min-w-0 flex-1 gap-2 rounded px-2 text-[10px]">
          <span class="text-txt-4 shrink-0">{{ t('目标键') }}</span>
          <input
            v-model="keyName"
            :aria-label="t('命令模板目标键')"
            class="font-mono"
            spellcheck="false"
          />
        </label>
        <label
          v-if="group === '常用查询'"
          class="field h-7 min-w-0 flex-1 gap-2 rounded px-2 text-[10px]"
        >
          <span class="text-txt-4 shrink-0">MATCH</span>
          <input
            v-model="pattern"
            :aria-label="t('SCAN 匹配模式')"
            placeholder="user:*"
            class="font-mono"
            spellcheck="false"
            maxlength="4096"
          />
        </label>
        <span
          v-if="selectedKey && keyName === selectedKey.name && keyType"
          class="text-accent font-mono text-[10px]"
          >{{ keyType }}</span
        >
      </div>
      <div class="redis-command-cards grid gap-1.5">
        <button
          v-for="template in templates"
          :key="template.id"
          type="button"
          class="border-line-soft bg-card hover:border-accent/40 min-w-0 rounded-md border px-2.5 py-2 text-left disabled:opacity-35"
          :disabled="busy"
          :title="template.command"
          @click="emit('insert', template.command)"
        >
          <div class="flex items-center gap-1.5 text-[11px]">
            <span :class="template.write ? 'text-amber' : 'text-txt-2'">{{
              t(template.label)
            }}</span>
            <span
              v-if="template.write"
              class="text-amber ml-auto text-[9px]"
              >{{ t('写入') }}</span
            >
            <AppIcon
              name="lucide:corner-down-left"
              :size="11"
              class="text-txt-4 ml-auto shrink-0"
            />
          </div>
          <code class="text-accent mt-1 block truncate text-[10px]">{{
            template.command
          }}</code>
          <p class="text-txt-4 mt-1 text-[10px] leading-relaxed">
            {{ t(template.description) }}
          </p>
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.redis-command-cards {
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 220px), 1fr));
}
</style>
