<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, onMounted, reactive, toRefs } from 'vue'
import { useEventListener } from '@vueuse/core'
import * as api from '@/api/column-tags'
import AppButton from '@/components/ui/AppButton.vue'
import BrandLogo from '@/components/ui/BrandLogo.vue'
import IconButton from '@/components/ui/IconButton.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import WindowResizeHandles from '@/components/ui/WindowResizeHandles.vue'
import DatabaseColumnTagEditor from '@/components/workspace/database/DatabaseColumnTagEditor.vue'
import { toast } from '@/composables/useToast'
import type { ColumnTagConfig } from '@/types/database'
import { closeWindow, IS_TAURI } from '@/utils/window'

const { t } = useI18n()

/**
 * 列「标签化显示」的原生设置窗口。
 * 要编辑的列由 Rust 按窗口身份提供，保存结果也经 Rust 转给主窗口，不走 URL。
 */
// 响应式状态
const state = reactive({
  // 原生窗口身份对应的列与初始标签配置。
  target: null as api.ColumnTagsRequest | null,
  // 初始列信息读取失败时展示失败状态，异常详情交给公共通知。
  loadFailed: false,
  // 防止重复提交；成功后原生端会关闭本窗口。
  saving: false,
})
const { target, loadFailed, saving } = toRefs(state)

const title = computed(() =>
  state.target
    ? t('标签化显示：{value0}', { value0: state.target.column })
    : t('标签化显示')
)

/** 取消列标签配置并关闭当前设置窗口，保留主窗口的原有配置。 */
function closeDialog(): void {
  if (IS_TAURI) {
    closeWindow()
    return
  }
  window.close()
}

/** 提交标签配置或取消标签显示，失败时恢复提交按钮并通过公共通知反馈。 */
async function submit(config: ColumnTagConfig | null): Promise<void> {
  if (state.saving) return
  state.saving = true
  try {
    // Rust 把结果转给主窗口后会关闭本窗口，这里不必再关。
    await api.columnTagsSubmit(config)
  } catch (error) {
    state.saving = false
    toast.error({ title: t('操作失败'), description: api.errorMessage(error) })
  }
}

// 挂载后从 Rust 窗口注册表读取目标列，初始化失败时展示可关闭的空状态。
onMounted(async () => {
  try {
    state.target = await api.columnTagsTarget()
  } catch (error) {
    state.loadFailed = true
    toast.error({
      title: t('无法打开标签设置窗口'),
      description: api.errorMessage(error),
    })
  }
})

// 标签设置窗口支持 Esc 取消，监听在页面卸载时自动清理。
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
        v-if="!target"
        class="text-txt-3 px-4 pt-3 text-[11px]"
      >
        {{ t('把匹配的单元格值显示为彩色标签，只改变显示，不会修改数据。') }}
      </p>
      <DatabaseColumnTagEditor
        v-if="target"
        :column="target.column"
        :initial="target.initial"
        :sample-values="target.sampleValues"
        :saving="saving"
        @cancel="closeDialog"
        @submit="submit"
      />
      <div
        v-else
        class="text-txt-4 flex flex-1 flex-col items-center justify-center gap-4 text-xs"
      >
        <p>
          {{ loadFailed ? t('无法打开标签设置窗口') : t('正在读取列信息…') }}
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
