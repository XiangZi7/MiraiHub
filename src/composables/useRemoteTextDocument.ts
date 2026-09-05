import { computed, onBeforeUnmount, onMounted, reactive, watch } from "vue";
import { useClipboard, useEventListener } from "@vueuse/core";
import * as api from "@/api/operations";
import type { RemoteEditRequest } from "@/composables/useRemoteEditor";
import { scheduleClipboardClear } from "@/utils/clipboard";

export function useRemoteTextDocument(
  request: RemoteEditRequest,
  standalone: boolean,
  onClose: () => void,
  onStatus: (dirty: boolean, busy: boolean) => void,
) {
  // 响应式状态
  const state = reactive({
    // 后端文件快照，保存时用于冲突检查
    document: null as api.TextDocument | null,
    // 用户编辑的草稿，仅保留在当前窗口内存中
    draft: "",
    // 读取或保存期间锁定编辑操作
    busy: false,
    // 最近一次读写错误
    error: "",
    // 保存结果或窗口关闭提示
    message: "",
    // 是否正在预览待保存内容
    reviewing: false,
    // 本次确认保存的固定内容
    reviewedText: "",
    // 待确认的放弃草稿动作
    discard: "" as "" | "close" | "reload",
  });

  const dirty = computed(
    () => !!state.document && state.draft !== state.document.text,
  );
  const lines = computed(() => state.draft.split("\n").length);
  const bytes = computed(() => new TextEncoder().encode(state.draft).length);
  const { copy } = useClipboard();
  let alive = true;
  async function load(): Promise<void> {
    if (state.busy) return;
    state.busy = true;
    state.error = "";
    state.message = "";
    state.reviewing = false;
    try {
      const doc = await api.openText(request.sessionId, request.path);
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
    if (state.busy) {
      state.message = "正在读取或保存，请稍后再关闭窗口。";
      return;
    }
    if (!state.busy) {
      if (dirty.value) state.discard = "close";
      else onClose();
    }
  }
  function requestReload(): void {
    if (dirty.value) state.discard = "reload";
    else void load();
  }
  function confirmDiscard(): void {
    const action = state.discard;
    state.discard = "";
    if (action === "close") onClose();
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
    if (!standalone && (dirty.value || state.busy)) {
      event.preventDefault();
      event.returnValue = "";
    }
  });
  onMounted(() => {
    void load();
  });
  watch(
    () => [dirty.value, state.busy] as const,
    ([dirty, busy]) => onStatus(dirty, busy),
    { flush: "sync" },
  );
  onBeforeUnmount(() => {
    alive = false;
    if (state.document) void api.closeText(state.document.id).catch(() => {});
  });

  return {
    state,
    dirty,
    lines,
    bytes,
    requestClose,
    requestReload,
    confirmDiscard,
    review,
    save,
    copyDraft,
  };
}
