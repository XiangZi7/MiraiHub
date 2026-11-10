<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, shallowRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import BrandLogo from '@/components/ui/BrandLogo.vue'
import IconButton from '@/components/ui/IconButton.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import { closeWindow, IS_TAURI } from '@/utils/window'
import DatabaseConnectionForm from '@/pages/connection/components/database-connection-form.vue'
import LocalConnectionForm from '@/pages/connection/components/local-connection-form.vue'
import SshConnectionForm from '@/pages/connection/components/ssh-connection-form.vue'

const { t } = useI18n()

const props = withDefaults(
  defineProps<{ kind: string; connectionId: string; group?: string }>(),
  { group: '' }
)
const isDatabase = computed(() => props.kind === 'database')
const isLocal = computed(() => props.kind === 'local')
const databaseKind = shallowRef<'mysql' | 'postgresql' | 'sqlite' | 'redis'>(
  'mysql'
)
const title = computed(() =>
  props.connectionId
    ? isDatabase.value
      ? 'Edit Database Connection'
      : isLocal.value
        ? 'Edit Local Terminal'
        : 'Edit SSH Connection'
    : isDatabase.value
      ? 'Add Database Connection'
      : isLocal.value
        ? 'Add Local Terminal'
        : 'Add SSH Connection'
)

/** 关闭连接配置窗口，桌面端走原生窗口入口，浏览器预览关闭当前窗口。 */
function closeDialog(): void {
  if (IS_TAURI) {
    closeWindow()
    return
  }

  window.close()
}

// 配置窗口支持 Esc 关闭；监听随页面卸载自动清理。
useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape') closeDialog()
})
</script>

<template>
  <WindowFrame class="dialog-window h-screen w-screen">
    <header
      class="connection-titlebar relative z-10"
      data-tauri-drag-region
    >
      <BrandLogo />
      <h1
        id="connection-window-title"
        class="text-txt text-[13px] font-semibold tracking-tight"
      >
        {{ title }}
      </h1>
      <div
        class="flex-1"
        data-tauri-drag-region
      />
      <IconButton
        icon="lucide:x"
        :size="16"
        :title="t('关闭')"
        @click="closeDialog"
      />
    </header>

    <main class="relative z-10 flex min-h-0 flex-1 flex-col">
      <LocalConnectionForm
        v-if="isLocal"
        :connection-id="connectionId"
        :default-group="group"
        @close="closeDialog"
      />
      <SshConnectionForm
        v-else-if="!isDatabase"
        :connection-id="connectionId"
        :default-group="group"
        @close="closeDialog"
      />
      <DatabaseConnectionForm
        v-else
        v-model:kind="databaseKind"
        :connection-id="connectionId"
        :default-group="group"
        @close="closeDialog"
      />
    </main>
  </WindowFrame>
</template>

<style scoped>
.connection-titlebar {
  display: flex;
  height: 48px;
  flex-shrink: 0;
  align-items: center;
  gap: 9px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 0 12px 0 14px;
}
</style>
