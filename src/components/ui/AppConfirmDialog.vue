<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import AppButton from './AppButton.vue'
import AppIcon from './AppIcon.vue'

const props = withDefaults(defineProps<{
  open: boolean
  title: string
  description: string
  confirmLabel?: string
  danger?: boolean
}>(), {
  confirmLabel: '确认',
  danger: false,
})

const emit = defineEmits<{
  close: []
  confirm: []
}>()

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (props.open && event.key === 'Escape') {
    event.preventDefault()
    emit('close')
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="confirm-dialog">
      <div v-if="open" class="app-confirm-backdrop" @click.self="emit('close')">
        <section class="app-confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="confirm-title">
          <div :class="['app-confirm-icon', danger && 'app-confirm-icon-danger']">
            <AppIcon :name="danger ? 'lucide:triangle-alert' : 'lucide:circle-help'" :size="18" />
          </div>
          <div class="min-w-0 flex-1">
            <h2 id="confirm-title" class="text-[13px] font-semibold text-txt">
              {{ title }}
            </h2>
            <p class="mt-1 text-[11px] leading-4 text-txt-3">
              {{ description }}
            </p>
          </div>
          <footer class="col-span-2 mt-2 flex justify-end gap-2">
            <AppButton size="sm" autofocus @click="emit('close')">
              取消
            </AppButton>
            <AppButton size="sm" :class="danger ? 'app-confirm-danger-button' : ''" @click="emit('confirm')">
              {{ confirmLabel }}
            </AppButton>
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.app-confirm-backdrop {
  position: fixed;
  inset: 0;
  z-index: 110;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.48);
  padding: 24px;
  backdrop-filter: blur(3px);
}

.app-confirm-dialog {
  display: grid;
  width: min(360px, 100%);
  grid-template-columns: auto minmax(0, 1fr);
  gap: 10px;
  border: 1px solid var(--color-line-strong);
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-panel) 92%, transparent);
  box-shadow: var(--shadow-pop);
  padding: 15px;
  backdrop-filter: blur(28px) saturate(170%);
}

.app-confirm-icon {
  display: grid;
  width: 32px;
  height: 32px;
  place-items: center;
  border-radius: 8px;
  background: color-mix(in oklch, var(--color-violet) 14%, transparent);
  color: var(--color-violet);
}

.app-confirm-icon-danger {
  background: color-mix(in oklch, var(--color-danger) 13%, transparent);
  color: var(--color-danger);
}

.app-confirm-danger-button {
  border-color: color-mix(in oklch, var(--color-danger) 45%, var(--color-line));
  background: color-mix(in oklch, var(--color-danger) 16%, var(--color-card));
  color: var(--color-danger);
}

.confirm-dialog-enter-active,
.confirm-dialog-leave-active {
  transition: opacity 120ms ease;
}

.confirm-dialog-enter-from,
.confirm-dialog-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .confirm-dialog-enter-active,
  .confirm-dialog-leave-active {
    transition: none;
  }
}
</style>
