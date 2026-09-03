<script setup lang="ts">
import { onMounted, shallowRef, useTemplateRef } from 'vue'
import { useClipboard } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import { usePrivateKeys } from '@/composables/usePrivateKeys'
import { useSshKeys } from '@/composables/useSshKeys'
import { SSH_KEY_KIND_META } from '@/constants/ssh-keys'
import type { GenerateKeyRequest } from '@/types/ssh'
import { formatDate, formatRelative } from '@/utils/time'
import { cn } from '@/utils/cn'
import GenerateKeyDialog from './GenerateKeyDialog.vue'

/**
 * SSH 密钥管理。
 * 左列表 + 右详情：密钥的数量不会多，但每把都要看全（指纹、公钥全文），
 * 所以详情给足宽度，而不是塞进列表行里折叠展开。
 */

const { keys, selected, keyword, loading, error, visibleKeys, current, refresh, generate, remove }
  = useSshKeys()
const { defaultPath: defaultPrivateKey, setDefault: setDefaultPrivateKey } = usePrivateKeys()

onMounted(refresh)

// 生成密钥对话框是否打开
const generateOpen = shallowRef(false)
// 拿到对话框实例，生成失败时把错误回传给它显示在表单里
const dialogRef = useTemplateRef<InstanceType<typeof GenerateKeyDialog>>('generateDialog')

// 指纹与公钥各用一份 clipboard：共用会让复制指纹时公钥按钮也跳成"已复制"。
// copiedDuring 给到 1.6s，够看清反馈再回到默认态
const fingerprintClip = useClipboard({ copiedDuring: 1600 })
const publicKeyClip = useClipboard({ copiedDuring: 1600 })

/** 删除前确认：密钥删掉就找不回来了，且远端的 authorized_keys 还留着废条目 */
async function confirmDelete(keyId: string, label: string): Promise<void> {
  if (!window.confirm(`确定删除密钥 ${label} 吗？私钥与公钥文件都会从 ~/.ssh 移除，且无法恢复。`))
    return

  await remove(keyId).catch(() => {
    // 失败原因已存进 error 并展示在列表顶部
  })
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
  }
  catch (err) {
    // Tauri 的结构化 AppError 是普通对象，String(err) 只会得到 [object Object]。
    // composable 已用统一的 errorMessage 提取过可读文案，优先回传那一份。
    dialogRef.value?.fail(error.value || (err instanceof Error ? err.message : String(err)))
  }
}
</script>

<template>
  <div class="pane flex-1 flex-row">
    <!-- 密钥列表 -->
    <nav class="flex w-68 shrink-0 flex-col border-r border-line-soft bg-panel">
      <header class="flex h-10 shrink-0 items-center gap-1 border-b border-line-soft pl-3 pr-2">
        <p class="flex-1 text-[11px] font-medium text-txt-2">
          Keys
          <span class="text-txt-4">({{ keys.length }})</span>
        </p>
        <IconButton icon="lucide:refresh-cw" :size="14" title="重新扫描" @click="refresh" />
        <IconButton icon="lucide:plus" :size="14" title="生成新密钥" @click="generateOpen = true" />
      </header>

      <div class="shrink-0 px-2 pb-1 pt-2">
        <SearchField v-model="keyword" icon="lucide:search" placeholder="搜索密钥…" />
      </div>

      <!-- 扫描失败：给出原因，而不是让列表静默空着 -->
      <p v-if="error" class="mx-2 mb-1 rounded border border-danger/30 bg-danger/10 px-2 py-1.5 text-[11px] text-danger">
        {{ error }}
      </p>

      <div class="min-h-0 flex-1 overflow-y-auto p-1.5 scroll-thin">
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
            <span class="block truncate text-xs text-txt">{{ key.label }}</span>
            <span class="block truncate text-[10.5px] text-txt-4">
              {{ SSH_KEY_KIND_META[key.kind].label }} · {{ key.bits }} bits
            </span>
          </span>
          <!-- tooltip 挂在 span 上：SVG 元素的 title 属性不会触发浏览器提示 -->
          <span v-if="key.encrypted" class="shrink-0" title="私钥有口令保护">
            <AppIcon name="lucide:lock" :size="11" class="text-txt-4" />
          </span>
          <span v-if="defaultPrivateKey === key.id" class="shrink-0" title="默认私钥">
            <AppIcon name="lucide:star" :size="12" class="text-violet" />
          </span>
        </button>

        <p v-if="loading" class="py-8 text-center text-xs text-txt-4">
          正在扫描 ~/.ssh …
        </p>
        <p v-else-if="!visibleKeys.length" class="py-8 text-center text-xs text-txt-4">
          {{ keyword ? '没有匹配的密钥' : '~/.ssh 下没有找到密钥' }}
        </p>
      </div>
    </nav>

    <!-- 详情 -->
    <div v-if="current" class="flex min-w-0 flex-1 flex-col">
      <header class="flex h-10 shrink-0 items-center gap-2 border-b border-line-soft pl-3.5 pr-2">
        <h2 class="truncate text-[13px] font-medium text-txt">
          {{ current.label }}
        </h2>
        <span class="shrink-0 rounded border border-line bg-card px-1.5 py-0.5 text-[10px] font-medium text-txt-2">
          {{ SSH_KEY_KIND_META[current.kind].label }}
        </span>
        <span
          v-if="defaultPrivateKey === current.id"
          class="shrink-0 rounded bg-violet/15 px-1.5 py-0.5 text-[10px] font-medium text-violet"
        >
          Default
        </span>
        <div class="flex-1" />
        <IconButton
          icon="lucide:star"
          :size="14"
          :title="defaultPrivateKey === current.id ? '当前默认私钥' : '设为默认私钥'"
          :disabled="defaultPrivateKey === current.id"
          :class="defaultPrivateKey === current.id ? 'text-violet opacity-100' : ''"
          @click="setDefaultPrivateKey(current.id)"
        />
        <IconButton
          icon="lucide:trash-2"
          :size="14"
          title="删除密钥"
          @click="confirmDelete(current.id, current.label)"
        />
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin">
        <!-- 元信息 -->
        <div class="mb-5 grid grid-cols-2 gap-2.5">
          <div class="card px-3 py-2.5">
            <p class="text-[11px] text-txt-3">
              Modified
            </p>
            <p class="mt-1 text-xs text-txt" :title="formatDate(current.modifiedAt)">
              {{ formatRelative(current.modifiedAt) }}
            </p>
          </div>
          <div class="card px-3 py-2.5">
            <p class="text-[11px] text-txt-3">
              Comment
            </p>
            <p class="mt-1 truncate text-xs text-txt" :title="current.comment">
              {{ current.comment || '—' }}
            </p>
          </div>
          <div class="card px-3 py-2.5">
            <p class="text-[11px] text-txt-3">
              Length
            </p>
            <p class="mt-1 text-xs text-txt">
              {{ current.bits }} bits
            </p>
          </div>
          <div class="card px-3 py-2.5">
            <p class="text-[11px] text-txt-3">
              Passphrase
            </p>
            <p class="mt-1 flex items-center gap-1.5 text-xs text-txt">
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
          <h3 class="mb-2 text-[13px] font-medium text-txt-2">
            Path
          </h3>
          <div class="card px-3 py-2">
            <code class="block truncate font-mono text-[11.5px] text-txt-2" :title="current.id">{{ current.id }}</code>
          </div>
        </section>

        <!-- 指纹 -->
        <section class="mb-5">
          <h3 class="mb-2 text-[13px] font-medium text-txt-2">
            Fingerprint
          </h3>
          <div class="card flex items-center gap-2 px-3 py-2">
            <code class="min-w-0 flex-1 truncate font-mono text-[11.5px] text-txt-2">{{ current.fingerprint }}</code>
            <IconButton
              :icon="fingerprintClip.copied.value ? 'lucide:check' : 'lucide:copy'"
              :size="13"
              title="复制指纹"
              @click="fingerprintClip.copy(current.fingerprint)"
            />
          </div>
        </section>

        <!-- 公钥全文 -->
        <section>
          <div class="mb-2 flex items-center gap-2">
            <h3 class="flex-1 text-[13px] font-medium text-txt-2">
              Public key
            </h3>
            <button
              type="button"
              class="btn px-2 py-1 text-[11px]"
              @click="publicKeyClip.copy(current.publicKey)"
            >
              <AppIcon :name="publicKeyClip.copied.value ? 'lucide:check' : 'lucide:copy'" :size="12" />
              <span>{{ publicKeyClip.copied.value ? '已复制' : '复制' }}</span>
            </button>
          </div>
          <pre class="card overflow-x-auto whitespace-pre-wrap break-all bg-terminal px-3 py-2.5 font-mono text-[11.5px] leading-relaxed text-term-fg scroll-thin">{{ current.publicKey }}</pre>
        </section>
      </div>
    </div>

    <!-- 一把密钥都没有时的兜底 -->
    <div v-else class="flex min-w-0 flex-1 items-center justify-center">
      <div class="flex flex-col items-center gap-3 text-center">
        <div class="grid size-14 place-items-center rounded-2xl border border-line bg-card text-txt-3">
          <AppIcon name="lucide:key-round" :size="26" />
        </div>
        <p class="text-sm text-txt-2">
          还没有密钥
        </p>
        <p class="max-w-70 text-xs text-txt-4">
          生成一把新密钥，或把已有的放进 ~/.ssh
        </p>
        <button type="button" class="btn mt-1" @click="generateOpen = true">
          <AppIcon name="lucide:plus" :size="13" />
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
  </div>
</template>
