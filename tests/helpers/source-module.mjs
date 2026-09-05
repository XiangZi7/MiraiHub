import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'

export const dataModule = source => `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

/** Node 测试执行实际 TS 模块；仅替换原生/存储边界与无需渲染的 SFC。 */
export function sourceLoader(overrides = {}) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const cache = new Map()
  function url(file) {
    const path = resolve(root, file)
    if (cache.has(path)) return cache.get(path)
    if (path.endsWith('.vue')) return dataModule('export default { render() { return null } }')
    const source = readFileSync(path, 'utf8')
    const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 } })
    const output = outputText.replace(/(from\s*|import\s*\()(['"])([^'"]+)\2/g, (_match, prefix, quote, specifier) => {
      let target = overrides[specifier]
      if (!target) {
        if (specifier.startsWith('@/') || specifier.startsWith('.')) {
          let local = specifier.startsWith('@/') ? resolve(root, 'src', specifier.slice(2)) : resolve(dirname(path), specifier)
          if (!/\.(ts|vue)$/.test(local)) local += existsSync(local + '.ts') ? '.ts' : '/index.ts'
          target = url(local)
        } else target = import.meta.resolve(specifier)
      }
      return `${prefix}${quote}${target}${quote}`
    })
    const result = dataModule(output + `\n//# sourceURL=${pathToFileURL(path).href}`)
    cache.set(path, result)
    return result
  }
  return file => import(url(file))
}
