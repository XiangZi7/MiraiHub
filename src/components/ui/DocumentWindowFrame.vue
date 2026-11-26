<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import WindowControls from '@/components/ui/WindowControls.vue'

defineProps<{
  title: string
  meta?: string
  dirty?: boolean
  closeAction?: () => void
}>()
const { t } = useI18n()
</script>

<template>
  <main
    class="document-window"
    :aria-label="title"
  >
    <header
      class="document-window-titlebar"
      data-tauri-drag-region
    >
      <div
        class="document-window-heading"
        data-tauri-drag-region
      >
        <h1
          class="document-window-title"
          data-tauri-drag-region
        >
          {{ title }}
        </h1>
        <span
          v-if="meta"
          class="document-window-meta"
          data-tauri-drag-region
          >{{ meta }}</span
        >
        <span
          v-if="dirty"
          class="document-window-dot"
          :title="t('未保存')"
        />
      </div>
      <!-- 文档操作：SSH 文件使用保存，Docker 日志使用刷新。 -->
      <slot name="actions" />
      <!-- 共享的原生窗口按钮保持最小化、最大化/还原和关闭的标准顺序。 -->
      <WindowControls :close-action="closeAction" />
    </header>
    <div class="document-window-body"><slot /></div>
  </main>
</template>

<style scoped>
.document-window {
  box-sizing: border-box;
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
  border: 1px solid var(--color-line-strong);
  background: var(--color-window);
}
.document-window-body {
  display: flex;
  flex: 1;
  flex-direction: column;
  min-height: 0;
}
.document-window-titlebar {
  display: flex;
  align-items: center;
  flex: none;
  gap: 8px;
  height: 36px;
  padding-left: 14px;
  border-bottom: 1px solid var(--color-line-soft);
  user-select: none;
}
.document-window-heading {
  display: flex;
  flex: 1;
  align-items: center;
  gap: 8px;
  min-width: 0;
  overflow: hidden;
  white-space: nowrap;
}
.document-window-title {
  overflow: hidden;
  color: var(--color-txt);
  font-size: 13px;
  font-weight: 600;
  text-overflow: ellipsis;
}
.document-window-meta {
  overflow: hidden;
  color: var(--color-txt-3);
  font-family: var(--font-mono);
  font-size: 11px;
  text-overflow: ellipsis;
}
.document-window-dot {
  flex: none;
  width: 7px;
  height: 7px;
  border-radius: 9999px;
  background: var(--color-accent);
}
</style>
