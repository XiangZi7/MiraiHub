<script setup lang="ts">
import { open as openDialog } from '@tauri-apps/plugin-dialog'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppSwitch from '@/components/ui/AppSwitch.vue'
import { DEFAULT_SETTINGS } from '@/types/settings'
import type {
  EditableSettingField,
  SettingField,
  SettingKey,
  SettingValue,
  SettingsPage,
  SettingsValues,
} from '@/types/settings'
import { IS_TAURI } from '@/utils/window'
import ScaleControl from './ScaleControl.vue'
import ShortcutRecorder from './ShortcutRecorder.vue'

const props = withDefaults(defineProps<{
  page: SettingsPage
  values: SettingsValues
  /** 校验失败的项及原因 */
  errors?: Partial<Record<SettingKey, string>>
  /** 关于页等展示项的运行时取值，按 field.id 覆盖 */
  runtimeValues?: Record<string, string>
}>(), {
  errors: () => ({}),
  runtimeValues: () => ({}),
})

const emit = defineEmits<{
  update: [key: SettingKey, value: SettingValue]
}>()

function stringValue(key: SettingKey): string {
  const value = props.values[key]
  return typeof value === 'string' ? value : ''
}

function booleanValue(key: SettingKey): boolean {
  return props.values[key] === true
}

function defaultString(key: SettingKey): string {
  const value = DEFAULT_SETTINGS[key]
  return typeof value === 'string' ? value : ''
}

/** 依赖的开关关闭时整行禁用，避免出现"最小化到托盘"却没有托盘的组合。 */
function isDisabled(field: SettingField): boolean {
  return field.control !== 'display' && Boolean(field.dependsOn) && !booleanValue(field.dependsOn!)
}

function updateText(field: EditableSettingField, event: Event): void {
  emit('update', field.key, (event.target as HTMLInputElement).value)
}

function controlWidth(size: EditableSettingField['size']): string {
  switch (size) {
    case 'lg':
      return 'w-52'
    case 'md':
      return 'w-28'
    default:
      return 'w-20'
  }
}

async function browseDirectory(field: EditableSettingField): Promise<void> {
  if (!IS_TAURI)
    return

  const selected = await openDialog({
    directory: true,
    multiple: false,
    title: field.label,
    defaultPath: stringValue(field.key) || undefined,
  })
  if (typeof selected === 'string')
    emit('update', field.key, selected)
}

function displayValue(field: SettingField): string {
  if (field.control !== 'display')
    return ''
  return (field.id && props.runtimeValues[field.id]) || field.displayValue
}
</script>

<template>
  <section class="flex min-h-0 flex-1 flex-col" :aria-labelledby="`settings-${page.id}-title`">
    <header class="settings-page-header">
      <h2 :id="`settings-${page.id}-title`" class="text-[12.5px] font-semibold text-txt">
        {{ page.title }}
      </h2>
      <p v-if="page.description" class="mt-0.5 text-[10.5px] text-txt-4">
        {{ page.description }}
      </p>
    </header>

    <div class="min-h-0 flex-1 overflow-y-auto scroll-thin">
      <section v-for="group in page.groups" :key="group.title" class="settings-group">
        <h3 class="settings-group-title">
          {{ group.title }}
        </h3>

        <div class="settings-rows">
          <div
            v-for="field in group.fields"
            :key="field.label"
            :class="['settings-row', isDisabled(field) && 'settings-row-disabled']"
          >
            <div class="min-w-0 flex-1 pr-4">
              <p class="text-[11.5px] leading-4 text-txt">
                {{ field.label }}
              </p>
              <p v-if="field.description" class="mt-0.5 text-[10px] leading-3.5 text-txt-4">
                {{ field.description }}
              </p>
              <p
                v-if="field.control !== 'display' && errors[field.key]"
                class="mt-0.5 text-[10px] leading-3.5 text-danger"
                role="alert"
              >
                {{ errors[field.key] }}
              </p>
            </div>

            <template v-if="field.control === 'display'">
              <span class="shrink-0 font-mono text-[11px] text-txt-3">{{ displayValue(field) }}</span>
            </template>

            <template v-else>
              <AppSwitch
                v-if="field.control === 'switch'"
                :model-value="booleanValue(field.key)"
                :label="field.label"
                :disabled="isDisabled(field)"
                hide-label
                @update:model-value="emit('update', field.key, $event)"
              />

              <AppSelect
                v-else-if="field.control === 'select'"
                :model-value="stringValue(field.key)"
                :label="field.label"
                :options="field.options ?? []"
                :disabled="isDisabled(field)"
                hide-label
                compact
                :class="['shrink-0', controlWidth(field.size)]"
                @update:model-value="emit('update', field.key, $event)"
              />

              <ScaleControl v-else-if="field.control === 'scale'" :model-value="stringValue(field.key)" :label="field.label" @update:model-value="emit('update', field.key, $event)" />

              <ShortcutRecorder
                v-else-if="field.control === 'shortcut'"
                :model-value="stringValue(field.key)"
                :label="field.label"
                :default-value="defaultString(field.key)"
                :disabled="isDisabled(field)"
                @update:model-value="emit('update', field.key, $event)"
              />

              <div v-else-if="field.control === 'directory'" class="flex shrink-0 items-center gap-1">
                <input
                  :value="stringValue(field.key)"
                  :aria-label="field.label"
                  :placeholder="field.placeholder"
                  :class="['settings-input', controlWidth(field.size)]"
                  :disabled="isDisabled(field)"
                  spellcheck="false"
                  @input="updateText(field, $event)"
                >
                <button
                  v-if="stringValue(field.key)"
                  type="button"
                  class="icon-btn size-6"
                  title="清除"
                  aria-label="清除目录"
                  @click="emit('update', field.key, '')"
                >
                  <AppIcon name="lucide:x" :size="12" />
                </button>
                <button
                  type="button"
                  class="icon-btn size-6 disabled:pointer-events-none disabled:opacity-35"
                  title="选择目录"
                  aria-label="选择目录"
                  :disabled="!IS_TAURI || isDisabled(field)"
                  @click="browseDirectory(field)"
                >
                  <AppIcon name="lucide:folder-open" :size="13" />
                </button>
              </div>

              <input
                v-else
                :value="stringValue(field.key)"
                :aria-label="field.label"
                :aria-invalid="Boolean(errors[field.key]) || undefined"
                :placeholder="field.placeholder"
                :inputmode="field.inputmode ?? 'text'"
                :class="['settings-input', controlWidth(field.size), errors[field.key] && 'settings-input-invalid']"
                :disabled="isDisabled(field)"
                spellcheck="false"
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
  min-height: 52px;
  flex-shrink: 0;
  flex-direction: column;
  justify-content: center;
  border-bottom: 1px solid var(--color-line-soft);
  background: color-mix(in oklch, var(--color-card) 26%, transparent);
  padding: 8px 18px;
}

.settings-group {
  padding: 10px 18px 14px;
}

.settings-group + .settings-group {
  border-top: 1px solid var(--color-line-soft);
}

.settings-group-title {
  margin-bottom: 4px;
  padding: 0 2px;
  color: var(--color-txt-4);
  font-size: 9.5px;
  font-weight: 650;
  letter-spacing: 0.09em;
  text-transform: uppercase;
}

.settings-rows {
  overflow: hidden;
  border: 1px solid var(--color-line-soft);
  border-radius: 9px;
  background: color-mix(in oklch, var(--color-card) 55%, transparent);
  box-shadow: var(--shadow-card);
}

.settings-row {
  display: flex;
  min-height: 42px;
  align-items: center;
  justify-content: space-between;
  padding: 7px 12px;
  transition: opacity 150ms ease;
}

.settings-row + .settings-row {
  border-top: 1px solid var(--color-line-soft);
}

.settings-row-disabled {
  opacity: 0.45;
}

.settings-input {
  height: 28px;
  flex-shrink: 0;
  border: 1px solid var(--color-line);
  border-radius: 7px;
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

.settings-input:disabled {
  pointer-events: none;
}

.settings-input-invalid,
.settings-input-invalid:focus-visible {
  border-color: color-mix(in oklch, var(--color-danger) 70%, transparent);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-danger) 12%, transparent);
}

@container settings (max-width: 560px) {
  .settings-row { flex-wrap: wrap; gap: 8px; }
  .settings-row > div:first-child { flex-basis: 100%; }
  .settings-page-header, .settings-group { padding-right: 10px; padding-left: 10px; }
}

@media (prefers-reduced-motion: reduce) {
  .settings-row,
  .settings-input {
    transition: none;
  }
}
</style>
