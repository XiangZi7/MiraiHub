<script setup lang="ts">
import { computed, reactive, toRefs, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import DatabaseQueryResizeHandle from '../database/DatabaseQueryResizeHandle.vue'
import type { RedisCommandResult } from '@/types/redis'
const props = defineProps<{
  busy: boolean
  result: RedisCommandResult | null
}>()
const command = defineModel<string>({ required: true })
const emit = defineEmits<{ execute: [] }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 编辑器与结果区的高度比例
  editorRatio: 45,
})
const { editorRatio } = toRefs(state)
const gutter = useTemplateRef<HTMLElement>('gutter')
function syncScroll(event: Event) {
  if (gutter.value)
    gutter.value.scrollTop = (event.target as HTMLTextAreaElement).scrollTop
}
const formatted = computed(() =>
  typeof props.result?.value === 'string'
    ? props.result.value
    : JSON.stringify(props.result?.value, null, 2)
)
const splitStyle = computed(() => ({
  gridTemplateRows:
    'minmax(0, ' +
    editorRatio.value +
    'fr) 10px minmax(0, ' +
    (100 - editorRatio.value) +
    'fr)',
}))
const lines = computed(() => command.value.split('\n').length)
function run() {
  if (!props.busy && command.value.trim()) emit('execute')
}
</script>

<template>
  <section
    class="grid min-h-0 flex-1"
    :style="splitStyle"
    :aria-label="t('Redis 命令')"
  >
    <div class="flex min-h-0 flex-col">
      <div
        class="border-line-soft text-txt-4 flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[10px]"
      >
        <AppIcon
          name="lucide:square-terminal"
          :size="12"
        />
        <span class="text-txt-3">{{ t('Redis 命令') }}</span>
        <span class="ml-auto">Ctrl + Enter</span>
      </div>
      <div class="bg-terminal flex min-h-0 flex-1 overflow-hidden">
        <div
          ref="gutter"
          class="border-line-soft text-txt-4 w-11 shrink-0 overflow-hidden border-r py-3 pr-3 text-right font-mono text-xs leading-[1.65]"
          aria-hidden="true"
        >
          <div
            v-for="line in lines"
            :key="line"
          >
            {{ line }}
          </div>
        </div>
        <textarea
          v-model="command"
          :aria-label="t('Redis 命令')"
          :disabled="busy"
          placeholder='SET "user:1" "hello" EX 3600'
          class="scroll-thin text-txt min-h-0 min-w-0 flex-1 resize-none bg-transparent p-3 font-mono text-xs leading-[1.65] outline-none"
          spellcheck="false"
          wrap="off"
          maxlength="1048576"
          @scroll="syncScroll"
          @keydown.ctrl.enter.stop.prevent="run"
          @keydown.meta.enter.stop.prevent="run"
        />
      </div>
      <p class="text-txt-4 shrink-0 px-3 py-1.5 text-[10px] leading-relaxed">
        {{ t('每次执行一条命令，支持引号和转义；写入命令会立即生效') }}
      </p>
    </div>
    <DatabaseQueryResizeHandle
      v-model="editorRatio"
      :default-value="45"
      :label="t('调整 Redis 编辑器和结果区高度')"
      :value-text="
        t('Redis 编辑器占 {value0}%', { value0: Math.round(editorRatio) })
      "
    />
    <div class="flex min-h-0 min-w-0 flex-col">
      <header
        class="border-line-soft flex h-8 shrink-0 items-center gap-2 border-b px-2 text-[11px]"
      >
        <span class="bg-raised text-txt rounded px-2.5 py-1">{{
          t('结果')
        }}</span>
        <span
          v-if="result"
          class="text-txt-4 ml-auto text-[10px]"
          >{{ result.elapsedMs }} ms</span
        >
      </header>
      <pre
        v-if="result"
        class="scroll-thin text-txt-2 min-h-0 flex-1 overflow-auto p-3 font-mono text-[11px] leading-relaxed break-all whitespace-pre-wrap"
        >{{ formatted }}</pre>
      <div
        v-else
        class="text-txt-4 flex min-h-0 flex-1 items-center justify-center text-[11px]"
      >
        {{ t('运行命令以查看结果') }}
      </div>
      <p
        v-if="result?.truncated"
        class="text-amber shrink-0 px-3 py-1.5 text-[10px]"
      >
        {{ t('结果已截断') }}
      </p>
    </div>
  </section>
</template>
