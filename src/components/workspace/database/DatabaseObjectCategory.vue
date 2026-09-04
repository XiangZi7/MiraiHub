<script setup lang="ts">
import { reactive, watch } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import { databaseObjectKey } from "@/composables/useDatabaseSession";
import type {
  DatabaseColumn,
  DatabaseObject,
  DatabaseObjectKind,
} from "@/types/database";
import { cn } from "@/utils/cn";

const props = defineProps<{
  schema: string;
  kind: DatabaseObjectKind;
  label: string;
  icon: string;
  iconClass: string;
  objects: readonly DatabaseObject[];
  selectedKey: string;
  columnsByObject: Record<string, DatabaseColumn[] | undefined>;
  inspectingKeys: Set<string>;
  defaultExpanded?: boolean;
}>();

const emit = defineEmits<{
  select: [object: DatabaseObject];
  open: [object: DatabaseObject];
  context: [event: MouseEvent, object: DatabaseObject];
  categoryContext: [event: MouseEvent, schema: string, kind: DatabaseObjectKind];
}>();

const state = reactive({
  expanded: Boolean(props.defaultExpanded),
  expandedObjects: new Set<string>(),
});

const hasColumns = () => props.kind === "table" || props.kind === "view";

function columnsFor(object: DatabaseObject): DatabaseColumn[] {
  return props.columnsByObject[databaseObjectKey(object)] ?? [];
}

function selectObject(object: DatabaseObject): void {
  emit("select", object);
  if (!hasColumns()) return;

  const key = databaseObjectKey(object);
  if (state.expandedObjects.has(key)) state.expandedObjects.delete(key);
  else state.expandedObjects.add(key);
}

watch(
  () => props.defaultExpanded,
  (expanded) => {
    if (expanded) state.expanded = true;
  },
);
</script>

<template>
  <button
    type="button"
    class="nav-item h-7 w-full gap-1.5 pl-6 text-xs"
    :aria-expanded="state.expanded"
    @click="state.expanded = !state.expanded"
    @contextmenu.prevent.stop="emit('categoryContext', $event, schema, kind)"
  >
    <AppIcon
      name="lucide:chevron-right"
      :size="12"
      :class="cn('text-txt-4 transition-transform', state.expanded && 'rotate-90')"
    />
    <AppIcon :name="icon" :size="13" :class="iconClass" />
    <span>{{ label }}</span>
    <span class="ml-auto text-[10px] text-txt-4">{{ objects.length }}</span>
  </button>

  <template v-if="state.expanded">
    <div
      v-if="!objects.length"
      class="flex h-7 items-center gap-1.5 pl-10 text-[10.5px] text-txt-4"
    >
      <span>暂无对象</span>
    </div>

    <template v-for="object in objects" :key="databaseObjectKey(object)">
      <button
        type="button"
        :class="
          cn(
            'nav-item h-7 w-full gap-1.5 pl-10 text-xs',
            selectedKey === databaseObjectKey(object) && 'nav-item-active',
          )
        "
        :title="`${object.schema}.${object.name}${object.identity ? `(${object.identity})` : ''}（双击打开）`"
        @click="selectObject(object)"
        @dblclick="emit('open', object)"
        @contextmenu.prevent.stop="emit('context', $event, object)"
      >
        <AppIcon
          v-if="hasColumns()"
          name="lucide:chevron-right"
          :size="11"
          :class="
            cn(
              'text-txt-4 transition-transform',
              state.expandedObjects.has(databaseObjectKey(object)) && 'rotate-90',
            )
          "
        />
        <span v-else class="w-[11px]" />
        <AppIcon :name="icon" :size="12" :class="iconClass" />
        <span class="min-w-0 flex-1 truncate text-left">{{ object.name }}</span>
        <span
          v-if="object.identity"
          class="max-w-18 truncate font-mono text-[8.5px] text-txt-4"
          :title="object.identity"
        >
          {{ object.identity }}
        </span>
        <span v-else-if="object.rowEstimate !== null" class="text-[9px] text-txt-4">
          {{ object.rowEstimate.toLocaleString() }}
        </span>
      </button>

      <template v-if="hasColumns() && state.expandedObjects.has(databaseObjectKey(object))">
        <div
          v-if="inspectingKeys.has(databaseObjectKey(object))"
          class="py-1 pl-15 text-[10.5px] text-txt-4"
        >
          读取字段…
        </div>
        <div
          v-for="column in columnsFor(object)"
          :key="`${databaseObjectKey(object)}:${column.name}`"
          class="flex h-6 items-center gap-1.5 pr-2 pl-15 text-[10.5px] text-txt-3"
          :title="`${column.dataType}${column.nullable ? ' · nullable' : ''}`"
        >
          <AppIcon name="lucide:columns-3" :size="10" class="shrink-0 text-txt-4" />
          <span class="min-w-0 flex-1 truncate">{{ column.name }}</span>
          <span class="max-w-18 truncate font-mono text-[9.5px] text-txt-4">
            {{ column.dataType }}
          </span>
        </div>
      </template>
    </template>
  </template>
</template>
