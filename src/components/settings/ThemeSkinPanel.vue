<script setup lang="ts">
import { useI18n } from 'vue-i18n'
import { computed, nextTick, useTemplateRef, watch } from 'vue'
import { useScroll } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import AppInput from '@/components/ui/AppInput.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import AppButton from '@/components/ui/AppButton.vue'
import IconButton from '@/components/ui/IconButton.vue'
import ThemePreview from './ThemePreview.vue'
import ThemeCustomization from './ThemeCustomization.vue'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { skinBackground } from '@/utils/skin-runtime'
import {
  builtinSkin,
  builtinSkins,
  loadSkinRegistry,
  skinRegistry,
} from '@/utils/skin-registry'
import { openSkinDirectory } from '@/api/skins'
import { toast } from '@/composables/useToast'
import { IS_TAURI } from '@/utils/window'
import {
  createCustomSkin,
  readSkinLibrary,
  resolveSkinSettings,
  skinPreset,
  type SkinSettings,
  type SkinAppearance,
  type CustomSkin,
} from '@/utils/skin'

const { t } = useI18n()

const props = defineProps<{ values: SkinSettings }>()
const emit = defineEmits<{ update: [patch: Partial<SkinSettings>] }>()
const library = computed(() => readSkinLibrary(props.values.skinLibrary))
const selected = computed(() =>
  library.value.find(item => item.id === props.values.skinTheme)
)
const effective = computed(() => resolveSkinSettings(props.values))
// 目录重新读取后 version 递增，卡片跟着刷新。
const builtin = computed(() => (skinRegistry.version, builtinSkins()))
const cards = useTemplateRef<HTMLElement>('cards')
const { arrivedState, measure } = useScroll(cards)
const themeName = computed(() =>
  selected.value
    ? selected.value.name || t('未命名皮肤')
    : (builtinSkin(props.values.skinTheme)?.name ?? t('Default Theme'))
)
const baseOptions = computed(() => [
  { value: 'default', label: t('Default Theme') },
  ...builtin.value.map(skin => ({ value: skin.id, label: skin.name })),
])

function selectTheme(id: string): void {
  if (props.values.skinTheme === id) return
  emit(
    'update',
    id.startsWith('custom-')
      ? { skinTheme: id }
      : { ...skinPreset(id), skinTheme: id }
  )
}
function addTheme(patch: Partial<SkinAppearance> = {}): void {
  const item = createCustomSkin(
    props.values,
    patch,
    t('skin.newName', { number: library.value.length + 1 })
  )
  emit('update', {
    skinLibrary: JSON.stringify([...library.value, item]),
    skinTheme: item.id,
  })
}
function update(patch: Partial<SkinAppearance>): void {
  if (selected.value) {
    emit('update', {
      skinLibrary: JSON.stringify(
        library.value.map(item =>
          item.id === selected.value?.id
            ? { ...item, values: { ...item.values, ...patch } }
            : item
        )
      ),
    })
  } else if (patch.skinBackgroundImage || patch.skinStyle === 'custom') {
    addTheme(patch)
  } else emit('update', patch)
}
function rename(value: string): void {
  const name = value.slice(0, 48)
  emit('update', {
    skinLibrary: JSON.stringify(
      library.value.map(item =>
        item.id === selected.value?.id ? { ...item, name } : item
      )
    ),
  })
}
function removeTheme(): void {
  if (!selected.value) return
  const base = selected.value.values.skinBase
  emit('update', {
    ...skinPreset(base),
    skinTheme: base,
    skinLibrary: JSON.stringify(
      library.value.filter(item => item.id !== selected.value?.id)
    ),
  })
}
function cardBackground(item: CustomSkin): string {
  return skinBackground({
    ...DEFAULT_SETTINGS,
    ...item.values,
    skinTheme: item.values.skinBase,
  })
}
function customSubtitle(item: CustomSkin): string {
  if (item.values.skinStyle === 'custom') return t('自定义配色')
  if (item.values.skinStyle === 'default' || item.values.skinBase === 'default')
    return t('项目默认样式')
  return t('skin.baseColors', {
    name: builtinSkin(item.values.skinBase)?.name ?? item.values.skinBase,
  })
}
async function openFolder(): Promise<void> {
  try {
    await openSkinDirectory(
      builtinSkin(props.values.skinTheme) ? props.values.skinTheme : undefined
    )
  } catch (error) {
    toast.error({
      title: t('打开皮肤文件夹失败'),
      description: error instanceof Error ? error.message : String(error),
    })
  }
}
async function reloadSkins(): Promise<void> {
  await loadSkinRegistry(true)
  toast.success(t('皮肤已重新加载'))
}
function scrollCards(direction: number): void {
  cards.value?.scrollBy({
    left: direction * 252,
    behavior:
      document.documentElement.classList.contains('reduce-motion') ||
      matchMedia('(prefers-reduced-motion: reduce)').matches
        ? 'instant'
        : 'smooth',
  })
}
function wheelCards(event: WheelEvent): void {
  const element = cards.value
  if (
    !element ||
    event.ctrlKey ||
    event.shiftKey ||
    Math.abs(event.deltaX) >= Math.abs(event.deltaY)
  )
    return
  const before = element.scrollLeft
  element.scrollLeft +=
    event.deltaY *
    (event.deltaMode === 1
      ? 16
      : event.deltaMode === 2
        ? element.clientWidth
        : 1)
  if (element.scrollLeft !== before) event.preventDefault()
}
watch(
  () => [props.values.skinTheme, library.value.length, builtin.value.length],
  async () => {
    await nextTick()
    const element = cards.value
    const active = element?.querySelector<HTMLElement>('[aria-pressed="true"]')
    if (element && active) {
      const offset = active.offsetLeft
      if (offset < element.scrollLeft) element.scrollLeft = offset
      else if (
        offset + active.offsetWidth >
        element.scrollLeft + element.clientWidth
      )
        element.scrollLeft = offset + active.offsetWidth - element.clientWidth
    }
    measure()
  },
  { immediate: true }
)
</script>

<template>
  <div class="skin-scroll scroll-thin">
    <section
      class="skin-settings"
      aria-labelledby="skin-heading"
    >
      <header class="skin-header">
        <div>
          <h2 id="skin-heading">{{ t('主题皮肤') }}</h2>
          <p>{{ t('选择你喜欢的主题皮肤') }}</p>
        </div>
        <div class="gallery-actions">
          <IconButton
            v-if="IS_TAURI"
            icon="lucide:folder-open"
            :title="t('打开皮肤文件夹')"
            @click="openFolder"
          />
          <IconButton
            icon="lucide:refresh-cw"
            :title="t('重新加载皮肤')"
            :disabled="skinRegistry.loading"
            @click="reloadSkins"
          />
          <IconButton
            icon="lucide:chevron-left"
            :title="t('向左浏览皮肤')"
            :disabled="arrivedState.left"
            @click="scrollCards(-1)"
          />
          <IconButton
            icon="lucide:chevron-right"
            :title="t('向右浏览皮肤')"
            :disabled="arrivedState.right"
            @click="scrollCards(1)"
          />
          <AppButton
            size="sm"
            @click="addTheme()"
            ><AppIcon
              name="lucide:plus"
              :size="13"
            />{{ t('新增皮肤') }}</AppButton
          >
        </div>
      </header>
      <div
        ref="cards"
        class="theme-cards scroll-thin"
        role="group"
        :aria-label="t('选择主题皮肤')"
        @wheel="wheelCards"
      >
        <button
          type="button"
          class="theme-card default-card"
          :aria-pressed="values.skinTheme === 'default'"
          @click="selectTheme('default')"
        >
          <div
            class="default-card-preview"
            aria-hidden="true"
          >
            <ThemePreview :values="DEFAULT_SETTINGS" />
          </div>
          <span class="card-copy"
            ><strong> {{ t('Default Theme') }} </strong
            ><small>{{ t('经典深色 · 专注于此刻') }}</small></span
          >
          <span
            v-if="values.skinTheme === 'default'"
            class="selected-mark"
            ><AppIcon
              name="lucide:check"
              :size="12"
          /></span>
          <span class="card-caption"> {{ t('MiraiHub Original') }} </span>
        </button>
        <!-- 内置皮肤来自安装目录的 skins 文件夹，名字和图片都在各自的 skin.json 里 -->
        <button
          v-for="skin in builtin"
          :key="skin.id"
          type="button"
          :class="[
            'theme-card builtin-card',
            skin.colorScheme === 'light'
              ? 'builtin-card-light'
              : 'builtin-card-dark',
          ]"
          :data-skin="skin.id"
          :aria-pressed="values.skinTheme === skin.id"
          :style="
            skin.background
              ? { backgroundImage: `url(${JSON.stringify(skin.background)})` }
              : undefined
          "
          @click="selectTheme(skin.id)"
        >
          <span class="card-copy"
            ><strong>{{ skin.name }}</strong
            ><small v-if="skin.description">{{ skin.description }}</small
            ><span
              v-if="skin.quote"
              class="builtin-quote"
              >{{ skin.quote }}</span
            ></span
          >
          <span
            v-if="values.skinTheme === skin.id"
            class="selected-mark"
            ><AppIcon
              name="lucide:check"
              :size="12"
          /></span>
          <span class="card-caption"
            ><AppIcon
              name="lucide:flower-2"
              :size="11"
            />
            {{ skin.caption || t('内置皮肤') }}</span
          >
        </button>
        <button
          v-for="item in library"
          :key="item.id"
          type="button"
          class="theme-card custom-card"
          :aria-pressed="values.skinTheme === item.id"
          :style="{
            backgroundImage: cardBackground(item)
              ? `url(${JSON.stringify(cardBackground(item))})`
              : undefined,
          }"
          @click="selectTheme(item.id)"
        >
          <span class="card-copy"
            ><strong>{{ item.name || t('未命名皮肤') }}</strong
            ><small>{{ customSubtitle(item) }}</small></span
          >
          <span
            v-if="values.skinTheme === item.id"
            class="selected-mark"
            ><AppIcon
              name="lucide:check"
              :size="12"
          /></span>
          <span class="card-caption"
            ><AppIcon
              name="lucide:palette"
              :size="11"
            />{{ t('自定义主题') }}</span
          >
        </button>
        <button
          type="button"
          class="theme-card add-card"
          :aria-label="t('新增自定义皮肤')"
          @click="addTheme()"
        >
          <AppIcon
            name="lucide:plus"
            :size="24"
          /><strong>{{ t('新增自定义皮肤') }}</strong
          ><small>{{ t('独立保存图片与样式') }}</small>
        </button>
      </div>
      <p
        v-if="IS_TAURI"
        class="skins-hint"
      >
        {{ t('皮肤文件放在安装目录的 skins 文件夹，修改后点「重新加载皮肤」生效。') }}
      </p>
      <div
        v-if="selected"
        class="custom-theme-details"
      >
        <label class="theme-name"
          >{{ t('皮肤名称')
          }}<AppInput
            :key="selected.id"
            :model-value="selected.name"
            :maxlength="48"
            :aria-label="t('皮肤名称')"
            @update:model-value="rename"
        /></label>
        <AppSelect
          :label="t('基础主题')"
          compact
          :model-value="effective.skinBase"
          :options="baseOptions"
          @update:model-value="update({ skinBase: $event })"
        />
        <AppButton
          size="sm"
          @click="removeTheme"
          ><AppIcon
            name="lucide:trash-2"
            :size="13"
          />{{ t('删除皮肤') }}</AppButton
        >
      </div>
      <section
        class="preview-section"
        aria-labelledby="preview-heading"
      >
        <div class="preview-heading">
          <h3 id="preview-heading">{{ t('主题预览') }}</h3>
          <span>{{ themeName }}</span>
        </div>
        <ThemePreview :values="values" />
      </section>
      <ThemeCustomization
        :values="effective"
        @update="update"
      />
    </section>
  </div>
</template>

<style scoped>
.skin-scroll {
  flex: 1;
  min-height: 0;
  overflow-y: auto;
}
.skin-settings {
  max-width: 720px;
  margin-inline: auto;
  padding: 26px 28px 32px;
}
h2 {
  font-size: 15px;
  font-weight: 600;
  color: var(--color-accent);
  letter-spacing: -0.3px;
}
h2 span {
  font-weight: 500;
}
.skin-header p {
  font-size: 10px;
  color: var(--color-txt-3);
  margin-top: 4px;
}
.theme-cards {
  position: relative;
  display: flex;
  gap: 20px;
  margin: 17px -5px -5px;
  padding: 5px 5px 12px;
  overflow-x: auto;
  overscroll-behavior-x: contain;
  scroll-snap-type: x proximity;
}
.theme-card {
  position: relative;
  isolation: isolate;
  flex: 0 0 232px;
  min-width: 0;
  height: 148px;
  scroll-snap-align: start;
  text-align: left;
  overflow: clip;
  border: 1px solid transparent;
  border-radius: 10px;
  cursor: pointer;
  box-shadow: 0 3px 9px #40243114;
  transition:
    border-color 200ms,
    box-shadow 200ms,
    transform 200ms;
}
.theme-card:hover {
  transform: translateY(-2px);
  box-shadow: 0 5px 18px #ac58852b;
}
.theme-card[aria-pressed='true'] {
  border-color: #f196c1;
  box-shadow:
    0 0 0 1px #f6a9d02e,
    0 4px 16px #d578a42b;
}
.theme-card:focus-visible {
  outline: 2px solid var(--color-accent);
  outline-offset: 4px;
}
.default-card {
  background: #15151b;
  color: #f4e9f0;
}
.default-card::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(100deg, #121217e8, #15151b66);
}
.default-card-preview {
  position: absolute;
  inset: 0;
  z-index: -2;
  opacity: 0.7;
  overflow: hidden;
}
.default-card-preview :deep(.theme-preview) {
  width: 400px;
  height: 230px;
  border: 0;
  border-radius: 0;
}
.builtin-card {
  background-size: cover;
  background-position: 70% center;
}
.builtin-card::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
}
.builtin-card-light {
  color: #a52c5b;
  background-color: #fff0f5;
}
.builtin-card-light::after {
  background: linear-gradient(90deg, #fff5f9a6, transparent 75%);
}
.builtin-card-dark {
  color: #fff;
  background-color: #27232f;
}
.builtin-card-dark::after {
  background: linear-gradient(100deg, #121019c9, #12101928);
}
.card-copy {
  position: absolute;
  top: 16px;
  left: 14px;
  right: 18px;
}
.card-copy strong {
  display: block;
  padding-right: 12px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 11px;
  font-weight: 500;
}
.card-copy small {
  display: block;
  margin-top: 5px;
  font-size: 9px;
  opacity: 0.75;
}
.builtin-quote {
  display: block;
  font-family: 'Yu Mincho', 'Microsoft YaHei', serif;
  margin-top: 11px;
  font-size: 11px;
  font-weight: 500;
}
.card-caption {
  position: absolute;
  bottom: 17px;
  left: 14px;
  display: flex;
  align-items: center;
  gap: 4px;
  font-size: 8px;
  opacity: 0.65;
}
.selected-mark {
  position: absolute;
  right: 9px;
  top: 9px;
  display: grid;
  place-items: center;
  width: 19px;
  height: 19px;
  color: white;
  background: #cf4e88;
  border-radius: 50%;
  box-shadow: 0 2px 5px #a6407030;
}
.skins-hint {
  margin-top: 10px;
  color: var(--color-txt-4);
  font-size: 9.5px;
}
.preview-section {
  margin-top: 28px;
}
.preview-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-bottom: 13px;
}
h3 {
  color: var(--color-accent);
  font-size: 12px;
  font-weight: 600;
}
h3 span {
  opacity: 0.65;
  font-size: 11px;
  font-weight: 400;
}
.preview-heading > span {
  font-size: 9px;
  color: var(--color-txt-3);
}
.skin-header,
.gallery-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
}
.gallery-actions {
  flex-shrink: 0;
}
.custom-card {
  color: #fff;
  background-color: #27232f;
  background-size: cover;
  background-position: center;
}
.custom-card::after {
  content: '';
  position: absolute;
  inset: 0;
  z-index: -1;
  background: linear-gradient(100deg, #121019c9, #12101928);
}
.add-card {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 10px;
  flex-basis: 154px;
  color: var(--color-txt-3);
  border: 1px dashed var(--color-line-strong);
  background: color-mix(in srgb, var(--color-card) 60%, transparent);
}
.add-card strong {
  font-size: 11px;
  font-weight: 500;
}
.add-card small {
  font-size: 9px;
}
.add-card:hover {
  color: var(--color-accent);
  border-color: var(--color-accent);
}
.custom-theme-details {
  display: flex;
  align-items: flex-end;
  gap: 14px;
  margin-top: 18px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 8px;
  background: var(--color-card);
}
.theme-name {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
  gap: 7px;
  color: var(--color-txt-3);
  font-size: 10px;
}
.custom-theme-details > :deep(.app-select) {
  width: 146px;
}
.custom-theme-details > :last-child {
  flex-shrink: 0;
  margin-bottom: 2px;
}
@container settings (max-width: 620px) {
  .skin-settings {
    padding: 20px 18px;
  }
  .theme-cards {
    gap: 14px;
  }
  .theme-card {
    height: 138px;
  }
  .card-copy {
    left: 10px;
  }
  .card-copy small {
    max-width: 100px;
  }
}
@container settings (max-width: 800px) {
  .skin-header {
    flex-wrap: wrap;
    gap: 12px;
  }
  .custom-theme-details {
    flex-wrap: wrap;
  }
}
</style>
