<script setup lang="ts">
import AppIcon from '@/components/ui/AppIcon.vue'
import { useToast, type ToastTone } from '@/composables/useToast'

const { toasts, dismiss, pause, resume } = useToast()

const toneMeta: Record<ToastTone, { icon: string, label: string }> = {
  success: { icon: 'lucide:check', label: '成功' },
  error: { icon: 'lucide:x', label: '错误' },
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
          :style="{ '--toast-duration': `${item.duration}ms` }"
          :role="item.tone === 'error' ? 'alert' : 'status'"
          aria-atomic="true"
          @mouseenter="pause(item.id)"
          @mouseleave="resume(item.id)"
        >
          <span class="toast-glow" aria-hidden="true" />

          <div class="toast-icon" aria-hidden="true">
            <AppIcon :name="toneMeta[item.tone].icon" :size="item.tone === 'warning' || item.tone === 'info' ? 14 : 13" />
          </div>

          <div class="toast-copy">
            <span class="sr-only">{{ toneMeta[item.tone].label }}：</span>
            <p class="toast-title">{{ item.title }}</p>
            <p v-if="item.description" class="toast-description scroll-thin">{{ item.description }}</p>
          </div>

          <button
            type="button"
            class="toast-close"
            :aria-label="`关闭${toneMeta[item.tone].label}通知`"
            title="关闭"
            @click="dismiss(item.id)"
          >
            <AppIcon name="lucide:x" :size="13" />
          </button>

          <span v-if="item.duration > 0" class="toast-progress" aria-hidden="true" />
        </article>
      </TransitionGroup>
    </section>
  </Teleport>
</template>

<style scoped>
/* 右下角堆叠：不遮挡标题栏工具与标签页，也是桌面应用的通行位置 */
.toast-viewport {
  position: fixed;
  right: 18px;
  bottom: 18px;
  z-index: 200;
  width: min(352px, calc(100vw - 36px));
  pointer-events: none;
}

.toast-list {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.toast-card {
  --toast-tone: var(--color-violet);

  position: relative;
  display: grid;
  grid-template-columns: auto minmax(0, 1fr) auto;
  align-items: start;
  column-gap: 10px;
  overflow: hidden;
  border: 1px solid color-mix(in oklch, var(--toast-tone) 24%, var(--color-line-strong));
  border-radius: 12px;
  background: color-mix(in oklch, var(--color-panel) 94%, transparent);
  box-shadow:
    0 22px 44px -18px rgb(0 0 0 / 0.72),
    0 2px 8px rgb(0 0 0 / 0.28),
    inset 0 1px 0 rgb(255 255 255 / 0.07);
  padding: 11px 10px 12px 12px;
  pointer-events: auto;
  backdrop-filter: blur(30px) saturate(175%);
  -webkit-backdrop-filter: blur(30px) saturate(175%);
}

.toast-card-success { --toast-tone: var(--color-success); }
.toast-card-error { --toast-tone: var(--color-danger); }
.toast-card-warning { --toast-tone: var(--color-amber); }

/* 左上角一抹同色辉光，替代粗重的左边框来标示语义 */
.toast-glow {
  position: absolute;
  top: -40px;
  left: -30px;
  width: 150px;
  height: 120px;
  pointer-events: none;
  border-radius: 999px;
  background: radial-gradient(
    closest-side,
    color-mix(in oklch, var(--toast-tone) 22%, transparent),
    transparent
  );
}

.toast-icon {
  position: relative;
  display: grid;
  width: 26px;
  height: 26px;
  margin-top: 1px;
  place-items: center;
  border-radius: 999px;
  background: color-mix(in oklch, var(--toast-tone) 18%, transparent);
  color: var(--toast-tone);
  box-shadow:
    inset 0 0 0 1px color-mix(in oklch, var(--toast-tone) 34%, transparent),
    0 0 14px color-mix(in oklch, var(--toast-tone) 22%, transparent);
}

.toast-copy {
  position: relative;
  min-width: 0;
  padding-top: 4px;
}

.toast-title {
  color: var(--color-txt);
  font-size: 12px;
  font-weight: 600;
  line-height: 1.35;
  letter-spacing: -0.005em;
  overflow-wrap: anywhere;
}

.toast-description {
  max-height: 96px;
  overflow-y: auto;
  margin-top: 3px;
  color: var(--color-txt-3);
  font-size: 10.5px;
  line-height: 1.5;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.toast-close {
  position: relative;
  display: grid;
  width: 24px;
  height: 24px;
  cursor: pointer;
  place-items: center;
  border-radius: 6px;
  color: var(--color-txt-4);
  opacity: 0;
  transition: background-color 150ms ease, color 150ms ease, opacity 150ms ease;
}

.toast-card:hover .toast-close,
.toast-card:focus-within .toast-close {
  opacity: 1;
}

.toast-close:hover,
.toast-close:focus-visible {
  background: var(--color-hover);
  color: var(--color-txt);
  opacity: 1;
  outline: none;
}

/* 底部倒计时：与 JS 定时器同源的时长，悬停时两边一起暂停 */
.toast-progress {
  position: absolute;
  right: 0;
  bottom: 0;
  left: 0;
  height: 2px;
  background: linear-gradient(90deg, var(--toast-tone), color-mix(in oklch, var(--toast-tone) 55%, transparent));
  transform-origin: left center;
  animation: toast-drain var(--toast-duration, 4000ms) linear forwards;
}

.toast-card:hover .toast-progress {
  animation-play-state: paused;
}

@keyframes toast-drain {
  from { transform: scaleX(1); }
  to { transform: scaleX(0); }
}

.toast-list-enter-active {
  transition: opacity 220ms cubic-bezier(0.2, 0.8, 0.2, 1), transform 260ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.toast-list-leave-active {
  transition: opacity 160ms ease, transform 160ms ease;
}

.toast-list-move {
  transition: transform 240ms cubic-bezier(0.2, 0.8, 0.2, 1);
}

.toast-list-enter-from {
  opacity: 0;
  transform: translateX(28px) scale(0.96);
}

.toast-list-leave-to {
  opacity: 0;
  transform: translateY(6px) scale(0.97);
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

  .toast-progress {
    animation: none;
    transform: scaleX(1);
  }
}
</style>
