import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { parse } from 'vue/compiler-sfc'

// 使用项目实际安装的构建依赖，复现 Tailwind → Vite 的两轮生产 CSS 压缩。
const tailwindRequire = createRequire(import.meta.resolve('@tailwindcss/vite'))
const viteRequire = createRequire(import.meta.resolve('vite'))
const { compile, optimize } = tailwindRequire('@tailwindcss/node')
const { transform } = viteRequire('lightningcss')
const postcss = viteRequire('postcss')

function productionCss(source) {
  return transform({
    filename: 'production.css',
    code: Buffer.from(optimize(source, { minify: true }).code),
    minify: true,
    targets: { chrome: 105 << 16 },
  }).code.toString()
}

for (const file of [
  'src/assets/styles/main.css',
  'src/components/workspace/database/DatabaseConnectionState.vue',
  'src/components/ui/ToastHost.vue',
]) {
  test(`生产压缩保留标准 backdrop-filter，包括关闭模糊的规则：${file}`, async () => {
    const path = fileURLToPath(new URL(`../${file}`, import.meta.url))
    let source = readFileSync(path, 'utf8')
    if (file.endsWith('.vue'))
      source = parse(source)
        .descriptor.styles.map(style => style.content)
        .join('\n')
    else
      source = (
        await compile(source, { base: dirname(path), onDependency() {} })
      ).build(['glass'])
    const expected = []
    postcss.parse(source).walkDecls('backdrop-filter', declaration => {
      expected.push([declaration.parent.selector, declaration.value])
    })
    assert.ok(expected.length)
    const actual = postcss.parse(productionCss(source))
    for (const [selector, value] of expected) {
      const matches = []
      actual.walkRules(rule => {
        if (rule.selector.replaceAll(' ', '') !== selector.replaceAll(' ', ''))
          return
        rule.walkDecls('backdrop-filter', declaration =>
          matches.push(declaration.value)
        )
      })
      assert.ok(
        matches.some(
          result => result.replaceAll(' ', '') === value.replaceAll(' ', '')
        ),
        `${selector} 在生产构建中丢失 backdrop-filter: ${value}`
      )
    }
  })
}
