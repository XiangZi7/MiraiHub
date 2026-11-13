<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed } from 'vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import { useConnections } from '@/composables/useConnections'
import type { ConnectionGroupKind } from '@/types/connection'

const { t } = useI18n()

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
    { value: '', label: t('未分组') },
    ...names.map(name => ({ value: name, label: name })),
  ]
})
</script>

<template>
  <!-- 连接分组选择：在当前值和候选项中显示图标。 -->
  <AppSelect
    icon="lucide:folder"
    v-model="model"
    :label="t('Group')"
    :options="options"
    searchable
  />
</template>
