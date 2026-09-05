<script setup lang="ts">
import type { CSSProperties } from 'vue'
import {
  computed,
  nextTick,
  shallowRef,
  useId,
  useTemplateRef,
  watch,
} from 'vue'
import { useEventListener } from '@vueuse/core'
import AppIcon from './AppIcon.vue'

interface SelectOption {
  value: string
  label: string
  description?: string
  group?: string
  disabled?: boolean
}

const props = withDefaults(
  defineProps<{
    label: string
    options: readonly SelectOption[]
    placeholder?: string
    required?: boolean
    disabled?: boolean
    /** 保留可访问名称，但不显示组件自带标签，适合设置项这类行内布局。 */
    hideLabel?: boolean
    /** 28px 高的紧凑规格，用于设置面板等高密度界面。 */
    compact?: boolean
    /** 显示搜索框；选项超过 7 个时也会自动开启。 */
    searchable?: boolean
  }>(),
  {
    placeholder: '请选择',
    required: false,
    disabled: false,
    hideLabel: false,
    compact: false,
    searchable: false,
  }
)

const model = defineModel<string>({ required: true })
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const menu = useTemplateRef<HTMLElement>('menu')
const searchInput = useTemplateRef<HTMLInputElement>('searchInput')
const open = shallowRef(false)
const search = shallowRef('')
const activeIndex = shallowRef(-1)
const menuStyle = shallowRef<CSSProperties>({})
const triggerId = useId()
const labelId = useId()
const listboxId = useId()

const selectedOption = computed(() =>
  props.options.find(option => option.value === model.value)
)
const showSearch = computed(() => props.searchable || props.options.length > 7)
const visibleOptions = computed(() => {
  const term = search.value.trim().toLocaleLowerCase()
  if (!term) return props.options
  return props.options.filter(
    option =>
      option.label.toLocaleLowerCase().includes(term) ||
      option.description?.toLocaleLowerCase().includes(term) ||
      option.group?.toLocaleLowerCase().includes(term)
  )
})

const activeOptionId = computed(() =>
  open.value && activeIndex.value >= 0
    ? `${listboxId}-option-${activeIndex.value}`
    : undefined
)

function enabledIndexFrom(start: number, step: 1 | -1): number {
  if (!visibleOptions.value.length) return -1

  let index = start
  for (let checked = 0; checked < visibleOptions.value.length; checked += 1) {
    index =
      (index + step + visibleOptions.value.length) % visibleOptions.value.length
    if (!visibleOptions.value[index]?.disabled) return index
  }

  return -1
}

function setInitialActiveIndex(): void {
  const selectedIndex = visibleOptions.value.findIndex(
    option => option.value === model.value && !option.disabled
  )
  activeIndex.value =
    selectedIndex >= 0 ? selectedIndex : enabledIndexFrom(-1, 1)
}

function updatePosition(): void {
  const element = trigger.value
  if (!element || !open.value) return

  const rect = element.getBoundingClientRect()
  const viewportPadding = 8
  const gap = 6
  const desiredHeight = Math.min(
    280,
    visibleOptions.value.length * 38 + (showSearch.value ? 48 : 8)
  )
  const roomBelow = window.innerHeight - rect.bottom - viewportPadding - gap
  const roomAbove = rect.top - viewportPadding - gap
  const placeAbove =
    roomBelow < Math.min(120, desiredHeight) && roomAbove > roomBelow
  const availableHeight = Math.max(72, placeAbove ? roomAbove : roomBelow)
  const width = Math.min(
    Math.max(rect.width, 196),
    window.innerWidth - viewportPadding * 2
  )
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - viewportPadding - width
  )

  menuStyle.value = {
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${Math.min(280, availableHeight)}px`,
    ...(placeAbove
      ? { bottom: `${window.innerHeight - rect.top + gap}px` }
      : { top: `${rect.bottom + gap}px` }),
  }
}

async function openMenu(): Promise<void> {
  if (props.disabled || !props.options.length) return

  search.value = ''
  setInitialActiveIndex()
  open.value = true
  await nextTick()
  updatePosition()
  if (showSearch.value) searchInput.value?.focus()
}

function closeMenu(): void {
  open.value = false
  activeIndex.value = -1
}

function toggleMenu(): void {
  if (open.value) closeMenu()
  else void openMenu()
}

function selectOption(option: SelectOption): void {
  if (option.disabled) return

  model.value = option.value
  closeMenu()
  trigger.value?.focus()
}

function moveActive(step: 1 | -1): void {
  activeIndex.value = enabledIndexFrom(activeIndex.value, step)
}

function moveToBoundary(boundary: 'first' | 'last'): void {
  activeIndex.value =
    boundary === 'first' ? enabledIndexFrom(-1, 1) : enabledIndexFrom(0, -1)
}

function handleKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      event.preventDefault()
      if (!open.value) void openMenu()
      else moveActive(event.key === 'ArrowDown' ? 1 : -1)
      break
    case 'Home':
    case 'End':
      event.preventDefault()
      if (!open.value) void openMenu()
      moveToBoundary(event.key === 'Home' ? 'first' : 'last')
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      if (!open.value) {
        void openMenu()
      } else {
        const option = visibleOptions.value[activeIndex.value]
        if (option) selectOption(option)
      }
      break
    case 'Escape':
      if (open.value) {
        event.preventDefault()
        event.stopPropagation()
        closeMenu()
      }
      break
    case 'Tab':
      closeMenu()
      break
  }
}

useEventListener(document, 'pointerdown', (event: PointerEvent) => {
  const target = event.target as Node | null
  if (
    !target ||
    trigger.value?.contains(target) ||
    menu.value?.contains(target)
  )
    return

  closeMenu()
})

useEventListener(window, 'resize', updatePosition)
useEventListener(window, 'scroll', updatePosition, {
  capture: true,
  passive: true,
})

watch(activeIndex, async index => {
  if (!open.value || index < 0) return
  await nextTick()
  document
    .getElementById(`${listboxId}-option-${index}`)
    ?.scrollIntoView({ block: 'nearest' })
})

watch(search, () => {
  activeIndex.value = enabledIndexFrom(-1, 1)
})

watch(
  () => props.disabled,
  disabled => {
    if (disabled) closeMenu()
  }
)
</script>

<template>
  <div :class="hideLabel ? '' : 'space-y-1.5'">
    <label
      :id="labelId"
      :for="triggerId"
      :class="
        hideLabel ? 'sr-only' : 'text-txt-2 block text-[11px] font-medium'
      "
    >
      {{ label }}
      <span
        v-if="required"
        class="text-violet"
        aria-hidden="true"
        >*</span
      >
    </label>

    <button
      :id="triggerId"
      ref="trigger"
      type="button"
      role="combobox"
      :aria-labelledby="labelId"
      aria-haspopup="listbox"
      :aria-controls="listboxId"
      :aria-expanded="open"
      :aria-activedescendant="activeOptionId"
      :aria-required="required"
      :disabled="disabled"
      :class="[
        'app-select-trigger field w-full cursor-pointer justify-between text-left disabled:pointer-events-none disabled:opacity-45',
        compact ? 'app-select-trigger-compact' : 'h-[34px]',
      ]"
      @click="toggleMenu"
      @keydown="handleKeydown"
    >
      <span
        :class="[
          'app-select-value min-w-0 flex-1 truncate text-xs',
          selectedOption ? 'text-txt' : 'text-txt-4',
        ]"
      >
        {{ selectedOption?.label ?? placeholder }}
      </span>
      <AppIcon
        name="lucide:chevron-down"
        :size="14"
        :class="[
          'text-txt-4 shrink-0 transition-transform duration-150 motion-reduce:transition-none',
          open && 'rotate-180',
        ]"
      />
    </button>

    <Teleport to="body">
      <Transition name="app-select-pop">
        <div
          v-if="open"
          :id="listboxId"
          ref="menu"
          role="listbox"
          :aria-labelledby="labelId"
          :style="menuStyle"
          class="app-select-menu scroll-thin fixed z-100 overflow-y-auto p-1.5"
          @keydown="handleKeydown"
        >
          <label
            v-if="showSearch"
            class="app-select-search border-line-soft bg-card sticky top-0 z-10 mb-1 flex h-8 items-center gap-2 rounded-md border px-2"
          >
            <AppIcon
              name="lucide:search"
              :size="12"
              class="text-txt-4"
            />
            <input
              ref="searchInput"
              v-model="search"
              class="text-txt min-w-0 flex-1 bg-transparent text-[11px] outline-none"
              placeholder="搜索选项"
              @keydown.space.stop
            />
          </label>
          <template
            v-for="(option, index) in visibleOptions"
            :key="option.value"
          >
            <div
              v-if="
                option.group &&
                option.group !== visibleOptions[index - 1]?.group
              "
              class="app-select-group"
            >
              {{ option.group }}
            </div>
            <div
              :id="`${listboxId}-option-${index}`"
              role="option"
              :aria-selected="model === option.value"
              :aria-disabled="option.disabled || undefined"
              :class="[
                'app-select-option flex min-h-9 items-center gap-2 px-2.5 py-1.5 text-left',
                index === activeIndex && 'app-select-option-active',
                model === option.value && 'app-select-option-selected',
                option.disabled && 'pointer-events-none opacity-40',
              ]"
              @pointerenter="!option.disabled && (activeIndex = index)"
              @pointerdown.prevent="selectOption(option)"
            >
              <span
                class="app-select-indicator"
                aria-hidden="true"
              />
              <span class="min-w-0 flex-1">
                <span class="text-txt block truncate text-xs">{{
                  option.label
                }}</span>
                <span
                  v-if="option.description"
                  class="text-txt-3 mt-0.5 block truncate text-[10px]"
                  >{{ option.description }}</span
                >
              </span>
              <AppIcon
                v-if="model === option.value"
                name="lucide:check"
                :size="13"
                class="text-violet shrink-0"
              />
            </div>
          </template>
          <div
            v-if="!visibleOptions.length"
            class="text-txt-4 px-2.5 py-5 text-center text-[11px]"
          >
            没有匹配项
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<style scoped>
.app-select-trigger:focus-visible,
.app-select-trigger[aria-expanded='true'] {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  outline: none;
  box-shadow: 0 0 0 3px
    color-mix(in oklch, var(--color-violet) 12%, transparent);
}

.app-select-trigger-compact {
  height: 28px;
  gap: 4px;
  border-radius: 6px;
  padding-right: 7px;
  padding-left: 8px;
}

.app-select-trigger-compact .app-select-value {
  font-size: 10.5px;
}

.app-select-menu {
  border: 1px solid color-mix(in oklch, var(--color-line-strong) 88%, white 5%);
  border-radius: 11px;
  background:
    linear-gradient(
      180deg,
      color-mix(in oklch, white 3%, transparent),
      transparent 32%
    ),
    color-mix(in oklch, var(--color-panel) 94%, transparent);
  box-shadow:
    0 18px 48px rgb(0 0 0 / 34%),
    0 3px 12px rgb(0 0 0 / 22%),
    inset 0 1px rgb(255 255 255 / 4%);
  backdrop-filter: blur(28px) saturate(175%);
  -webkit-backdrop-filter: blur(28px) saturate(175%);
}

.app-select-option {
  position: relative;
  cursor: pointer;
  border: 1px solid transparent;
  border-radius: 7px;
  color: var(--color-txt-2);
  transition:
    background-color 150ms ease,
    color 150ms ease,
    border-color 150ms ease;
}

.app-select-indicator {
  width: 2px;
  height: 16px;
  flex: none;
  border-radius: 999px;
  background: transparent;
  transition:
    background-color 150ms ease,
    transform 180ms cubic-bezier(0.2, 0.8, 0.2, 1);
  transform: scaleY(0.45);
}

.app-select-option-selected .app-select-indicator {
  background: var(--color-violet);
  transform: scaleY(1);
}

.app-select-group {
  padding: 7px 9px 3px;
  color: var(--color-txt-4);
  font-size: 9px;
  font-weight: 650;
  letter-spacing: 0.08em;
  text-transform: uppercase;
}

.app-select-option-active {
  background: var(--color-hover);
  border-color: color-mix(in oklch, var(--color-line-strong) 65%, transparent);
}

.app-select-option-selected {
  background: color-mix(in oklch, var(--color-violet) 12%, var(--color-card));
  color: var(--color-txt);
}

.app-select-pop-enter-active,
.app-select-pop-leave-active {
  transition:
    opacity 140ms ease,
    transform 140ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.app-select-pop-enter-from,
.app-select-pop-leave-to {
  opacity: 0;
  transform: translateY(-3px) scale(0.985);
}

@media (prefers-reduced-motion: reduce) {
  .app-select-indicator,
  .app-select-option,
  .app-select-pop-enter-active,
  .app-select-pop-leave-active {
    transition: none;
  }
}
</style>
