<script setup lang="ts">
import { useEventListener } from '@vueuse/core'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const props = defineProps<{
  open: boolean
  fileName: string
  remaining: number
}>()

const always = defineModel<boolean>('always', { required: true })
const emit = defineEmits<{
  overwrite: []
  skip: []
  cancel: []
}>()

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (props.open && event.key === 'Escape') {
    event.preventDefault()
    emit('cancel')
  }
})
</script>

<template>
  <Teleport to="body">
    <Transition name="file-conflict">
      <div
        v-if="open"
        class="file-conflict-backdrop"
        @click.self="emit('cancel')"
      >
        <section
          class="file-conflict-dialog"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="file-conflict-title"
        >
          <div
            class="bg-amber/12 text-amber grid size-9 shrink-0 place-items-center rounded-lg"
          >
            <AppIcon
              name="lucide:files"
              :size="18"
            />
          </div>
          <div class="min-w-0 flex-1">
            <h2
              id="file-conflict-title"
              class="text-txt text-[13px] font-semibold"
            >
              远端已有同名文件
            </h2>
            <p class="text-txt-3 mt-1 text-[11px] leading-4 break-all">
              “{{ fileName }}”已经存在。要覆盖远端文件，还是跳过本次上传？
            </p>
            <AppCheckbox
              v-if="remaining > 0"
              v-model="always"
              class="mt-3"
              label="总是执行本次选择"
              :description="`应用到本批次后续 ${remaining} 个文件的同名冲突`"
            />
          </div>
          <footer class="col-span-2 mt-2 flex justify-end gap-2">
            <AppButton
              size="sm"
              @click="emit('cancel')"
              >取消全部</AppButton
            >
            <AppButton
              size="sm"
              @click="emit('skip')"
              >跳过</AppButton
            >
            <AppButton
              size="sm"
              variant="primary"
              autofocus
              @click="emit('overwrite')"
              >覆盖</AppButton
            >
          </footer>
        </section>
      </div>
    </Transition>
  </Teleport>
</template>

<style scoped>
.file-conflict-backdrop {
  position: fixed;
  inset: 0;
  z-index: 115;
  display: grid;
  place-items: center;
  background: rgb(0 0 0 / 0.48);
  padding: 24px;
  backdrop-filter: blur(3px);
}

.file-conflict-dialog {
  display: grid;
  width: min(410px, 100%);
  grid-template-columns: auto minmax(0, 1fr);
  gap: 11px;
  border: 1px solid var(--color-line-strong);
  border-radius: 11px;
  background: color-mix(in oklch, var(--color-panel) 94%, transparent);
  box-shadow: var(--shadow-pop);
  padding: 16px;
}

.file-conflict-enter-active,
.file-conflict-leave-active {
  transition: opacity 130ms ease;
}

.file-conflict-enter-from,
.file-conflict-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .file-conflict-enter-active,
  .file-conflict-leave-active {
    transition: none;
  }
}
</style>
