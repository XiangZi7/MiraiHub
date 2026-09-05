<script setup lang="ts">
import {
  nextTick,
  onBeforeUnmount,
  onMounted,
  useId,
  useTemplateRef,
} from 'vue'
import { useEventListener } from '@vueuse/core'
import IconButton from '@/components/ui/IconButton.vue'
const props = withDefaults(
  defineProps<{
    title: string
    wide?: boolean
    busy?: boolean
    standalone?: boolean
  }>(),
  { wide: false, busy: false, standalone: false }
)
const emit = defineEmits<{ close: [] }>()
const titleId = useId()
const dialog = useTemplateRef<HTMLElement>('dialog')
let previous: HTMLElement | null = null
onMounted(async () => {
  previous = document.activeElement as HTMLElement
  await nextTick()
  dialog.value?.focus()
})
onBeforeUnmount(() => previous?.focus())
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (document.querySelector('[role=alertdialog]')) return
  if (event.key === 'Escape') {
    event.preventDefault()
    event.stopPropagation()
    if (!props.busy) emit('close')
  }
  if (event.key === 'Tab' && dialog.value) {
    const controls = [
      ...dialog.value.querySelectorAll<HTMLElement>(
        'button:not([disabled]),input:not([disabled]),textarea:not([disabled]),select:not([disabled]),[tabindex="0"]'
      ),
    ].filter(e => e.getClientRects().length)
    const first = controls[0],
      last = controls.at(-1)
    if (
      event.shiftKey &&
      (document.activeElement === first ||
        document.activeElement === dialog.value)
    ) {
      event.preventDefault()
      last?.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first?.focus()
    }
  }
})
</script>
<template>
  <Teleport
    to="body"
    :disabled="standalone"
    ><div
      class="operation-backdrop"
      :class="standalone && 'operation-window'"
    >
      <section
        ref="dialog"
        class="operation-dialog"
        :class="wide && 'wide'"
        :role="standalone ? 'region' : 'dialog'"
        :aria-modal="standalone ? undefined : true"
        :aria-labelledby="titleId"
        tabindex="-1"
      >
        <header>
          <h2 :id="titleId">{{ title }}</h2>
          <div class="flex-1" />
          <IconButton
            icon="lucide:x"
            :size="16"
            title="关闭"
            :disabled="busy"
            @click="emit('close')"
          />
        </header>
        <div class="operation-body scroll-thin"><slot /></div>
      </section></div
  ></Teleport>
</template>
<style scoped>
.operation-backdrop {
  --operation-inset: 22px;
  position: fixed;
  inset: 0;
  z-index: 100;
  display: grid;
  place-items: center;
  background: #0008;
  backdrop-filter: blur(5px);
  padding: var(--operation-inset);
}
.operation-dialog {
  display: flex;
  flex-direction: column;
  width: min(800px, 100%);
  max-height: calc(100dvh - var(--operation-inset) * 2);
  min-height: min(250px, calc(100dvh - var(--operation-inset) * 2));
  min-width: 0;
  overflow: hidden;
  border: 1px solid var(--color-line-strong);
  border-radius: 12px;
  background: var(--color-panel);
  box-shadow: 0 20px 80px #0008;
  color: var(--color-txt);
  outline: none;
}
.operation-dialog.wide {
  width: min(1100px, 100%);
  height: calc(100dvh - 70px);
}
.operation-dialog > header {
  display: flex;
  align-items: center;
  gap: 10px;
  flex-shrink: 0;
  padding: 12px 18px;
  border-bottom: 1px solid var(--color-line-soft);
  font-size: 14px;
  font-weight: 600;
}
.operation-body {
  padding: 18px;
  overflow: auto;
  min-height: 0;
  min-width: 0;
  overscroll-behavior: contain;
  display: flex;
  flex: 1;
  flex-direction: column;
  gap: 14px;
  font-size: 12px;
}
.operation-window {
  position: static;
  width: 100%;
  height: 100%;
  padding: 0;
  background: var(--color-panel);
  backdrop-filter: none;
}
.operation-window .operation-dialog.wide {
  width: 100%;
  height: 100%;
  max-height: none;
  min-height: 0;
  border: 0;
  border-radius: 0;
  box-shadow: none;
}
@media (max-width: 700px) {
  .operation-backdrop {
    --operation-inset: 12px;
  }
  .operation-window .operation-body {
    padding: 12px;
    gap: 10px;
  }
}
</style>
