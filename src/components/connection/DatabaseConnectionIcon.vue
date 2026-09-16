<script setup lang="ts">
import { computed } from 'vue'
import type { DatabaseConnectionKind } from '@/types/database'
import AppIcon from '@/components/ui/AppIcon.vue'
import { DATABASE_CONNECTION_ICONS } from '@/constants/connection'

const props = defineProps<{ kind: DatabaseConnectionKind }>()
const icon = computed(() => DATABASE_CONNECTION_ICONS[props.kind])
</script>

<template>
  <span
    class="database-connection-icon"
    role="img"
    :aria-label="icon.label"
    :title="icon.label"
  >
    <AppIcon
      :name="icon.name"
      :size="18"
    />
  </span>
</template>

<style scoped>
.database-connection-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 18px;
  height: 18px;
  flex-shrink: 0;
}
</style>
