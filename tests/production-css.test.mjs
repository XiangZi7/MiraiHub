import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { test } from 'node:test'
import { compileStyle, parse } from 'vue/compiler-sfc'

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

for (const name of ['TerminalPanel', 'LocalTerminalPanel']) {
  test(`${name} 的透明终端底色在生产压缩后仍优先于 xterm 的黑底`, () => {
    const filename = fileURLToPath(
      new URL(`../src/components/workspace/${name}.vue`, import.meta.url)
    )
    const { descriptor, errors } = parse(readFileSync(filename, 'utf8'))
    assert.deepEqual(errors, [])
    const compiled = compileStyle({
      filename,
      source: descriptor.styles.map(style => style.content).join('\n'),
      id: 'data-v-terminal',
      scoped: true,
    })
    assert.deepEqual(compiled.errors, [])
    // xterm 的黑底选择器为 .xterm .xterm-viewport（0,2,0）。编译后的组件
    // 多一个作用域属性，保证独立 CSS chunk 无论按什么顺序加载都使用透明底。
    const css = postcss.parse(productionCss(compiled.code))
    const overrides = []
    css.walkRules(rule => {
      if (rule.selector !== '[data-v-terminal] .xterm .xterm-viewport') return
      rule.walkDecls('background-color', declaration =>
        overrides.push(declaration.value)
      )
    })
    assert.ok(overrides.some(value => ['transparent', '#0000'].includes(value)))
  })
}

test('错误提示保留调用方的绝对定位，不混入相对定位', async () => {
  const { createSSRApp } = await import('vue')
  const { renderToString } = await import('vue/server-renderer')
  const { sourceLoader, dataModule } =
    await import('./helpers/source-module.mjs')
  const load = sourceLoader(
    {
      'vue-i18n': dataModule(
        'export const useI18n = () => ({ t: key => key })'
      ),
    },
    ['src/components/ui/SessionErrorNotice.vue']
  )
  const { default: Notice } = await load(
    'src/components/ui/SessionErrorNotice.vue'
  )
  for (const position of ['absolute', 'fixed']) {
    const html = await renderToString(
      createSSRApp(Notice, {
        message: '模拟连接失败',
        class: position + ' top-2 right-2',
      })
    )
    const root = html.match(/<div\b[^>]*>/)?.[0] ?? ''
    const classes = root.match(/class="([^"]*)"/)?.[1].split(/\s+/) ?? []
    assert.deepEqual(
      classes.filter(value =>
        ['static', 'relative', 'absolute', 'fixed', 'sticky'].includes(value)
      ),
      [position]
    )
    assert.ok(html.includes('模拟连接失败'))
  }
})
