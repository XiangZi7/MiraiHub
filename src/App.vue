<script setup lang="ts">
import ConnectionWindow from '@/components/connection/ConnectionWindow.vue'
import MainWindow from '@/components/workspace/MainWindow.vue'

const windowSurface = new URLSearchParams(window.location.search).get('window')
</script>

<template>
  <ConnectionWindow v-if="windowSurface === 'connection'" />
  <MainWindow v-else />
</template>
