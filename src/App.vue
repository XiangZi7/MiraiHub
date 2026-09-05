<script setup lang="ts">
import { RouterView, useRoute } from "vue-router";
import ToastHost from "@/components/ui/ToastHost.vue";
const route = useRoute();
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component
      :is="Component"
      :key="route.name === 'connection' ? route.fullPath : route.meta.surface"
    />
  </RouterView>
  <ToastHost v-if="route.meta.surface !== 'splash'" />
</template>
