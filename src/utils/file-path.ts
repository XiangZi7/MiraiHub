export interface FilePathCompletionContext {
  directory: string
  prefix: string
}

/** 清理地址栏粘贴的外层引号与本地 file URL，不把路径内容当作 shell 表达式执行。 */
export function cleanFilePath(value: string, local = false): string {
  let target = value.trim()
  if (
    target.length >= 2 &&
    ((target.startsWith('"') && target.endsWith('"')) ||
      (target.startsWith("'") && target.endsWith("'")))
  )
    target = target.slice(1, -1)

  if (local && /^file:\/\//i.test(target)) {
    try {
      const url = new URL(target)
      const path = decodeURIComponent(url.pathname)
      target =
        url.hostname && url.hostname !== 'localhost'
          ? `//${url.hostname}${path}`
          : path.replace(/^\/([a-z]:[\/\\])/i, '$1')
    } catch {
      // 无效 URL 保留原输入，实际导航失败统一由文件面板通知。
    }
  }
  return target
}

/** 将地址栏的相对路径接到当前目录，保留 .. 给原生文件系统解析，避免误改符号链接语义。 */
export function resolveFilePath(
  value: string,
  base: string,
  local = false
): string {
  const target = cleanFilePath(value, local)
  if (!target) return base

  if (!local) {
    if (target.startsWith('/') || /^~(?:\/|$)/.test(target)) return target
    return base ? `${base.replace(/\/$/, '')}/${target}` : target
  }

  if (/^[a-z]:/i.test(target))
    return /^[a-z]:$/i.test(target) ? `${target}\\` : target
  if (/^[\/\\]{2}/.test(target)) return target
  if (/^[\/\\]/.test(target)) {
    const drive = base.match(/^[a-z]:/i)?.[0]
    if (drive) return `${drive}${target}`
    const share = base.replace(/\\/g, '/').match(/^\/\/[^/]+\/[^/]+/)?.[0]
    if (share) {
      return base.startsWith('\\\\')
        ? share.replace(/\//g, '\\') + target.replace(/\//g, '\\')
        : share + target.replace(/\\/g, '/')
    }
    return target
  }
  const separator = base.includes('\\') ? '\\' : '/'
  return base ? `${base.replace(/[\/\\]$/, '')}${separator}${target}` : target
}

/** 按实际输入的父目录生成查询上下文，未编辑的当前地址优先展示其子目录。 */
export function filePathCompletionContext(
  value: string,
  base: string,
  local = false,
  pristine = false
): FilePathCompletionContext {
  const target = cleanFilePath(value, local)
  if (!target || pristine) return { directory: base, prefix: '' }
  if (!local && target === '~') return { directory: '~', prefix: '' }
  if (local && /^[a-z]:[^\/\\]*$/i.test(target))
    return { directory: `${target.slice(0, 2)}\\`, prefix: target.slice(2) }

  const slash = local
    ? Math.max(target.lastIndexOf('/'), target.lastIndexOf('\\'))
    : target.lastIndexOf('/')
  return slash < 0
    ? { directory: base, prefix: target }
    : {
        directory: resolveFilePath(target.slice(0, slash + 1), base, local),
        prefix: target.slice(slash + 1),
      }
}

/** 比较补全查询目录；Windows 忽略分隔符与大小写，POSIX 路径仍区分大小写。 */
export function filePathKey(path: string, local = false): string {
  const windows = local && (/^[a-z]:/i.test(path) || /^[\/\\]{2}/.test(path))
  const normalized = windows ? path.replace(/\\/g, '/').toLowerCase() : path
  return (
    normalized.replace(/\/+$/, '') || (normalized.startsWith('/') ? '/' : '')
  )
}

/** 目录候选补齐后保留结尾分隔符，方便连续按 Tab 输入多级路径。 */
export function appendFilePathSeparator(path: string, local = false): string {
  if (local ? /[\/\\]$/.test(path) : path.endsWith('/')) return path
  return path + (local && path.includes('\\') ? '\\' : '/')
}
