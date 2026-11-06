<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { useEventListener } from '@vueuse/core'
import { computed, onMounted, reactive, shallowRef } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSkeleton from '@/components/ui/AppSkeleton.vue'
import IconButton from '@/components/ui/IconButton.vue'
import * as database from '@/api/database'
import { toast } from '@/composables/useToast'
import type { DatabaseTableDetail } from '@/types/database'
import {
  ER_HEADER_HEIGHT,
  ER_MAX_ROWS,
  ER_ROW_HEIGHT,
  layoutErDiagram,
  type ErNode,
} from '@/utils/er-layout'
import { loadSchemaTables } from '@/utils/schema-diff'

const { t } = useI18n()

const props = defineProps<{
  sessionId: string
  databaseName: string
}>()

const emit = defineEmits<{
  close: []
  open: [table: DatabaseTableDetail]
}>()

const tables = shallowRef<DatabaseTableDetail[]>([])
const state = reactive({
  loading: true,
  progress: '',
  truncated: false,
  nodes: [] as ErNode[],
  edges: [] as { from: string; to: string; label: string }[],
  view: { x: 0, y: 0, scale: 1 },
  highlighted: '',
})
const tableByName = computed(
  () => new Map(tables.value.map(table => [table.name, table]))
)
const nodeByName = computed(
  () => new Map(state.nodes.map(node => [node.name, node]))
)

/** 读取全部表结构并计算初始布局。 */
async function load(): Promise<void> {
  state.loading = true
  try {
    const result = await loadSchemaTables(props.sessionId, (done, total) => {
      state.progress = `${done} / ${total}`
    })
    tables.value = result.tables
    state.truncated = result.truncated
    const layout = layoutErDiagram(result.tables)
    state.nodes = layout.nodes
    state.edges = layout.edges
  } catch (error) {
    toast.error({
      title: t('读取表结构失败'),
      description: database.errorMessage(error),
    })
    emit('close')
  } finally {
    state.loading = false
  }
}
onMounted(load)

/** 外键连线：从子表右侧引出，弯到父表左侧（父表在右时反向）。 */
function edgePath(edge: { from: string; to: string }): string {
  const from = nodeByName.value.get(edge.from)
  const to = nodeByName.value.get(edge.to)
  if (!from || !to) return ''
  const fromRight = from.x > to.x
  const x1 = fromRight ? from.x : from.x + from.width
  const x2 = fromRight ? to.x + to.width : to.x
  const y1 = from.y + ER_HEADER_HEIGHT / 2
  const y2 = to.y + ER_HEADER_HEIGHT / 2
  const bend = Math.max(40, Math.abs(x2 - x1) / 2) * (fromRight ? -1 : 1)
  return `M ${x1} ${y1} C ${x1 + bend} ${y1}, ${x2 - bend} ${y2}, ${x2} ${y2}`
}

let drag: { kind: 'pan' | 'node'; name?: string; x: number; y: number } | null = null

/** 按下表头拖动表，按下空白处平移画布。 */
function pointerDown(event: PointerEvent, name?: string): void {
  if (event.button !== 0) return
  event.stopPropagation()
  ;(event.currentTarget as Element).setPointerCapture?.(event.pointerId)
  drag = { kind: name ? 'node' : 'pan', name, x: event.clientX, y: event.clientY }
}

/** 拖动中按缩放比例换算位移。 */
function pointerMove(event: PointerEvent): void {
  if (!drag) return
  const dx = event.clientX - drag.x
  const dy = event.clientY - drag.y
  drag.x = event.clientX
  drag.y = event.clientY
  if (drag.kind === 'pan') {
    state.view.x += dx
    state.view.y += dy
    return
  }
  const node = state.nodes.find(item => item.name === drag?.name)
  if (node) {
    node.x += dx / state.view.scale
    node.y += dy / state.view.scale
  }
}

/** 滚轮以鼠标位置为中心缩放。 */
function wheel(event: WheelEvent): void {
  event.preventDefault()
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const px = event.clientX - rect.left
  const py = event.clientY - rect.top
  const next = Math.min(2, Math.max(0.25, state.view.scale * (event.deltaY < 0 ? 1.1 : 0.9)))
  const ratio = next / state.view.scale
  state.view.x = px - (px - state.view.x) * ratio
  state.view.y = py - (py - state.view.y) * ratio
  state.view.scale = next
}

/** 恢复初始缩放与位置。 */
function resetView(): void {
  state.view = { x: 0, y: 0, scale: 1 }
}

useEventListener(window, 'pointerup', () => {
  drag = null
})
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') emit('close')
})
</script>

<template>
  <Transition
    name="fade"
    appear
  >
    <div class="bg-window glass absolute inset-0 z-50 flex flex-col">
      <header class="border-line-soft flex h-10 shrink-0 items-center gap-2 border-b px-3">
        <AppIcon
          name="lucide:network"
          :size="15"
          class="text-accent"
        />
        <span class="text-txt text-[12.5px] font-medium">{{ t('ER 图') }}</span>
        <span class="text-txt-4 font-mono text-[11px]">{{ databaseName }}</span>
        <span
          v-if="state.truncated"
          class="text-amber text-[11px]"
          >{{ t('表过多，仅展示前 120 张') }}</span
        >
        <span class="flex-1" />
        <span class="text-txt-4 text-[11px]">{{ t('拖动表头移动 · 滚轮缩放 · 拖空白处平移') }}</span>
        <IconButton
          icon="lucide:scan"
          :size="14"
          :title="t('重置视图')"
          @click="resetView"
        />
        <IconButton
          icon="lucide:x"
          :size="15"
          :title="t('关闭')"
          @click="emit('close')"
        />
      </header>

      <div
        v-if="state.loading"
        class="flex flex-1 flex-col items-center justify-center gap-3"
      >
        <AppSkeleton
          variant="table"
          class="w-96"
          :rows="5"
          :columns="3"
        />
        <span class="text-txt-3 text-xs">{{ t('正在读取表结构…') }} {{ state.progress }}</span>
      </div>

      <div
        v-else
        class="relative min-h-0 flex-1 cursor-grab overflow-hidden active:cursor-grabbing"
        @pointerdown="pointerDown($event)"
        @pointermove="pointerMove"
        @wheel="wheel"
      >
        <div
          class="absolute top-0 left-0 origin-top-left"
          :style="{ transform: `translate(${state.view.x}px, ${state.view.y}px) scale(${state.view.scale})` }"
        >
          <svg class="pointer-events-none absolute top-0 left-0 size-[8000px] overflow-visible">
            <path
              v-for="(edge, index) in state.edges"
              :key="index"
              :d="edgePath(edge)"
              fill="none"
              :class="[
                'transition-[stroke,stroke-width] duration-200',
                state.highlighted && (edge.from === state.highlighted || edge.to === state.highlighted)
                  ? 'stroke-accent stroke-2'
                  : 'stroke-line-strong stroke-[1.5]',
              ]"
            />
          </svg>
          <section
            v-for="node in state.nodes"
            :key="node.name"
            class="bg-pane border-line shadow-pane absolute overflow-hidden rounded-card border transition-shadow"
            :class="state.highlighted === node.name && 'ring-accent ring-2'"
            :style="{ left: `${node.x}px`, top: `${node.y}px`, width: `${node.width}px`, height: `${node.height}px` }"
            @pointerenter="state.highlighted = node.name"
            @pointerleave="state.highlighted = ''"
          >
            <header
              class="bg-raised flex cursor-move items-center gap-1.5 px-2.5"
              :style="{ height: `${ER_HEADER_HEIGHT}px` }"
              @pointerdown="pointerDown($event, node.name)"
              @dblclick="tableByName.get(node.name) && emit('open', tableByName.get(node.name)!)"
            >
              <AppIcon
                name="lucide:table-2"
                :size="12"
                class="text-accent shrink-0"
              />
              <span class="text-txt truncate text-[12px] font-medium">{{ node.name }}</span>
            </header>
            <ul class="py-1">
              <li
                v-for="column in tableByName.get(node.name)?.columns.slice(0, ER_MAX_ROWS)"
                :key="column.name"
                class="flex items-center gap-1.5 px-2.5 font-mono text-[10.5px]"
                :style="{ height: `${ER_ROW_HEIGHT}px` }"
              >
                <AppIcon
                  v-if="column.primaryKey"
                  name="lucide:key-round"
                  :size="10"
                  class="text-amber shrink-0"
                />
                <AppIcon
                  v-else-if="tableByName.get(node.name)?.foreignKeys.some(key => key.columns.includes(column.name))"
                  name="lucide:link"
                  :size="10"
                  class="text-blue shrink-0"
                />
                <span
                  v-else
                  class="w-2.5 shrink-0"
                />
                <span class="text-txt-2 truncate">{{ column.name }}</span>
                <span class="flex-1" />
                <span class="text-txt-4 truncate">{{ column.dataType }}</span>
              </li>
              <li
                v-if="(tableByName.get(node.name)?.columns.length ?? 0) > ER_MAX_ROWS"
                class="text-txt-4 px-2.5 text-[10.5px]"
                :style="{ height: `${ER_ROW_HEIGHT}px` }"
              >
                +{{ (tableByName.get(node.name)?.columns.length ?? 0) - ER_MAX_ROWS }}
              </li>
            </ul>
          </section>
        </div>
      </div>
    </div>
  </Transition>
</template>
