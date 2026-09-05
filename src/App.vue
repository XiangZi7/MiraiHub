<script setup lang="ts">
import { RouterView, useRoute } from 'vue-router'
import { ref } from 'vue'
import { useEventListener } from '@vueuse/core'
import ToastHost from '@/components/ui/ToastHost.vue'
const route = useRoute()
const settingsVisit = ref(0)
const settingsHidden = ref(false)
useEventListener(window, 'miraihub:settings-hidden', () => {
  settingsHidden.value = true
})
useEventListener(window, 'miraihub:settings-reopen', () => {
  settingsVisit.value++
  settingsHidden.value = false
})
</script>

<template>
  <RouterView v-slot="{ Component }">
    <component
      v-if="route.meta.surface !== 'settings' || !settingsHidden"
      :is="Component"
      :key="
        route.name === 'connection'
          ? route.fullPath
          : route.meta.surface === 'settings'
            ? `settings-${settingsVisit}`
            : route.meta.surface
      "
    />
  </RouterView>
  <ToastHost v-if="route.meta.surface !== 'splash'" />
</template>
