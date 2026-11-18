import type { RdpResolution } from '@/types/connection'

export const RDP_RESOLUTIONS: readonly RdpResolution[] = [
  { width: 1280, height: 720 },
  { width: 1600, height: 900 },
  { width: 1920, height: 1080 },
  { width: 2560, height: 1440 },
  { width: 3840, height: 2160 },
]

const MIN_WIDTH = 200
const MIN_HEIGHT = 200
const MAX_WIDTH = 4096
const MAX_HEIGHT = 2304

/** 验证配置或备份中的单屏分辨率，限制帧缓冲区大小并符合 RDP 宽度要求。 */
export function validRdpResolution(size: RdpResolution): boolean {
  return (
    Number.isInteger(size.width) &&
    Number.isInteger(size.height) &&
    size.width >= MIN_WIDTH &&
    size.width <= MAX_WIDTH &&
    size.height >= MIN_HEIGHT &&
    size.height <= MAX_HEIGHT &&
    size.width % 2 === 0
  )
}

/** 按桌面可见区域选择远端分辨率，高分辨率窗口等比收敛到客户端上限。 */
export function fitRdpResolution(width: number, height: number): RdpResolution {
  if (width <= 0 || height <= 0) return { width: 1600, height: 900 }
  const ratio = Math.min(1, MAX_WIDTH / width, MAX_HEIGHT / height)
  return {
    width: Math.max(MIN_WIDTH, Math.floor((width * ratio) / 2) * 2),
    height: Math.max(MIN_HEIGHT, Math.floor(height * ratio)),
  }
}
