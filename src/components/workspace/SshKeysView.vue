<script setup lang="ts">
import { computed, reactive, toRefs } from 'vue'
import { useClipboard } from '@vueuse/core'
import AppIcon from '@/components/ui/AppIcon.vue'
import IconButton from '@/components/ui/IconButton.vue'
import SearchField from '@/components/ui/SearchField.vue'
import StatusDot from '@/components/ui/StatusDot.vue'
import { SSH_KEY_KIND_META, SSH_KEYS } from '@/constants/ssh-keys'
import { cn } from '@/utils/cn'

/**
 * SSH 密钥管理。
 * 左列表 + 右详情：密钥的数量不会多，但每把都要看全（指纹、公钥全文、授权到哪些机器），
 * 所以详情给足宽度，而不是塞进列表行里折叠展开。
 */

// 响应式状态
const state = reactive({
  // 选中的密钥 id
  selected: SSH_KEYS[0]?.id ?? '',
  // 列表搜索关键词
  keyword: '',
})

const { selected, keyword } = toRefs(state)

/** 按密钥名、指纹、已授权主机过滤 */
const visibleKeys = computed(() => {
  const kw = state.keyword.trim().toLowerCase()
  if (!kw)
    return SSH_KEYS

  return SSH_KEYS.filter(key =>
    key.label.toLowerCase().includes(kw)
    || key.fingerprint.toLowerCase().includes(kw)
    || key.hosts.some(host => host.toLowerCase().includes(kw)),
  )
})

/** 当前详情展示的密钥 */
const current = computed(() => SSH_KEYS.find(key => key.id === state.selected))

// 指纹与公钥各用一份 clipboard：共用会让复制指纹时公钥按钮也跳成"已复制"。
// copiedDuring 给到 1.6s，够看清反馈再回到默认态
const fingerprintClip = useClipboard({ copiedDuring: 1600 })
const publicKeyClip = useClipboard({ copiedDuring: 1600 })
</script>

<template>
  <div class="pane flex-1 flex-row">
    <!-- 密钥列表 -->
    <nav class="flex w-68 shrink-0 flex-col border-r border-line-soft bg-panel">
      <header class="flex h-10 shrink-0 items-center gap-1 border-b border-line-soft pl-3 pr-2">
        <p class="flex-1 text-[11px] font-medium text-txt-2">
          Keys
          <span class="text-txt-4">({{ SSH_KEYS.length }})</span>
        </p>
        <IconButton icon="lucide:file-key" :size="14" title="导入已有密钥" />
        <IconButton icon="lucide:plus" :size="14" title="生成新密钥" />
      </header>

      <div class="shrink-0 px-2 pb-1 pt-2">
        <SearchField v-model="keyword" icon="lucide:search" placeholder="搜索密钥…" />
      </div>

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
              <template v-if="key.hosts.length">· {{ key.hosts.length }} hosts</template>
            </span>
          </span>
          <!-- tooltip 挂在 span 上：SVG 元素的 title 属性不会触发浏览器提示 -->
          <span v-if="key.encrypted" class="shrink-0" title="私钥有口令保护">
            <AppIcon name="lucide:lock" :size="11" class="text-txt-4" />
          </span>
        </button>

        <p v-if="!visibleKeys.length" class="py-8 text-center text-xs text-txt-4">
          没有匹配的密钥
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
        <div class="flex-1" />
        <IconButton icon="lucide:download" :size="14" title="导出公钥" />
        <IconButton icon="lucide:ellipsis" :size="14" title="更多" />
      </header>

      <div class="min-h-0 flex-1 overflow-y-auto p-4 scroll-thin">
        <!-- 元信息 -->
        <div class="mb-5 grid grid-cols-2 gap-2.5">
          <div class="card px-3 py-2.5">
            <p class="text-[11px] text-txt-3">
              Created
            </p>
            <p class="mt-1 text-xs text-txt">
              {{ current.createdAt }}
            </p>
          </div>
          <div class="card px-3 py-2.5">
            <p class="text-[11px] text-txt-3">
              Last used
            </p>
            <p class="mt-1 text-xs text-txt">
              {{ current.lastUsed }}
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
        <section class="mb-5">
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

        <!-- 授权主机 -->
        <section>
          <h3 class="mb-2 text-[13px] font-medium text-txt-2">
            Authorized hosts
            <span class="text-txt-4">({{ current.hosts.length }})</span>
          </h3>

          <div v-if="current.hosts.length" class="card divide-y divide-line-soft overflow-hidden">
            <div
              v-for="host in current.hosts"
              :key="host"
              class="flex items-center gap-3 px-3.5 py-2.5 transition-colors hover:bg-raised"
            >
              <StatusDot :size="7" />
              <span class="flex-1 truncate text-xs text-txt-2">{{ host }}</span>
              <AppIcon name="lucide:chevron-right" :size="13" class="shrink-0 text-txt-4" />
            </div>
          </div>

          <p v-else class="card px-3.5 py-4 text-center text-xs text-txt-4">
            这把密钥还没授权到任何主机
          </p>
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
          生成一把新密钥，或从 ~/.ssh 导入已有的
        </p>
      </div>
    </div>
  </div>
</template>
