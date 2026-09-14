import { readFileSync, existsSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { resolve, dirname } from 'node:path'
import ts from 'typescript'
import { parse, compileScript } from 'vue/compiler-sfc'

export const dataModule = source =>
  `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`

/** Node 测试执行实际 TS 模块；仅替换原生/存储边界与无需渲染的 SFC。 */
export function sourceLoader(overrides = {}, renderedComponents = []) {
  const root = fileURLToPath(new URL('../../', import.meta.url))
  const cache = new Map()
  function url(file) {
    const path = resolve(root, file)
    if (cache.has(path)) return cache.get(path)
    if (
      path.endsWith('.vue') &&
      !renderedComponents.some(file => resolve(root, file) === path)
    )
      return dataModule('export default { render() { return null } }')
    let source = readFileSync(path, 'utf8')
    if (path.endsWith('.vue'))
      source = compileScript(parse(source, { filename: path }).descriptor, {
        id: path,
        inlineTemplate: true,
      }).content
    const { outputText } = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.ESNext,
        target: ts.ScriptTarget.ES2022,
      },
    })
    const moduleAst = ts.createSourceFile(
      path,
      outputText,
      ts.ScriptTarget.Latest,
      true
    )
    const imports = []
    function collectImports(node) {
      if (
        (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) &&
        node.moduleSpecifier &&
        ts.isStringLiteral(node.moduleSpecifier)
      )
        imports.push(node.moduleSpecifier)
      if (
        ts.isCallExpression(node) &&
        node.expression.kind === ts.SyntaxKind.ImportKeyword &&
        node.arguments[0] &&
        ts.isStringLiteral(node.arguments[0])
      )
        imports.push(node.arguments[0])
      ts.forEachChild(node, collectImports)
    }
    collectImports(moduleAst)
    let output = outputText
    for (const node of imports.sort((a, b) => b.pos - a.pos)) {
      const specifier = node.text
      let target = overrides[specifier]
      if (!target) {
        if (specifier.startsWith('@/') || specifier.startsWith('.')) {
          let local = specifier.startsWith('@/')
            ? resolve(root, 'src', specifier.slice(2))
            : resolve(dirname(path), specifier)
          if (!/\.(ts|vue)$/.test(local))
            local += existsSync(local + '.ts') ? '.ts' : '/index.ts'
          target = url(local)
        } else target = import.meta.resolve(specifier)
      }
      output =
        output.slice(0, node.getStart(moduleAst)) +
        JSON.stringify(target) +
        output.slice(node.end)
    }
    const result = dataModule(
      output + `\n//# sourceURL=${pathToFileURL(path).href}`
    )
    cache.set(path, result)
    return result
  }
  return file => import(url(file))
}
