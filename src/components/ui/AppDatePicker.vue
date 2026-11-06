<script setup lang="ts">
import type { CSSProperties } from 'vue'
import {
  computed,
  nextTick,
  reactive,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import { useEventListener } from '@vueuse/core'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppMenuSurface from '@/components/ui/AppMenuSurface.vue'
import {
  calendarDays,
  currentDateParts,
  formatDateValue,
  parseDateValue,
  shiftMonth,
  type CalendarDay,
  type DateParts,
  type DateValueMode,
} from '@/utils/date-value'

/**
 * 日期 / 时间 / 日期时间选择器。
 *
 * 输入框始终可以直接键入，弹层只是辅助：值按 `YYYY-MM-DD HH:mm:ss` 文本读写，
 * 解析不了的内容（零日期、超长 TIME）原样保留。弹层上的按钮都不抢焦点，
 * 表格单元格这类"失焦即提交"的场景点日历不会提前提交。
 * 透传的 attrs（class、placeholder、事件）落在内部 input 上。
 */
defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<{
    mode?: DateValueMode
    size?: 'sm' | 'md'
    variant?: 'default' | 'cell'
    disabled?: boolean
  }>(),
  { mode: 'date', size: 'md', variant: 'default', disabled: false }
)

const model = defineModel<string>({ required: true })
const { t, locale } = useI18n()
const root = useTemplateRef<HTMLElement>('root')
const panel = useTemplateRef<HTMLElement>('panel')
const timeColumns = useTemplateRef<HTMLElement[]>('timeColumns')
const panelId = useId()

const state = reactive({
  open: false,
  year: 2000,
  month: 1,
  style: {} as CSSProperties,
})
const today = shallowRef(currentDateParts())

const hasDate = computed(() => props.mode !== 'time')
const hasTime = computed(() => props.mode !== 'date')
const parsed = computed(() => parseDateValue(model.value, props.mode))
const weekStart = computed<0 | 1>(() => (locale.value.startsWith('zh') ? 1 : 0))
const days = computed(() =>
  calendarDays(state.year, state.month, weekStart.value)
)

function localDate(year: number, month: number, day: number): Date {
  const date = new Date(2000, 0, 1)
  date.setFullYear(year, month - 1, day)
  return date
}

const weekdays = computed(() => {
  const format = new Intl.DateTimeFormat(locale.value, { weekday: 'narrow' })
  // 2024-01-07 是周日，往后数 7 天即一整周。
  return Array.from({ length: 7 }, (_, index) =>
    format.format(localDate(2024, 1, 7 + ((index + weekStart.value) % 7)))
  )
})
const monthLabel = computed(() =>
  new Intl.DateTimeFormat(locale.value, {
    year: 'numeric',
    month: 'long',
  }).format(localDate(state.year, state.month, 1))
)

const timeUnits = computed(() => [
  { key: 'hour' as const, label: t('时'), count: 24 },
  { key: 'minute' as const, label: t('分'), count: 60 },
  { key: 'second' as const, label: t('秒'), count: 60 },
])

const sameDay = (a: CalendarDay, b: DateParts | null): boolean =>
  !!b && a.year === b.year && a.month === b.month && a.day === b.day

/** 没有可解析的旧值时，从今天 00:00:00 开始拼。 */
function baseParts(): DateParts {
  return (
    parsed.value ?? {
      ...currentDateParts(),
      hour: 0,
      minute: 0,
      second: 0,
    }
  )
}

function commit(parts: DateParts): void {
  model.value = formatDateValue(parts, props.mode)
}

function selectDay(day: CalendarDay): void {
  commit({ ...baseParts(), year: day.year, month: day.month, day: day.day })
  if (day.outside) Object.assign(state, { year: day.year, month: day.month })
  if (!hasTime.value) close()
}

function selectTime(key: 'hour' | 'minute' | 'second', value: number): void {
  commit({ ...baseParts(), [key]: value })
}

function selectNow(): void {
  // 保留原值的时区后缀，只替换日期和时间本身。
  commit({ ...currentDateParts(), suffix: parsed.value?.suffix ?? '' })
  if (!hasTime.value) close()
}

function moveMonth(delta: number): void {
  Object.assign(state, shiftMonth(state.year, state.month, delta))
}

function syncView(): void {
  const source = parsed.value?.year ? parsed.value : today.value
  state.year = source.year
  state.month = source.month
}

/** 时间列把选中项滚到正中，只滚动列本身，不带动外层窗口。 */
function scrollTimeColumns(behavior: ScrollBehavior): void {
  for (const column of timeColumns.value ?? []) {
    const item = column.querySelector<HTMLElement>('[aria-selected="true"]')
    if (!item) continue
    column.scrollTo({
      top: item.offsetTop - (column.clientHeight - item.offsetHeight) / 2,
      behavior,
    })
  }
}

function updatePosition(): void {
  const anchor = root.value
  const element = panel.value
  if (!anchor || !element || !state.open) return

  const rect = anchor.getBoundingClientRect()
  const padding = 8
  const gap = 6
  const { offsetWidth: width, offsetHeight: height } = element
  const roomBelow = window.innerHeight - rect.bottom - padding - gap
  const placeAbove = roomBelow < height && rect.top - padding - gap > roomBelow
  const left = Math.min(
    Math.max(padding, rect.left),
    window.innerWidth - padding - width
  )
  state.style = {
    left: `${left}px`,
    ...(placeAbove
      ? { bottom: `${window.innerHeight - rect.top + gap}px` }
      : { top: `${rect.bottom + gap}px` }),
  }
}

async function open(): Promise<void> {
  if (props.disabled || state.open) return
  today.value = currentDateParts()
  syncView()
  // 先隐藏着渲染一帧量出尺寸，再决定向上还是向下展开，避免首帧闪在旧位置。
  state.style = { visibility: 'hidden', top: '0px', left: '0px' }
  state.open = true
  await nextTick()
  updatePosition()
  scrollTimeColumns('instant')
}

function close(): void {
  state.open = false
}

function focus(): void {
  root.value?.querySelector('input')?.focus({ preventScroll: true })
}

function toggle(): void {
  focus()
  if (state.open) close()
  else void open()
}

/** 捕获阶段先处理：弹层打开时 Esc 只关闭弹层，不让单元格编辑器把整次编辑取消。 */
function handleKeydown(event: KeyboardEvent): void {
  if (event.key === 'Escape' && state.open) {
    event.preventDefault()
    event.stopPropagation()
    close()
  } else if (event.key === 'ArrowDown' && event.altKey) {
    event.preventDefault()
    void open()
  } else if (event.key === 'Enter' || event.key === 'Tab') close()
}

useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  const target = event.target as Node | null
  if (
    !state.open ||
    !target ||
    root.value?.contains(target) ||
    panel.value?.contains(target)
  )
    return
  close()
})
useEventListener(window, 'resize', updatePosition)
useEventListener(
  window,
  'scroll',
  (event: Event) => {
    // 时间列自身滚动也会冒到这里，弹层内的滚动不需要重新定位。
    if (!panel.value?.contains(event.target as Node)) updatePosition()
  },
  { capture: true, passive: true }
)

watch(parsed, async (value, previous) => {
  if (!state.open || !value) return
  if (
    hasDate.value &&
    (value.year !== previous?.year || value.month !== previous?.month)
  )
    syncView()
  await nextTick()
  scrollTimeColumns('smooth')
})
watch(
  () => props.disabled,
  disabled => disabled && close()
)

defineExpose({ open, close, focus })
</script>

<template>
  <div
    ref="root"
    class="relative w-full min-w-0"
    @keydown.capture="handleKeydown"
  >
    <AppInput
      v-bind="$attrs"
      v-model="model"
      :size="size"
      :variant="variant"
      :disabled="disabled"
      monospace
      class="pr-7"
      role="combobox"
      aria-haspopup="dialog"
      :aria-expanded="state.open"
      :aria-controls="panelId"
      autocomplete="off"
      spellcheck="false"
      @click="open"
      @blur="close"
    />
    <button
      type="button"
      tabindex="-1"
      :disabled="disabled"
      :aria-label="hasDate ? t('选择日期') : t('选择时间')"
      class="text-txt-4 hover:text-violet absolute top-1/2 right-1 flex size-5 -translate-y-1/2 items-center justify-center rounded transition-colors disabled:pointer-events-none"
      :class="state.open && 'text-violet'"
      @mousedown.prevent
      @click="toggle"
    >
      <AppIcon
        :name="hasDate ? 'lucide:calendar' : 'lucide:clock'"
        :size="13"
      />
    </button>

    <Teleport to="body">
      <div
        v-show="state.open"
        :id="panelId"
        ref="panel"
        role="dialog"
        :aria-label="hasDate ? t('选择日期') : t('选择时间')"
        :style="state.style"
        class="border-line-strong shadow-pop fixed z-100 flex flex-col gap-2 rounded-[11px] border p-2 text-xs select-none"
        @mousedown.prevent
      >
        <AppMenuSurface />
        <div class="flex gap-2">
          <div
            v-if="hasDate"
            class="w-[224px]"
          >
            <div class="mb-1 flex h-7 items-center gap-0.5">
              <button
                v-for="nav in [
                  {
                    delta: -12,
                    icon: 'lucide:chevrons-left',
                    label: t('上一年'),
                  },
                  {
                    delta: -1,
                    icon: 'lucide:chevron-left',
                    label: t('上个月'),
                  },
                ]"
                :key="nav.delta"
                type="button"
                tabindex="-1"
                :aria-label="nav.label"
                class="text-txt-3 hover:bg-hover hover:text-txt flex size-7 items-center justify-center rounded-md transition-colors"
                @click="moveMonth(nav.delta)"
              >
                <AppIcon
                  :name="nav.icon"
                  :size="14"
                />
              </button>
              <span
                class="text-txt flex-1 text-center text-xs font-medium tabular-nums"
                aria-live="polite"
                >{{ monthLabel }}</span
              >
              <button
                v-for="nav in [
                  {
                    delta: 1,
                    icon: 'lucide:chevron-right',
                    label: t('下个月'),
                  },
                  {
                    delta: 12,
                    icon: 'lucide:chevrons-right',
                    label: t('下一年'),
                  },
                ]"
                :key="nav.delta"
                type="button"
                tabindex="-1"
                :aria-label="nav.label"
                class="text-txt-3 hover:bg-hover hover:text-txt flex size-7 items-center justify-center rounded-md transition-colors"
                @click="moveMonth(nav.delta)"
              >
                <AppIcon
                  :name="nav.icon"
                  :size="14"
                />
              </button>
            </div>
            <div class="text-txt-4 grid grid-cols-7 text-center text-[10px]">
              <span
                v-for="(weekday, index) in weekdays"
                :key="index"
                class="flex h-6 items-center justify-center"
                >{{ weekday }}</span
              >
            </div>
            <div class="grid grid-cols-7 gap-y-0.5">
              <button
                v-for="day in days"
                :key="`${day.year}-${day.month}-${day.day}`"
                type="button"
                tabindex="-1"
                :aria-pressed="sameDay(day, parsed)"
                class="mx-auto flex size-7.5 items-center justify-center rounded-md text-[11px] tabular-nums transition-colors"
                :class="
                  sameDay(day, parsed)
                    ? 'bg-violet font-medium text-white'
                    : [
                        day.outside
                          ? 'text-txt-4'
                          : 'text-txt-2 hover:text-txt',
                        'hover:bg-hover',
                        sameDay(day, today) &&
                          'text-violet ring-violet/45 ring-1 ring-inset',
                      ]
                "
                @click="selectDay(day)"
              >
                {{ day.day }}
              </button>
            </div>
          </div>

          <div
            v-if="hasTime"
            class="flex gap-1"
            :class="hasDate && 'border-line-soft border-l pl-2'"
          >
            <div
              v-for="unit in timeUnits"
              :key="unit.key"
              class="flex w-10 flex-col"
            >
              <span
                class="text-txt-4 flex h-7 items-center justify-center text-[10px]"
                >{{ unit.label }}</span
              >
              <div
                ref="timeColumns"
                role="listbox"
                :aria-label="unit.label"
                class="scroll-none relative overflow-y-auto overscroll-contain"
                :class="hasDate ? 'h-[222px]' : 'h-[196px]'"
              >
                <button
                  v-for="value in unit.count"
                  :key="value"
                  type="button"
                  tabindex="-1"
                  role="option"
                  :aria-selected="parsed?.[unit.key] === value - 1"
                  class="flex h-7 w-full items-center justify-center rounded-md font-mono text-[11px] transition-colors"
                  :class="
                    parsed?.[unit.key] === value - 1
                      ? 'bg-violet text-white'
                      : 'text-txt-2 hover:bg-hover hover:text-txt'
                  "
                  @click="selectTime(unit.key, value - 1)"
                >
                  {{ String(value - 1).padStart(2, '0') }}
                </button>
              </div>
            </div>
          </div>
        </div>

        <div
          class="border-line-soft flex items-center justify-between border-t pt-2"
        >
          <button
            type="button"
            tabindex="-1"
            class="text-violet hover:bg-violet/10 rounded-md px-2 py-1 text-[11px] transition-colors"
            @click="selectNow"
          >
            {{ hasTime ? t('此刻') : t('今天') }}
          </button>
          <button
            type="button"
            tabindex="-1"
            class="bg-violet/12 text-violet hover:bg-violet/20 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors"
            @click="close"
          >
            {{ t('完成') }}
          </button>
        </div>
      </div>
    </Teleport>
  </div>
</template>
