<script setup lang="ts">
import ConnectionWindow from '@/components/connection/ConnectionWindow.vue'
import SettingsWindow from '@/components/settings/SettingsWindow.vue'
import SplashWindow from '@/components/splash/SplashWindow.vue'
import ToastHost from '@/components/ui/ToastHost.vue'
import MainWindow from '@/components/workspace/MainWindow.vue'

const windowSurface = new URLSearchParams(window.location.search).get('window')
</script>

<template>
  <SplashWindow v-if="windowSurface === 'splash'" />
  <template v-else>
    <ConnectionWindow v-if="windowSurface === 'connection'" />
    <SettingsWindow v-else-if="windowSurface === 'settings'" />
    <MainWindow v-else />
    <ToastHost />
  </template>
</template>
