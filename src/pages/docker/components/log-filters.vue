<script setup lang="ts">
import { computed, reactive, shallowRef, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import AppButton from '@/components/ui/AppButton.vue'
import AppDatePicker from '@/components/ui/AppDatePicker.vue'
import AppInput from '@/components/ui/AppInput.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { DockerLogFilter } from '@/types/docker'
import {
  currentDateParts,
  formatDateValue,
  parseDateValue,
} from '@/utils/date-value'

const props = defineProps<{ filters: DockerLogFilter }>()
const emit = defineEmits<{ apply: [filter: DockerLogFilter] }>()
const { t } = useI18n()
const showValidation = shallowRef(false)
const errorId = useId()

/** 编辑已应用的时间时按本地时区回填，与日期选择器的日历一致。 */
function localTime(value?: number): string {
  return value === undefined
    ? ''
    : formatDateValue(currentDateParts(new Date(value * 1000)), 'datetime')
}

const draft = reactive({
  include: props.filters.include,
  exclude: props.filters.exclude,
  start: localTime(props.filters.since),
  end: localTime(props.filters.until),
})

/** 校验选择器的日历日期；未指定时区时按本地时间转换为 Docker 使用的 Unix 秒。 */
function timestamp(value: string): number | undefined {
  if (!value.trim()) return undefined
  const parts = parseDateValue(value, 'datetime')
  if (!parts || parts.fraction) return NaN
  const iso = formatDateValue(
    { ...parts, suffix: parts.suffix.trim() },
    'datetime'
  ).replace(' ', 'T')
  return Date.parse(iso) / 1000
}

const range = computed(() => {
  const since = timestamp(draft.start)
  const until = timestamp(draft.end)
  const reversed = since !== undefined && until !== undefined && since >= until
  return { since, until, reversed }
})
const startInvalid = computed(
  () =>
    showValidation.value &&
    (Number.isNaN(range.value.since) || range.value.reversed)
)
const endInvalid = computed(
  () =>
    showValidation.value &&
    (Number.isNaN(range.value.until) || range.value.reversed)
)
const error = computed(() => {
  if (!startInvalid.value && !endInvalid.value) return ''
  return range.value.reversed
    ? t('日志开始时间必须早于结束时间')
    : t('请输入有效的日期和时间，精确到秒')
})

/** 一次提交完整条件，编辑时间过程中保持当前订阅。 */
function apply(): void {
  showValidation.value = true
  if (error.value) return
  showValidation.value = false
  emit('apply', {
    include: draft.include.trim(),
    exclude: draft.exclude.trim(),
    since: range.value.since,
    until: range.value.until,
  })
}

/** 同时清空草稿和生效的日志筛选。 */
function reset(): void {
  Object.assign(draft, { include: '', exclude: '', start: '', end: '' })
  apply()
}
</script>

<template>
  <!-- 日志筛选栏复用标准输入、日期时间选择器和按钮。 -->
  <form
    class="border-line bg-card shrink-0 border-b px-3 py-2"
    :aria-label="t('筛选日志')"
    @submit.prevent="apply"
  >
    <div
      class="grid grid-cols-2 items-end gap-2 lg:grid-cols-[1fr_1fr_1.25fr_1.25fr_auto]"
    >
      <label class="text-txt-2 grid min-w-0 gap-1 text-xs">
        {{ t('包含关键词') }}
        <AppInput
          v-model="draft.include"
          size="sm"
          type="search"
          :aria-label="t('包含关键词')"
        />
      </label>
      <label class="text-txt-2 grid min-w-0 gap-1 text-xs">
        {{ t('排除关键词') }}
        <AppInput
          v-model="draft.exclude"
          size="sm"
          type="search"
          :aria-label="t('排除关键词')"
        />
      </label>
      <!-- 日期选择器本身含日历按钮，标签通过 aria-label 直接关联输入。 -->
      <div class="text-txt-2 grid min-w-0 gap-1 text-xs">
        <span>{{ t('开始时间') }}</span>
        <AppDatePicker
          v-model="draft.start"
          size="sm"
          mode="datetime"
          :aria-label="t('开始时间')"
          :aria-invalid="startInvalid"
          :aria-describedby="startInvalid ? errorId : undefined"
          class="aria-invalid:border-danger"
          :placeholder="t('不限')"
        />
      </div>
      <div class="text-txt-2 grid min-w-0 gap-1 text-xs">
        <span>{{ t('结束时间') }}</span>
        <AppDatePicker
          v-model="draft.end"
          size="sm"
          mode="datetime"
          :aria-label="t('结束时间')"
          :aria-invalid="endInvalid"
          :aria-describedby="endInvalid ? errorId : undefined"
          class="aria-invalid:border-danger"
          :placeholder="t('不限')"
        />
      </div>
      <!-- 一次应用或清除所有条件。 -->
      <div class="col-span-2 flex items-center justify-end gap-1 lg:col-span-1">
        <AppButton
          type="submit"
          variant="primary"
          size="sm"
          >{{ t('应用筛选') }}</AppButton
        >
        <IconButton
          icon="lucide:filter-x"
          :title="t('清除筛选')"
          @click="reset"
        />
      </div>
    </div>
    <p
      v-if="error"
      :id="errorId"
      role="alert"
      class="text-danger mt-1.5 text-xs"
    >
      {{ error }}
    </p>
  </form>
</template>
