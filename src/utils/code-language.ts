import type { Extension } from '@codemirror/state'
import { Language, LanguageSupport, StreamLanguage } from '@codemirror/language'
import type { Parser } from '@lezer/common'
import { css } from '@codemirror/lang-css'
import { html } from '@codemirror/lang-html'
import { javascript } from '@codemirror/lang-javascript'
import { json } from '@codemirror/lang-json'
import { markdown } from '@codemirror/lang-markdown'
import { python } from '@codemirror/lang-python'
import { sql } from '@codemirror/lang-sql'
import { xml } from '@codemirror/lang-xml'
import { yaml } from '@codemirror/lang-yaml'
import { dockerFile } from '@codemirror/legacy-modes/mode/dockerfile'
import { nginx } from '@codemirror/legacy-modes/mode/nginx'
import { properties } from '@codemirror/legacy-modes/mode/properties'
import { shell } from '@codemirror/legacy-modes/mode/shell'
import { toml } from '@codemirror/legacy-modes/mode/toml'

/** 编辑器语言：状态栏展示名与对应的 CodeMirror 语言扩展。 */
export interface CodeLanguage {
  label: string
  extension: Extension
  parser?: Parser
}

const PLAIN: CodeLanguage = { label: '纯文本', extension: [] }

/** 按完整目录、特殊文件名和扩展名识别语言；Nginx 站点配置保留目录上下文，未知文件按纯文本打开。 */
function detectCodeLanguage(path: string): CodeLanguage {
  const normalized = path.toLowerCase()
  const name = normalized.split('/').pop() || ''
  if (
    name === '.bashrc' ||
    name === '.zshrc' ||
    name === '.profile' ||
    name === '.bash_profile' ||
    name === '.bash_login'
  )
    return { label: 'Bash', extension: StreamLanguage.define(shell) }
  if (name === 'dockerfile' || name.startsWith('dockerfile.'))
    return { label: 'Dockerfile', extension: StreamLanguage.define(dockerFile) }
  if (
    name === 'nginx.conf' ||
    (/(?:^|\/)nginx\//u.test(normalized) && name.endsWith('.conf')) ||
    /(?:^|\/)nginx\/(?:conf\.d|sites-available|sites-enabled|servers)\/[^/]+$/u.test(
      normalized
    )
  )
    return { label: 'Nginx', extension: StreamLanguage.define(nginx) }
  if (name === '.env' || name.startsWith('.env.'))
    return { label: 'Properties', extension: StreamLanguage.define(properties) }

  const extension = name.includes('.') ? name.split('.').pop()! : ''
  switch (extension) {
    case 'sh':
    case 'bash':
    case 'zsh':
      return { label: 'Bash', extension: StreamLanguage.define(shell) }
    case 'json':
    case 'jsonc':
      return { label: 'JSON', extension: json() }
    case 'yaml':
    case 'yml':
      return { label: 'YAML', extension: yaml() }
    case 'toml':
      return { label: 'TOML', extension: StreamLanguage.define(toml) }
    case 'ini':
    case 'cfg':
    case 'properties':
      return {
        label: 'Properties',
        extension: StreamLanguage.define(properties),
      }
    case 'md':
    case 'markdown':
      return { label: 'Markdown', extension: markdown() }
    case 'py':
      return { label: 'Python', extension: python() }
    case 'js':
    case 'mjs':
    case 'cjs':
      return { label: 'JavaScript', extension: javascript() }
    case 'ts':
      return {
        label: 'TypeScript',
        extension: javascript({ typescript: true }),
      }
    case 'jsx':
      return { label: 'JSX', extension: javascript({ jsx: true }) }
    case 'tsx':
      return {
        label: 'TSX',
        extension: javascript({ jsx: true, typescript: true }),
      }
    case 'html':
    case 'htm':
      return { label: 'HTML', extension: html() }
    case 'vue':
      return { label: 'Vue', extension: html() }
    case 'css':
    case 'scss':
    case 'less':
      return { label: 'CSS', extension: css() }
    case 'xml':
    case 'svg':
      return { label: 'XML', extension: xml() }
    case 'sql':
      return { label: 'SQL', extension: sql() }
    default:
      return PLAIN
  }
}

const languages = new Map<string, CodeLanguage>()

/** 复用编辑器与终端的语言解析器；按完整路径缓存最多 128 项，避免不同目录的同名配置串用语言。 */
export function codeLanguage(path: string): CodeLanguage {
  const normalized = path.replaceAll('\\', '/')
  const cached = languages.get(normalized)
  if (cached) return cached
  const result = detectCodeLanguage(normalized)
  const extension = result.extension
  if (extension instanceof LanguageSupport)
    result.parser = extension.language.parser
  else if (extension instanceof Language) result.parser = extension.parser
  languages.set(normalized, result)
  if (languages.size > 128) languages.delete(languages.keys().next().value!)
  return result
}
