<script setup lang="ts">
import { computed, reactive, watch } from "vue";
import * as database from "@/api/database";
import AppIcon from "@/components/ui/AppIcon.vue";
import IconButton from "@/components/ui/IconButton.vue";
import type { DatabaseKind, DatabaseObject, DatabaseRoutineDetail } from "@/types/database";
import { cn } from "@/utils/cn";

type RoutinePanel = "definition" | "parameters" | "ddl";

const props = defineProps<{
  sessionId: string;
  databaseKind: DatabaseKind;
  object: DatabaseObject;
}>();

const emit = defineEmits<{
  query: [sql: string];
}>();

const state = reactive({
  activePanel: "definition" as RoutinePanel,
  detail: null as DatabaseRoutineDetail | null,
  loading: false,
  error: "",
});

const panels: Array<{ id: RoutinePanel; label: string }> = [
  { id: "definition", label: "定义" },
  { id: "parameters", label: "参数" },
  { id: "ddl", label: "DDL" },
];

const kindLabel = computed(() => props.object.kind === "procedure" ? "存储过程" : "函数");
const code = computed(() => {
  if (!state.detail) return "";
  return state.activePanel === "ddl" ? state.detail.ddl : state.detail.definition;
});

async function loadDetail(): Promise<void> {
  if (!props.sessionId) return;
  state.loading = true;
  state.error = "";
  try {
    state.detail = await database.routineDetail(props.sessionId, props.object);
  } catch (error) {
    state.error = database.errorMessage(error);
    state.detail = null;
  } finally {
    state.loading = false;
  }
}

async function copyText(value: string): Promise<void> {
  await navigator.clipboard.writeText(value);
}

function queryTemplate(): string {
  const qualified = `${quoteIdentifier(props.object.schema)}.${quoteIdentifier(props.object.name)}`;
  const args = state.detail?.parameters
    .filter((parameter) => parameter.mode.toLocaleUpperCase() !== "OUT")
    .map((parameter) => `/* ${parameter.name || "参数"}: ${parameter.dataType} */ NULL`)
    .join(", ") ?? "";
  return props.object.kind === "procedure"
    ? `CALL ${qualified}(${args});`
    : `SELECT ${qualified}(${args});`;
}

function quoteIdentifier(identifier: string): string {
  return props.databaseKind === "mysql"
    ? `\`${identifier.replaceAll("`", "``")}\``
    : `"${identifier.replaceAll('"', '""')}"`;
}

watch(
  () => [props.sessionId, props.object.schema, props.object.name, props.object.identity, props.object.kind],
  () => void loadDetail(),
  { immediate: true },
);
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col bg-workspace">
    <header class="flex h-10 shrink-0 items-center border-b border-line-soft px-3">
      <div class="flex min-w-0 items-center gap-2 text-[12px] text-txt">
        <AppIcon :name="object.kind === 'procedure' ? 'lucide:workflow' : 'lucide:braces'" :size="14" class="text-accent" />
        <span class="shrink-0">{{ kindLabel }}:</span>
        <strong class="truncate font-medium">{{ object.name }}</strong>
        <span v-if="object.identity" class="max-w-80 truncate font-mono text-[10px] text-txt-4">({{ object.identity }})</span>
      </div>
      <div class="flex-1" />
      <IconButton icon="lucide:rotate-cw" :size="13" title="刷新详情" :disabled="state.loading" @click="loadDetail" />
      <IconButton icon="lucide:play" :size="13" title="生成调用语句" @click="emit('query', queryTemplate())" />
    </header>

    <div class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
        <div class="flex h-9 shrink-0 items-end gap-1 border-b border-line-soft px-3">
          <button
            v-for="panel in panels"
            :key="panel.id"
            type="button"
            :class="cn('relative h-full px-2.5 text-[11px] text-txt-3 transition-colors hover:text-txt', state.activePanel === panel.id && 'text-accent after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full after:bg-accent')"
            @click="state.activePanel = panel.id"
          >
            {{ panel.label }}
          </button>
        </div>

        <div v-if="state.loading" class="grid flex-1 place-items-center text-xs text-txt-4">
          <span class="flex items-center gap-2"><AppIcon name="lucide:loader-circle" :size="14" class="animate-spin text-accent" />正在读取{{ kindLabel }}…</span>
        </div>
        <div v-else-if="state.error" class="m-4 rounded-lg border border-danger/30 bg-danger/8 p-3 text-[11px] leading-5 text-danger">
          {{ state.error }}
        </div>

        <div v-else-if="state.detail && state.activePanel === 'parameters'" class="min-h-0 flex-1 overflow-auto p-3 scroll-thin">
          <table class="w-full border-collapse overflow-hidden rounded-lg border border-line-soft text-left text-[11px]">
            <thead class="bg-panel text-txt-3">
              <tr>
                <th class="border border-line-soft px-3 py-2 font-medium">参数名</th>
                <th class="border border-line-soft px-3 py-2 font-medium">类型</th>
                <th class="border border-line-soft px-3 py-2 font-medium">模式</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="parameter in state.detail.parameters" :key="`${parameter.ordinal}:${parameter.name}`" class="hover:bg-hover">
                <td class="border border-line-soft px-3 py-2 font-mono text-txt">{{ parameter.name || '—' }}</td>
                <td class="border border-line-soft px-3 py-2 font-mono text-blue">{{ parameter.dataType }}</td>
                <td class="border border-line-soft px-3 py-2 text-accent">{{ parameter.mode || 'IN' }}</td>
              </tr>
              <tr v-if="!state.detail.parameters.length">
                <td colspan="3" class="border border-line-soft px-3 py-8 text-center text-txt-4">此对象没有参数</td>
              </tr>
            </tbody>
          </table>
        </div>

        <div v-else-if="state.detail" class="relative min-h-0 flex-1 overflow-auto bg-[#0d0f14] p-4 scroll-thin">
          <button type="button" class="btn absolute top-3 right-3 z-10 h-7 px-2 text-[10.5px]" @click="copyText(code)">
            <AppIcon name="lucide:copy" :size="11" />复制
          </button>
          <pre class="whitespace-pre-wrap pr-22 font-mono text-[11.5px] leading-5 text-term-fg">{{ code || '没有可用的定义' }}</pre>
        </div>
      </div>

      <aside v-if="state.detail" class="w-76 shrink-0 overflow-y-auto border-l border-line-soft bg-panel p-3 scroll-thin">
        <h3 class="mb-2 text-[12px] font-medium text-txt">参数信息</h3>
        <div class="overflow-hidden rounded-lg border border-line-soft">
          <table class="w-full border-collapse text-left text-[10.5px]">
            <thead class="bg-card text-txt-3">
              <tr><th class="border-b border-line-soft px-2 py-1.5 font-medium">参数名</th><th class="border-b border-line-soft px-2 py-1.5 font-medium">类型</th><th class="border-b border-line-soft px-2 py-1.5 font-medium">模式</th></tr>
            </thead>
            <tbody>
              <tr v-for="parameter in state.detail.parameters" :key="`side:${parameter.ordinal}:${parameter.name}`">
                <td class="border-b border-line-soft px-2 py-1.5 font-mono text-txt-2">{{ parameter.name || '—' }}</td>
                <td class="border-b border-line-soft px-2 py-1.5 font-mono text-txt-3">{{ parameter.dataType }}</td>
                <td class="border-b border-line-soft px-2 py-1.5 text-accent">{{ parameter.mode || 'IN' }}</td>
              </tr>
              <tr v-if="!state.detail.parameters.length"><td colspan="3" class="px-2 py-4 text-center text-txt-4">无参数</td></tr>
            </tbody>
          </table>
        </div>

        <h3 class="mt-4 mb-2 text-[12px] font-medium text-txt">基本信息</h3>
        <dl class="grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-2 rounded-lg border border-line-soft bg-card p-3 text-[10.5px]">
          <dt class="text-txt-4">名称</dt><dd class="truncate text-txt-2" :title="state.detail.name">{{ state.detail.name }}</dd>
          <dt class="text-txt-4">数据库</dt><dd class="truncate text-txt-2">{{ state.detail.schema }}</dd>
          <template v-if="state.detail.returnType"><dt class="text-txt-4">返回类型</dt><dd class="font-mono text-blue">{{ state.detail.returnType }}</dd></template>
          <dt class="text-txt-4">语言</dt><dd class="font-mono text-txt-2">{{ state.detail.language || 'SQL' }}</dd>
          <dt class="text-txt-4">创建时间</dt><dd class="text-txt-3">{{ state.detail.createdAt || '—' }}</dd>
          <dt class="text-txt-4">更新时间</dt><dd class="text-txt-3">{{ state.detail.updatedAt || '—' }}</dd>
          <dt class="text-txt-4">注释</dt><dd class="break-words text-txt-3">{{ state.detail.comment || '—' }}</dd>
        </dl>
      </aside>
    </div>
  </section>
</template>
