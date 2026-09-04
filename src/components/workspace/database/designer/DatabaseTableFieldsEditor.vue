<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import type { DatabaseKind } from "@/types/database";
import type { TableDesignerColumn } from "@/types/database-designer";
import { columnTypes } from "@/utils/database-ddl";

const props = defineProps<{
  modelValue: TableDesignerColumn[];
  databaseKind: DatabaseKind;
}>();

const emit = defineEmits<{
  "update:modelValue": [columns: TableDesignerColumn[]];
}>();

const types = computed(() => columnTypes(props.databaseKind));

function newId(): string {
  return `column-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function addColumn(): void {
  const first = props.modelValue.length === 0;
  emit("update:modelValue", [...props.modelValue, {
    id: newId(),
    name: first ? "id" : `column_${props.modelValue.length + 1}`,
    dataType: first ? "BIGINT" : "VARCHAR",
    length: first ? "" : "255",
    nullable: !first,
    primaryKey: first,
    unique: false,
    unsigned: false,
    autoIncrement: first,
    defaultValue: "",
    comment: "",
  }]);
}

function updateColumn(id: string, patch: Partial<TableDesignerColumn>): void {
  emit("update:modelValue", props.modelValue.map(column => column.id === id ? { ...column, ...patch } : column));
}

function removeColumn(id: string): void {
  emit("update:modelValue", props.modelValue.filter(column => column.id !== id));
}

function moveColumn(index: number, direction: -1 | 1): void {
  const target = index + direction;
  if (target < 0 || target >= props.modelValue.length) return;
  const columns = [...props.modelValue];
  const [column] = columns.splice(index, 1);
  if (!column) return;
  columns.splice(target, 0, column);
  emit("update:modelValue", columns);
}
</script>

<template>
  <section class="designer-section">
    <div class="designer-section-heading">
      <div>
        <h3>字段定义</h3>
        <p>配置字段类型、长度、主键、默认值与自动递增。</p>
      </div>
      <button type="button" class="btn h-7 px-2 text-[10.5px]" @click="addColumn">
        <AppIcon name="lucide:plus" :size="11" />添加字段
      </button>
    </div>

    <div class="designer-table-wrap scroll-thin">
      <table class="designer-table min-w-[1120px]">
        <thead>
          <tr>
            <th class="w-16">排序</th><th class="min-w-36">字段名</th><th class="min-w-38">类型</th>
            <th class="w-24">长度/精度</th><th class="w-14">可空</th><th class="w-14">主键</th>
            <th class="w-14">唯一</th><th v-if="databaseKind === 'mysql'" class="w-16">无符号</th>
            <th class="w-16">自增</th><th class="min-w-40">默认值</th><th class="min-w-44">备注</th><th class="w-10" />
          </tr>
        </thead>
        <tbody>
          <tr v-for="(column, index) in modelValue" :key="column.id">
            <td>
              <div class="flex justify-center gap-0.5">
                <button type="button" class="designer-icon-button" title="上移" :disabled="index === 0" @click="moveColumn(index, -1)"><AppIcon name="lucide:chevron-up" :size="11" /></button>
                <button type="button" class="designer-icon-button" title="下移" :disabled="index === modelValue.length - 1" @click="moveColumn(index, 1)"><AppIcon name="lucide:chevron-down" :size="11" /></button>
              </div>
            </td>
            <td><input :value="column.name" class="designer-cell-input font-mono" aria-label="字段名" @input="updateColumn(column.id, { name: ($event.target as HTMLInputElement).value })"></td>
            <td>
              <select :value="column.dataType" class="designer-cell-input" aria-label="字段类型" @change="updateColumn(column.id, { dataType: ($event.target as HTMLSelectElement).value })">
                <option v-for="type in types" :key="type" :value="type">{{ type }}</option>
              </select>
            </td>
            <td><input :value="column.length" class="designer-cell-input font-mono" placeholder="255 / 10,2" aria-label="长度或精度" @input="updateColumn(column.id, { length: ($event.target as HTMLInputElement).value })"></td>
            <td><input type="checkbox" :checked="column.nullable" class="designer-checkbox" aria-label="允许为空" :disabled="column.primaryKey" @change="updateColumn(column.id, { nullable: ($event.target as HTMLInputElement).checked })"></td>
            <td><input type="checkbox" :checked="column.primaryKey" class="designer-checkbox" aria-label="主键" @change="updateColumn(column.id, { primaryKey: ($event.target as HTMLInputElement).checked, nullable: ($event.target as HTMLInputElement).checked ? false : column.nullable })"></td>
            <td><input type="checkbox" :checked="column.unique" class="designer-checkbox" aria-label="唯一" @change="updateColumn(column.id, { unique: ($event.target as HTMLInputElement).checked })"></td>
            <td v-if="databaseKind === 'mysql'"><input type="checkbox" :checked="column.unsigned" class="designer-checkbox" aria-label="无符号" @change="updateColumn(column.id, { unsigned: ($event.target as HTMLInputElement).checked })"></td>
            <td><input type="checkbox" :checked="column.autoIncrement" class="designer-checkbox" aria-label="自动递增" @change="updateColumn(column.id, { autoIncrement: ($event.target as HTMLInputElement).checked })"></td>
            <td><input :value="column.defaultValue" class="designer-cell-input font-mono" placeholder="NULL / CURRENT_TIMESTAMP" aria-label="默认值表达式" :disabled="column.autoIncrement" @input="updateColumn(column.id, { defaultValue: ($event.target as HTMLInputElement).value })"></td>
            <td><input :value="column.comment" class="designer-cell-input" placeholder="字段说明" aria-label="字段备注" @input="updateColumn(column.id, { comment: ($event.target as HTMLInputElement).value })"></td>
            <td><button type="button" class="designer-icon-button text-danger" title="删除字段" @click="removeColumn(column.id)"><AppIcon name="lucide:trash-2" :size="11" /></button></td>
          </tr>
          <tr v-if="!modelValue.length"><td :colspan="databaseKind === 'mysql' ? 12 : 11" class="h-28 text-center text-txt-4">尚未添加字段</td></tr>
        </tbody>
      </table>
    </div>
  </section>
</template>

<style scoped>
.designer-section { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.designer-section-heading { display: flex; min-height: 58px; flex: none; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--color-line-soft); padding: 9px 12px; }
.designer-section-heading h3 { color: var(--color-txt); font-size: 12px; font-weight: 600; }
.designer-section-heading p { margin-top: 2px; color: var(--color-txt-4); font-size: 9.5px; }
.designer-table-wrap { min-height: 0; flex: 1; overflow: auto; padding: 10px; }
.designer-table { width: 100%; border-collapse: separate; border: 1px solid var(--color-line-soft); border-spacing: 0; overflow: hidden; border-radius: 8px; background: color-mix(in oklch, var(--color-card) 72%, transparent); font-size: 10.5px; }
.designer-table th { position: sticky; z-index: 2; top: 0; border-right: 1px solid var(--color-line-soft); border-bottom: 1px solid var(--color-line-soft); background: color-mix(in oklch, var(--color-panel) 94%, transparent); padding: 7px 6px; color: var(--color-txt-3); font-weight: 500; text-align: left; }
.designer-table td { height: 36px; border-right: 1px solid var(--color-line-soft); border-bottom: 1px solid var(--color-line-soft); padding: 3px; color: var(--color-txt-2); }
.designer-table tr:hover td { background: color-mix(in oklch, var(--color-hover) 72%, transparent); }
.designer-cell-input { width: 100%; height: 28px; min-width: 0; border: 1px solid transparent; border-radius: 5px; background: transparent; padding: 0 6px; color: var(--color-txt-2); outline: none; }
.designer-cell-input:hover { border-color: var(--color-line-soft); background: color-mix(in oklch, var(--color-panel) 54%, transparent); }
.designer-cell-input:focus { border-color: color-mix(in oklch, var(--color-accent) 50%, var(--color-line)); background: var(--color-panel); box-shadow: 0 0 0 2px color-mix(in oklch, var(--color-accent) 10%, transparent); }
.designer-cell-input:disabled { opacity: 0.45; }
.designer-checkbox { display: block; width: 14px; height: 14px; margin: auto; accent-color: var(--color-accent); }
.designer-icon-button { display: inline-grid; width: 24px; height: 24px; cursor: pointer; place-items: center; border-radius: 5px; color: var(--color-txt-4); outline: none; }
.designer-icon-button:hover:not(:disabled), .designer-icon-button:focus-visible { background: var(--color-hover); color: var(--color-txt); }
.designer-icon-button:disabled { cursor: default; opacity: 0.25; }
</style>
