<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { useEventListener } from '@vueuse/core'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'

const { t } = useI18n()

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
      >
        <section
          class="overlay-surface file-conflict-dialog"
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
              {{ t('远端已有同名文件或文件夹') }}
            </h2>
            <p class="text-txt-3 mt-1 text-[11px] leading-4 break-all">
              {{ t('files.conflict', { name: fileName }) }}
            </p>
            <AppCheckbox
              v-if="remaining > 0"
              v-model="always"
              class="mt-3"
              :label="t('总是执行本次选择')"
              :description="
                t('应用到本批次后续 {value0} 个项目的同名冲突', {
                  value0: remaining,
                })
              "
            />
          </div>
          <footer class="col-span-2 mt-2 flex justify-end gap-2">
            <AppButton
              size="sm"
              @click="emit('cancel')"
            >
              {{ t('取消全部') }}
            </AppButton>
            <AppButton
              size="sm"
              @click="emit('skip')"
            >
              {{ t('跳过') }}
            </AppButton>
            <AppButton
              size="sm"
              variant="primary"
              autofocus
              @click="emit('overwrite')"
            >
              {{ t('合并 / 覆盖') }}
            </AppButton>
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
