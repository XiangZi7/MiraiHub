/** Unix 文件权限位与 `ls` 权限串、八进制文本之间的换算。 */

// 把 `drwxr-sr-t` 这类权限串（含类型首字符）解析为数值权限，包括 setuid/setgid/sticky
export function parsePermissionString(permissions: string): number {
  const bits = permissions.length >= 10 ? permissions.slice(1, 10) : permissions
  if (bits.length < 9) return 0
  let mode = 0
  const values = [4, 2, 1]
  for (let index = 0; index < 9; index++) {
    const char = bits[index]!
    const value = values[index % 3]! << ((2 - Math.floor(index / 3)) * 3)
    if (char === '-') continue
    // 执行位上的 S/T 表示只有特殊位、没有执行权限
    if (index % 3 === 2 && (char === 'S' || char === 'T')) {
      mode |= specialBit(index)
      continue
    }
    if (index % 3 === 2 && (char === 's' || char === 't')) {
      mode |= specialBit(index)
    }
    mode |= value
  }
  return mode
}

// 执行位所在列对应的特殊权限位
function specialBit(index: number): number {
  if (index === 2) return 0o4000
  if (index === 5) return 0o2000
  return 0o1000
}

// 解析 3 到 4 位八进制文本，非法时返回 null
export function parseOctalMode(text: string): number | null {
  const value = text.trim()
  if (!/^[0-7]{3,4}$/.test(value)) return null
  return Number.parseInt(value, 8)
}

// 数值权限格式化为八进制文本；没有特殊位时只显示 3 位
export function formatOctalMode(mode: number): string {
  const masked = mode & 0o7777
  return masked > 0o777
    ? masked.toString(8).padStart(4, '0')
    : masked.toString(8).padStart(3, '0')
}
