import { existsSync } from 'node:fs'
import { spawnSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const env = { ...process.env }
const key = resolve(root, '.tauri/updater.key')
if (!env.TAURI_SIGNING_PRIVATE_KEY && existsSync(key))
  env.TAURI_SIGNING_PRIVATE_KEY = key
if (!env.TAURI_SIGNING_PRIVATE_KEY) {
  console.error(
    '缺少 TAURI_SIGNING_PRIVATE_KEY。请按 docs/RELEASING.md 配置签名密钥。'
  )
  process.exit(1)
}
env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD ??= ''
const result = spawnSync(
  process.execPath,
  [
    resolve(root, 'node_modules/@tauri-apps/cli/tauri.js'),
    'build',
    '--bundles',
    'nsis',
    '--',
    '--locked',
  ],
  { cwd: root, env, stdio: 'inherit' }
)
process.exit(result.status ?? 1)
