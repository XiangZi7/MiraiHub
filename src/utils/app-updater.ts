import type { DownloadEvent } from '@tauri-apps/plugin-updater'

export type UpdatePhase =
  | 'idle'
  | 'checking'
  | 'latest'
  | 'downloading'
  | 'ready'
  | 'installing'
  | 'error'
  | 'unsupported'
export interface UpdateState {
  phase: UpdatePhase
  version: string
  downloaded: number
  total: number
  error: string
  errorStage: '' | 'check' | 'download' | 'install'
  reason: string
  deferred: boolean
  dismissed: boolean
}
export const initialUpdateState = (): UpdateState => ({
  phase: 'idle',
  version: '',
  downloaded: 0,
  total: 0,
  error: '',
  errorStage: '',
  reason: '',
  deferred: false,
  dismissed: false,
})

export interface UpdatePackage {
  version: string
  download: (
    onEvent: (event: DownloadEvent) => void,
    options: { timeout: number }
  ) => Promise<void>
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
  let automatic = false
  let checkFailures = 0
  let checkTimer: ReturnType<typeof setTimeout> | undefined
  const normalInterval = 6 * 60 * 60 * 1000
  const retryIntervals = [60_000, 5 * 60_000, 15 * 60_000]
  const change = (patch: Partial<UpdateState>) => {
    Object.assign(state, patch)
    options.changed()
  }
  async function release() {
    const update = pending
    pending = null
    await update?.close().catch(() => {})
  }
  function clearCheckTimer() {
    clearTimeout(checkTimer)
    checkTimer = undefined
  }
  function scheduleCheck(delay: number) {
    clearCheckTimer()
    if (!automatic || disposed || !options.enabled()) return
    checkTimer = setTimeout(() => {
      checkTimer = undefined
      if (options.enabled()) void check()
    }, delay)
  }
  async function check() {
    if (
      disposed ||
      busy ||
      pending ||
      state.phase === 'unsupported' ||
      state.phase === 'installing'
    )
      return
    clearCheckTimer()
    busy = true
    change({
      phase: 'checking',
      error: '',
      errorStage: '',
      version: '',
      downloaded: 0,
      total: 0,
    })
    try {
      pending = await options.check()
      if (disposed) return
      if (!pending) {
        change({ phase: 'latest', dismissed: false })
        return
      }
      change({
        phase: 'downloading',
        version: pending.version,
        dismissed: false,
      })
      await pending.download(
        event => {
          if (disposed) return
          if (event.event === 'Started')
            change({ total: event.data.contentLength ?? 0, downloaded: 0 })
          if (event.event === 'Progress')
            change({ downloaded: state.downloaded + event.data.chunkLength })
          // Finished precedes signature verification. Only the resolved download
          // promise means the bytes are verified and eligible for installation.
        },
        { timeout: 10 * 60 * 1000 }
      )
      if (!disposed) change({ phase: 'ready', dismissed: false })
    } catch (error) {
      const errorStage = state.phase === 'downloading' ? 'download' : 'check'
      await release()
      if (!disposed)
        change({ phase: 'error', error: String(error), errorStage })
    } finally {
      if (disposed) await release()
      busy = false
      if (state.phase === 'error' && state.errorStage === 'check') {
        // A release can briefly lack its manifest, or GitHub can be offline.
        // Retry with backoff, then return to the normal interval.
        scheduleCheck(retryIntervals[checkFailures++] ?? normalInterval)
      } else {
        checkFailures = 0
        // Download/verification failures keep the normal cadence; only manifest
        // checks get fast retries. A retry always obtains a fresh signed package.
        if (state.phase === 'latest' || state.phase === 'error')
          scheduleCheck(normalInterval)
      }
    }
  }
  async function installWhenIdle() {
    if (
      disposed ||
      busy ||
      !pending ||
      state.phase !== 'ready' ||
      state.deferred ||
      (!options.enabled() && !requested)
    )
      return
    busy = true
    try {
      // Recheck preferences after the native round trip: the user may have
      // paused installation while the window/session preflight was pending.
      if (
        !(await options.canInstall()) ||
        disposed ||
        state.deferred ||
        (!options.enabled() && !requested)
      )
        return
      change({ phase: 'installing', dismissed: false })
      await pending.install()
    } catch (error) {
      await release()
      if (!disposed)
        change({ phase: 'error', error: String(error), errorStage: 'install' })
      scheduleCheck(normalInterval)
    } finally {
      if (disposed) await release()
      busy = false
    }
  }
  return {
    check,
    installWhenIdle,
    startAutoChecks: () => {
      automatic = true
      scheduleCheck(15_000)
    },
    refreshAutoChecks: () => {
      checkFailures = 0
      clearCheckTimer()
      if (state.phase === 'error' && state.errorStage !== 'check') {
        scheduleCheck(normalInterval)
        return
      }
      scheduleCheck(0)
    },
    retryOnReconnect: () => {
      if (state.phase === 'error' && state.errorStage === 'check')
        scheduleCheck(0)
    },
    dismiss: () => change({ dismissed: true }),
    defer: () => {
      requested = false
      change({ deferred: true })
    },
    resume: () => {
      requested = true
      change({ deferred: false })
    },
    async dispose() {
      disposed = true
      clearCheckTimer()
      if (!busy) await release()
    },
  }
}
