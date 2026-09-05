<script setup lang="ts">
import { computed, shallowRef } from "vue";
import { useEventListener } from "@vueuse/core";
import BrandLogo from "@/components/ui/BrandLogo.vue";
import IconButton from "@/components/ui/IconButton.vue";
import WindowFrame from "@/components/ui/WindowFrame.vue";
import { closeWindow, IS_TAURI } from "@/utils/window";
import DatabaseConnectionForm from "@/components/connection/DatabaseConnectionForm.vue";
import LocalConnectionForm from "@/components/connection/LocalConnectionForm.vue";
import SshConnectionForm from "@/components/connection/SshConnectionForm.vue";

const props = defineProps<{ kind: string; connectionId: string }>();
const isDatabase = computed(() => props.kind === "database");
const isLocal = computed(() => props.kind === "local");
const databaseKind = shallowRef<"mysql" | "postgresql">("mysql");
const title = computed(() =>
  props.connectionId
    ? isDatabase.value
      ? "Edit Database Connection"
      : isLocal.value
        ? "Edit Local Terminal"
        : "Edit SSH Connection"
    : isDatabase.value
      ? "Add Database Connection"
      : isLocal.value
        ? "Add Local Terminal"
        : "Add SSH Connection",
);

function closeDialog(): void {
  if (IS_TAURI) {
    closeWindow();
    return;
  }

  window.close();
}

useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if (event.key === "Escape") closeDialog();
});
</script>

<template>
  <WindowFrame class="h-screen w-screen">
    <header class="connection-titlebar relative z-10" data-tauri-drag-region>
      <BrandLogo />
      <h1
        id="connection-window-title"
        class="text-[13px] font-semibold tracking-tight text-txt"
      >
        {{ title }}
      </h1>
      <div class="flex-1" data-tauri-drag-region />
      <IconButton
        icon="lucide:x"
        :size="16"
        title="关闭"
        @click="closeDialog"
      />
    </header>

    <main class="relative z-10 flex min-h-0 flex-1 flex-col">
      <LocalConnectionForm
        v-if="isLocal"
        :connection-id="connectionId"
        @close="closeDialog"
      />
      <SshConnectionForm
        v-else-if="!isDatabase"
        :connection-id="connectionId"
        @close="closeDialog"
      />
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
