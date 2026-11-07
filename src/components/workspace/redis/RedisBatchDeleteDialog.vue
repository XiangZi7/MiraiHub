<script setup lang="ts">
import { computed, reactive, toRefs, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import * as redis from '@/api/redis'
import { toast } from '@/composables/useToast'
import type { RedisPatternPreview } from '@/types/redis'

const props = defineProps<{
  open: boolean
  sessionId: string
  database: string
}>()
const emit = defineEmits<{ close: []; deleted: [count: number] }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  pattern: '',
  // 预览结果对应的模式；输入变化后需重新预览
  previewed: '',
  preview: null as RedisPatternPreview | null,
  loading: false,
  // 二次确认：输入匹配数量
  confirmText: '',
})
const { pattern, preview, loading, confirmText } = toRefs(state)
watch(
  () => props.open,
  open => {
    if (!open) return
    state.pattern = ''
    state.previewed = ''
    state.preview = null
    state.confirmText = ''
  }
)
const stale = computed(() => state.previewed !== state.pattern)
const canDelete = computed(
  () =>
    !!state.preview &&
    !stale.value &&
    state.preview.count > 0 &&
    state.confirmText.trim() === String(state.preview.count) &&
    !state.loading
)
async function runPreview() {
  if (!state.pattern || state.loading) return
  state.loading = true
  try {
    state.preview = await redis.previewPattern(props.sessionId, state.pattern)
    state.previewed = state.pattern
    state.confirmText = ''
  } catch (error) {
    toast.error(redis.errorMessage(error))
  } finally {
    state.loading = false
  }
}
async function remove() {
  if (!canDelete.value) return
  state.loading = true
  try {
    const count = await redis.deletePattern(props.sessionId, state.previewed)
    toast.success(t('已删除 {count} 个键', { count }))
    emit('deleted', count)
    emit('close')
  } catch (error) {
    toast.error(redis.errorMessage(error))
  } finally {
    state.loading = false
  }
}
</script>

<template>
  <Teleport to="body">
    <div
      v-if="open"
      class="fixed inset-0 z-100"
    >
      <AppDialog
        :title="t('按模式批量删除')"
        :description="
          t('在 DB {db} 中扫描匹配的键，确认后使用 UNLINK 删除。', {
            db: database,
          })
        "
        wide
        @close="!loading && emit('close')"
      >
        <form
          class="flex items-center gap-2"
          @submit.prevent="runPreview"
        >
          <AppInput
            v-model="pattern"
            monospace
            class="flex-1"
            :aria-label="t('匹配模式')"
            :placeholder="t('例如 cache:* 或 session:*:tmp')"
            spellcheck="false"
            maxlength="4096"
            autofocus
          />
          <AppButton
            type="submit"
            :disabled="!pattern || loading"
            ><AppIcon
              name="lucide:scan-search"
              :size="12"
            />{{ t('预览') }}</AppButton
          >
        </form>
        <div
          v-if="loading"
          class="progress-indeterminate mt-3 h-0.5"
        />
        <template v-if="preview">
          <p
            class="mt-3 text-[11px]"
            :class="stale ? 'text-txt-4' : 'text-txt-2'"
          >
            {{
              preview.complete
                ? t('匹配 {count} 个键', { count: preview.count })
                : t('已扫描到至少 {count} 个键（扫描超时，删除时会完整处理）', {
                    count: preview.count,
                  })
            }}
            <span
              v-if="stale"
              class="text-amber ml-1"
              >{{ t('模式已修改，请重新预览') }}</span
            >
          </p>
          <ul
            v-if="preview.keys.length"
            class="border-line-soft bg-terminal scroll-thin mt-2 max-h-56 overflow-auto rounded-md border p-2 font-mono text-[11px]"
          >
            <li
              v-for="key in preview.keys"
              :key="key.id"
              class="text-txt-2 truncate"
              :title="key.name"
            >
              {{ key.name }}
            </li>
            <li
              v-if="preview.count > preview.keys.length"
              class="text-txt-4 pt-1"
            >
              {{
                t('…另有 {count} 个', {
                  count: preview.count - preview.keys.length,
                })
              }}
            </li>
          </ul>
          <label
            v-if="preview.count > 0 && !stale"
            class="text-txt-3 mt-3 flex flex-col gap-1.5 text-[11px]"
          >
            <span>{{
              t('此操作无法撤销。请输入匹配数量 {count} 以确认：', {
                count: preview.count,
              })
            }}</span>
            <AppInput
              v-model="confirmText"
              monospace
              inputmode="numeric"
              :aria-label="t('确认数量')"
            />
          </label>
        </template>
        <template #footer>
          <AppButton
            class="ml-auto"
            variant="ghost"
            :disabled="loading"
            @click="emit('close')"
            >{{ t('取消') }}</AppButton
          >
          <AppButton
            variant="danger"
            :disabled="!canDelete"
            @click="remove"
            ><AppIcon
              name="lucide:trash-2"
              :size="12"
            />{{ t('删除匹配的键') }}</AppButton
          >
        </template>
      </AppDialog>
    </div>
  </Teleport>
</template>
