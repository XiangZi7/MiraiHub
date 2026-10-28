import { watch, type WatchSource } from 'vue'
import { toast } from '@/composables/useToast'
import { translateNativeMessage } from '@/i18n/native'

export function notifyAgentError(message: string): void {
  if (message) toast.error(translateNativeMessage(message))
}

/** Agent errors use the application's shared bottom-right notification host. */
export function useAgentErrorToasts(
  ...sources: WatchSource<string | undefined>[]
): void {
  for (const source of sources)
    watch(source, message => {
      if (message) notifyAgentError(message)
    })
}
