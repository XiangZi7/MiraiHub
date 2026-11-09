import { existsSync } from 'node:fs'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))

// 实时转发 CLI 日志，仅保留末尾诊断用于判断打包下载是否可以重试。
function runTauri(args, { cwd, env }) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(
      process.execPath,
      [resolve(cwd, 'node_modules/@tauri-apps/cli/tauri.js'), ...args],
      { cwd, env, stdio: ['inherit', 'pipe', 'pipe'], windowsHide: true }
    )
    let output = ''
    // 保持终端输出实时可见，诊断缓冲区不随长日志无限增长。
    const forward = (chunk, stream) => {
      stream.write(chunk)
      output = (output + chunk.toString()).slice(-64 * 1024)
    }
    child.stdout.on('data', chunk => forward(chunk, process.stdout))
    child.stderr.on('data', chunk => forward(chunk, process.stderr))
    child.once('error', reject)
    child.once('close', status =>
      resolveResult({ status: status ?? 1, output })
    )
  })
}

// 只重试超时、连接中断、限流和临时服务错误；配置、签名、校验及其他 4xx 错误直接失败。
export function isTransientBundleError(output) {
  return (
    /\bhttp\s+(?:status|error)(?:\s+code)?\s*:\s*[`'"]?(?:408|425|429|5\d\d)\b/i.test(
      output
    ) ||
    /\b(?:ECONNRESET|ETIMEDOUT|EAI_AGAIN)\b|timed?\s*out|connection\s+(?:reset|aborted)|dns\s+error|unexpected\s+(?:end of file|eof)/i.test(
      output
    )
  )
}

// 前端与 Rust 只编译一次，NSIS 打包最多尝试三次，临时下载失败时复用已编译的程序。
export async function buildRelease({
  projectRoot = root,
  environment = process.env,
  run = runTauri,
  wait = delay,
  log = console.log,
} = {}) {
  const env = { ...environment }
  const key = resolve(projectRoot, '.tauri/updater.key')
  if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(key))
    env.TAURI_SIGNING_PRIVATE_KEY = key
  if (!env.TAURI_SIGNING_PRIVATE_KEY)
    throw new Error(
      '缺少 TAURI_SIGNING_PRIVATE_KEY。请按 docs/RELEASING.md 配置签名密钥。'
    )
  env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= ''
  const options = { cwd: projectRoot, env }
  const build = await run(['build', '--no-bundle', '--', '--locked'], options)
  if (build.status !== 0) return build.status

  for (let attempt = 1; attempt <= 3; attempt++) {
    log(`生成 NSIS 安装包（第 ${attempt}/3 次）`)
    const bundle = await run(['bundle', '--bundles', 'nsis'], options)
    if (
      bundle.status === 0 ||
      attempt === 3 ||
      !isTransientBundleError(bundle.output)
    )
      return bundle.status
    const seconds = attempt * 10
    log(`打包遇到临时网络错误，${seconds} 秒后仅重试打包，不重新编译。`)
    await wait(seconds * 1000)
  }
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    process.exitCode = await buildRelease()
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
