<script setup lang="ts">
import AppSelect from '@/components/ui/AppSelect.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import type {
  EditableSettingField,
  SettingKey,
  SettingValue,
  SettingsPage,
  SettingsValues,
} from '@/types/settings'

defineProps<{
  page: SettingsPage
  values: SettingsValues
}>()

const emit = defineEmits<{
  update: [key: SettingKey, value: SettingValue]
}>()

function stringValue(values: SettingsValues, key: SettingKey): string {
  const value = values[key]
  return typeof value === 'string' ? value : ''
}

function booleanValue(values: SettingsValues, key: SettingKey): boolean {
  return values[key] === true
}

function updateText(field: EditableSettingField, event: Event): void {
  emit('update', field.key, (event.target as HTMLInputElement).value)
}

function controlWidth(size: EditableSettingField['size']): string {
  switch (size) {
    case 'lg':
      return 'w-40'
    case 'md':
      return 'w-24'
    default:
      return 'w-20'
  }
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" :aria-labelledby="`settings-${page.id}-title`">
    <header class="settings-page-header">
      <h2 :id="`settings-${page.id}-title`" class="text-xs font-semibold text-txt">
        {{ page.title }}
      </h2>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto scroll-thin">
      <section v-for="group in page.groups" :key="group.title" class="settings-group">
        <h3 v-if="group.title !== page.title" class="settings-group-title">
          {{ group.title }}
        </h3>

        <div class="px-5">
          <div v-for="field in group.fields" :key="field.label" class="settings-row">
            <div class="min-w-0 pr-4">
              <p class="text-[11px] leading-4 text-txt-2">
                {{ field.label }}
              </p>
              <p v-if="field.description" class="mt-0.5 text-[9.5px] leading-3.5 text-txt-4">
                {{ field.description }}
              </p>
            </div>

            <template v-if="field.control === 'display'">
              <span class="shrink-0 text-[11px] text-txt-3">{{ field.displayValue }}</span>
            </template>

            <template v-else>
              <AppSwitch
                v-if="field.control === 'switch'"
                :model-value="booleanValue(values, field.key)"
                :label="field.label"
                hide-label
                @update:model-value="emit('update', field.key, $event)"
              />

              <AppSelect
                v-else-if="field.control === 'select'"
                :model-value="stringValue(values, field.key)"
                :label="field.label"
                :options="field.options ?? []"
                hide-label
                compact
                :class="controlWidth(field.size)"
                @update:model-value="emit('update', field.key, $event)"
              />

              <input
                v-else
                :value="stringValue(values, field.key)"
                :aria-label="field.label"
                :placeholder="field.placeholder"
                :inputmode="field.inputmode ?? 'text'"
                :class="['settings-input', controlWidth(field.size), field.control === 'shortcut' && 'settings-shortcut']"
                @input="updateText(field, $event)"
              >
            </template>
          </div>
        </div>
      </section>
    </div>
  </section>
</template>

<style scoped>
.settings-page-header {
  display: flex;
  height: 42px;
  flex-shrink: 0;
  align-items: center;
  border-bottom: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-card) 26%, transparent);
  padding: 0 15px;
}

.settings-group + .settings-group {
  border-top: 1px solid var(--color-line-soft);
}

.settings-group-title {
  display: flex;
  min-height: 31px;
  align-items: center;
  background: color-mix(in oklch, var(--color-card) 22%, transparent);
  padding: 0 20px;
  color: var(--color-txt-2);
  font-size: 10.5px;
  font-weight: 600;
}

.settings-row {
  display: flex;
  min-height: 31px;
  align-items: center;
  justify-content: space-between;
}

.settings-input {
  height: 28px;
  flex-shrink: 0;
  border: 1px solid var(--color-line);
  border-radius: 6px;
  background: color-mix(in oklch, var(--color-panel) 82%, transparent);
  padding: 0 9px;
  color: var(--color-txt);
  font-size: 11px;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.settings-input::placeholder {
  color: var(--color-txt-4);
}

.settings-input:focus-visible {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 12%, transparent);
}

.settings-shortcut {
  color: var(--color-txt-2);
  font-family: var(--font-mono);
  text-align: center;
}

@media (prefers-reduced-motion: reduce) {
  .settings-input {
    transition: none;
  }
}
</style>
