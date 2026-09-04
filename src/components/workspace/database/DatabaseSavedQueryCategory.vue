<script setup lang="ts">
import { reactive, watch } from "vue";
import AppIcon from "@/components/ui/AppIcon.vue";
import type { SavedDatabaseQuery } from "@/types/database-query";
import { cn } from "@/utils/cn";

const props = defineProps<{
  database: string;
  queries: readonly SavedDatabaseQuery[];
  selectedId: string;
  defaultExpanded?: boolean;
}>();

const emit = defineEmits<{
  create: [database: string];
  open: [query: SavedDatabaseQuery];
  context: [event: MouseEvent, query: SavedDatabaseQuery];
  categoryContext: [event: MouseEvent, database: string];
}>();

const state = reactive({ expanded: Boolean(props.defaultExpanded) });

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
    @contextmenu.prevent.stop="emit('categoryContext', $event, database)"
  >
    <AppIcon name="lucide:chevron-right" :size="12" :class="cn('text-txt-4 transition-transform', state.expanded && 'rotate-90')" />
    <AppIcon name="lucide:notebook-tabs" :size="13" class="text-cyan" />
    <span>Queries</span>
    <span class="ml-auto text-[10px] text-txt-4">{{ queries.length }}</span>
  </button>

  <template v-if="state.expanded">
    <button v-if="!queries.length" type="button" class="nav-item h-7 w-full gap-1.5 pl-10 text-[10.5px] text-txt-4" @click="emit('create', database)">
      <AppIcon name="lucide:plus" :size="11" /><span>新建已保存查询</span>
    </button>
    <button
      v-for="query in queries"
      :key="query.id"
      type="button"
      :class="cn('nav-item h-7 w-full gap-1.5 pl-10 text-xs', selectedId === query.id && 'nav-item-active')"
      :title="`${query.name}\n${query.database} · 点击打开`"
      @click="emit('open', query)"
      @contextmenu.prevent.stop="emit('context', $event, query)"
    >
      <AppIcon name="lucide:file-code-2" :size="12" class="shrink-0 text-cyan" />
      <span class="min-w-0 flex-1 truncate text-left">{{ query.name }}</span>
      <span class="query-saved-dot" title="已保存" />
    </button>
  </template>
</template>

<style scoped>
.query-saved-dot { width: 5px; height: 5px; flex: none; border-radius: 999px; background: var(--color-cyan); box-shadow: 0 0 6px color-mix(in oklch, var(--color-cyan) 48%, transparent); opacity: 0.72; }
</style>
