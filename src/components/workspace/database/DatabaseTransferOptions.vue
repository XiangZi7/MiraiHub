<script setup lang="ts">
import { computed, useId } from 'vue'
import { useI18n } from 'vue-i18n'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import type { DatabaseTransferContent } from '@/types/database'

const props = defineProps<{
  mode: 'export' | 'import'
  databaseKind?: string
  disabled: boolean
}>()

const content = defineModel<DatabaseTransferContent>('content', {
  required: true,
})
const includeDatabase = defineModel<boolean>('includeDatabase', {
  required: true,
})
const dropExisting = defineModel<boolean>('dropExisting', { required: true })
const { t } = useI18n()
const contentGroupName = useId()

const contentOptions = computed(() => [
  { value: 'all', label: t('结构和数据') },
  { value: 'structure', label: t('仅结构') },
  { value: 'data', label: t('仅数据') },
])
const description = computed(() => {
  if (content.value === 'data')
    return props.mode === 'export'
      ? t('只导出表数据，不包含建库、建表、视图或例程；导入时目标表需已存在。')
      : props.databaseKind === 'postgresql'
        ? t(
            '只导入 INSERT 数据和序列值，跳过建库、建表和其他 SQL；目标表需已存在。'
          )
        : t(
            '只导入 INSERT / REPLACE 数据，跳过建库、建表和其他 SQL；目标表需已存在。'
          )
  if (content.value === 'structure')
    return t('只处理表、索引、约束、视图和例程结构，不包含表数据。')
  return t('包含对象结构和表数据，适合完整迁移。')
})
const databaseLabel = computed(() =>
  props.databaseKind === 'postgresql'
    ? t('包含 Schema 创建语句')
    : t('包含建库和切库语句')
)
const databaseDescription = computed(() => {
  if (props.databaseKind === 'postgresql')
    return t('关闭后不创建 Schema，目标 Schema 需已存在。')
  return props.mode === 'export'
    ? t('默认关闭，便于将文件导入其他数据库。')
    : t('默认关闭，导入当前数据库；开启后允许文件创建或切换数据库。')
})
</script>

<template>
  <fieldset
    class="grid min-w-0 gap-2"
    :disabled="disabled"
  >
    <legend class="text-txt-2 mb-2 text-[11px] font-medium">
      {{ mode === 'export' ? t('导出内容') : t('导入内容') }}
    </legend>
    <div class="grid grid-cols-3 gap-2">
      <label
        v-for="option in contentOptions"
        :key="option.value"
        class="border-line-soft text-txt-3 has-checked:border-accent/60 has-checked:bg-accent/10 has-checked:text-accent has-focus-visible:ring-accent/50 flex cursor-pointer items-center justify-center gap-1.5 rounded-md border px-2 py-2.5 text-[11px] transition-colors has-focus-visible:ring-2"
        :class="disabled && 'pointer-events-none opacity-60'"
      >
        <input
          v-model="content"
          type="radio"
          :name="contentGroupName"
          :value="option.value"
          class="accent-accent size-3"
        />
        {{ option.label }}
      </label>
    </div>
    <p class="text-txt-4 min-h-8 text-[10.5px] leading-4">{{ description }}</p>
    <div
      v-if="content !== 'data'"
      class="card grid gap-3 px-3 py-2.5"
    >
      <AppCheckbox
        v-model="includeDatabase"
        :label="databaseLabel"
        :description="databaseDescription"
        :disabled="disabled"
      />
      <AppCheckbox
        v-if="mode === 'export'"
        v-model="dropExisting"
        :label="t('导入前删除同名对象')"
        :description="
          t('在导出文件中加入表、视图、存储过程和函数的 DROP 语句。')
        "
        :disabled="disabled"
      />
    </div>
  </fieldset>
</template>
