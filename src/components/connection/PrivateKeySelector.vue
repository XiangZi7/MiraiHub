<script setup lang="ts">
import { computed } from 'vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppTextField from '@/components/ui/AppTextField.vue'
import type { StoredPrivateKey } from '@/types/private-key'

const props = withDefaults(
  defineProps<{
    keys: readonly StoredPrivateKey[]
    defaultPath: string
    browsing?: boolean
  }>(),
  {
    browsing: false,
  }
)

const emit = defineEmits<{
  browse: []
  setDefault: [path: string]
  remember: [path: string]
}>()

const model = defineModel<string>({ required: true })

const options = computed(() =>
  props.keys.map(key => ({
    value: key.path,
    label:
      key.path === props.defaultPath ? `${key.label} · Default` : key.label,
  }))
)

const isDefault = computed({
  get: () => Boolean(model.value) && model.value === props.defaultPath,
  set: (enabled: boolean) => emit('setDefault', enabled ? model.value : ''),
})
</script>

<template>
  <div class="grid gap-3.5">
    <AppSelect
      v-model="model"
      label="Saved Private Keys"
      :options="options"
      :disabled="!keys.length"
      :placeholder="
        keys.length ? 'Choose a saved private key' : 'No private keys saved yet'
      "
    />

    <AppTextField
      v-model="model"
      label="Private Key Path"
      placeholder="C:\Users\you\.ssh\id_ed25519"
      action-icon="lucide:folder-open"
      :action-title="
        browsing
          ? 'Opening file picker…'
          : 'Choose one or more private key files'
      "
      :action-disabled="browsing"
      @action="emit('browse')"
      @blur="model.trim() && emit('remember', model.trim())"
    />

    <div class="flex min-h-5 items-start justify-between gap-4">
      <p class="text-txt-4 min-w-0 text-[10.5px] leading-4">
        {{ keys.length }} private
        {{ keys.length === 1 ? 'key' : 'keys' }} saved. The picker supports
        multiple selection.
      </p>
      <AppCheckbox
        v-model="isDefault"
        label="Default private key"
        :disabled="!model.trim()"
      />
    </div>
  </div>
</template>
