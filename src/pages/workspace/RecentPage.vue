<script setup lang="ts">
import RecentView from '@/components/workspace/RecentView.vue'
import { useWorkspaceNavigation } from '@/composables/useWorkspaceNavigation'
const { openConnection } = useWorkspaceNavigation()
</script>
<template><RecentView @open="openConnection" /></template>
