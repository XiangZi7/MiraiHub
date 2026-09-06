import { readonly } from 'vue'
import { storeToRefs } from 'pinia'
import { useTransfersStore } from '@/stores/transfers'
export type {
  FileTransferDirection,
  FileTransferTask,
} from '@/stores/transfers'
export function useFileTransfers() {
  const store = useTransfersStore()
  void store.ensureListener()
  const {
    activeTasks,
    completedTasks,
    failedTasks,
    unreadCount,
    hasUnreadError,
  } = storeToRefs(store)
  const {
    upload,
    download,
    pause,
    resume,
    cancel,
    pauseAll,
    resumeAll,
    clearSettled,
    markAllSeen,
    recordUploadError,
  } = store
  return {
    tasks: readonly(store.tasks),
    activeTasks,
    completedTasks,
    failedTasks,
    unreadCount,
    hasUnreadError,
    markAllSeen,
    recordUploadError,
    upload,
    download,
    pause,
    resume,
    cancel,
    pauseAll,
    resumeAll,
    clearSettled,
  }
}
