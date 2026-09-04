<script setup lang="ts">
import { computed } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import type { DatabaseObject } from "@/types/database";
import type { ReferentialAction, TableDesignerColumn, TableDesignerForeignKey } from "@/types/database-designer";

const props = defineProps<{
  modelValue: TableDesignerForeignKey[];
  columns: readonly TableDesignerColumn[];
  schema: string;
  tables: readonly DatabaseObject[];
  referencedColumns: Readonly<Record<string, string[]>>;
  loadingReference: string;
}>();

const emit = defineEmits<{
  "update:modelValue": [foreignKeys: TableDesignerForeignKey[]];
  "inspect-table": [schema: string, table: string];
}>();

const tableOptions = computed(() => props.tables
  .filter(object => object.kind === "table")
  .map(object => ({ key: `${object.schema}.${object.name}`, schema: object.schema, name: object.name })));

const referentialActions: readonly ReferentialAction[] = ["NO ACTION", "RESTRICT", "CASCADE", "SET NULL"];

function newId(): string {
  return `foreign-key-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function addForeignKey(): void {
  const firstTable = tableOptions.value[0];
  const foreignKey: TableDesignerForeignKey = {
    id: newId(),
    name: `fk_${props.modelValue.length + 1}`,
    column: props.columns[0]?.name ?? "",
    referencedSchema: firstTable?.schema ?? props.schema,
    referencedTable: firstTable?.name ?? "",
    referencedColumn: "",
    onDelete: "NO ACTION",
    onUpdate: "NO ACTION",
  };
  emit("update:modelValue", [...props.modelValue, foreignKey]);
  if (foreignKey.referencedTable) emit("inspect-table", foreignKey.referencedSchema, foreignKey.referencedTable);
}

function updateForeignKey(id: string, patch: Partial<TableDesignerForeignKey>): void {
  emit("update:modelValue", props.modelValue.map(foreignKey => foreignKey.id === id ? { ...foreignKey, ...patch } : foreignKey));
}

function selectTable(foreignKey: TableDesignerForeignKey, value: string): void {
  const table = tableOptions.value.find(item => item.key === value);
  if (!table) {
    updateForeignKey(foreignKey.id, { referencedTable: value, referencedColumn: "" });
    return;
  }
  updateForeignKey(foreignKey.id, {
    referencedSchema: table.schema,
    referencedTable: table.name,
    referencedColumn: "",
  });
  emit("inspect-table", table.schema, table.name);
}

function referenceKey(foreignKey: TableDesignerForeignKey): string {
  return `${foreignKey.referencedSchema}.${foreignKey.referencedTable}`;
}

function removeForeignKey(id: string): void {
  emit("update:modelValue", props.modelValue.filter(foreignKey => foreignKey.id !== id));
}
</script>

<template>
  <section class="designer-section">
    <div class="designer-section-heading">
      <div><h3>外键约束</h3><p>关联已有表，并配置更新、删除时的参照行为。</p></div>
      <button type="button" class="btn h-7 px-2 text-[10.5px]" @click="addForeignKey"><AppIcon name="lucide:plus" :size="11" />添加外键</button>
    </div>

    <div class="foreign-key-list scroll-thin">
      <article v-for="foreignKey in modelValue" :key="foreignKey.id" class="foreign-key-card">
        <div class="foreign-key-heading">
          <span class="foreign-key-icon"><AppIcon name="lucide:link-2" :size="14" /></span>
          <label class="field-label">约束名<input :value="foreignKey.name" class="field h-8 px-2 font-mono text-[10.5px]" @input="updateForeignKey(foreignKey.id, { name: ($event.target as HTMLInputElement).value })"></label>
          <button type="button" class="remove-button" title="删除外键" @click="removeForeignKey(foreignKey.id)"><AppIcon name="lucide:trash-2" :size="12" /></button>
        </div>

        <div class="reference-flow">
          <label class="field-label">本地字段
            <select :value="foreignKey.column" class="field h-8 px-2 font-mono text-[10.5px]" @change="updateForeignKey(foreignKey.id, { column: ($event.target as HTMLSelectElement).value })">
              <option value="">请选择字段</option><option v-for="column in columns" :key="column.id" :value="column.name">{{ column.name || "未命名字段" }}</option>
            </select>
          </label>
          <span class="flow-arrow"><AppIcon name="lucide:arrow-right" :size="14" /></span>
          <label class="field-label">引用表
            <select :value="referenceKey(foreignKey)" class="field h-8 px-2 font-mono text-[10.5px]" @change="selectTable(foreignKey, ($event.target as HTMLSelectElement).value)">
              <option value="">请选择引用表</option><option v-for="table in tableOptions" :key="table.key" :value="table.key">{{ table.key }}</option>
            </select>
          </label>
          <span class="flow-arrow"><AppIcon name="lucide:arrow-right" :size="14" /></span>
          <label class="field-label">引用字段
            <select :value="foreignKey.referencedColumn" class="field h-8 px-2 font-mono text-[10.5px]" :disabled="!foreignKey.referencedTable || loadingReference === referenceKey(foreignKey)" @change="updateForeignKey(foreignKey.id, { referencedColumn: ($event.target as HTMLSelectElement).value })">
              <option value="">{{ loadingReference === referenceKey(foreignKey) ? "正在读取字段…" : "请选择字段" }}</option>
              <option v-for="column in referencedColumns[referenceKey(foreignKey)] ?? []" :key="column" :value="column">{{ column }}</option>
            </select>
          </label>
        </div>

        <div class="action-grid">
          <label class="field-label">删除时
            <select :value="foreignKey.onDelete" class="field h-8 px-2 text-[10.5px]" @change="updateForeignKey(foreignKey.id, { onDelete: ($event.target as HTMLSelectElement).value as ReferentialAction })"><option v-for="action in referentialActions" :key="action" :value="action">{{ action }}</option></select>
          </label>
          <label class="field-label">更新时
            <select :value="foreignKey.onUpdate" class="field h-8 px-2 text-[10.5px]" @change="updateForeignKey(foreignKey.id, { onUpdate: ($event.target as HTMLSelectElement).value as ReferentialAction })"><option v-for="action in referentialActions" :key="action" :value="action">{{ action }}</option></select>
          </label>
          <p class="action-hint"><AppIcon name="lucide:info" :size="11" />SET NULL 要求本地字段允许为空；CASCADE 会同步变更关联数据。</p>
        </div>
      </article>

      <div v-if="!modelValue.length" class="empty-state"><AppIcon name="lucide:link-2" :size="24" /><p>尚未配置外键</p><span>添加后可从当前数据库的已有表中选择引用字段。</span></div>
    </div>
  </section>
</template>

<style scoped>
.designer-section { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.designer-section-heading { display: flex; min-height: 58px; flex: none; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--color-line-soft); padding: 9px 12px; }
.designer-section-heading h3 { color: var(--color-txt); font-size: 12px; font-weight: 600; }
.designer-section-heading p, .field-label { margin-top: 2px; color: var(--color-txt-4); font-size: 9.5px; }
.foreign-key-list { min-height: 0; overflow-y: auto; padding: 12px; }
.foreign-key-card { margin-bottom: 9px; border: 1px solid var(--color-line-soft); border-radius: 9px; background: linear-gradient(145deg, rgb(255 255 255 / 3%), transparent), color-mix(in oklch, var(--color-card) 72%, transparent); padding: 11px; box-shadow: inset 0 1px rgb(255 255 255 / 3%); }
.foreign-key-heading { display: grid; grid-template-columns: 32px minmax(180px, 360px) 28px; align-items: end; gap: 8px; }
.foreign-key-icon { display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid color-mix(in oklch, var(--color-blue) 28%, var(--color-line)); border-radius: 7px; background: color-mix(in oklch, var(--color-blue) 9%, transparent); color: var(--color-blue); }
.field-label { display: grid; gap: 4px; }
.reference-flow { display: grid; grid-template-columns: minmax(140px, 1fr) 24px minmax(180px, 1.3fr) 24px minmax(140px, 1fr); align-items: end; gap: 7px; margin-top: 12px; }
.flow-arrow { display: grid; height: 32px; place-items: center; color: var(--color-txt-4); }
.action-grid { display: grid; grid-template-columns: 150px 150px 1fr; align-items: end; gap: 8px; margin-top: 10px; }
.action-hint { display: flex; min-height: 32px; align-items: center; gap: 5px; color: var(--color-txt-4); font-size: 9px; }
.remove-button { display: grid; width: 28px; height: 28px; cursor: pointer; place-items: center; border-radius: 6px; color: var(--color-txt-4); outline: none; }
.remove-button:hover, .remove-button:focus-visible { background: color-mix(in oklch, var(--color-danger) 10%, transparent); color: var(--color-danger); }
.empty-state { display: grid; min-height: 230px; place-items: center; align-content: center; gap: 7px; color: var(--color-txt-4); font-size: 11px; text-align: center; }
.empty-state span { font-size: 9.5px; }
@media (max-width: 900px) { .reference-flow { grid-template-columns: 1fr; } .flow-arrow { display: none; } .action-grid { grid-template-columns: 1fr 1fr; } .action-hint { grid-column: 1 / -1; } }
</style>
