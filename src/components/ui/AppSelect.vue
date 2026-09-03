<script setup lang="ts">
import type { CSSProperties } from 'vue'
import { computed, nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue'
import { useEventListener } from '@vueuse/core'
import AppIcon from './AppIcon.vue'

interface SelectOption {
  value: string
  label: string
  description?: string
  disabled?: boolean
}

const props = withDefaults(defineProps<{
  label: string
  options: readonly SelectOption[]
  placeholder?: string
  required?: boolean
  disabled?: boolean
}>(), {
  placeholder: '请选择',
  required: false,
  disabled: false,
})

const model = defineModel<string>({ required: true })
const trigger = useTemplateRef<HTMLButtonElement>('trigger')
const menu = useTemplateRef<HTMLElement>('menu')
const open = shallowRef(false)
const activeIndex = shallowRef(-1)
const menuStyle = shallowRef<CSSProperties>({})
const labelId = useId()
const listboxId = useId()

const selectedOption = computed(() => (
  props.options.find(option => option.value === model.value)
))

const activeOptionId = computed(() => (
  open.value && activeIndex.value >= 0
    ? `${listboxId}-option-${activeIndex.value}`
    : undefined
))

function enabledIndexFrom(start: number, step: 1 | -1): number {
  if (!props.options.length)
    return -1

  let index = start
  for (let checked = 0; checked < props.options.length; checked += 1) {
    index = (index + step + props.options.length) % props.options.length
    if (!props.options[index]?.disabled)
      return index
  }

  return -1
}

function setInitialActiveIndex(): void {
  const selectedIndex = props.options.findIndex(option => option.value === model.value && !option.disabled)
  activeIndex.value = selectedIndex >= 0 ? selectedIndex : enabledIndexFrom(-1, 1)
}

function updatePosition(): void {
  const element = trigger.value
  if (!element || !open.value)
    return

  const rect = element.getBoundingClientRect()
  const viewportPadding = 8
  const gap = 6
  const desiredHeight = Math.min(240, props.options.length * 38 + 8)
  const roomBelow = window.innerHeight - rect.bottom - viewportPadding - gap
  const roomAbove = rect.top - viewportPadding - gap
  const placeAbove = roomBelow < Math.min(120, desiredHeight) && roomAbove > roomBelow
  const availableHeight = Math.max(72, placeAbove ? roomAbove : roomBelow)
  const width = Math.min(rect.width, window.innerWidth - viewportPadding * 2)
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - viewportPadding - width,
  )

  menuStyle.value = {
    left: `${left}px`,
    width: `${width}px`,
    maxHeight: `${Math.min(240, availableHeight)}px`,
    ...(placeAbove
      ? { bottom: `${window.innerHeight - rect.top + gap}px` }
      : { top: `${rect.bottom + gap}px` }),
  }
}

async function openMenu(): Promise<void> {
  if (props.disabled || !props.options.length)
    return

  setInitialActiveIndex()
  open.value = true
  await nextTick()
  updatePosition()
}

function closeMenu(): void {
  open.value = false
  activeIndex.value = -1
}

function toggleMenu(): void {
  if (open.value)
    closeMenu()
  else
    void openMenu()
}

function selectOption(option: SelectOption): void {
  if (option.disabled)
    return

  model.value = option.value
  closeMenu()
  trigger.value?.focus()
}

function moveActive(step: 1 | -1): void {
  activeIndex.value = enabledIndexFrom(activeIndex.value, step)
}

function moveToBoundary(boundary: 'first' | 'last'): void {
  activeIndex.value = boundary === 'first'
    ? enabledIndexFrom(-1, 1)
    : enabledIndexFrom(0, -1)
}

function handleKeydown(event: KeyboardEvent): void {
  switch (event.key) {
    case 'ArrowDown':
    case 'ArrowUp':
      event.preventDefault()
      if (!open.value)
        void openMenu()
      else
        moveActive(event.key === 'ArrowDown' ? 1 : -1)
      break
    case 'Home':
    case 'End':
      event.preventDefault()
      if (!open.value)
        void openMenu()
      moveToBoundary(event.key === 'Home' ? 'first' : 'last')
      break
    case 'Enter':
    case ' ':
      event.preventDefault()
      if (!open.value) {
        void openMenu()
      }
      else {
        const option = props.options[activeIndex.value]
        if (option)
          selectOption(option)
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
  if (!target || trigger.value?.contains(target) || menu.value?.contains(target))
    return

  closeMenu()
})

useEventListener(window, 'resize', updatePosition)
useEventListener(window, 'scroll', updatePosition, { capture: true, passive: true })

watch(() => props.disabled, (disabled) => {
  if (disabled)
    closeMenu()
})
</script>

<template>
  <div class="space-y-1.5">
    <label :id="labelId" class="block text-[11px] font-medium text-txt-2">
      {{ label }}
      <span v-if="required" class="text-violet" aria-hidden="true">*</span>
    </label>

    <button
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
      class="app-select-trigger field h-[34px] w-full cursor-pointer justify-between text-left disabled:pointer-events-none disabled:opacity-45"
      @click="toggleMenu"
      @keydown="handleKeydown"
    >
      <span :class="['min-w-0 flex-1 truncate text-xs', selectedOption ? 'text-txt' : 'text-txt-4']">
        {{ selectedOption?.label ?? placeholder }}
      </span>
      <AppIcon
        name="lucide:chevron-down"
        :size="14"
        :class="['shrink-0 text-txt-4 transition-transform duration-150', open && 'rotate-180']"
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
          class="app-select-menu fixed z-100 overflow-y-auto border border-line-strong p-1 shadow-pop scroll-thin"
        >
          <div
            v-for="(option, index) in options"
            :id="`${listboxId}-option-${index}`"
            :key="option.value"
            role="option"
            :aria-selected="model === option.value"
            :aria-disabled="option.disabled || undefined"
            :class="[
              'app-select-option flex min-h-8 items-center gap-2 px-2 py-1.5 text-left',
              index === activeIndex && 'app-select-option-active',
              model === option.value && 'app-select-option-selected',
              option.disabled && 'pointer-events-none opacity-40',
            ]"
            @pointerenter="!option.disabled && (activeIndex = index)"
            @pointerdown.prevent="selectOption(option)"
          >
            <span class="min-w-0 flex-1">
              <span class="block truncate text-xs text-txt">{{ option.label }}</span>
              <span v-if="option.description" class="mt-0.5 block truncate text-[10px] text-txt-3">
                {{ option.description }}
              </span>
            </span>
            <AppIcon
              v-if="model === option.value"
              name="lucide:check"
              :size="13"
              class="shrink-0 text-violet"
            />
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
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 12%, transparent);
}

.app-select-menu {
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-panel) 90%, transparent);
  backdrop-filter: blur(24px) saturate(165%);
  -webkit-backdrop-filter: blur(24px) saturate(165%);
}

.app-select-option {
  cursor: pointer;
  border-radius: 6px;
  color: var(--color-txt-2);
  transition: background-color 120ms ease, color 120ms ease;
}

.app-select-option-active {
  background: var(--color-hover);
}

.app-select-option-selected {
  background: color-mix(in oklch, var(--color-violet) 12%, var(--color-card));
}

.app-select-pop-enter-active,
.app-select-pop-leave-active {
  transition: opacity 120ms ease;
}

.app-select-pop-enter-from,
.app-select-pop-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .app-select-trigger svg,
  .app-select-option,
  .app-select-pop-enter-active,
  .app-select-pop-leave-active {
    transition: none;
  }
}
</style>
