<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppTextarea from '@/components/ui/AppTextarea.vue'
import IconButton from '@/components/ui/IconButton.vue'
import type { DatabaseKind } from '@/types/database'
import type {
  TableDesignerTrigger,
  TriggerEvent,
  TriggerTiming,
} from '@/types/database-designer'

const { t } = useI18n()

const props = defineProps<{
  modelValue: TableDesignerTrigger[]
  databaseKind: DatabaseKind
  errors?: Readonly<Record<string, string[]>>
}>()

const emit = defineEmits<{
  'update:modelValue': [triggers: TableDesignerTrigger[]]
}>()

const timingOptions = [
  { value: 'BEFORE', label: 'BEFORE' },
  { value: 'AFTER', label: 'AFTER' },
]
const levelOptions = [
  { value: 'ROW', label: 'FOR EACH ROW' },
  { value: 'STATEMENT', label: 'FOR EACH STATEMENT' },
]
const events = computed<TriggerEvent[]>(() =>
  props.databaseKind === 'postgresql'
    ? ['INSERT', 'UPDATE', 'DELETE', 'TRUNCATE']
    : ['INSERT', 'UPDATE', 'DELETE']
)
const multiEvent = computed(() => props.databaseKind === 'postgresql')
const bodyPlaceholder = computed(() =>
  props.databaseKind === 'postgresql'
    ? 'BEGIN\n  NEW.updated_at := now();\n  RETURN NEW;\nEND;'
    : props.databaseKind === 'mysql'
      ? 'SET NEW.updated_at = NOW();'
      : "UPDATE logs SET touched = 1 WHERE id = NEW.id"
)

/** 新增一个触发器草稿。 */
function addTrigger(): void {
  emit('update:modelValue', [
    ...props.modelValue,
    {
      id: `trigger-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: `trg_${props.modelValue.length + 1}`,
      timing: 'BEFORE',
      events: ['INSERT'],
      level: 'ROW',
      body: '',
      functionName: '',
    },
  ])
}

/** 按 id 修改触发器。 */
function updateTrigger(
  id: string,
  patch: Partial<TableDesignerTrigger>
): void {
  emit(
    'update:modelValue',
    props.modelValue.map(trigger =>
      trigger.id === id ? { ...trigger, ...patch } : trigger
    )
  )
}

/** 切换事件：PostgreSQL 可多选，其余方言单选。 */
function toggleEvent(trigger: TableDesignerTrigger, event: TriggerEvent): void {
  if (!multiEvent.value) {
    updateTrigger(trigger.id, { events: [event] })
    return
  }
  const next = trigger.events.includes(event)
    ? trigger.events.filter(item => item !== event)
    : [...trigger.events, event]
  updateTrigger(trigger.id, { events: next })
}

/** 删除触发器。 */
function removeTrigger(id: string): void {
  emit(
    'update:modelValue',
    props.modelValue.filter(trigger => trigger.id !== id)
  )
}

defineExpose({ add: addTrigger })
</script>

<template>
  <section class="scroll-thin flex min-h-0 flex-1 flex-col overflow-y-auto p-3">
    <article
      v-for="trigger in modelValue"
      :key="trigger.id"
      class="border-line-soft bg-card/70 mb-2.5 grid gap-2.5 rounded-[9px] border p-3"
      :class="errors?.[trigger.id]?.length ? 'border-danger/50' : ''"
    >
      <div class="grid grid-cols-[minmax(160px,280px)_130px_auto_1fr_28px] items-end gap-2 max-[900px]:grid-cols-2">
        <label class="text-txt-4 grid gap-1 text-[9.5px]">
          {{ t('触发器名') }}
          <AppInput
            :model-value="trigger.name"
            monospace
            @update:model-value="updateTrigger(trigger.id, { name: $event })"
        /></label>
        <AppSelect
          :model-value="trigger.timing"
          :label="t('触发时机')"
          :options="timingOptions"
          compact
          @update:model-value="
            updateTrigger(trigger.id, { timing: $event as TriggerTiming })
          "
        />
        <div class="text-txt-4 grid gap-1 text-[9.5px]">
          <span>{{ t('触发事件') }}</span>
          <div
            class="flex gap-1"
            role="group"
            :aria-label="t('触发事件')"
          >
            <button
              v-for="event in events"
              :key="event"
              type="button"
              class="border-line-soft h-8 rounded-md border px-2 font-mono text-[10px] motion-safe:transition-colors"
              :class="
                trigger.events.includes(event)
                  ? 'border-blue/50 bg-blue/15 text-blue'
                  : 'text-txt-3 hover:bg-hover'
              "
              :aria-pressed="trigger.events.includes(event)"
              @click="toggleEvent(trigger, event)"
            >
              {{ event }}
            </button>
          </div>
        </div>
        <AppSelect
          v-if="databaseKind === 'postgresql'"
          :model-value="trigger.level"
          :label="t('触发级别')"
          :options="levelOptions"
          compact
          @update:model-value="
            updateTrigger(trigger.id, {
              level: $event as TableDesignerTrigger['level'],
            })
          "
        />
        <span v-else />
        <IconButton
          icon="lucide:trash-2"
          :size="12"
          class="text-danger hover:text-danger size-7"
          :title="t('删除触发器')"
          @click="removeTrigger(trigger.id)"
        />
      </div>
      <label
        v-if="databaseKind === 'postgresql'"
        class="text-txt-4 grid max-w-105 gap-1 text-[9.5px]"
      >
        {{ t('触发函数（留空自动生成）') }}
        <AppInput
          :model-value="trigger.functionName ?? ''"
          monospace
          :placeholder="t('留空表示按表名和触发器名生成')"
          @update:model-value="
            updateTrigger(trigger.id, { functionName: $event })
          "
      /></label>
      <AppTextarea
        :model-value="trigger.body"
        :label="
          databaseKind === 'postgresql'
            ? t('触发函数体（plpgsql）')
            : t('触发语句')
        "
        :rows="5"
        class="font-mono"
        :placeholder="bodyPlaceholder"
        spellcheck="false"
        @update:model-value="updateTrigger(trigger.id, { body: $event })"
      />
      <p class="text-txt-4 text-[9.5px]">
        {{
          databaseKind === 'postgresql'
            ? t('保存时会创建或替换触发函数，再创建触发器；修改触发器会先删除再重建。')
            : t('多条语句以分号分隔，MySQL 会自动包裹 BEGIN…END；修改触发器会先删除再重建。')
        }}
      </p>
      <ul
        v-if="errors?.[trigger.id]?.length"
        class="text-danger grid gap-0.5 text-[10px]"
      >
        <li
          v-for="message in errors[trigger.id]"
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
        name="lucide:zap"
        :size="24"
      />
      <p>{{ t('尚未配置触发器') }}</p>
    </div>
  </section>
</template>
