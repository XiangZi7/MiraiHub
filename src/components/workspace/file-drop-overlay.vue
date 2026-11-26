<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'

defineProps<{ active: boolean; directory: string; local?: boolean }>()
const { t } = useI18n()
</script>

<template>
  <Transition name="drop-overlay">
    <div
      v-if="active"
      class="drop-overlay"
      role="status"
    >
      <div
        class="bg-violet/15 text-violet grid size-12 place-items-center rounded-xl"
      >
        <AppIcon
          :name="local ? 'lucide:copy' : 'lucide:cloud-upload'"
          :size="24"
        />
      </div>
      <p class="text-txt mt-3 text-[13px] font-semibold">
        {{ local ? t('松开即可复制') : t('松开即可上传') }}
      </p>
      <p class="text-txt-3 mt-1 max-w-full truncate px-3 text-[10.5px]">
        {{
          local ? directory : t('files.dropDestination', { path: directory })
        }}
      </p>
    </div>
  </Transition>
</template>

<style scoped>
.drop-overlay {
  position: absolute;
  inset: 8px;
  z-index: 30;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  border: 1px dashed color-mix(in oklch, var(--color-violet) 72%, transparent);
  border-radius: 10px;
  background: color-mix(in oklch, var(--color-panel) 89%, transparent);
  box-shadow: inset 0 0 40px
    color-mix(in oklch, var(--color-violet) 8%, transparent);
  backdrop-filter: blur(12px);
  pointer-events: none;
}

.drop-overlay-enter-active,
.drop-overlay-leave-active {
  transition: opacity 120ms ease;
}

.drop-overlay-enter-from,
.drop-overlay-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .drop-overlay-enter-active,
  .drop-overlay-leave-active {
    transition: none;
  }
}
</style>
