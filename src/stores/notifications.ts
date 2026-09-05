import { acceptHMRUpdate, defineStore } from "pinia";
import { computed, onScopeDispose, reactive } from "vue";
import { settingsSnapshot } from "@/composables/useSettings";
import { playNotificationSound } from "@/utils/sound";

import type {
  ToastTone,
  ToastInput,
  ToastItem,
  NotificationItem,
} from "@/types/notification";
interface ToastTimer {
  handle: ReturnType<typeof setTimeout>;
  remaining: number;
  startedAt: number;
  paused: boolean;
}

const DEFAULT_DURATIONS: Record<ToastTone, number> = {
  success: 3500,
  info: 4000,
  warning: 5000,
  error: 6500,
};

const MAX_VISIBLE_TOASTS = 4;
export const useNotificationsStore = defineStore("notifications", () => {
  const items = reactive<ToastItem[]>([]);

  const notifications = reactive<NotificationItem[]>([]);
  const timers = new Map<string, ToastTimer>();
  let nextId = 0;

  function dismiss(id: string): void {
    const timer = timers.get(id);
    if (timer) {
      clearTimeout(timer.handle);
      timers.delete(id);
    }

    const index = items.findIndex((item) => item.id === id);
    if (index !== -1) items.splice(index, 1);
  }

  function startTimer(id: string, duration: number): void {
    if (duration <= 0) return;

    const timer: ToastTimer = {
      handle: setTimeout(() => dismiss(id), duration),
      remaining: duration,
      startedAt: Date.now(),
      paused: false,
    };
    timers.set(id, timer);
  }

  function pause(id: string): void {
    const timer = timers.get(id);
    if (!timer || timer.paused) return;

    clearTimeout(timer.handle);
    timer.remaining = Math.max(
      0,
      timer.remaining - (Date.now() - timer.startedAt),
    );
    timer.paused = true;
  }

  function resume(id: string): void {
    const timer = timers.get(id);
    if (!timer || !timer.paused) return;

    if (timer.remaining <= 0) {
      dismiss(id);
      return;
    }

    timer.startedAt = Date.now();
    timer.paused = false;
    timer.handle = setTimeout(() => dismiss(id), timer.remaining);
  }

  function show(tone: ToastTone, input: ToastInput): string {
    const options = typeof input === "string" ? { title: input } : input;
    const title = options.title.trim();
    if (!title) return "";

    // 「错误与异常」通知关闭后，失败原因仍留在各自的面板里，只是不再弹出
    if (tone === "error" && !settingsSnapshot().notifyErrors) return "";

    const description = options.description?.trim() ?? "";
    const duplicate = items.find(
      (item) =>
        item.tone === tone &&
        item.title === title &&
        item.description === description,
    );
    if (duplicate) dismiss(duplicate.id);

    while (items.length >= MAX_VISIBLE_TOASTS) dismiss(items[0].id);

    const id = `toast-${Date.now()}-${nextId++}`;
    const duration = options.duration ?? DEFAULT_DURATIONS[tone];
    items.push({ id, tone, title, description, duration });
    notifications.unshift({
      id,
      tone,
      title,
      description,
      duration,
      createdAt: Date.now(),
      read: false,
    });
    notifications.splice(100);
    startTimer(id, duration);

    if (settingsSnapshot().notificationSound) playNotificationSound(tone);

    return id;
  }

  function clear(): void {
    for (const item of [...items]) dismiss(item.id);
  }

  onScopeDispose(clear);
  return {
    items,
    notifications,
    show,
    dismiss,
    clear,
    pause,
    resume,
    unreadCount: computed(
      () => notifications.filter((item) => !item.read).length,
    ),
    markAllRead: () => {
      for (const item of notifications) item.read = true;
    },
    clearNotifications: () => {
      notifications.splice(0);
    },
  };
});

if (import.meta.hot)
  import.meta.hot.accept(
    acceptHMRUpdate(useNotificationsStore, import.meta.hot),
  );
