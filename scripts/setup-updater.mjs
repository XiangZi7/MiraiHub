import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { resolve } from 'node:path'

const root = fileURLToPath(new URL('../', import.meta.url))
const keyPath = resolve(root, '.tauri/updater.key')
const configPath = resolve(root, 'src-tauri/tauri.conf.json')
const config = JSON.parse(readFileSync(configPath, 'utf8'))
if (!existsSync(keyPath)) {
  if (config.plugins?.updater?.pubkey) {
    throw new Error('已有更新公钥，请恢复原签名私钥。不要重新生成密钥，否则已安装的客户端将无法更新。')
  }
  mkdirSync(resolve(root, '.tauri'), { recursive: true })
  // Never print CLI output: signer generate includes the private key.
  try {
    execFileSync(process.execPath, [
      resolve(root, 'node_modules/@tauri-apps/cli/tauri.js'),
      'signer', 'generate', '--ci', '-w', keyPath,
    ], { cwd: root, stdio: 'pipe' })
  } catch {
    throw new Error('生成更新签名密钥失败，请检查 .tauri 目录权限。')
  }
}
const pubkey = readFileSync(keyPath + '.pub', 'utf8').trim()
if (config.plugins?.updater?.pubkey && config.plugins.updater.pubkey !== pubkey) {
  throw new Error('本地密钥与应用中的公钥不匹配，请恢复原签名密钥。')
}
config.bundle.createUpdaterArtifacts = true
config.plugins = {
  ...config.plugins,
  updater: {
    pubkey,
    endpoints: ['https://github.com/XiangZi7/MiraiHub/releases/latest/download/latest.json'],
    windows: { installMode: 'passive' },
  },
}
writeFileSync(configPath, JSON.stringify(config, null, 2) + '\n')
console.log('公钥已写入 tauri.conf.json；私钥保存在 .tauri/updater.key（已被 Git 忽略）。')
console.log('请备份私钥，并将其内容配置为 GitHub Actions Secret：TAURI_SIGNING_PRIVATE_KEY。')
