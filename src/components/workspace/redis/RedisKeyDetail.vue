<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import type { RedisKeyDetail } from '@/types/redis'
const props = defineProps<{ detail: RedisKeyDetail | null; busy: boolean }>()
const emit = defineEmits<{
  save: [value: string]
  remove: []
  expire: [seconds: number]
  refresh: []
  dirty: [value: boolean]
  command: []
}>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 当前 string 值编辑草稿
  draft: '',
  // 待设置的过期秒数
  ttl: '-1',
  // 删除确认弹窗
  confirmDelete: false,
})
const { draft, ttl, confirmDelete } = toRefs(state)
const dirty = computed(
  () => !!props.detail?.editable && state.draft !== props.detail.value
)
const validTtl = computed(
  () => /^(-1|[1-9]\d*)$/.test(state.ttl) && Number(state.ttl) <= 2147483647
)
const formatted = computed(() =>
  typeof props.detail?.value === 'string'
    ? props.detail.value
    : JSON.stringify(props.detail?.value, null, 2)
)
watch(
  () => props.detail,
  detail => {
    state.draft = detail?.editable ? String(detail.value) : ''
    state.ttl =
      detail && detail.ttlMs >= 0
        ? String(Math.max(1, Math.ceil(detail.ttlMs / 1000)))
        : '-1'
    state.confirmDelete = false
  },
  { immediate: true }
)
watch(dirty, value => emit('dirty', value), { immediate: true })
function confirmRemoval() {
  state.confirmDelete = false
  emit('remove')
}
</script>

<template>
  <section
    class="flex min-h-0 min-w-0 flex-1 flex-col"
    :aria-label="t('键值')"
  >
    <template v-if="detail">
      <header
        class="border-line-soft flex min-h-9 shrink-0 flex-wrap items-center gap-2 border-b px-3 py-1.5"
      >
        <span
          class="bg-raised text-accent rounded px-1.5 py-0.5 font-mono text-[10px]"
          >{{ detail.keyType }}</span
        >
        <span
          class="text-txt-2 min-w-0 flex-1 truncate font-mono text-[11px]"
          :title="detail.key.name"
          >{{ detail.key.name || t('空字符串键') }}</span
        >
        <div class="flex items-center gap-1">
          <IconButton
            icon="lucide:refresh-cw"
            :size="13"
            :title="t('刷新键内容')"
            :aria-label="t('刷新键内容')"
            :disabled="busy || dirty"
            @click="emit('refresh')"
          />
          <IconButton
            icon="lucide:trash-2"
            :size="13"
            :title="t('删除键')"
            :aria-label="t('删除键')"
            :disabled="busy"
            @click="confirmDelete = true"
          />
        </div>
      </header>
      <form
        class="border-line-soft text-txt-3 flex min-h-9 shrink-0 flex-wrap items-center gap-x-3 gap-y-1.5 border-b px-3 py-1 text-[10px]"
        @submit.prevent="
          !busy && !dirty && validTtl && emit('expire', Number(ttl))
        "
      >
        <span>{{ t('长度') }}: {{ detail.length }}</span>
        <span
          >TTL:
          {{
            detail.ttlMs === -1
              ? t('永不过期')
              : detail.ttlMs === -2
                ? t('已过期')
                : detail.ttlMs + ' ms'
          }}</span
        >
        <div class="ml-auto flex items-center gap-1.5">
          <label class="field h-6 w-24 gap-1 rounded-md px-1.5">
            <span class="text-txt-4 text-[10px]">TTL</span>
            <input
              v-model="ttl"
              class="min-w-0"
              :aria-label="t('TTL（秒，-1 表示永不过期）')"
              :title="t('TTL（秒，-1 表示永不过期）')"
              inputmode="numeric"
              :disabled="busy || dirty"
            />
            <span class="text-txt-4 text-[10px]">s</span>
          </label>
          <AppButton
            type="submit"
            size="sm"
            variant="ghost"
            :disabled="busy || dirty || !validTtl"
            >{{ t('设置 TTL') }}</AppButton
          >
        </div>
      </form>
      <div
        class="border-line-soft bg-panel text-txt-3 flex h-8 shrink-0 items-center gap-2 border-b px-3 text-[11px]"
      >
        <AppIcon
          name="lucide:braces"
          :size="12"
        />
        <span>{{ t('值') }}</span>
        <span
          v-if="dirty"
          class="text-amber text-[10px]"
          >{{ t('未保存') }}</span
        >
        <span
          v-if="!detail.editable"
          class="text-txt-4 ml-auto text-[10px]"
          >{{ t('只读预览') }}</span
        >
      </div>
      <textarea
        v-if="detail.editable"
        v-model="draft"
        :aria-label="t('String 值')"
        :disabled="busy"
        class="scroll-thin bg-terminal text-txt min-h-0 w-full flex-1 resize-none p-3 font-mono text-xs leading-relaxed outline-none"
        spellcheck="false"
        @keydown.ctrl.enter.prevent="!busy && dirty && emit('save', draft)"
        @keydown.meta.enter.prevent="!busy && dirty && emit('save', draft)"
      />
      <pre
        v-else
        class="scroll-thin bg-terminal text-txt-2 min-h-0 flex-1 overflow-auto p-3 font-mono text-xs leading-relaxed break-all whitespace-pre-wrap"
        >{{ formatted }}</pre>
      <p
        v-if="detail.truncated"
        class="border-line-soft text-amber shrink-0 border-t px-3 py-2 text-[10px]"
      >
        {{ t('仅显示部分内容；可在命令面板按范围或游标继续读取') }}
      </p>
      <p
        v-if="detail.keyType === 'hash' || detail.keyType === 'set'"
        class="text-txt-4 shrink-0 px-3 py-1 text-[10px]"
      >
        {{ t('扫描结果首项为下一游标，第二项为当前批次内容') }}
      </p>
      <footer
        class="border-line-soft flex min-h-10 shrink-0 flex-wrap items-center gap-2 border-t px-3 py-1.5"
      >
        <AppButton
          v-if="detail.editable"
          size="sm"
          :disabled="busy || !dirty"
          @click="emit('save', draft)"
        >
          <AppIcon
            name="lucide:save"
            :size="12"
          />{{ t('保存值') }}
        </AppButton>
        <span
          v-if="detail.editable"
          class="text-txt-4 text-[10px]"
          >{{ t('保存时保留当前 TTL') }}</span
        >
        <AppButton
          v-else
          size="sm"
          @click="emit('command')"
          ><AppIcon
            name="lucide:square-terminal"
            :size="12"
          />{{ t('Redis 命令') }}</AppButton
        >
      </footer>
    </template>
    <div
      v-else
      class="text-txt-4 flex min-h-0 flex-1 flex-col items-center justify-center gap-3 px-6 text-center"
    >
      <AppIcon
        name="lucide:database"
        :size="32"
        class="opacity-40"
      />
      <p class="text-txt-2 text-xs">{{ t('Redis 键浏览器') }}</p>
      <p class="max-w-72 text-[11px] leading-relaxed">
        {{ t('选择一个键查看内容，或使用命令创建数据') }}
      </p>
      <AppButton
        size="sm"
        @click="emit('command')"
        ><AppIcon
          name="lucide:square-terminal"
          :size="12"
        />{{ t('打开 Redis 命令') }}</AppButton
      >
    </div>
    <AppConfirmDialog
      :open="confirmDelete"
      :title="t('删除 Redis 键？')"
      :description="t('将删除当前键及其全部内容。')"
      :confirm-label="t('删除键')"
      danger
      @close="confirmDelete = false"
      @confirm="confirmRemoval"
    />
  </section>
</template>
