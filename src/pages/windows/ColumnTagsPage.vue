<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, onMounted, reactive } from 'vue'
import { useEventListener } from '@vueuse/core'
import * as api from '@/api/column-tags'
import AppButton from '@/components/ui/AppButton.vue'
import BrandLogo from '@/components/ui/BrandLogo.vue'
import IconButton from '@/components/ui/IconButton.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import WindowResizeHandles from '@/components/ui/WindowResizeHandles.vue'
import DatabaseColumnTagEditor from '@/components/workspace/database/DatabaseColumnTagEditor.vue'
import type { ColumnTagConfig } from '@/types/database'
import { closeWindow, IS_TAURI } from '@/utils/window'

const { t } = useI18n()

/**
 * 列「标签化显示」的原生设置窗口。
 * 要编辑的列由 Rust 按窗口身份提供，保存结果也经 Rust 转给主窗口，不走 URL。
 */
const state = reactive({
  target: null as api.ColumnTagsRequest | null,
  error: '',
  saving: false,
})

const title = computed(() =>
  state.target
    ? t('标签化显示：{value0}', { value0: state.target.column })
    : t('标签化显示')
)

function closeDialog(): void {
  if (IS_TAURI) {
    closeWindow()
    return
  }
  window.close()
}

async function submit(config: ColumnTagConfig | null): Promise<void> {
  if (state.saving) return
  state.saving = true
  state.error = ''
  try {
    // Rust 把结果转给主窗口后会关闭本窗口，这里不必再关。
    await api.columnTagsSubmit(config)
  } catch (error) {
    state.error = api.errorMessage(error)
    state.saving = false
  }
}

onMounted(async () => {
  try {
    state.target = await api.columnTagsTarget()
  } catch (error) {
    state.error = api.errorMessage(error)
  }
})

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') closeDialog()
})
</script>

<template>
  <WindowFrame
    class="dialog-window h-screen w-screen"
    role="dialog"
    aria-modal="true"
    aria-labelledby="column-tags-title"
  >
    <header
      class="column-tags-titlebar relative z-10"
      data-tauri-drag-region
    >
      <BrandLogo />
      <h1
        id="column-tags-title"
        class="text-txt min-w-0 flex-1 truncate text-[13px] font-semibold tracking-tight"
        data-tauri-drag-region
      >
        {{ title }}
      </h1>
      <IconButton
        icon="lucide:x"
        :size="16"
        :title="t('关闭 (Esc)')"
        @click="closeDialog"
      />
    </header>

    <main class="relative z-10 flex min-h-0 flex-1 flex-col">
      <p
        v-if="!state.target"
        class="text-txt-3 px-4 pt-3 text-[11px]"
      >
        {{ t('把匹配的单元格值显示为彩色标签，只改变显示，不会修改数据。') }}
      </p>
      <p
        v-if="state.error"
        role="alert"
        class="text-danger px-4 pt-3 text-[11px] break-words"
      >
        {{ state.error }}
      </p>
      <DatabaseColumnTagEditor
        v-if="state.target"
        :column="state.target.column"
        :initial="state.target.initial"
        :sample-values="state.target.sampleValues"
        :saving="state.saving"
        @cancel="closeDialog"
        @submit="submit"
      />
      <div
        v-else
        class="text-txt-4 flex flex-1 flex-col items-center justify-center gap-4 text-xs"
      >
        <p>
          {{ state.error ? t('无法打开标签设置窗口') : t('正在读取列信息…') }}
        </p>
        <AppButton @click="closeDialog">
          {{ t('关闭窗口') }}
        </AppButton>
      </div>
    </main>
    <WindowResizeHandles />
  </WindowFrame>
</template>

<style scoped>
.column-tags-titlebar {
  display: flex;
  height: 48px;
  flex-shrink: 0;
  align-items: center;
  gap: 9px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 0 12px 0 14px;
}
</style>
