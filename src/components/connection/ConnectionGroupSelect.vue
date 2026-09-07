<script setup lang="ts">
import { computed } from 'vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { useConnections } from '@/composables/useConnections'
import type { ConnectionGroupKind } from '@/types/connection'

const props = defineProps<{ kind: ConnectionGroupKind }>()
const model = defineModel<string>({ required: true })
const { groupsFor } = useConnections()
const options = computed(() => {
  const names = groupsFor(props.kind)
    .filter(group => !(group.virtual && group.name === 'Ungrouped'))
    .map(group => group.name)
  // 编辑旧连接时，即使分组尚未同步，也保留其原有归属。
  if (model.value && !names.includes(model.value)) names.push(model.value)
  return [
    { value: '', label: '未分组' },
    ...names.map(name => ({ value: name, label: name })),
  ]
})
</script>

<template>
  <AppSelect
    v-model="model"
    label="Group"
    :options="options"
    searchable
  />
</template>
