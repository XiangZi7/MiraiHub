<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, reactive, toRefs } from "vue";
import { useClipboard, useEventListener } from "@vueuse/core";
import * as api from "@/api/operations";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { IS_TAURI } from "@/utils/window";
import OperationDialog from "./OperationDialog.vue";
import AppButton from "@/components/ui/AppButton.vue";
import AppConfirmDialog from "@/components/ui/AppConfirmDialog.vue";
import { scheduleClipboardClear } from "@/utils/clipboard";
const props = defineProps<{
  sessionId: string;
  path: string;
  connectionName: string;
}>();
const emit = defineEmits<{ close: [] }>();
const state = reactive({
  document: null as api.TextDocument | null,
  draft: "",
  busy: false,
  error: "",
  message: "",
  reviewing: false,
  reviewedText: "",
  discard: "" as "" | "close" | "reload",
});
const {
  document: remote,
  draft,
  busy,
  error,
  message,
  reviewing,
  reviewedText,
  discard,
} = toRefs(state);
const dirty = computed(
  () => !!state.document && state.draft !== state.document.text,
);
const lines = computed(() => state.draft.split("\n").length);
const bytes = computed(() => new TextEncoder().encode(state.draft).length);
const { copy } = useClipboard();
let alive = true;
let unlistenClose: (() => void) | undefined;
async function load(): Promise<void> {
  if (state.busy) return;
  state.busy = true;
  state.error = "";
  state.message = "";
  state.reviewing = false;
  try {
    const doc = await api.openText(props.sessionId, props.path);
    if (!alive) {
      void api.closeText(doc.id).catch(() => {});
      return;
    }
    const previous = state.document;
    state.document = doc;
    state.draft = doc.text;
    if (previous) void api.closeText(previous.id).catch(() => {});
  } catch (error) {
    if (alive) state.error = api.errorMessage(error);
  } finally {
    state.busy = false;
  }
}
function review(): void {
  if (!dirty.value || state.busy) return;
  if (bytes.value > 1024 * 1024) {
    state.error = "草稿超过 1 MB，请缩短后再保存";
    return;
  }
  state.reviewedText = state.draft;
  state.reviewing = true;
  state.error = "";
  state.message = "";
}
async function save(): Promise<void> {
  if (!state.reviewing || !state.document || state.busy) return;
  state.busy = true;
  state.error = "";
  try {
    const doc = await api.saveText(state.document.id, state.reviewedText);
    state.document = doc;
    state.draft = doc.text;
    state.reviewing = false;
    state.message = doc.backupPath
      ? `已保存。原内容备份：${doc.backupPath}`
      : "内容没有变化";
  } catch (error) {
    state.error = api.errorMessage(error);
    state.reviewing = false;
  } finally {
    state.busy = false;
  }
}
function requestClose(): void {
  if (!state.busy) {
    if (dirty.value) state.discard = "close";
    else emit("close");
  }
}
function requestReload(): void {
  if (dirty.value) state.discard = "reload";
  else void load();
}
function confirmDiscard(): void {
  const action = state.discard;
  state.discard = "";
  if (action === "close") emit("close");
  else if (action === "reload") void load();
}
async function copyDraft(): Promise<void> {
  try {
    await copy(state.draft);
    scheduleClipboardClear(state.draft);
    state.message = "草稿已复制";
  } catch (error) {
    state.error = api.errorMessage(error);
  }
}
useEventListener(window, "keydown", (event: KeyboardEvent) => {
  if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
    event.preventDefault();
    event.stopPropagation();
    if (!state.discard && !state.reviewing) review();
  }
});
useEventListener(window, "beforeunload", (event: BeforeUnloadEvent) => {
  if (dirty.value || state.busy) {
    event.preventDefault();
    event.returnValue = "";
  }
});
onMounted(() => {
  void load();
  if (IS_TAURI)
    void getCurrentWindow()
      .onCloseRequested((event) => {
        if (dirty.value || state.busy) {
          event.preventDefault();
          state.message =
            "请先保存草稿，或关闭编辑器并确认放弃修改，再退出程序。";
        }
      })
      .then((unlisten) => {
        if (alive) unlistenClose = unlisten;
        else unlisten();
      })
      .catch(() => {});
});
onBeforeUnmount(() => {
  alive = false;
  unlistenClose?.();
  if (state.document) void api.closeText(state.document.id).catch(() => {});
});
</script>
<template>
  <OperationDialog
    title="远端文本编辑器"
    wide
    :busy="busy"
    @close="requestClose"
  >
    <div class="editor-target">
      <strong>{{ remote?.endpoint || connectionName }}</strong
      ><code>{{ remote?.path || path }}</code>
    </div>
    <div class="editor-toolbar">
      <span
        >{{ dirty ? "未保存" : "已同步" }} · UTF-8{{
          remote?.bom ? " BOM" : ""
        }}
        · {{ remote?.lineEnding || "LF" }} · {{ lines }} 行 ·
        {{ (bytes / 1024).toFixed(1) }} KB</span
      >
      <div class="flex-1" />
      <AppButton size="sm" :disabled="busy || reviewing" @click="requestReload"
        >重新加载</AppButton
      ><AppButton size="sm" :disabled="!remote" @click="copyDraft"
        >复制草稿</AppButton
      ><AppButton
        variant="primary"
        size="sm"
        :disabled="!dirty || busy || reviewing"
        @click="review"
        >预览并保存 · Ctrl+S</AppButton
      >
    </div>
    <p v-if="error" role="alert" class="editor-notice text-danger">
      {{ error }}
    </p>
    <p v-if="message" role="status" class="editor-notice text-success">
      {{ message }}
    </p>
    <template v-if="reviewing && remote">
      <p class="text-[12px] text-warning">
        核对以下完整内容后，确认保存到上方服务器与路径。
      </p>
      <div class="editor-review">
        <label
          >打开时的内容<textarea
            :value="remote.text"
            readonly
            spellcheck="false"
            aria-label="保存前的远端内容"
          /></label
        ><label
          >即将保存的内容<textarea
            :value="reviewedText"
            readonly
            spellcheck="false"
            aria-label="即将保存的内容"
          />
        </label>
      </div>
      <div class="flex justify-end gap-2">
        <AppButton :disabled="busy" @click="reviewing = false"
          >返回编辑</AppButton
        ><AppButton variant="primary" :disabled="busy" @click="save">{{
          busy ? "正在检查并保存…" : "确认保存到远端"
        }}</AppButton>
      </div>
    </template>
    <textarea
      v-else
      v-model="draft"
      class="editor-input"
      :disabled="busy || !remote"
      spellcheck="false"
      aria-label="远端文件内容"
      :placeholder="busy ? '正在读取远端文本…' : '打开文件后即可编辑'"
    />
    <p class="editor-help">
      支持 1 MB 以内的 UTF-8
      普通文件。保存前检查冲突并保留原内容备份，使用原子替换；保留基本权限、所有者及换行格式。特殊
      ACL、扩展属性和硬链接关系不保留。
    </p>
  </OperationDialog>
  <AppConfirmDialog
    :open="!!discard"
    :title="discard === 'close' ? '关闭未保存的文件？' : '放弃草稿并重新加载？'"
    description="当前修改尚未保存。可以取消并复制草稿，避免丢失编辑内容。"
    confirm-label="放弃修改"
    danger
    @close="discard = ''"
    @confirm="confirmDiscard"
  />
</template>
<style scoped>
.editor-target {
  display: flex;
  flex-direction: column;
  gap: 5px;
  min-width: 0;
  font-size: 12px;
}
.editor-target strong {
  color: var(--color-accent);
}
.editor-target code {
  overflow-wrap: anywhere;
  color: var(--color-txt-3);
}
.editor-toolbar {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 8px;
}
.editor-toolbar > span {
  font-size: 10px;
  color: var(--color-txt-3);
}
.editor-input,
.editor-review textarea {
  width: 100%;
  resize: none;
  min-height: 180px;
  padding: 14px;
  border: 1px solid var(--color-line);
  border-radius: 7px;
  background: var(--color-base);
  color: var(--color-txt);
  font:
    12px/1.8 "JetBrains Mono",
    monospace;
  tab-size: 2;
  white-space: pre;
  overflow: auto;
}
.editor-input {
  flex: 1;
}
.editor-review {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 12px;
  flex: 1;
  min-height: 180px;
}
.editor-review label {
  display: flex;
  flex-direction: column;
  gap: 8px;
  min-width: 0;
  font-size: 11px;
  color: var(--color-txt-3);
}
.editor-review textarea {
  flex: 1;
}
.editor-help {
  font-size: 10px;
  line-height: 1.7;
  color: var(--color-txt-4);
}
.editor-notice {
  font-size: 11px;
  line-height: 1.7;
  overflow-wrap: anywhere;
  white-space: pre-wrap;
  max-height: 130px;
  overflow: auto;
}
@media (max-width: 700px) {
  .editor-review {
    grid-template-columns: 1fr;
    overflow: auto;
  }
}
</style>
