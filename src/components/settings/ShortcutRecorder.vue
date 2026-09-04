<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { formatShortcut, shortcutFromEvent } from '@/utils/shortcut'

/**
 * 快捷键录制框。
 *
 * 聚焦后按下组合键即完成录入；Esc 取消，Backspace / Delete 恢复默认值。
 * 不做全局冲突检测：四条快捷键都在设置页里一眼可见，重复时用户自己能看出来。
 */

const props = defineProps<{
  label: string
  defaultValue: string
  disabled?: boolean
}>()

const model = defineModel<string>({ required: true })
const recording = shallowRef(false)
const pending = shallowRef('')

const parts = computed(() => formatShortcut(model.value).split('+'))
const isDefault = computed(() => model.value === props.defaultValue)

function stop(event?: Event): void {
  recording.value = false
  pending.value = ''
  if (event?.target instanceof HTMLElement)
    event.target.blur()
}

function modifiersLabel(event: KeyboardEvent): string {
  const held: string[] = []
  if (event.ctrlKey)
    held.push('Ctrl')
  if (event.altKey)
    held.push('Alt')
  if (event.shiftKey)
    held.push('Shift')
  if (event.metaKey)
    held.push('Meta')
  return held.length ? `${held.join(' + ')} + …` : ''
}

function handleKeydown(event: KeyboardEvent): void {
  event.preventDefault()
  event.stopPropagation()

  if (event.key === 'Escape') {
    stop(event)
    return
  }

  if (event.key === 'Backspace' || event.key === 'Delete') {
    model.value = props.defaultValue
    stop(event)
    return
  }

  const value = shortcutFromEvent(event)
  if (value) {
    model.value = value
    stop(event)
    return
  }

  pending.value = modifiersLabel(event)
}
</script>

<template>
  <div class="flex items-center gap-1.5">
    <button
      type="button"
      :class="['shortcut-field', recording && 'shortcut-field-recording']"
      :aria-label="`${label}：当前为 ${formatShortcut(model)}，按下新的组合键修改`"
      :disabled="disabled"
      @focus="recording = true"
      @blur="stop()"
      @keydown="handleKeydown"
    >
      <span v-if="recording" class="shortcut-hint">{{ pending || '按下组合键…' }}</span>
      <template v-else>
        <template v-for="(part, index) in parts" :key="`${part}-${index}`">
          <kbd class="shortcut-key">{{ part }}</kbd>
          <span v-if="index < parts.length - 1" class="shortcut-plus">+</span>
        </template>
      </template>
    </button>
    <button
      type="button"
      class="icon-btn size-6 disabled:pointer-events-none disabled:opacity-30"
      title="恢复默认"
      aria-label="恢复默认快捷键"
      :disabled="disabled || isDefault"
      @click="model = defaultValue"
    >
      <AppIcon name="lucide:rotate-ccw" :size="12" />
    </button>
  </div>
</template>

<style scoped>
.shortcut-field {
  display: inline-flex;
  min-width: 150px;
  height: 28px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 4px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-panel) 82%, transparent);
  padding: 0 8px;
  color: var(--color-txt-2);
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease, background-color 150ms ease;
}

.shortcut-field:hover {
  border-color: var(--color-line-strong);
}

.shortcut-field:disabled {
  cursor: default;
  opacity: 0.45;
}

.shortcut-field-recording {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  background: color-mix(in oklch, var(--color-violet) 10%, var(--color-panel));
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 12%, transparent);
}

.shortcut-hint {
  color: var(--color-violet);
  font-size: 10.5px;
  font-weight: 500;
}

.shortcut-key {
  display: inline-flex;
  min-width: 20px;
  height: 18px;
  align-items: center;
  justify-content: center;
  border: 1px solid var(--color-line-strong);
  border-bottom-width: 2px;
  border-radius: 4px;
  background: var(--color-card);
  padding: 0 5px;
  color: var(--color-txt);
  font-family: var(--font-mono);
  font-size: 10px;
  line-height: 1;
}

.shortcut-plus {
  color: var(--color-txt-4);
  font-size: 10px;
}

@media (prefers-reduced-motion: reduce) {
  .shortcut-field {
    transition: none;
  }
}
</style>
