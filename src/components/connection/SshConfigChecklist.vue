<script setup lang="ts">
import { computed } from 'vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import type { SshConfigTransferItem } from '@/types/ssh-config-transfer'

const props = defineProps<{
  items: readonly SshConfigTransferItem[]
  disabled?: boolean
}>()
const selectedIds = defineModel<string[]>({ required: true })

const allSelected = computed({
  get: () =>
    props.items.length > 0 &&
    props.items.every(item => selectedIds.value.includes(item.id)),
  set: selected => {
    selectedIds.value = selected ? props.items.map(item => item.id) : []
  },
})

function setSelected(id: string, selected: boolean): void {
  const next = new Set(selectedIds.value)
  if (selected) next.add(id)
  else next.delete(id)
  selectedIds.value = [...next]
}

function authLabel(type: SshConfigTransferItem['authType']): string {
  return {
    password: '密码',
    privateKey: '私钥',
    agent: 'SSH Agent',
  }[type]
}
</script>

<template>
  <div class="ssh-config-checklist">
    <div class="ssh-config-checklist-header">
      <AppCheckbox
        v-model="allSelected"
        :label="`全选（${selectedIds.length}/${items.length}）`"
        :disabled="disabled || !items.length"
      />
    </div>

    <div
      v-if="items.length"
      class="scroll-thin ssh-config-checklist-items"
    >
      <div
        v-for="item in items"
        :key="item.id"
        class="ssh-config-checklist-row"
      >
        <AppCheckbox
          :model-value="selectedIds.includes(item.id)"
          :label="`选择 ${item.name}`"
          hide-label
          :disabled="disabled"
          @update:model-value="setSelected(item.id, $event)"
        />
        <AppIcon
          name="lucide:server"
          :size="14"
          class="text-txt-3 shrink-0"
        />
        <span class="min-w-0 flex-1">
          <span class="text-txt block truncate text-[11.5px]">{{
            item.name
          }}</span>
          <span class="text-txt-4 mt-0.5 block truncate font-mono text-[9.5px]">
            {{ item.username }}@{{ item.host }}:{{ item.port }}
          </span>
        </span>
        <span
          v-if="item.group"
          class="ssh-config-checklist-group"
          :title="item.group"
        >
          {{ item.group }}
        </span>
        <span class="text-txt-3 shrink-0 text-[9.5px]">
          {{ authLabel(item.authType) }}
        </span>
      </div>
    </div>

    <p
      v-else
      class="text-txt-4 px-3 py-8 text-center text-[11px]"
    >
      没有可选择的 SSH 配置
    </p>
  </div>
</template>

<style scoped>
.ssh-config-checklist {
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 8px;
}

.ssh-config-checklist-header {
  border-bottom: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-panel) 82%, transparent);
  padding: 8px 10px;
}

.ssh-config-checklist-items {
  max-height: 280px;
  overflow-y: auto;
}

.ssh-config-checklist-row {
  display: flex;
  min-height: 46px;
  cursor: pointer;
  align-items: center;
  gap: 8px;
  border-bottom: 1px solid var(--color-line-soft);
  padding: 6px 10px;
}

.ssh-config-checklist-row:last-child {
  border-bottom: 0;
}

.ssh-config-checklist-row:hover {
  background: var(--color-hover);
}

.ssh-config-checklist-group {
  max-width: 92px;
  overflow: hidden;
  border: 1px solid var(--color-line);
  border-radius: 999px;
  padding: 2px 6px;
  color: var(--color-txt-3);
  font-size: 9px;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
