import { onBeforeUnmount, reactive, toRefs, watch, type Ref } from 'vue'
import { useI18n } from 'vue-i18n'

interface Recognition {
  lang: string
  continuous: boolean
  interimResults: boolean
  onresult:
    | ((event: {
        results: ArrayLike<ArrayLike<{ transcript: string }>>
      }) => void)
    | null
  onerror: ((event: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}

/** Uses the browser's speech service only after the user activates the microphone. */
export function useAgentDictation(prompt: Ref<string>, disabled: Ref<boolean>) {
  const { t, locale } = useI18n()
  const host =
    typeof window === 'undefined'
      ? undefined
      : (window as Window & {
          SpeechRecognition?: new () => Recognition
          webkitSpeechRecognition?: new () => Recognition
        })
  const Constructor = host?.SpeechRecognition ?? host?.webkitSpeechRecognition
  const supported = Boolean(Constructor)
  const state = reactive({ listening: false, speechError: '' })
  let recognition: Recognition | undefined
  let lastTranscript = ''
  function stop(): void {
    recognition?.stop()
  }
  function toggle(): void {
    if (state.listening) {
      stop()
      return
    }
    if (!Constructor || disabled.value) return
    state.speechError = ''
    const current = new Constructor()
    recognition = current
    const original = prompt.value
    lastTranscript = original
    current.lang = locale.value === 'zh-CN' ? 'zh-CN' : 'en-US'
    current.continuous = true
    current.interimResults = true
    current.onresult = event => {
      if (
        recognition !== current ||
        disabled.value ||
        prompt.value !== lastTranscript
      )
        return
      const spoken = Array.from(
        event.results,
        result => result[0]?.transcript ?? ''
      ).join('')
      lastTranscript = [original, spoken].filter(Boolean).join(' ')
      prompt.value = lastTranscript
    }
    current.onerror = event => {
      if (recognition === current && event.error !== 'aborted')
        state.speechError = t(
          event.error === 'not-allowed'
            ? 'agent.microphoneDenied'
            : 'agent.dictationFailed'
        )
    }
    current.onend = () => {
      if (recognition === current) {
        state.listening = false
        recognition = undefined
      }
    }
    try {
      current.start()
      state.listening = true
    } catch {
      state.listening = false
      recognition = undefined
      state.speechError = t('agent.dictationFailed')
    }
  }
  watch(
    disabled,
    value => {
      if (value) stop()
    },
    { flush: 'sync' }
  )
  watch(
    prompt,
    value => {
      if (state.listening && value !== lastTranscript) stop()
    },
    { flush: 'sync' }
  )
  onBeforeUnmount(() => {
    if (recognition) {
      recognition.onresult = null
      recognition.onerror = null
      recognition.onend = null
      recognition.abort()
      recognition = undefined
    }
  })
  return { supported, ...toRefs(state), toggle }
}
