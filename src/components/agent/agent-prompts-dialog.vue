<script setup lang="ts">
import { onMounted, reactive, toRefs } from 'vue'
import { useI18n } from 'vue-i18n'
import AppDialog from '@/components/ui/AppDialog.vue'
import AppButton from '@/components/ui/AppButton.vue'
import { listAgentPrompts, saveAgentPrompts, type AgentPrompt } from '@/api/agent-prompts'
import { toast } from '@/composables/useToast'
const emit = defineEmits<{ close: []; saved: [] }>()
const { t } = useI18n()
// 响应式状态
const state = reactive({
  // 可独立编辑的模板草稿
  items: [] as AgentPrompt[],
})
const { items } = toRefs(state)
// 读取模板失败时阻止覆盖损坏的数据。
onMounted(() => { try { state.items = listAgentPrompts() } catch (error) { toast.error(String(error)); emit('close') } })
/** 保存并通知输入框重新加载模板列表。 */
function save(): void {
  try { saveAgentPrompts(state.items); emit('saved'); emit('close'); toast.success(t('已保存')) }
  catch (error) { toast.error({ title: t('保存模板失败'), description: String(error) }) }
}
/** 新建一个独立模板，编辑内容不立即写入存储。 */
function add(): void { state.items.push({ id: crypto.randomUUID(), name: '/', content: '' }) }
</script>
<template>
  <AppDialog :title="t('管理提示词模板')" wide @close="emit('close')">
    <div class="scroll-thin grid max-h-96 gap-3 overflow-auto p-4">
      <div v-for="(item, index) in items" :key="item.id" class="border-line grid gap-2 rounded border p-3">
        <label class="grid gap-1 text-xs">{{ t('斜杠命令') }}<input v-model="item.name" class="field" maxlength="31" /></label>
        <label class="grid gap-1 text-xs">{{ t('提示词内容') }}<textarea v-model="item.content" class="field min-h-24" maxlength="16000" /></label>
        <AppButton size="sm" @click="items.splice(index, 1)">{{ t('删除') }}</AppButton>
      </div>
    </div>
    <div class="border-line flex gap-2 border-t p-4"><AppButton :disabled="items.length >= 50" @click="add">{{ t('添加') }}</AppButton><AppButton class="ml-auto" variant="primary" @click="save">{{ t('保存') }}</AppButton></div>
  </AppDialog>
</template>
