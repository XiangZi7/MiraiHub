import type { DownloadEvent } from '@tauri-apps/plugin-updater'

export type UpdatePhase = 'idle' | 'checking' | 'latest' | 'downloading' | 'ready' | 'installing' | 'error' | 'unsupported'
export interface UpdateState {
  phase: UpdatePhase
  version: string
  downloaded: number
  total: number
  error: string
  reason: string
  deferred: boolean
}
export const initialUpdateState = (): UpdateState => ({
  phase: 'idle', version: '', downloaded: 0, total: 0, error: '', reason: '', deferred: false,
})

export interface UpdatePackage {
  version: string
  download: (onEvent: (event: DownloadEvent) => void, options: { timeout: number }) => Promise<void>
  install: () => Promise<void>
  close: () => Promise<void>
}

/** One controller per application, independent of Vue and native event routing. */
export function createUpdateController(options: {
  state: UpdateState
  check: () => Promise<UpdatePackage | null>
  canInstall: () => Promise<boolean>
  enabled: () => boolean
  changed: () => void
}) {
  const { state } = options
  let pending: UpdatePackage | null = null
  let busy = false
  let disposed = false
  let requested = false
  const change = (patch: Partial<UpdateState>) => {
    Object.assign(state, patch)
    options.changed()
  }
  async function release() {
    const update = pending
    pending = null
    await update?.close().catch(() => {})
  }
  async function check() {
    if (disposed || busy || pending || state.phase === 'unsupported' || state.phase === 'installing') return
    busy = true
    change({ phase: 'checking', error: '', version: '', downloaded: 0, total: 0 })
    try {
      pending = await options.check()
      if (disposed) return
      if (!pending) {
        change({ phase: 'latest' })
        return
      }
      change({ phase: 'downloading', version: pending.version })
      await pending.download(event => {
        if (disposed) return
        if (event.event === 'Started') change({ total: event.data.contentLength ?? 0, downloaded: 0 })
        if (event.event === 'Progress') change({ downloaded: state.downloaded + event.data.chunkLength })
        // Finished precedes signature verification. Only the resolved download
        // promise means the bytes are verified and eligible for installation.
      }, { timeout: 10 * 60 * 1000 })
      if (!disposed) change({ phase: 'ready' })
    } catch (error) {
      await release()
      if (!disposed) change({ phase: 'error', error: String(error) })
    } finally {
      if (disposed) await release()
      busy = false
    }
  }
  async function installWhenIdle() {
    if (disposed || busy || !pending || state.phase !== 'ready' || state.deferred || (!options.enabled() && !requested)) return
    busy = true
    try {
      // Recheck preferences after the native round trip: the user may have
      // paused installation while the window/session preflight was pending.
      if (!await options.canInstall() || disposed || state.deferred || (!options.enabled() && !requested)) return
      change({ phase: 'installing' })
      await pending.install()
    } catch (error) {
      await release()
      change({ phase: 'error', error: String(error) })
    } finally {
      busy = false
    }
  }
  return {
    check,
    installWhenIdle,
    defer: () => { requested = false; change({ deferred: true }) },
    resume: () => { requested = true; change({ deferred: false }) },
    async dispose() {
      disposed = true
      if (!busy) await release()
    },
  }
}
