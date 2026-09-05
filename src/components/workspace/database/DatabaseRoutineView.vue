<script setup lang="ts">
import { computed, reactive, watch } from 'vue'
import * as database from '@/api/database'
import AppButton from '@/components/ui/AppButton.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { toast } from '@/composables/useToast'
import type {
  DatabaseKind,
  DatabaseObject,
  DatabaseRoutineDetail,
} from '@/types/database'
import { copyText as copyClipboardText } from '@/utils/clipboard'
import { cn } from '@/utils/cn'

type RoutinePanel = 'definition' | 'parameters' | 'ddl'

const props = defineProps<{
  sessionId: string
  databaseKind: DatabaseKind
  object: DatabaseObject
}>()

const emit = defineEmits<{
  query: [sql: string]
}>()

const state = reactive({
  activePanel: 'definition' as RoutinePanel,
  detail: null as DatabaseRoutineDetail | null,
  loading: false,
  error: '',
})

const panels: Array<{ id: RoutinePanel; label: string }> = [
  { id: 'definition', label: '定义' },
  { id: 'parameters', label: '参数' },
  { id: 'ddl', label: 'DDL' },
]

const kindLabel = computed(() =>
  props.object.kind === 'procedure' ? '存储过程' : '函数'
)
const code = computed(() => {
  if (!state.detail) return ''
  return state.activePanel === 'ddl'
    ? state.detail.ddl
    : state.detail.definition
})

async function loadDetail(): Promise<void> {
  if (!props.sessionId) return
  state.loading = true
  state.error = ''
  try {
    state.detail = await database.routineDetail(props.sessionId, props.object)
  } catch (error) {
    state.error = database.errorMessage(error)
    state.detail = null
    toast.error({
      title: `读取${kindLabel.value}失败`,
      description: state.error,
    })
  } finally {
    state.loading = false
  }
}

async function copyText(value: string): Promise<void> {
  await copyClipboardText(value)
  toast.success(`${kindLabel.value}定义已复制`)
}

function queryTemplate(): string {
  const qualified = `${quoteIdentifier(props.object.schema)}.${quoteIdentifier(props.object.name)}`
  const args =
    state.detail?.parameters
      .filter(parameter => parameter.mode.toLocaleUpperCase() !== 'OUT')
      .map(
        parameter =>
          `/* ${parameter.name || '参数'}: ${parameter.dataType} */ NULL`
      )
      .join(', ') ?? ''
  return props.object.kind === 'procedure'
    ? `CALL ${qualified}(${args});`
    : `SELECT ${qualified}(${args});`
}

function quoteIdentifier(identifier: string): string {
  return props.databaseKind === 'mysql'
    ? `\`${identifier.replaceAll('`', '``')}\``
    : `"${identifier.replaceAll('"', '""')}"`
}

watch(
  () => [
    props.sessionId,
    props.object.schema,
    props.object.name,
    props.object.identity,
    props.object.kind,
  ],
  () => void loadDetail(),
  { immediate: true }
)
</script>

<template>
  <section class="bg-workspace flex min-h-0 flex-1 flex-col">
    <header
      class="border-line-soft flex h-10 shrink-0 items-center border-b px-3"
    >
      <div class="text-txt flex min-w-0 items-center gap-2 text-[12px]">
        <AppIcon
          :name="
            object.kind === 'procedure' ? 'lucide:workflow' : 'lucide:braces'
          "
          :size="14"
          class="text-accent"
        />
        <span class="shrink-0">{{ kindLabel }}:</span>
        <strong class="truncate font-medium">{{ object.name }}</strong>
        <span
          v-if="object.identity"
          class="text-txt-4 max-w-80 truncate font-mono text-[10px]"
          >({{ object.identity }})</span
        >
      </div>
      <div class="flex-1" />
      <IconButton
        icon="lucide:rotate-cw"
        :size="13"
        title="刷新详情"
        :disabled="state.loading"
        @click="loadDetail"
      />
      <IconButton
        icon="lucide:play"
        :size="13"
        title="生成调用语句"
        @click="emit('query', queryTemplate())"
      />
    </header>

    <div class="flex min-h-0 flex-1">
      <div class="flex min-w-0 flex-1 flex-col">
        <div
          class="border-line-soft flex h-9 shrink-0 items-end gap-1 border-b px-3"
        >
          <AppButton
            v-for="panel in panels"
            :key="panel.id"
            variant="bare"
            :class="
              cn(
                'text-txt-3 hover:text-txt relative h-full px-2.5 text-[11px] transition-colors',
                state.activePanel === panel.id &&
                  'text-accent after:bg-accent after:absolute after:inset-x-1 after:bottom-0 after:h-0.5 after:rounded-full'
              )
            "
            @click="state.activePanel = panel.id"
          >
            {{ panel.label }}
          </AppButton>
        </div>

        <div
          v-if="state.loading"
          class="text-txt-4 grid flex-1 place-items-center text-xs"
        >
          <span class="flex items-center gap-2"
            ><AppIcon
              name="lucide:loader-circle"
              :size="14"
              class="text-accent animate-spin"
            />正在读取{{ kindLabel }}…</span
          >
        </div>
        <div
          v-else-if="state.error"
          class="text-txt-4 grid flex-1 place-items-center text-center text-xs"
        >
          <div>
            <p>详情读取失败</p>
            <AppButton
              class="mt-3"
              @click="loadDetail"
              >重新加载</AppButton
            >
          </div>
        </div>

        <div
          v-else-if="state.detail && state.activePanel === 'parameters'"
          class="scroll-thin min-h-0 flex-1 overflow-auto p-3"
        >
          <table
            class="border-line-soft w-full border-collapse overflow-hidden rounded-lg border text-left text-[11px]"
          >
            <thead class="bg-panel text-txt-3">
              <tr>
                <th class="border-line-soft border px-3 py-2 font-medium">
                  参数名
                </th>
                <th class="border-line-soft border px-3 py-2 font-medium">
                  类型
                </th>
                <th class="border-line-soft border px-3 py-2 font-medium">
                  模式
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="parameter in state.detail.parameters"
                :key="`${parameter.ordinal}:${parameter.name}`"
                class="hover:bg-hover"
              >
                <td
                  class="border-line-soft text-txt border px-3 py-2 font-mono"
                >
                  {{ parameter.name || '—' }}
                </td>
                <td
                  class="border-line-soft text-blue border px-3 py-2 font-mono"
                >
                  {{ parameter.dataType }}
                </td>
                <td class="border-line-soft text-accent border px-3 py-2">
                  {{ parameter.mode || 'IN' }}
                </td>
              </tr>
              <tr v-if="!state.detail.parameters.length">
                <td
                  colspan="3"
                  class="border-line-soft text-txt-4 border px-3 py-8 text-center"
                >
                  此对象没有参数
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <div
          v-else-if="state.detail"
          class="scroll-thin relative min-h-0 flex-1 overflow-auto bg-[#0d0f14] p-4"
        >
          <AppButton
            size="sm"
            class="absolute top-3 right-3 z-10 h-7"
            @click="copyText(code)"
          >
            <AppIcon
              name="lucide:copy"
              :size="11"
            />复制
          </AppButton>
          <pre
            class="text-term-fg pr-22 font-mono text-[11.5px] leading-5 whitespace-pre-wrap"
            >{{ code || '没有可用的定义' }}</pre>
        </div>
      </div>

      <aside
        v-if="state.detail"
        class="border-line-soft bg-panel scroll-thin w-76 shrink-0 overflow-y-auto border-l p-3"
      >
        <h3 class="text-txt mb-2 text-[12px] font-medium">参数信息</h3>
        <div class="border-line-soft overflow-hidden rounded-lg border">
          <table class="w-full border-collapse text-left text-[10.5px]">
            <thead class="bg-card text-txt-3">
              <tr>
                <th class="border-line-soft border-b px-2 py-1.5 font-medium">
                  参数名
                </th>
                <th class="border-line-soft border-b px-2 py-1.5 font-medium">
                  类型
                </th>
                <th class="border-line-soft border-b px-2 py-1.5 font-medium">
                  模式
                </th>
              </tr>
            </thead>
            <tbody>
              <tr
                v-for="parameter in state.detail.parameters"
                :key="`side:${parameter.ordinal}:${parameter.name}`"
              >
                <td
                  class="border-line-soft text-txt-2 border-b px-2 py-1.5 font-mono"
                >
                  {{ parameter.name || '—' }}
                </td>
                <td
                  class="border-line-soft text-txt-3 border-b px-2 py-1.5 font-mono"
                >
                  {{ parameter.dataType }}
                </td>
                <td class="border-line-soft text-accent border-b px-2 py-1.5">
                  {{ parameter.mode || 'IN' }}
                </td>
              </tr>
              <tr v-if="!state.detail.parameters.length">
                <td
                  colspan="3"
                  class="text-txt-4 px-2 py-4 text-center"
                >
                  无参数
                </td>
              </tr>
            </tbody>
          </table>
        </div>

        <h3 class="text-txt mt-4 mb-2 text-[12px] font-medium">基本信息</h3>
        <dl
          class="border-line-soft bg-card grid grid-cols-[88px_minmax(0,1fr)] gap-x-2 gap-y-2 rounded-lg border p-3 text-[10.5px]"
        >
          <dt class="text-txt-4">名称</dt>
          <dd
            class="text-txt-2 truncate"
            :title="state.detail.name"
          >
            {{ state.detail.name }}
          </dd>
          <dt class="text-txt-4">数据库</dt>
          <dd class="text-txt-2 truncate">{{ state.detail.schema }}</dd>
          <template v-if="state.detail.returnType"
            ><dt class="text-txt-4">返回类型</dt>
            <dd class="text-blue font-mono">
              {{ state.detail.returnType }}
            </dd></template
          >
          <dt class="text-txt-4">语言</dt>
          <dd class="text-txt-2 font-mono">
            {{ state.detail.language || 'SQL' }}
          </dd>
          <dt class="text-txt-4">创建时间</dt>
          <dd class="text-txt-3">{{ state.detail.createdAt || '—' }}</dd>
          <dt class="text-txt-4">更新时间</dt>
          <dd class="text-txt-3">{{ state.detail.updatedAt || '—' }}</dd>
          <dt class="text-txt-4">注释</dt>
          <dd class="text-txt-3 break-words">
            {{ state.detail.comment || '—' }}
          </dd>
        </dl>
      </aside>
    </div>
  </section>
</template>
