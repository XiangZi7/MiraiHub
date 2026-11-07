/**
 * 命令面板用的子序列模糊匹配打分：不匹配返回 -1，分数越高越相关。
 * 连续命中、单词/分隔符开头命中、前缀命中加分；跨度越长扣分。
 */
export function fuzzyScore(pattern: string, text: string): number {
  const needle = pattern.toLowerCase()
  const haystack = text.toLowerCase()
  if (!needle) return 0
  // 完整子串命中直接给高分，越靠前越好
  const direct = haystack.indexOf(needle)
  if (direct >= 0) return 100 - Math.min(direct, 50) + (direct === 0 ? 20 : 0)

  let score = 0
  let last = -1
  let first = -1
  for (const char of needle) {
    const index = haystack.indexOf(char, last + 1)
    if (index < 0) return -1
    if (first < 0) first = index
    if (index === last + 1) score += 5
    const prev = haystack[index - 1]
    if (index === 0 || (prev && /[\s._\-/:]/.test(prev))) score += 8
    last = index
  }
  return Math.max(0, score - (last - first - needle.length + 1))
}
