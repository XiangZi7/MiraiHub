import type { ToastTone } from '@/composables/useToast'

let context: AudioContext | undefined

/** 各语义色对应的短音序列（Hz）。都很轻，只是提醒有事发生。 */
const NOTES: Record<ToastTone, number[]> = {
  success: [660, 880],
  info: [587],
  warning: [494, 494],
  error: [330, 262],
}

/**
 * 用 Web Audio 合成一段极短的提示音，不依赖任何音频文件。
 * AudioContext 在用户尚未与页面交互时可能处于 suspended 状态，此时静默失败。
 */
export function playNotificationSound(tone: ToastTone): void {
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended')
      void context.resume()

    const start = context.currentTime
    NOTES[tone].forEach((frequency, index) => {
      const oscillator = context!.createOscillator()
      const gain = context!.createGain()
      const at = start + index * 0.09

      oscillator.type = 'sine'
      oscillator.frequency.value = frequency
      gain.gain.setValueAtTime(0.0001, at)
      gain.gain.exponentialRampToValueAtTime(0.05, at + 0.012)
      gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.17)

      oscillator.connect(gain).connect(context!.destination)
      oscillator.start(at)
      oscillator.stop(at + 0.19)
    })
  }
  catch {
    // 没有音频设备或被系统策略禁止时不影响功能
  }
}
