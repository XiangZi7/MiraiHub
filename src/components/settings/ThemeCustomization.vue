<script setup lang="ts">
import { computed, reactive, toRefs, useTemplateRef } from 'vue'
import { useI18n } from 'vue-i18n'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import ThemeColorControls from './ThemeColorControls.vue'
import AppSlider from '@/components/ui/AppSlider.vue'
import { readBackgroundImage, type SkinSettings } from '@/utils/skin'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { translateLabel } from '@/i18n'

const { t } = useI18n()

const props = defineProps<{ values: SkinSettings }>()
const emit = defineEmits<{ update: [patch: Partial<SkinSettings>] }>()
const fileInput = useTemplateRef<HTMLInputElement>('fileInput')
// Upload feedback stays local; the settings page owns the complete draft.
const state = reactive({ uploading: false, error: '' })
const { uploading, error } = toRefs(state)
const styleOptions = computed(() => [
  { value: 'builtin', label: t('主题内置样式') },
  { value: 'default', label: t('项目默认样式') },
  { value: 'custom', label: t('自定义配色') },
])

async function upload(event: Event): Promise<void> {
  const input = event.target as HTMLInputElement
  const file = input.files?.[0]
  input.value = ''
  if (!file || state.uploading) return
  state.uploading = true
  state.error = ''
  const uploadingTheme = props.values.skinTheme
  try {
    const image = await readBackgroundImage(file)
    if (props.values.skinTheme !== uploadingTheme) {
      state.error = t('已切换皮肤，请在目标皮肤中重新选择图片')
      return
    }
    emit('update', {
      skinBackground: 'custom',
      skinBackgroundImage: image,
      skinBackgroundName: file.name,
    })
  } catch (error) {
    state.error =
      error instanceof Error
        ? translateLabel(error.message)
        : t('图片读取失败，请重试')
  } finally {
    state.uploading = false
  }
}
</script>

<template>
  <div class="theme-customization">
    <div class="customization-row">
      <div>
        <h3>{{ t('界面样式') }}</h3>
        <p>{{ t('搭配主题配色，或保留熟悉的默认外观') }}</p>
      </div>
      <AppSelect
        :label="t('界面样式')"
        hide-label
        compact
        :options="styleOptions"
        :model-value="values.skinStyle"
        @update:model-value="emit('update', { skinStyle: $event })"
      />
    </div>
    <ThemeColorControls
      v-if="values.skinStyle === 'custom'"
      :values="values"
      @update="emit('update', $event)"
    />
    <div class="customization-row background-heading">
      <div>
        <h3>{{ t('背景图片') }}</h3>
        <p>{{ t('让工作区多一点你的风格') }}</p>
      </div>
      <div
        class="background-options"
        role="group"
        :aria-label="t('背景来源')"
      >
        <button
          :aria-pressed="values.skinBackground === 'theme'"
          @click="emit('update', { skinBackground: 'theme' })"
        >
          {{ t('跟随主题') }}
        </button>
        <button
          :aria-pressed="values.skinBackground === 'none'"
          @click="emit('update', { skinBackground: 'none' })"
        >
          {{ t('无背景') }}
        </button>
        <button
          v-if="values.skinBackgroundImage"
          :aria-pressed="values.skinBackground === 'custom'"
          @click="emit('update', { skinBackground: 'custom' })"
        >
          {{ t('自定义') }}
        </button>
      </div>
    </div>
    <input
      ref="fileInput"
      class="sr-only"
      type="file"
      accept="image/png,image/jpeg,image/webp"
      :aria-label="t('上传背景图片')"
      tabindex="-1"
      @change="upload"
    />
    <button
      type="button"
      class="upload-area"
      :disabled="uploading"
      @click="fileInput?.click()"
    >
      <img
        v-if="values.skinBackgroundImage"
        :src="values.skinBackgroundImage"
        :alt="t('已上传的背景缩略图')"
      />
      <AppIcon
        v-else
        name="lucide:image-plus"
        :size="24"
      />
      <span
        ><strong>{{
          uploading
            ? t('正在处理图片…')
            : values.skinBackgroundName || t('上传自定义背景')
        }}</strong
        ><small>{{
          values.skinTheme.startsWith('custom-')
            ? t('PNG、JPG、WebP · 最大 10 MB')
            : t('上传后新建独立皮肤 · 保留内置主题')
        }}</small></span
      >
      <AppIcon
        name="lucide:upload"
        :size="15"
      />
    </button>
    <p
      v-if="error"
      role="alert"
      class="upload-error"
    >
      {{ error }}
    </p>
    <div
      v-if="values.skinBackgroundImage"
      class="uploaded-actions"
    >
      <span>{{
        values.skinBackground === 'custom'
          ? t('正在使用自定义背景')
          : t('已保留上传的图片')
      }}</span
      ><button
        @click="
          emit('update', {
            skinBackgroundImage: '',
            skinBackgroundName: '',
            skinBackground: 'theme',
          })
        "
      >
        {{ t('移除图片') }}
      </button>
    </div>
    <template
      v-if="
        values.skinBackground !== 'none' &&
        (values.skinBase === 'kuriyama-mirai' ||
          values.skinTheme === 'kuriyama-mirai' ||
          values.skinBackground === 'custom')
      "
    >
      <AppSlider
        class="background-slider"
        :label="t('背景不透明度')"
        unit="%"
        :model-value="Number(values.skinBackgroundOpacity)"
        @update:model-value="
          emit('update', { skinBackgroundOpacity: String($event) })
        "
      />
      <AppSlider
        class="background-slider"
        :label="t('背景模糊程度')"
        unit="px"
        :max="20"
        :model-value="Number(values.skinBackgroundBlur)"
        @update:model-value="
          emit('update', { skinBackgroundBlur: String($event) })
        "
      />
      <div class="background-layout">
        <AppSelect
          :label="t('背景显示方式')"
          compact
          :options="[
            { value: 'cover', label: t('铺满窗口') },
            { value: 'contain', label: t('完整显示') },
          ]"
          :model-value="values.skinBackgroundFit"
          @update:model-value="emit('update', { skinBackgroundFit: $event })"
        />
        <AppSelect
          :label="t('背景对齐位置')"
          compact
          :options="[
            { value: 'center', label: t('居中') },
            { value: 'top', label: t('顶部') },
            { value: 'bottom', label: t('底部') },
            { value: 'left', label: t('左侧') },
            { value: 'right', label: t('右侧') },
          ]"
          :model-value="values.skinBackgroundPosition"
          @update:model-value="
            emit('update', { skinBackgroundPosition: $event })
          "
        />
      </div>
      <button
        class="reset-background"
        @click="
          emit('update', {
            skinBackgroundOpacity: DEFAULT_SETTINGS.skinBackgroundOpacity,
            skinBackgroundBlur: '0',
            skinBackgroundFit: 'cover',
            skinBackgroundPosition: 'center',
          })
        "
      >
        {{ t('重置背景参数') }}
      </button>
    </template>
  </div>
</template>

<style scoped>
.theme-customization {
  margin-top: 28px;
}
.customization-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
}
h3 {
  color: var(--color-txt);
  font-size: 12px;
  font-weight: 600;
}
h3 span {
  color: var(--color-txt-3);
  font-weight: 400;
  font-size: 10px;
}
p {
  color: var(--color-txt-3);
  font-size: 10px;
  margin-top: 5px;
  line-height: 1.7;
}
.customization-row > :last-child {
  flex-shrink: 0;
}
.customization-row > :deep(.app-select) {
  width: 150px;
}
.background-heading {
  margin-top: 25px;
  padding-top: 22px;
  border-top: 1px solid var(--color-line-soft);
}
.background-options {
  display: flex;
  gap: 2px;
  background: var(--color-panel);
  border: 1px solid var(--color-line);
  border-radius: 6px;
  padding: 3px;
}
.background-options button {
  padding: 4px 8px;
  border-radius: 4px;
  color: var(--color-txt-3);
  font-size: 10px;
  cursor: pointer;
  transition:
    background-color 150ms,
    color 150ms;
}
.background-options button[aria-pressed='true'] {
  color: var(--color-accent);
  background: var(--color-raised);
}
.upload-area {
  display: flex;
  width: 100%;
  min-height: 78px;
  margin-top: 14px;
  gap: 13px;
  align-items: center;
  text-align: left;
  border: 1px dashed var(--color-line-strong);
  border-radius: 8px;
  padding: 14px 17px;
  color: var(--color-txt-3);
  cursor: pointer;
  background: var(--color-card);
  transition:
    background-color 180ms,
    border-color 180ms;
}
.upload-area:hover {
  border-color: var(--color-accent);
  background: var(--color-raised);
}
.upload-area:disabled {
  opacity: 0.5;
  cursor: wait;
}
.upload-area img {
  width: 60px;
  height: 42px;
  border-radius: 5px;
  object-fit: cover;
}
.upload-area > span {
  flex: 1;
  min-width: 0;
}
.upload-area strong {
  display: block;
  font-size: 11px;
  font-weight: 500;
  color: var(--color-txt-2);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.upload-area small {
  display: block;
  font-size: 9px;
  margin-top: 5px;
}
.upload-error {
  color: var(--color-danger);
}
.uploaded-actions {
  display: flex;
  justify-content: space-between;
  font-size: 10px;
  margin-top: 8px;
  color: var(--color-txt-3);
}
.uploaded-actions button {
  color: var(--color-accent);
  cursor: pointer;
}
.background-slider {
  margin-top: 17px;
}
button:focus-visible,
input:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 3px;
}
@container settings (max-width: 620px) {
  .customization-row {
    align-items: flex-start;
    flex-direction: column;
    gap: 10px;
  }
}
.background-layout {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 16px;
  margin-top: 18px;
}
.reset-background {
  margin-top: 14px;
  font-size: 10px;
  color: var(--color-accent);
  cursor: pointer;
}
</style>
