<script setup lang="ts">
import { computed, nextTick, shallowRef, useId, useTemplateRef, watch } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import IconButton from '@/components/ui/IconButton.vue'
import { useStartupCommandPresets } from '@/composables/useStartupCommandPresets'
import { toast } from '@/composables/useToast'

const command = defineModel<string>({ required: true })
const { presets, save, remove } = useStartupCommandPresets()

const selectedId = shallowRef('')
const naming = shallowRef(false)
const presetName = shallowRef('')
const nameInput = useTemplateRef<HTMLInputElement>('presetName')
const commandId = useId()

const presetOptions = computed(() => [
  { value: '', label: '不使用预设', description: '保留当前输入的命令' },
  ...presets.value.map(preset => ({
    value: preset.id,
    label: preset.name,
    description: preset.command,
  })),
])

watch(selectedId, (id) => {
  const preset = presets.value.find(item => item.id === id)
  if (preset)
    command.value = preset.command
})

async function beginSave(): Promise<void> {
  if (!command.value.trim()) {
    toast.warning('先填写初始化命令')
    return
  }

  const selected = presets.value.find(item => item.id === selectedId.value)
  presetName.value = selected?.name ?? ''
  naming.value = true
  await nextTick()
  nameInput.value?.focus()
  nameInput.value?.select()
}

async function savePreset(): Promise<void> {
  const name = presetName.value.trim()
  const value = command.value.trim()
  if (!name || !value)
    return

  const preset = await save(name, value)
  selectedId.value = preset.id
  naming.value = false
  toast.success(`预设“${preset.name}”已保存`)
}

async function removePreset(): Promise<void> {
  if (!selectedId.value)
    return

  await remove(selectedId.value)
  selectedId.value = ''
  toast.success('预设已删除，当前命令保留')
}
</script>

<template>
  <fieldset class="startup-command-field">
    <legend class="mb-1.5 block text-[11px] font-medium text-txt-2">
      Initialization Command
    </legend>

    <div class="grid grid-cols-[minmax(0,1fr)_auto_auto] items-end gap-2">
      <AppSelect
        v-model="selectedId"
        label="初始化命令预设"
        :options="presetOptions"
        hide-label
      />
      <IconButton icon="lucide:save" title="把当前命令保存为预设" @click="beginSave" />
      <IconButton
        icon="lucide:trash-2"
        title="删除选中的预设"
        :disabled="!selectedId"
        @click="removePreset"
      />
    </div>

    <form v-if="naming" class="mt-2 flex items-center gap-2" @submit.prevent="savePreset">
      <input
        ref="presetName"
        v-model="presetName"
        class="preset-name-input"
        placeholder="预设名称，例如：进入项目并启动 tmux"
        aria-label="初始化命令预设名称"
        maxlength="64"
        @keydown.esc.prevent="naming = false"
      >
      <AppButton size="sm" variant="primary" type="submit">
        保存预设
      </AppButton>
      <AppButton size="sm" @click="naming = false">
        取消
      </AppButton>
    </form>

    <textarea
      :id="commandId"
      v-model="command"
      class="command-input mt-2"
      rows="3"
      placeholder="e.g. cd /srv/app && tmux attach || tmux"
      spellcheck="false"
    />

    <p class="mt-1.5 text-[10.5px] text-txt-4">SSH shell 就绪后自动执行；预设保存在本机。</p>
  </fieldset>
</template>

<style scoped>
.startup-command-field {
  min-width: 0;
}

.preset-name-input,
.command-input {
  min-width: 0;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: color-mix(in oklch, var(--color-panel) 88%, transparent);
  color: var(--color-txt);
  font-size: 12px;
  outline: none;
  transition: border-color 150ms ease, box-shadow 150ms ease;
}

.preset-name-input {
  height: 32px;
  flex: 1;
  padding: 0 9px;
}

.command-input {
  width: 100%;
  resize: vertical;
  padding: 8px 10px;
  font-family: "JetBrains Mono Variable", ui-monospace, monospace;
  line-height: 1.45;
}

.preset-name-input::placeholder,
.command-input::placeholder {
  color: var(--color-txt-4);
}

.preset-name-input:focus,
.command-input:focus {
  border-color: color-mix(in oklch, var(--color-violet) 62%, white 8%);
  box-shadow: 0 0 0 3px color-mix(in oklch, var(--color-violet) 12%, transparent);
}
</style>
