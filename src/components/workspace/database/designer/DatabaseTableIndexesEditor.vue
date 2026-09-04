<script setup lang="ts">
import AppIcon from "@/components/ui/AppIcon.vue";
import type { DatabaseKind } from "@/types/database";
import type { TableDesignerColumn, TableDesignerIndex } from "@/types/database-designer";

const props = defineProps<{
  modelValue: TableDesignerIndex[];
  columns: readonly TableDesignerColumn[];
  databaseKind: DatabaseKind;
}>();

const emit = defineEmits<{
  "update:modelValue": [indexes: TableDesignerIndex[]];
}>();

function newId(): string {
  return `index-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function addIndex(): void {
  const number = props.modelValue.length + 1;
  emit("update:modelValue", [...props.modelValue, {
    id: newId(),
    name: `idx_${number}`,
    kind: "index",
    method: "btree",
    columns: props.columns[0]?.name ? [props.columns[0].name] : [],
  }]);
}

function updateIndex(id: string, patch: Partial<TableDesignerIndex>): void {
  emit("update:modelValue", props.modelValue.map(index => index.id === id ? { ...index, ...patch } : index));
}

function toggleColumn(index: TableDesignerIndex, column: string): void {
  const columns = index.columns.includes(column)
    ? index.columns.filter(item => item !== column)
    : [...index.columns, column];
  updateIndex(index.id, { columns });
}

function removeIndex(id: string): void {
  emit("update:modelValue", props.modelValue.filter(index => index.id !== id));
}
</script>

<template>
  <section class="designer-section">
    <div class="designer-section-heading">
      <div><h3>索引配置</h3><p>支持普通、唯一和 MySQL 全文索引，可组合多个字段。</p></div>
      <button type="button" class="btn h-7 px-2 text-[10.5px]" @click="addIndex"><AppIcon name="lucide:plus" :size="11" />添加索引</button>
    </div>

    <div class="index-list scroll-thin">
      <article v-for="index in modelValue" :key="index.id" class="index-card">
        <div class="index-card-heading">
          <span class="index-icon"><AppIcon name="lucide:list-key" :size="14" /></span>
          <label class="field-label">索引名<input :value="index.name" class="field h-8 px-2 font-mono text-[10.5px]" @input="updateIndex(index.id, { name: ($event.target as HTMLInputElement).value })"></label>
          <label class="field-label">类型<select :value="index.kind" class="field h-8 px-2 text-[10.5px]" @change="updateIndex(index.id, { kind: ($event.target as HTMLSelectElement).value as TableDesignerIndex['kind'] })"><option value="index">普通索引</option><option value="unique">唯一索引</option><option v-if="databaseKind === 'mysql'" value="fulltext">全文索引</option></select></label>
          <label class="field-label">方法<select :value="index.method" class="field h-8 px-2 text-[10.5px]" :disabled="index.kind === 'fulltext'" @change="updateIndex(index.id, { method: ($event.target as HTMLSelectElement).value as TableDesignerIndex['method'] })"><option value="btree">BTREE</option><option value="hash">HASH</option></select></label>
          <button type="button" class="remove-button" title="删除索引" @click="removeIndex(index.id)"><AppIcon name="lucide:trash-2" :size="12" /></button>
        </div>
        <div class="mt-3">
          <p class="field-label mb-1.5">索引字段（点击选择，选择顺序即索引顺序）</p>
          <div class="column-picker">
            <button v-for="column in columns" :key="column.id" type="button" :class="['column-chip', index.columns.includes(column.name) && 'column-chip-active']" @click="toggleColumn(index, column.name)">
              <AppIcon :name="index.columns.includes(column.name) ? 'lucide:check' : 'lucide:plus'" :size="10" />{{ column.name || '未命名字段' }}
              <span v-if="index.columns.includes(column.name)" class="order-badge">{{ index.columns.indexOf(column.name) + 1 }}</span>
            </button>
            <span v-if="!columns.length" class="text-[10px] text-txt-4">请先添加字段</span>
          </div>
        </div>
      </article>
      <div v-if="!modelValue.length" class="empty-state"><AppIcon name="lucide:list-key" :size="24" /><p>尚未配置额外索引</p><span>主键和字段级唯一约束可直接在“字段”页配置。</span></div>
    </div>
  </section>
</template>

<style scoped>
.designer-section { display: flex; min-height: 0; flex: 1; flex-direction: column; }
.designer-section-heading { display: flex; min-height: 58px; flex: none; align-items: center; justify-content: space-between; gap: 16px; border-bottom: 1px solid var(--color-line-soft); padding: 9px 12px; }
.designer-section-heading h3 { color: var(--color-txt); font-size: 12px; font-weight: 600; }
.designer-section-heading p, .field-label { margin-top: 2px; color: var(--color-txt-4); font-size: 9.5px; }
.index-list { min-height: 0; overflow-y: auto; padding: 12px; }
.index-card { margin-bottom: 9px; border: 1px solid var(--color-line-soft); border-radius: 9px; background: linear-gradient(145deg, rgb(255 255 255 / 3%), transparent), color-mix(in oklch, var(--color-card) 72%, transparent); padding: 11px; box-shadow: inset 0 1px rgb(255 255 255 / 3%); }
.index-card-heading { display: grid; grid-template-columns: 32px minmax(150px, 1fr) 130px 105px 28px; align-items: end; gap: 8px; }
.index-icon { display: grid; width: 30px; height: 30px; place-items: center; border: 1px solid color-mix(in oklch, var(--color-violet) 28%, var(--color-line)); border-radius: 7px; background: color-mix(in oklch, var(--color-violet) 9%, transparent); color: var(--color-violet); }
.field-label { display: grid; gap: 4px; }
.column-picker { display: flex; min-height: 29px; flex-wrap: wrap; gap: 5px; }
.column-chip { display: flex; height: 27px; cursor: pointer; align-items: center; gap: 4px; border: 1px solid var(--color-line-soft); border-radius: 6px; background: color-mix(in oklch, var(--color-panel) 58%, transparent); padding: 0 7px; color: var(--color-txt-3); font-family: var(--font-mono); font-size: 9.5px; outline: none; transition: border-color 150ms ease, background-color 150ms ease, color 150ms ease; }
.column-chip:hover, .column-chip:focus-visible { border-color: var(--color-line-strong); color: var(--color-txt); }
.column-chip-active { border-color: color-mix(in oklch, var(--color-accent) 38%, transparent); background: color-mix(in oklch, var(--color-accent) 9%, transparent); color: var(--color-accent); }
.order-badge { display: grid; min-width: 14px; height: 14px; place-items: center; border-radius: 999px; background: color-mix(in oklch, var(--color-accent) 15%, transparent); font-size: 8px; }
.remove-button { display: grid; width: 28px; height: 28px; cursor: pointer; place-items: center; border-radius: 6px; color: var(--color-txt-4); outline: none; }
.remove-button:hover, .remove-button:focus-visible { background: color-mix(in oklch, var(--color-danger) 10%, transparent); color: var(--color-danger); }
.empty-state { display: grid; min-height: 230px; place-items: center; align-content: center; gap: 7px; color: var(--color-txt-4); font-size: 11px; text-align: center; }
.empty-state span { font-size: 9.5px; }
@media (max-width: 900px) { .index-card-heading { grid-template-columns: 32px 1fr 110px 28px; } .index-card-heading > :nth-child(4) { display: none; } }
@media (prefers-reduced-motion: reduce) { .column-chip { transition: none; } }
</style>
