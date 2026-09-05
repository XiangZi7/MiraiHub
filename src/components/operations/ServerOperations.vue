<script setup lang="ts">
import { defineAsyncComponent, reactive, toRefs } from "vue";
import IconButton from "@/components/ui/IconButton.vue";
const TunnelManagerDialog = defineAsyncComponent(
  () => import("./TunnelManagerDialog.vue"),
);
const BatchOperationDialog = defineAsyncComponent(
  () => import("./BatchOperationDialog.vue"),
);
defineProps<{ sessionId?: string }>();
const state = reactive({ tunnels: false, batch: false });
const { tunnels, batch } = toRefs(state);
</script>
<template>
  <div class="flex items-center gap-0.5">
    <IconButton
      icon="lucide:network"
      :size="14"
      title="SSH 隧道 / 端口转发"
      @click="tunnels = true"
    /><IconButton
      icon="lucide:layers"
      :size="14"
      title="批量服务器操作"
      @click="batch = true"
    /><TunnelManagerDialog
      v-if="tunnels"
      :preferred-session-id="sessionId"
      @close="tunnels = false"
    /><BatchOperationDialog v-if="batch" @close="batch = false" />
  </div>
</template>
