<script setup lang="ts">
import { shallowRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import BrandLogo from '@/components/ui/BrandLogo.vue'
import IconButton from '@/components/ui/IconButton.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import { closeWindow, IS_TAURI } from '@/utils/window'
import DatabaseConnectionForm from './DatabaseConnectionForm.vue'
import LocalConnectionForm from './LocalConnectionForm.vue'
import SshConnectionForm from './SshConnectionForm.vue'

const searchParams = new URLSearchParams(window.location.search)
const requestedKind = searchParams.get('type')
const connectionId = searchParams.get('connectionId') ?? ''
const isDatabase = requestedKind === 'database'
const isLocal = requestedKind === 'local'
const databaseKind = shallowRef<'mysql' | 'postgresql'>('mysql')
const title = connectionId
  ? isDatabase ? 'Edit Database Connection' : isLocal ? 'Edit Local Terminal' : 'Edit SSH Connection'
  : isDatabase ? 'Add Database Connection' : isLocal ? 'Add Local Terminal' : 'Add SSH Connection'

function closeDialog(): void {
  if (IS_TAURI) {
    closeWindow()
    return
  }

  window.close()
}

useEventListener(window, 'keydown', (event: KeyboardEvent) => {
  if (event.key === 'Escape')
    closeDialog()
})
</script>

<template>
  <WindowFrame ambient class="h-screen w-screen">
    <header class="connection-titlebar relative z-10" data-tauri-drag-region>
      <BrandLogo />
      <h1 id="connection-window-title" class="text-[13px] font-semibold tracking-tight text-txt">
        {{ title }}
      </h1>
      <div class="flex-1" data-tauri-drag-region />
      <IconButton icon="lucide:x" :size="16" title="关闭" @click="closeDialog" />
    </header>

    <main class="relative z-10 flex min-h-0 flex-1 flex-col">
      <LocalConnectionForm v-if="isLocal" :connection-id="connectionId" @close="closeDialog" />
      <SshConnectionForm v-else-if="!isDatabase" :connection-id="connectionId" @close="closeDialog" />
      <DatabaseConnectionForm
        v-else
        v-model:kind="databaseKind"
        :connection-id="connectionId"
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
