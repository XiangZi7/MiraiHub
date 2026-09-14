import fs from 'node:fs'
import path from 'node:path'
import ts from 'typescript'
import { parse, compileTemplate } from 'vue/compiler-sfc'
import { sourceLoader } from '../tests/helpers/source-module.mjs'
const { messages } = await sourceLoader()('src/i18n/messages.ts')
const han = /[\u3400-\u9fff]/
const results = []
function walk(dir) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const file = path.join(dir, ent.name).replaceAll('\\', '/')
    if (ent.isDirectory()) { if (!['i18n', 'types'].includes(ent.name)) walk(file); continue }
    if (!/\.(vue|ts)$/.test(file)) continue
    const source = fs.readFileSync(file, 'utf8')
    const desc = file.endsWith('.vue') ? parse(source).descriptor : null
    function scan(code, kind) {
      const ast = ts.createSourceFile(file + '.ts', code, ts.ScriptTarget.Latest, true)
      function visit(n) {
        if ((ts.isStringLiteral(n) || ts.isNoSubstitutionTemplateLiteral(n)) && han.test(n.text)) {
          const p = n.parent
          if ((ts.isPropertyAssignment(p) && p.name === n) || ts.isLiteralTypeNode(p)) return
          if (ts.isCallExpression(p) && /(?:^|\.)(t|translateLabel)$/.test(p.expression.getText(ast))) return
          results.push({ file, kind, text: n.text, translated: Object.hasOwn(messages['en-US'], n.text), context: p.getText(ast).slice(0, 180) })
        }
        if (ts.isTemplateExpression(n) && han.test(n.getText(ast))) results.push({ file, kind: 'dynamic', text: n.getText(ast) })
        ts.forEachChild(n, visit)
      }
      visit(ast)
    }
    scan(desc ? desc.scriptSetup?.content ?? desc.script?.content ?? '' : source, 'script')
    if (desc?.template) scan(compileTemplate({source: desc.template.content, filename: file, id: file}).code, 'template')
  }
}
walk('src')
fs.writeFileSync('i18n-audit.json', JSON.stringify(results, null, 2))
console.log('Occurrences', results.length, 'Unique', new Set(results.map(x => x.text)).size)
console.log([...new Set(results.filter(x => !x.translated).map(x => x.text))].join('\n'))

