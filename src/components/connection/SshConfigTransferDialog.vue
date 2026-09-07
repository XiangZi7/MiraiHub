<script setup lang="ts">
import { computed, shallowRef } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppCheckbox from '@/components/ui/AppCheckbox.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import { useSshConfigTransfer } from '@/composables/useSshConfigTransfer'
import SshConfigChecklist from './SshConfigChecklist.vue'

const props = defineProps<{ open: boolean }>()
const emit = defineEmits<{
  close: []
  imported: []
}>()

const mode = shallowRef<'export' | 'import'>('export')
const {
  state,
  exportItems,
  canImportCredentials,
  exportSelected,
  chooseImportFile,
  previewImport,
  importSelected,
} = useSshConfigTransfer(() => props.open)

const title = computed(() =>
  mode.value === 'export' ? '导出 SSH 配置' : '导入 SSH 配置'
)

async function finishExport(): Promise<void> {
  if (await exportSelected()) emit('close')
}

async function finishImport(): Promise<void> {
  if (!(await importSelected())) return
  emit('imported')
  emit('close')
}
</script>

<template>
  <Teleport to="body">
    <Transition name="ssh-config-transfer">
      <AppDialog
        v-if="open"
        :title="title"
        description="批量选择 SSH 连接；导入和导出文件均由 Rust 在本机处理。"
        wide
        @close="emit('close')"
      >
        <div
          class="ssh-config-transfer-tabs"
          role="tablist"
          aria-label="SSH 配置导入导出"
        >
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'export'"
            :class="[
              'ssh-config-transfer-tab',
              mode === 'export' && 'is-active',
            ]"
            @click="mode = 'export'"
          >
            <AppIcon
              name="lucide:file-output"
              :size="14"
            />
            导出
          </button>
          <button
            type="button"
            role="tab"
            :aria-selected="mode === 'import'"
            :class="[
              'ssh-config-transfer-tab',
              mode === 'import' && 'is-active',
            ]"
            @click="mode = 'import'"
          >
            <AppIcon
              name="lucide:file-input"
              :size="14"
            />
            导入
          </button>
        </div>

        <div
          v-if="mode === 'export'"
          class="grid gap-3.5"
        >
          <SshConfigChecklist
            v-model="state.selectedExportIds"
            :items="exportItems"
            :disabled="state.loading"
          />

          <div class="card grid gap-3 px-3 py-2.5">
            <AppCheckbox
              v-model="state.exportBasicOnly"
              label="仅导出基础信息"
              description="不包含密码、私钥文件、私钥路径、密钥口令和启动命令。"
              :disabled="state.loading"
            />

            <div
              v-if="!state.exportBasicOnly"
              class="grid gap-2"
            >
              <p class="ssh-config-transfer-warning">
                <AppIcon
                  name="lucide:shield-alert"
                  :size="13"
                />
                完整备份会读取所选连接使用的私钥并加密保存，恢复时需要同一密码。
              </p>
              <label class="grid gap-1.5 text-[11px]">
                <span class="text-txt-2 font-medium">备份密码</span>
                <input
                  v-model="state.exportPassword"
                  type="password"
                  autocomplete="new-password"
                  class="field h-[34px] px-2.5"
                  placeholder="至少 10 字节"
                  :disabled="state.loading"
                />
              </label>
            </div>
          </div>
        </div>

        <div
          v-else
          class="grid gap-3.5"
        >
          <div class="grid gap-2">
            <label class="text-txt-2 text-[11px] font-medium">配置文件</label>
            <div class="flex gap-2">
              <div
                class="field text-txt-3 flex min-w-0 flex-1 items-center gap-2 px-2.5 font-mono text-[10px]"
              >
                <AppIcon
                  name="lucide:file-json"
                  :size="13"
                  class="shrink-0"
                />
                <span
                  class="truncate"
                  :title="state.importPath"
                  >{{ state.importPath || '尚未选择文件' }}</span
                >
              </div>
              <AppButton
                :disabled="state.loading"
                @click="chooseImportFile"
              >
                浏览…
              </AppButton>
            </div>
            <label class="grid gap-1.5 text-[11px]">
              <span class="text-txt-2 font-medium">解密密码</span>
              <input
                v-model="state.importPassword"
                type="password"
                autocomplete="off"
                class="field h-[34px] px-2.5"
                placeholder="旧版或未加密文件可留空"
                :disabled="state.loading"
              />
            </label>
            <AppButton
              class="w-fit"
              :disabled="state.loading || !state.importPath"
              @click="previewImport"
            >
              {{ state.loading ? '读取中…' : '读取配置' }}
            </AppButton>
          </div>

          <template v-if="state.importPreview">
            <div class="text-txt-3 flex items-center gap-2 text-[10.5px]">
              <AppIcon
                name="lucide:badge-check"
                :size="13"
                class="text-success"
              />
              已识别 {{ state.importPreview.sourceFormat }} 格式，共
              {{ state.importPreview.connections.length }} 条 SSH 配置
            </div>

            <p
              v-for="warning in state.importPreview.warnings"
              :key="warning"
              class="ssh-config-transfer-warning"
            >
              <AppIcon
                name="lucide:triangle-alert"
                :size="13"
              />
              {{ warning }}
            </p>

            <SshConfigChecklist
              v-model="state.selectedImportIds"
              :items="state.importPreview.connections"
              :disabled="state.loading"
            />

            <div class="card grid gap-3 px-3 py-2.5">
              <AppCheckbox
                v-if="state.importPreview.includesCredentials"
                v-model="state.importCredentials"
                label="导入密码和私钥"
                :description="
                  canImportCredentials
                    ? '旧版内嵌私钥会由 Rust 导入到本机 ~/.ssh，不会把密钥内容交给前端。'
                    : '当前已关闭“记住密码”，因此敏感凭据不会导入。'
                "
                :disabled="state.loading || !canImportCredentials"
              />
              <AppCheckbox
                v-if="state.importPreview.includesStartupCommands"
                v-model="state.importStartupCommands"
                label="导入启动命令"
                description="只保存配置；本次导入不会连接服务器或执行命令。"
                :disabled="state.loading"
              />
            </div>
          </template>
        </div>

        <p
          v-if="state.error"
          role="alert"
          class="text-danger mt-3 text-[11px]"
        >
          {{ state.error }}
        </p>

        <template #footer>
          <div class="flex-1" />
          <AppButton
            :disabled="state.loading"
            @click="emit('close')"
            >取消</AppButton
          >
          <AppButton
            v-if="mode === 'export'"
            variant="primary"
            :disabled="state.loading || !state.selectedExportIds.length"
            @click="finishExport"
          >
            {{
              state.loading
                ? '导出中…'
                : `导出 ${state.selectedExportIds.length} 条`
            }}
          </AppButton>
          <AppButton
            v-else-if="state.importPreview"
            variant="primary"
            :disabled="state.loading || !state.selectedImportIds.length"
            @click="finishImport"
          >
            {{
              state.loading
                ? '导入中…'
                : `导入 ${state.selectedImportIds.length} 条`
            }}
          </AppButton>
        </template>
      </AppDialog>
    </Transition>
  </Teleport>
</template>

<style scoped>
.ssh-config-transfer-tabs {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 4px;
  margin-bottom: 14px;
  border-radius: 8px;
  background: var(--color-panel);
  padding: 3px;
}

.ssh-config-transfer-tab {
  display: inline-flex;
  cursor: pointer;
  align-items: center;
  justify-content: center;
  gap: 6px;
  border-radius: 6px;
  padding: 7px 10px;
  color: var(--color-txt-3);
  font-size: 11px;
}

.ssh-config-transfer-tab:hover,
.ssh-config-transfer-tab:focus-visible {
  background: var(--color-hover);
  color: var(--color-txt);
}

.ssh-config-transfer-tab.is-active {
  background: color-mix(in oklch, var(--color-violet) 14%, var(--color-panel));
  color: var(--color-violet);
  box-shadow: inset 0 0 0 1px
    color-mix(in oklch, var(--color-violet) 30%, transparent);
}

.ssh-config-transfer-warning {
  display: flex;
  align-items: flex-start;
  gap: 6px;
  color: var(--color-amber);
  font-size: 10.5px;
  line-height: 1.55;
}

.ssh-config-transfer-warning > :first-child {
  margin-top: 1px;
  flex-shrink: 0;
}

.ssh-config-transfer-enter-active,
.ssh-config-transfer-leave-active {
  transition: opacity 150ms ease;
}

.ssh-config-transfer-enter-from,
.ssh-config-transfer-leave-to {
  opacity: 0;
}

@media (prefers-reduced-motion: reduce) {
  .ssh-config-transfer-enter-active,
  .ssh-config-transfer-leave-active {
    transition: none;
  }
}
</style>
