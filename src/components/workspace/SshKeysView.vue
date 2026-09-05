<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from 'vue'
import { useClipboard } from '@vueuse/core'
import AppConfirmDialog from '@/components/ui/AppConfirmDialog.vue'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import { usePrivateKeys } from '@/composables/usePrivateKeys'
import { useSshKeys } from '@/composables/useSshKeys'
import { toast } from '@/composables/useToast'
import { SSH_KEY_KIND_META } from '@/constants/ssh-keys'
import type { GenerateKeyRequest } from '@/types/ssh'
import { formatDate, formatRelative } from '@/utils/time'
import { cn } from '@/utils/cn'
import { scheduleClipboardClear } from '@/utils/clipboard'
import GenerateKeyDialog from './GenerateKeyDialog.vue'

/**
 * SSH 密钥管理。
 * 左列表 + 右详情：密钥的数量不会多，但每把都要看全（指纹、公钥全文），
 * 所以详情给足宽度，而不是塞进列表行里折叠展开。
 */

const {
  keys,
  selected,
  keyword,
  loading,
  error,
  visibleKeys,
  current,
  refresh,
  generate,
  remove,
} = useSshKeys()
const { defaultPath: defaultPrivateKey, setDefault: setDefaultPrivateKey } =
  usePrivateKeys()

onMounted(refreshKeys)

// 生成密钥对话框是否打开
const generateOpen = shallowRef(false)
const pendingDelete = shallowRef<{ id: string; label: string } | null>(null)
// 拿到对话框实例，生成失败时把错误回传给它显示在表单里
const dialogRef =
  useTemplateRef<InstanceType<typeof GenerateKeyDialog>>('generateDialog')

// 指纹与公钥各用一份 clipboard：共用会让复制指纹时公钥按钮也跳成"已复制"。
// copiedDuring 给到 1.6s，够看清反馈再回到默认态
const fingerprintClip = useClipboard({ copiedDuring: 1600 })
const publicKeyClip = useClipboard({ copiedDuring: 1600 })

/** 删除前确认：密钥删掉就找不回来了，且远端的 authorized_keys 还留着废条目 */
function requestDelete(keyId: string, label: string): void {
  pendingDelete.value = { id: keyId, label }
}

async function confirmDelete(): Promise<void> {
  const target = pendingDelete.value
  pendingDelete.value = null
  if (!target) return

  try {
    await remove(target.id)
    toast.success(`密钥“${target.label}”已删除`)
  } catch (caught) {
    toast.error({
      title: '删除 SSH 密钥失败',
      description: error.value || String(caught),
    })
  }
}

async function refreshKeys(): Promise<void> {
  await refresh()
  if (error.value)
    toast.error({ title: '扫描 SSH 密钥失败', description: error.value })
}

async function copyFingerprint(): Promise<void> {
  if (!current.value) return
  await fingerprintClip.copy(current.value.fingerprint)
  scheduleClipboardClear(current.value.fingerprint)
  toast.success('SSH 指纹已复制')
}

async function copyPublicKey(): Promise<void> {
  if (!current.value) return
  await publicKeyClip.copy(current.value.publicKey)
  scheduleClipboardClear(current.value.publicKey)
  toast.success('SSH 公钥已复制')
}

function makeDefault(path: string): void {
  setDefaultPrivateKey(path)
  toast.success('默认私钥已更新')
}

/**
 * 生成密钥。
 *
 * 失败不关对话框 —— 用户填的参数还在里面，
 * 关掉会让他重填一遍才知道哪里错了。
 */
async function handleGenerate(request: GenerateKeyRequest): Promise<void> {
  try {
    await generate(request)
    generateOpen.value = false
    toast.success(`SSH 密钥“${request.label}”已生成`)
  } catch (err) {
    // Tauri 的结构化 AppError 是普通对象，String(err) 只会得到 [object Object]。
    // composable 已用统一的 errorMessage 提取过可读文案，优先回传那一份。
    dialogRef.value?.fail()
    toast.error({
      title: '生成 SSH 密钥失败',
      description:
        error.value || (err instanceof Error ? err.message : String(err)),
    })
  }
}
</script>

<template>
  <div class="pane flex-1 flex-row">
    <!-- 密钥列表 -->
    <nav class="border-line-soft bg-panel flex w-68 shrink-0 flex-col border-r">
      <header
        class="border-line-soft flex h-10 shrink-0 items-center gap-1 border-b pr-2 pl-3"
      >
        <p class="text-txt-2 flex-1 text-[11px] font-medium">
          Keys
          <span class="text-txt-4">({{ keys.length }})</span>
        </p>
        <IconButton
          icon="lucide:refresh-cw"
          :size="14"
          title="重新扫描"
          @click="refreshKeys"
        />
        <IconButton
          icon="lucide:plus"
          :size="14"
          title="生成新密钥"
          @click="generateOpen = true"
        />
      </header>

      <div class="shrink-0 px-2 pt-2 pb-1">
        <SearchField
          v-model="keyword"
          icon="lucide:search"
          placeholder="搜索密钥…"
        />
      </div>

      <div class="scroll-thin min-h-0 flex-1 overflow-y-auto p-1.5">
        <button
          v-for="key in visibleKeys"
          :key="key.id"
          type="button"
          :class="cn('row-item w-full', selected === key.id && 'bg-raised')"
          @click="selected = key.id"
        >
          <AppIcon
            name="lucide:key-round"
            :size="15"
            :class="SSH_KEY_KIND_META[key.kind].tone"
          />
          <span class="min-w-0 flex-1 text-left">
            <span class="text-txt block truncate text-xs">{{ key.label }}</span>
            <span class="text-txt-4 block truncate text-[10.5px]">
              {{ SSH_KEY_KIND_META[key.kind].label }} · {{ key.bits }} bits
            </span>
          </span>
          <!-- tooltip 挂在 span 上：SVG 元素的 title 属性不会触发浏览器提示 -->
          <span
            v-if="key.encrypted"
            class="shrink-0"
            title="私钥有口令保护"
          >
            <AppIcon
              name="lucide:lock"
              :size="11"
              class="text-txt-4"
            />
          </span>
          <span
            v-if="defaultPrivateKey === key.id"
            class="shrink-0"
            title="默认私钥"
          >
            <AppIcon
              name="lucide:star"
              :size="12"
              class="text-violet"
            />
          </span>
        </button>

        <p
          v-if="loading"
          class="text-txt-4 py-8 text-center text-xs"
        >
          正在扫描 ~/.ssh …
        </p>
        <p
          v-else-if="!visibleKeys.length"
          class="text-txt-4 py-8 text-center text-xs"
        >
          {{ keyword ? '没有匹配的密钥' : '~/.ssh 下没有找到密钥' }}
        </p>
      </div>
    </nav>

    <!-- 详情 -->
    <div
      v-if="current"
      class="flex min-w-0 flex-1 flex-col"
    >
      <header
        class="border-line-soft flex h-10 shrink-0 items-center gap-2 border-b pr-2 pl-3.5"
      >
        <h2 class="text-txt truncate text-[13px] font-medium">
          {{ current.label }}
        </h2>
        <span
          class="border-line bg-card text-txt-2 shrink-0 rounded border px-1.5 py-0.5 text-[10px] font-medium"
        >
          {{ SSH_KEY_KIND_META[current.kind].label }}
        </span>
        <span
          v-if="defaultPrivateKey === current.id"
          class="bg-violet/15 text-violet shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium"
        >
          Default
        </span>
        <div class="flex-1" />
        <IconButton
          icon="lucide:star"
          :size="14"
          :title="
            defaultPrivateKey === current.id ? '当前默认私钥' : '设为默认私钥'
          "
          :disabled="defaultPrivateKey === current.id"
          :class="
            defaultPrivateKey === current.id ? 'text-violet opacity-100' : ''
          "
          @click="makeDefault(current.id)"
        />
        <IconButton
          icon="lucide:trash-2"
          :size="14"
          title="删除密钥"
          @click="requestDelete(current.id, current.label)"
        />
      </header>

      <div class="scroll-thin min-h-0 flex-1 overflow-y-auto p-4">
        <!-- 元信息 -->
        <div class="mb-5 grid grid-cols-2 gap-2.5">
          <div class="card px-3 py-2.5">
            <p class="text-txt-3 text-[11px]">Modified</p>
            <p
              class="text-txt mt-1 text-xs"
              :title="formatDate(current.modifiedAt)"
            >
              {{ formatRelative(current.modifiedAt) }}
            </p>
          </div>
          <div class="card px-3 py-2.5">
            <p class="text-txt-3 text-[11px]">Comment</p>
            <p
              class="text-txt mt-1 truncate text-xs"
              :title="current.comment"
            >
              {{ current.comment || '—' }}
            </p>
          </div>
          <div class="card px-3 py-2.5">
            <p class="text-txt-3 text-[11px]">Length</p>
            <p class="text-txt mt-1 text-xs">{{ current.bits }} bits</p>
          </div>
          <div class="card px-3 py-2.5">
            <p class="text-txt-3 text-[11px]">Passphrase</p>
            <p class="text-txt mt-1 flex items-center gap-1.5 text-xs">
              <AppIcon
                :name="current.encrypted ? 'lucide:lock' : 'lucide:lock-open'"
                :size="12"
                :class="current.encrypted ? 'text-accent' : 'text-amber'"
              />
              <span>{{ current.encrypted ? 'Protected' : 'None' }}</span>
            </p>
          </div>
        </div>

        <!-- 路径 -->
        <section class="mb-5">
          <h3 class="text-txt-2 mb-2 text-[13px] font-medium">Path</h3>
          <div class="card px-3 py-2">
            <code
              class="text-txt-2 block truncate font-mono text-[11.5px]"
              :title="current.id"
              >{{ current.id }}</code
            >
          </div>
        </section>

        <!-- 指纹 -->
        <section class="mb-5">
          <h3 class="text-txt-2 mb-2 text-[13px] font-medium">Fingerprint</h3>
          <div class="card flex items-center gap-2 px-3 py-2">
            <code
              class="text-txt-2 min-w-0 flex-1 truncate font-mono text-[11.5px]"
              >{{ current.fingerprint }}</code
            >
            <IconButton
              :icon="
                fingerprintClip.copied.value ? 'lucide:check' : 'lucide:copy'
              "
              :size="13"
              title="复制指纹"
              @click="copyFingerprint"
            />
          </div>
        </section>

        <!-- 公钥全文 -->
        <section>
          <div class="mb-2 flex items-center gap-2">
            <h3 class="text-txt-2 flex-1 text-[13px] font-medium">
              Public key
            </h3>
            <button
              type="button"
              class="btn px-2 py-1 text-[11px]"
              @click="copyPublicKey"
            >
              <AppIcon
                :name="
                  publicKeyClip.copied.value ? 'lucide:check' : 'lucide:copy'
                "
                :size="12"
              />
              <span>{{ publicKeyClip.copied.value ? '已复制' : '复制' }}</span>
            </button>
          </div>
          <pre
            class="card bg-terminal text-term-fg scroll-thin overflow-x-auto px-3 py-2.5 font-mono text-[11.5px] leading-relaxed break-all whitespace-pre-wrap"
            >{{ current.publicKey }}</pre>
        </section>
      </div>
    </div>

    <!-- 一把密钥都没有时的兜底 -->
    <div
      v-else
      class="flex min-w-0 flex-1 items-center justify-center"
    >
      <div class="flex flex-col items-center gap-3 text-center">
        <div
          class="border-line bg-card text-txt-3 grid size-14 place-items-center rounded-2xl border"
        >
          <AppIcon
            name="lucide:key-round"
            :size="26"
          />
        </div>
        <p class="text-txt-2 text-sm">还没有密钥</p>
        <p class="text-txt-4 max-w-70 text-xs">
          生成一把新密钥，或把已有的放进 ~/.ssh
        </p>
        <button
          type="button"
          class="btn mt-1"
          @click="generateOpen = true"
        >
          <AppIcon
            name="lucide:plus"
            :size="13"
          />
          <span>生成新密钥</span>
        </button>
      </div>
    </div>

    <GenerateKeyDialog
      v-if="generateOpen"
      ref="generateDialog"
      @close="generateOpen = false"
      @submit="handleGenerate"
    />
    <AppConfirmDialog
      :open="Boolean(pendingDelete)"
      title="删除 SSH 密钥？"
      :description="`将从 ~/.ssh 永久删除密钥“${pendingDelete?.label ?? ''}”及其公钥文件，此操作无法撤销。`"
      confirm-label="确认删除"
      danger
      @close="pendingDelete = null"
      @confirm="confirmDelete"
    />
  </div>
</template>
