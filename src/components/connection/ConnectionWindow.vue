<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import { useEventListener } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import BrandLogo from '@/components/ui/BrandLogo.vue'
import IconButton from '@/components/ui/IconButton.vue'
import WindowFrame from '@/components/ui/WindowFrame.vue'
import { closeWindow, IS_TAURI } from '@/utils/window'
import DatabaseConnectionForm from './DatabaseConnectionForm.vue'
import SshConnectionForm from './SshConnectionForm.vue'

type ConnectionKind = 'ssh' | 'mysql' | 'postgresql'

const connectionKinds: Array<{
  id: ConnectionKind
  label: string
  icon: string
}> = [
  { id: 'ssh', label: 'SSH', icon: 'lucide:terminal-square' },
  { id: 'mysql', label: 'MySQL', icon: 'lucide:database' },
  { id: 'postgresql', label: 'PostgreSQL', icon: 'lucide:cylinder' },
]

const requestedKind = new URLSearchParams(window.location.search).get('type')
const activeKind = shallowRef<ConnectionKind>(
  requestedKind === 'mysql' || requestedKind === 'postgresql' ? requestedKind : 'ssh',
)

const title = computed<string>(() => {
  if (activeKind.value === 'mysql')
    return 'Add MySQL Connection'
  if (activeKind.value === 'postgresql')
    return 'Add PostgreSQL Connection'
  return 'Add SSH Connection'
})

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
  <WindowFrame ambient class="connection-window h-screen w-screen rounded-[14px] border border-line-strong">
    <header class="connection-titlebar relative z-10" data-tauri-drag-region>
      <BrandLogo />
      <h1 id="connection-window-title" class="text-[13px] font-semibold tracking-tight text-txt">
        {{ title }}
      </h1>
      <div class="flex-1" data-tauri-drag-region />
      <IconButton icon="lucide:x" :size="16" title="关闭" @click="closeDialog" />
    </header>

    <nav
      class="connection-kinds relative z-10"
      role="tablist"
      aria-label="Connection type"
      aria-labelledby="connection-window-title"
    >
      <button
        v-for="kind in connectionKinds"
        :key="kind.id"
        type="button"
        role="tab"
        :aria-selected="activeKind === kind.id"
        :class="['connection-kind', activeKind === kind.id && 'connection-kind-active']"
        @click="activeKind = kind.id"
      >
        <AppIcon :name="kind.icon" :size="14" />
        <span>{{ kind.label }}</span>
      </button>
    </nav>

    <main class="relative z-10 flex min-h-0 flex-1 flex-col">
      <SshConnectionForm v-if="activeKind === 'ssh'" @close="closeDialog" />
      <DatabaseConnectionForm
        v-else
        :key="activeKind"
        :kind="activeKind"
        @close="closeDialog"
      />
    </main>
  </WindowFrame>
</template>

<style scoped>
.connection-window {
  background:
    linear-gradient(145deg, rgb(255 255 255 / 0.025), transparent 38%),
    color-mix(in oklch, var(--color-window) 96%, oklch(12% 0.012 278 / 0.96));
  box-shadow:
    0 28px 72px -22px rgb(0 0 0 / 0.78),
    inset 0 1px 0 rgb(255 255 255 / 0.1);
}

.connection-titlebar {
  display: flex;
  height: 48px;
  flex-shrink: 0;
  align-items: center;
  gap: 9px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 0 12px 0 14px;
}

.connection-kinds {
  display: flex;
  flex-shrink: 0;
  gap: 7px;
  border-bottom: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-panel) 26%, transparent);
  padding: 9px 18px;
}

.connection-kind {
  display: inline-flex;
  height: 30px;
  min-width: 104px;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 7px;
  border: 1px solid var(--color-line-soft);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-card) 45%, transparent);
  padding: 0 12px;
  color: var(--color-txt-3);
  font-size: 11.5px;
  transition:
    border-color 150ms ease,
    background-color 150ms ease,
    color 150ms ease,
    box-shadow 150ms ease;
}

.connection-kind:hover,
.connection-kind:focus-visible {
  border-color: var(--color-line-strong);
  color: var(--color-txt-2);
  outline: none;
}

.connection-kind-active {
  border-color: color-mix(in oklch, var(--color-violet) 65%, transparent);
  background: color-mix(in oklch, var(--color-violet) 14%, var(--color-card));
  color: var(--color-txt);
  box-shadow:
    inset 0 1px 0 rgb(255 255 255 / 0.05),
    0 0 16px color-mix(in oklch, var(--color-violet) 10%, transparent);
}

@media (prefers-reduced-motion: reduce) {
  .connection-kind {
    transition: none;
  }
}
</style>
