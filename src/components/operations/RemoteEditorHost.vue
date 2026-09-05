<script setup lang="ts">
import { defineAsyncComponent } from "vue";
import { useRemoteEditor } from "@/composables/useRemoteEditor";
const Editor = defineAsyncComponent(() => import("./RemoteTextEditor.vue"));
const editor = useRemoteEditor();
</script>
<template>
  <Editor
    v-if="editor.state.request"
    v-bind="editor.state.request"
    @close="editor.close"
  />
</template>
