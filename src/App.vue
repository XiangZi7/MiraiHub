<script setup lang="ts">
import { defineAsyncComponent, onMounted } from 'vue'
import ConnectionWindow from '@/components/connection/ConnectionWindow.vue'
import SettingsWindow from '@/components/settings/SettingsWindow.vue'
import SplashWindow from '@/components/splash/SplashWindow.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import MainWindow from '@/components/workspace/MainWindow.vue'
import { appReady } from '@/utils/window'

const RemoteEditorWindow = defineAsyncComponent(() => import('@/components/operations/RemoteEditorWindow.vue'))
const windowSurface = new URLSearchParams(window.location.search).get('window')

onMounted(() => {
  if (!windowSurface)
    void appReady()
})
</script>

<template>
  <SplashWindow v-if="windowSurface === 'splash'" />
  <template v-else>
    <ConnectionWindow v-if="windowSurface === 'connection'" />
    <SettingsWindow v-else-if="windowSurface === 'settings'" />
    <RemoteEditorWindow v-else-if="windowSurface === 'remote-editor'" />
    <MainWindow v-else />
    <ToastHost />
  </template>
</template>
