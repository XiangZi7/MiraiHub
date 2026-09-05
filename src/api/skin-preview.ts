import { emitTo, listen } from '@tauri-apps/api/event'
import { DEFAULT_SETTINGS } from '@/types/settings'
import { IS_TAURI } from '@/utils/window'
import { readSkinLibrary, skinPreset, type SkinSettings } from '@/utils/skin'

const PREVIEW_EVENT = 'miraihub:skin-preview'
const appearanceKeys = Object.keys(skinPreset()) as (keyof ReturnType<
  typeof skinPreset
>)[]
const skinKeys = ['skinTheme', 'skinLibrary', ...appearanceKeys] as const

export interface SkinPreviewMessage {
  sessionId: string
  revision: number
  skin: SkinSettings | null
}

/** Send only skin settings and the selected custom card, never the entire settings draft. */
export function skinPreviewSnapshot(values: SkinSettings): SkinSettings {
  const skin = {
    ...skinPreset(),
    skinTheme: values.skinTheme,
    skinLibrary: '[]',
  }
  const custom = readSkinLibrary(values.skinLibrary).find(
    item => item.id === values.skinTheme
  )
  if (custom) skin.skinLibrary = JSON.stringify([custom])
  else for (const key of appearanceKeys) skin[key] = values[key]
  return skin
}

/** A session owns temporary appearance only; ending it never writes saved settings. */
export function createSkinPreviewSession() {
  const sessionId = crypto.randomUUID()
  const channel = !IS_TAURI ? new BroadcastChannel(PREVIEW_EVENT) : undefined
  let revision = 0
  let ended = false
  let pending: SkinSettings | undefined
  let timer: ReturnType<typeof setTimeout> | undefined
  let delivery = Promise.resolve()

  function send(skin: SkinSettings | null): void {
    const message: SkinPreviewMessage = {
      sessionId,
      revision: ++revision,
      skin,
    }
    if (channel) channel.postMessage(message)
    else {
      // Serialize native IPC so a slow preview cannot arrive after its rollback.
      delivery = delivery
        .then(() => emitTo('main', PREVIEW_EVENT, message))
        .catch(error => {
          console.warn('同步皮肤预览失败：', error)
        })
    }
  }
  function preview(skin: SkinSettings): void {
    if (ended) return
    pending = skin
    if (timer) return
    timer = setTimeout(() => {
      timer = undefined
      if (pending && !ended) send(pending)
      pending = undefined
    }, 40)
  }
  function end(): Promise<void> {
    if (!ended) {
      ended = true
      clearTimeout(timer)
      pending = undefined
      send(null)
      channel?.close()
    }
    return delivery
  }
  return { preview, end }
}

/** Ignore delayed frames from cancelled visits, including rapid close/reopen. */
export function createSkinPreviewReceiver(
  onChange: (skin: SkinSettings | null) => void
) {
  const revisions = new Map<string, number>()
  let activeSession: string | undefined
  return (value: unknown): void => {
    if (!value || typeof value !== 'object') return
    const message = value as Partial<SkinPreviewMessage>
    if (
      typeof message.sessionId !== 'string' ||
      !message.sessionId ||
      !Number.isSafeInteger(message.revision) ||
      message.revision! < 1 ||
      message.revision! <= (revisions.get(message.sessionId) ?? 0)
    )
      return
    if (
      message.skin !== null &&
      (!message.skin ||
        skinKeys.some(
          key => typeof message.skin![key] !== typeof DEFAULT_SETTINGS[key]
        ))
    )
      return
    revisions.set(
      message.sessionId,
      message.skin === null ? Infinity : message.revision!
    )
    if (message.skin === null) {
      if (!activeSession || activeSession === message.sessionId) {
        activeSession = undefined
        onChange(null)
      }
    } else {
      if (activeSession && activeSession !== message.sessionId)
        revisions.set(activeSession, Infinity)
      activeSession = message.sessionId
      onChange(message.skin!)
    }
  }
}

export function subscribeSkinPreview(
  onChange: (skin: SkinSettings | null) => void
): () => void {
  const receive = createSkinPreviewReceiver(onChange)
  if (!IS_TAURI) {
    const channel = new BroadcastChannel(PREVIEW_EVENT)
    channel.onmessage = event => receive(event.data)
    return () => channel.close()
  }
  let disposed = false
  let stop: (() => void) | undefined
  void listen<unknown>(PREVIEW_EVENT, event => receive(event.payload))
    .then(unlisten => {
      if (disposed) unlisten()
      else stop = unlisten
    })
    .catch(error => console.warn('订阅皮肤预览失败：', error))
  return () => {
    disposed = true
    stop?.()
  }
}
