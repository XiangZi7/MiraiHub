export const UI_SCALE_MIN = 80
export const UI_SCALE_MAX = 150
export const UI_SCALE_STEP = 5
export function normalizeUiScale(value: unknown): number {
  const percent = Number(value)
  if (!Number.isFinite(percent) || percent <= 0) return 100
  return Math.max(UI_SCALE_MIN, Math.min(UI_SCALE_MAX, Math.round(percent)))
}
