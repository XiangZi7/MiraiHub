<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppTextarea from '@/components/ui/AppTextarea.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { DatabaseKind } from '@/types/database'
import type { TableDesignerCheck } from '@/types/database-designer'

const { t } = useI18n()

const props = defineProps<{
  modelValue: TableDesignerCheck[]
  databaseKind: DatabaseKind
  /** 编辑已有表：SQLite 修改检查约束需要重建表。 */
  editing: boolean
  errors?: Readonly<Record<string, string[]>>
}>()

const emit = defineEmits<{
  'update:modelValue': [checks: TableDesignerCheck[]]
}>()

/** 新增一个检查约束草稿。 */
function addCheck(): void {
  emit('update:modelValue', [
    ...props.modelValue,
    {
      id: `check-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `chk_${props.modelValue.length + 1}`,
      expression: '',
    },
  ])
}

/** 按 id 修改检查约束。 */
function updateCheck(id: string, patch: Partial<TableDesignerCheck>): void {
  emit(
    'update:modelValue',
    props.modelValue.map(check => (check.id === id ? { ...check, ...patch } : check))
  )
}

/** 删除检查约束。 */
function removeCheck(id: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter(check => check.id !== id)
  )
}

defineExpose({ add: addCheck })
</script>

<template>
  <section class="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
    <p
      v-if="databaseKind === 'mysql'"
      class="text-txt-4 mb-2 flex items-center gap-1.5 text-[10px]"
    >
      <AppIcon
        name="lucide:info"
        :size="11"
      />
      {{ t('MySQL 8.0.16 及以上版本才会强制执行检查约束。') }}
    </p>
    <p
      v-else-if="databaseKind === 'sqlite' && editing"
      class="text-amber mb-2 flex items-center gap-1.5 text-[10px]"
    >
      <AppIcon
        name="lucide:triangle-alert"
        :size="11"
      />
      {{
        t(
          '保存时将在同一事务中重建表（临时表→复制数据→删除旧表→改名→重建索引与触发器）；字段定义内联的 CHECK 保持不变。'
        )
      }}
    </p>
    <article
      v-for="check in modelValue"
      :key="check.id"
      class="border-line-soft bg-card/70 mb-2.5 grid gap-2 rounded-[9px] border p-3"
      :class="errors?.[check.id]?.length ? 'border-danger/50' : ''"
    >
      <div class="grid grid-cols-[minmax(180px,360px)_1fr_28px] items-end gap-2">
        <label class="text-txt-4 grid gap-1 text-[9.5px]">
          {{ t('约束名') }}
          <AppInput
            :model-value="check.name"
            monospace
            @update:model-value="updateCheck(check.id, { name: $event })"
        /></label>
        <span />
        <IconButton
          icon="lucide:trash-2"
          :size="12"
          class="text-danger hover:text-danger size-7"
          :title="t('删除检查约束')"
          @click="removeCheck(check.id)"
        />
      </div>
      <AppTextarea
        :model-value="check.expression"
        :label="t('检查表达式')"
        :rows="2"
        class="font-mono"
        :placeholder="t('例如：price >= 0 AND status IN (0, 1)')"
        @update:model-value="updateCheck(check.id, { expression: $event })"
      />
      <ul
        v-if="errors?.[check.id]?.length"
        class="text-danger grid gap-0.5 text-[10px]"
      >
        <li
          v-for="message in errors[check.id]"
          :key="message"
        >
          {{ message }}
        </li>
      </ul>
    </article>
    <div
      v-if="!modelValue.length"
      class="text-txt-4 grid min-h-57.5 place-items-center content-center gap-2 text-center text-[11px]"
    >
      <AppIcon
        name="lucide:shield-check"
        :size="24"
      />
      <p>{{ t('尚未配置检查约束') }}</p>
    </div>
  </section>
</template>
