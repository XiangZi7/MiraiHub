<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { useToast, type ToastTone } from '@/composables/useToast'

const { toasts, dismiss, pause, resume } = useToast()

const toneMeta: Record<ToastTone, { icon: string, label: string }> = {
  success: { icon: 'lucide:circle-check', label: '成功' },
  error: { icon: 'lucide:circle-alert', label: '错误' },
  warning: { icon: 'lucide:triangle-alert', label: '警告' },
  info: { icon: 'lucide:info', label: '提示' },
}

</script>

<template>
  <Teleport to="body">
    <section
      class="toast-viewport"
      aria-label="通知"
      aria-live="polite"
      aria-relevant="additions"
    >
      <TransitionGroup name="toast-list" tag="div" class="toast-list">
        <article
          v-for="item in toasts"
          :key="item.id"
          :class="['toast-card', `toast-card-${item.tone}`]"
          :role="item.tone === 'error' ? 'alert' : 'status'"
          aria-atomic="true"
          @mouseenter="pause(item.id)"
          @mouseleave="resume(item.id)"
        >
          <div class="toast-icon" aria-hidden="true">
            <AppIcon :name="toneMeta[item.tone].icon" :size="17" />
          </div>
          <div class="toast-copy">
            <span class="sr-only">{{ toneMeta[item.tone].label }}：</span>
            <p class="toast-title">{{ item.title }}</p>
            <p v-if="item.description" class="toast-description">{{ item.description }}</p>
          </div>
          <button
            type="button"
            class="toast-close"
            :aria-label="`关闭${toneMeta[item.tone].label}通知`"
            title="关闭"
            @click="dismiss(item.id)"
          >
            <AppIcon name="lucide:x" :size="14" />
          </button>
        </article>
      </TransitionGroup>
    </section>
  </Teleport>
</template>

<style scoped>
.toast-viewport {
  position: fixed;
  top: 52px;
  right: 16px;
  z-index: 200;
  width: min(360px, calc(100vw - 32px));
  pointer-events: none;
}

.toast-list {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.toast-card {
  --toast-tone: var(--color-violet);
  display: grid;
  grid-template-columns: 32px minmax(0, 1fr) 26px;
  align-items: start;
  gap: 9px;
  overflow: hidden;
  border: 1px solid color-mix(in oklch, var(--toast-tone) 30%, var(--color-line));
  border-left: 3px solid var(--toast-tone);
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-panel) 92%, transparent);
  box-shadow: var(--shadow-pop);
  padding: 11px 10px;
  pointer-events: auto;
  backdrop-filter: blur(28px) saturate(170%);
  -webkit-backdrop-filter: blur(28px) saturate(170%);
}

.toast-card-success { --toast-tone: var(--color-success); }
.toast-card-error { --toast-tone: var(--color-danger); }
.toast-card-warning { --toast-tone: var(--color-amber); }

.toast-icon {
  display: grid;
  width: 30px;
  height: 30px;
  place-items: center;
  border-radius: 8px;
  background: color-mix(in oklch, var(--toast-tone) 13%, transparent);
  color: var(--toast-tone);
}

.toast-copy {
  min-width: 0;
  padding-top: 1px;
}

.toast-title {
  color: var(--color-txt);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.45;
  overflow-wrap: anywhere;
}

.toast-description {
  max-height: 112px;
  overflow-y: auto;
  margin-top: 3px;
  color: var(--color-txt-3);
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.toast-close {
  display: grid;
  width: 26px;
  height: 26px;
  cursor: pointer;
  place-items: center;
  border-radius: 6px;
  color: var(--color-txt-4);
  transition: background-color 150ms ease, color 150ms ease;
}

.toast-close:hover,
.toast-close:focus-visible {
  background: var(--color-hover);
  color: var(--color-txt);
  outline: none;
}

.toast-list-enter-active,
.toast-list-leave-active,
.toast-list-move {
  transition: opacity 180ms ease, transform 180ms ease;
}

.toast-list-enter-from,
.toast-list-leave-to {
  opacity: 0;
  transform: translateX(18px);
}

.toast-list-leave-active {
  position: absolute;
  right: 0;
  left: 0;
}

@media (prefers-reduced-motion: reduce) {
  .toast-list-enter-active,
  .toast-list-leave-active,
  .toast-list-move,
  .toast-close {
    transition: none;
  }
}
</style>
