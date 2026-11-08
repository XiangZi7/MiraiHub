<script setup lang="ts">
import { useI18n } from 'vue-i18n'

import { computed, onMounted, reactive, toRefs } from 'vue'
import AppButton from '@/components/ui/AppButton.vue'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppSelect from '@/components/ui/AppSelect.vue'
import * as connections from '@/api/connections'
import { errorMessage } from '@/api/ssh'
import { deployPublicKey } from '@/api/ssh-keys-config'
import { toast } from '@/composables/useToast'
import { isSshConnection, type SavedConnection } from '@/types/connection'

const { t } = useI18n()

/**
 * 把本地公钥部署到服务器（等价于 ssh-copy-id）。
 * 选一条已保存的 SSH 连接，临时连上后把公钥去重追加到远端 ~/.ssh/authorized_keys。
 */

const props = defineProps<{
  /** 私钥路径，即密钥 id */
  keyId: string
  /** 密钥显示名 */
  keyLabel: string
}>()
const emit = defineEmits<{ close: [] }>()

// 响应式状态
const state = reactive({
  // 是否正在读取已保存连接
  loading: true,
  // 是否正在部署
  deploying: false,
  // 可选的已保存 SSH 连接
  targets: [] as SavedConnection[],
  // 选中的连接 id
  connectionId: '',
  // 部署失败的原因
  error: '',
})
const { loading, deploying, targets, connectionId, error } = toRefs(state)

// 下拉选项：名称 + user@host:port
const options = computed(() =>
  state.targets.map(item => ({
    value: item.id,
    label: item.name,
    description: `${item.username}@${item.host}:${item.port}`,
    icon: 'lucide:server',
  }))
)

onMounted(loadTargets)

// 读取已保存的 SSH 连接，默认选中第一条
async function loadTargets(): Promise<void> {
  state.loading = true
  try {
    state.targets = (await connections.list()).filter(isSshConnection)
    state.connectionId = state.targets[0]?.id ?? ''
  } catch (caught) {
    state.error = errorMessage(caught)
  } finally {
    state.loading = false
  }
}

// 连接到选中的服务器并部署公钥，根据结果提示已追加或已存在
async function deploy(): Promise<void> {
  if (!state.connectionId || state.deploying) return
  const target = state.targets.find(item => item.id === state.connectionId)
  state.deploying = true
  state.error = ''
  try {
    const result = await deployPublicKey(state.connectionId, props.keyId)
    const name = target?.name ?? ''
    if (result.status === 'exists')
      toast.success({
        title: t('公钥已存在于“{value0}”', { value0: name }),
        description: t('远端 authorized_keys 已包含该公钥，未重复添加。'),
      })
    else
      toast.success({
        title: t('公钥已部署到“{value0}”', { value0: name }),
        description: result.fingerprint,
      })
    emit('close')
  } catch (caught) {
    state.error = errorMessage(caught)
  } finally {
    state.deploying = false
  }
}
</script>

<template>
  <AppDialog
    :title="t('部署到服务器')"
    :description="
      t('将“{value0}”的公钥追加到远端 ~/.ssh/authorized_keys，已存在时不会重复添加。', {
        value0: keyLabel,
      })
    "
    @close="emit('close')"
  >
    <p
      v-if="!loading && !targets.length"
      class="text-txt-3 text-[11px]"
    >
      {{ t('还没有已保存的 SSH 连接') }}
    </p>
    <AppSelect
      v-else
      v-model="connectionId"
      :label="t('目标服务器')"
      :options="options"
      :placeholder="loading ? t('加载中…') : t('选择 SSH 连接')"
      :disabled="loading || deploying"
      searchable
    />
    <p
      v-if="error"
      role="alert"
      class="text-danger mt-2.5 text-[11px] break-all"
    >
      {{ error }}
    </p>

    <template #footer>
      <div class="flex-1" />
      <AppButton
        :disabled="deploying"
        @click="emit('close')"
      >
        {{ t('取消') }}
      </AppButton>
      <AppButton
        variant="primary"
        :disabled="loading || deploying || !connectionId"
        @click="deploy"
      >
        {{ deploying ? t('部署中…') : t('部署') }}
      </AppButton>
    </template>
  </AppDialog>
</template>
