<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import AppTextarea from '@/components/ui/AppTextarea.vue'
import type { RedisKeyDetail } from '@/types/redis'
const props = defineProps<{ detail: RedisKeyDetail | null; busy: boolean }>()
const emit = defineEmits<{
  save: [value: string]
  remove: []
  expire: [seconds: number]
  refresh: []
  dirty: [value: boolean]
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
  <section class="scroll-thin min-h-0 flex-1 overflow-auto p-4">
    <div
      v-if="detail"
      class="grid gap-4"
    >
      <header class="flex flex-wrap items-start justify-between gap-3">
        <div class="min-w-0">
          <h2 class="text-txt font-mono text-sm font-semibold break-all">
            {{ detail.key.name || t('空字符串键') }}
          </h2>
          <div class="text-txt-3 mt-2 flex flex-wrap gap-3 text-xs">
            <span class="text-amber font-mono">{{ detail.keyType }}</span>
            <span>{{ t('长度') }}: {{ detail.length }}</span>
            <span
              >TTL:
              {{
                detail.ttlMs === -1
                  ? t('永不过期')
                  : detail.ttlMs === -2
                    ? t('已过期')
                    : `${detail.ttlMs} ms`
              }}</span
            >
          </div>
        </div>
        <div class="flex gap-2">
          <AppButton
            :disabled="busy || dirty"
            @click="emit('refresh')"
            >{{ t('刷新') }}</AppButton
          >
          <AppButton
            :disabled="busy"
            @click="confirmDelete = true"
            >{{ t('删除键') }}</AppButton
          >
        </div>
      </header>
      <template v-if="detail.editable">
        <AppTextarea
          v-model="draft"
          :label="t('String 值')"
          :rows="10"
          :disabled="busy"
          class="font-mono text-xs"
        />
        <div class="flex items-center gap-3">
          <AppButton
            variant="primary"
            :disabled="busy || !dirty"
            @click="emit('save', draft)"
            >{{ t('保存值') }}</AppButton
          >
          <span class="text-txt-3 text-xs">{{ t('保存时保留当前 TTL') }}</span>
        </div>
      </template>
      <pre
        v-else
        class="border-line-soft bg-card text-txt-2 scroll-thin max-h-96 overflow-auto rounded-lg border p-3 font-mono text-xs break-all whitespace-pre-wrap"
        >{{ formatted }}</pre>
      <p
        v-if="detail.truncated"
        class="text-amber text-xs"
      >
        {{ t('仅显示部分内容；可在命令面板按范围或游标继续读取') }}
      </p>
      <p
        v-if="detail.keyType === 'hash' || detail.keyType === 'set'"
        class="text-txt-3 text-xs"
      >
        {{ t('扫描结果首项为下一游标，第二项为当前批次内容') }}
      </p>
      <form
        class="border-line-soft flex flex-wrap items-end gap-2 border-t pt-4"
        @submit.prevent="validTtl && emit('expire', Number(ttl))"
      >
        <AppTextField
          v-model="ttl"
          :label="t('TTL（秒，-1 表示永不过期）')"
          inputmode="numeric"
          :disabled="busy || dirty"
          class="w-56"
        />
        <AppButton
          type="submit"
          :disabled="busy || dirty || !validTtl"
          >{{ t('设置 TTL') }}</AppButton
        >
      </form>
    </div>
    <div
      v-else
      class="text-txt-3 flex h-full min-h-32 items-center justify-center text-sm"
    >
      {{ t('选择一个键查看内容，或使用命令创建数据') }}
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
