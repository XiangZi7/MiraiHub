import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'

const base = process.env.README_PREVIEW_URL || 'http://127.0.0.1:1420'
const browserPath =
  process.env.README_BROWSER ||
  [
    'C:/Program Files/Google/Chrome/Application/chrome.exe',
    'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  ].find(existsSync)
if (!browserPath)
  throw new Error('Set README_BROWSER to a Chromium executable.')
const profile = resolve('test-results', `readme-browser-${Date.now()}`)
await mkdir(profile, { recursive: true })
// 历史浏览器 fixture 截图只输出到隔离目录，避免覆盖 README 的真实桌面截图。
await mkdir('output/readme-fixtures', { recursive: true })
const browser = spawn(
  browserPath,
  [
    '--headless=new',
    '--no-first-run',
    '--no-default-browser-check',
    '--disable-gpu',
    '--hide-scrollbars',
    '--remote-debugging-port=0',
    `--user-data-dir=${profile}`,
    'about:blank',
  ],
  { windowsHide: true, stdio: 'ignore' }
)

// 短间隔等待本地页面或调试端口就绪，总等待时间有上限。
async function until(probe, timeout = 20000) {
  const start = Date.now()
  while (Date.now() - start < timeout) {
    try {
      const value = await probe()
      if (value) return value
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('README preview timed out')
}

let socket
try {
  const port = await until(
    async () =>
      (await readFile(resolve(profile, 'DevToolsActivePort'), 'utf8')).split(
        '\n'
      )[0]
  )
  const target = await (
    await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, {
      method: 'PUT',
    })
  ).json()
  socket = new WebSocket(target.webSocketDebuggerUrl)
  await new Promise((resolve, reject) => {
    socket.onopen = resolve
    socket.onerror = reject
  })
  let nextId = 0
  const pending = new Map()
  const errors = []
  socket.onmessage = event => {
    const value = JSON.parse(event.data)
    if (value.id) {
      const handlers = pending.get(value.id)
      pending.delete(value.id)
      if (value.error) handlers?.reject(new Error(JSON.stringify(value.error)))
      else handlers?.resolve(value.result)
    }
    if (value.method === 'Runtime.exceptionThrown')
      errors.push(value.params.exceptionDetails)
  }
  // 向独立 Chromium 页面发出 CDP 请求，不接触用户浏览器会话。
  function send(method, params = {}) {
    const id = ++nextId
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject })
      socket.send(JSON.stringify({ id, method, params }))
    })
  }
  // 在本地演示页面中读取布局和触发界面操作。
  async function evaluate(expression) {
    const result = await send('Runtime.evaluate', {
      expression,
      awaitPromise: true,
      returnByValue: true,
    })
    if (result.exceptionDetails)
      throw new Error(
        result.exceptionDetails.text +
          ': ' +
          result.exceptionDetails.exception?.description
      )
    return result.result.value
  }
  await send('Page.enable')
  await send('Runtime.enable')
  await send('Emulation.setDeviceMetricsOverride', {
    width: 1440,
    height: 900,
    deviceScaleFactor: 1.5,
    mobile: false,
  })
  const args = process.argv.slice(2)
  if (args.includes('--showcase')) {
    await send('Emulation.setDeviceMetricsOverride', {
      width: 1600,
      height: 800,
      deviceScaleFactor: 1,
      mobile: false,
    })
    for (const lang of ['zh', 'en']) {
      for (const view of [
        'hero',
        'ssh',
        'database',
        'files',
        'redis',
        'ai',
        'er',
        'monitor',
        'appearance',
      ]) {
        await send('Page.navigate', {
          url: `${base}/tests/readme-showcase.html?view=${view}&lang=${lang}`,
        })
        await until(() =>
          evaluate(
            'document.documentElement.dataset.showcaseReady === "true" && Array.from(document.images).every(i => i.complete && i.naturalWidth > 0)'
          )
        )
        await evaluate('document.fonts.ready')
        const screenshot = await send('Page.captureScreenshot', {
          format: 'png',
          captureBeyondViewport: false,
        })
        const file = `docs/images/showcase-${view}-${lang}.png`
        await writeFile(file, Buffer.from(screenshot.data, 'base64'))
        console.log(file)
      }
    }
    process.exitCode = 0
  } else {
    const requested = args.find(arg => arg.startsWith('--view='))?.split('=')[1]
    const cases = requested
      ? [[requested, args.includes('--light') ? 'light' : 'dark']]
      : [
          ['database', 'dark'],
          ['database', 'light'],
          ['ssh', 'dark'],
          ['files', 'light'],
          ['redis', 'dark'],
          ['monitor', 'light'],
          ['designer', 'light'],
          ['ai', 'dark'],
          ['er', 'light'],
        ]
    for (const [view, theme] of cases) {
      errors.length = 0
      await send('Page.navigate', {
        url: `${base}/tests/readme-preview.html?view=${view}&theme=${theme}`,
      })
      await until(() =>
        evaluate('document.documentElement.dataset.readmeReady === "true"')
      )
      const expected = {
        database: 'db_connect',
        er: 'db_connect',
        ssh: 'ssh_open_shell',
        ai: 'ssh_open_shell',
        redis: 'redis_scan',
        files: 'local_list_directory',
        designer: 'db_table_detail',
        monitor: 'ssh_system_stats',
      }[view]
      await until(
        () =>
          evaluate(
            `window.readmePreview.calls.includes(${JSON.stringify(expected)})`
          ),
        45000
      )
      await new Promise(resolve => setTimeout(resolve, 1000))
      await evaluate(
        `Array.from(document.querySelectorAll('button')).find(b => b.title === '全部展开')?.click()`
      )
      // 数据库预览选择已恢复的 SQL 草稿，再运行返回固定示例结果的查询。
      if (view === 'database' || view === 'er') {
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b => b.textContent.trim() === 'studio')?.click()`
        )
        await evaluate(
          `Array.from(document.querySelectorAll('[role="tab"]')).find(b => b.textContent.trim().startsWith('订单概览'))?.click()`
        )
        await new Promise(resolve => setTimeout(resolve, 500))
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b => (b.getAttribute('title') || '').startsWith('执行选中内容'))?.click()`
        )
        if (view === 'er') {
          await evaluate(
            `Array.from(document.querySelectorAll('button')).find(b => b.title === 'ER 图')?.click()`
          )
          await until(() =>
            evaluate(`window.readmePreview.calls.includes('db_table_detail')`)
          )
        }
      }
      if (view === 'redis') {
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b => b.title === 'cache:')?.click()`
        )
        await new Promise(resolve => setTimeout(resolve, 150))
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b => b.title === 'cache:homepage')?.click()`
        )
      }
      if (view === 'ai') {
        await evaluate(
          `(() => { const input = document.querySelector('textarea[aria-label="发送给 AI 的消息"]'); if (!input) throw new Error('AI composer missing'); input.value = '帮我检查一下 Web 服务的运行状态。'; input.dispatchEvent(new Event('input', { bubbles: true })); })()`
        )
        await new Promise(resolve => setTimeout(resolve, 150))
        await evaluate(
          `Array.from(document.querySelectorAll('button')).find(b => b.getAttribute('aria-label') === '发送消息')?.click()`
        )
      }
      await new Promise(resolve => setTimeout(resolve, 900))
      await evaluate('document.fonts.ready')
      if (view === 'ssh' || view === 'ai') {
        await send('Emulation.setDeviceMetricsOverride', {
          width: 1440,
          height: 901,
          deviceScaleFactor: 1.5,
          mobile: false,
        })
        await new Promise(resolve => setTimeout(resolve, 300))
        await send('Emulation.setDeviceMetricsOverride', {
          width: 1440,
          height: 900,
          deviceScaleFactor: 1.5,
          mobile: false,
        })
        await new Promise(resolve => setTimeout(resolve, 300))
        await evaluate('window.readmePreview.replayTerminal()')
        await new Promise(resolve => setTimeout(resolve, 400))
      }
      const info = await evaluate(
        `({ title: document.title, text: document.body.innerText.slice(0, 6000), controls: Array.from(document.querySelectorAll('button')).map(b => ({text:b.textContent.trim(), title:b.getAttribute('title'), label:b.getAttribute('aria-label')})), calls: window.readmePreview.calls })`
      )
      if (errors.length)
        throw new Error(`Runtime errors in ${view}: ${JSON.stringify(errors)}`)
      const screenshot = await send('Page.captureScreenshot', {
        format: 'png',
        captureBeyondViewport: false,
      })
      const filename = `output/readme-fixtures/feature-${view}-${theme}.png`
      await writeFile(filename, Buffer.from(screenshot.data, 'base64'))
      await writeFile(
        `test-results/readme-${view}-${theme}.json`,
        JSON.stringify({ ...info, errors }, null, 2)
      )
      console.log(`${filename} · ${errors.length} runtime errors`)
    }
  }
} finally {
  socket?.close()
  browser.kill()
}
