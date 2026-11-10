import { mkdir, writeFile } from 'node:fs/promises'
import { dirname, resolve } from 'node:path'

const args = process.argv.slice(2)
const output = args.find(arg => arg.startsWith('--output='))?.slice(9)
const port = Number(
  args.find(arg => arg.startsWith('--port='))?.slice(7) || 9237
)
if (
  !output?.endsWith('.png') ||
  !Number.isInteger(port) ||
  port < 1 ||
  port > 65535
)
  throw new Error(
    'Usage: node scripts/capture-tauri-readme.mjs --output=docs/images/feature-database-dark.png [--port=9237]'
  )

const targets = await fetch(`http://127.0.0.1:${port}/json/list`).then(
  response => response.json()
)
const candidates = targets.filter(target => {
  const url = new URL(target.url)
  return (
    url.hostname === 'localhost' &&
    url.port === '1420' &&
    !url.searchParams.has('window') &&
    !url.pathname.startsWith('/tests/')
  )
})
if (candidates.length !== 1)
  throw new Error(
    `Expected one running Tauri main WebView; found ${candidates.length}`
  )

const socket = new WebSocket(candidates[0].webSocketDebuggerUrl)
await new Promise((resolve, reject) => {
  socket.onopen = resolve
  socket.onerror = reject
})
let sequence = 0
const pending = new Map()
socket.onmessage = event => {
  const message = JSON.parse(event.data)
  if (!message.id) return
  const callback = pending.get(message.id)
  if (!callback) return
  pending.delete(message.id)
  if (message.error) callback.reject(new Error(JSON.stringify(message.error)))
  else callback.resolve(message.result)
}

// 仅与本机已启动的 Tauri WebView 通信，不打开浏览器或导航到演示页面。
function send(method, params = {}) {
  const id = ++sequence
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id)
      reject(new Error(`Tauri capture timed out: ${method}`))
    }, 15000)
    pending.set(id, {
      resolve: value => {
        clearTimeout(timer)
        resolve(value)
      },
      reject: error => {
        clearTimeout(timer)
        reject(error)
      },
    })
    socket.send(JSON.stringify({ id, method, params }))
  })
}

// 读取运行环境并等待字体和绘制就绪，不修改 DOM、业务状态或 IPC。
async function inspect() {
  const result = await send('Runtime.evaluate', {
    expression: `(async () => {
      await document.fonts.ready;
      await new Promise(resolve => {
        requestAnimationFrame(() => { requestAnimationFrame(resolve); });
      });
      return {
        tauri: !!window.__TAURI_INTERNALS__, fixture: !!window.readmePreview,
        title: document.title, theme: document.documentElement.dataset.skinScheme,
        width: innerWidth, height: innerHeight,
        developmentBadge: !!document.querySelector('header span') && [...document.querySelectorAll('header span')].some(node => node.textContent.trim() === '开发环境')
      };
    })()`,
    awaitPromise: true,
    returnByValue: true,
  })
  if (result.exceptionDetails)
    throw new Error('Unable to inspect the running Tauri window')
  return result.result.value
}

try {
  const state = await inspect()
  if (!state.tauri || state.fixture)
    throw new Error(
      'Capture requires a real Tauri runtime without preview fixtures'
    )
  if (state.developmentBadge)
    throw new Error(
      'Remove the development badge before capturing README images'
    )
  const expectedTheme = output.match(/-(dark|light)\.png$/)?.[1]
  if (expectedTheme && state.theme !== expectedTheme)
    throw new Error(
      `Expected ${expectedTheme} theme; the running app uses ${state.theme}`
    )
  const screenshot = await send('Page.captureScreenshot', {
    format: 'png',
    fromSurface: true,
    captureBeyondViewport: false,
  })
  const destination = resolve(output)
  await mkdir(dirname(destination), { recursive: true })
  await writeFile(destination, Buffer.from(screenshot.data, 'base64'))
  console.log(JSON.stringify({ file: destination, ...state }))
} finally {
  socket.close()
}
