import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  statSync,
  writeFileSync,
  readdirSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { syncReleaseVersion } from './release-version.mjs'
import { assetName, releaseTargets } from './release-targets.mjs'

/** 收集指定桌面目标的原生安装包与签名，缺失任何产物立即失败。 */
export function packageUnix({ root, tag, commit, targetId, triple = '' }) {
  const release = syncReleaseVersion(root, tag, { check: true })
  const target = releaseTargets[targetId]
  if (!target || target.platform === 'windows')
    throw new Error('Unsupported Unix release target')
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error('Commit must be a full Git SHA')
  if (triple && triple !== target.triple)
    throw new Error('Rust target does not match release architecture')
  const build = resolve(root, 'src-tauri/target', triple, 'release/bundle')
  const arch = target.arch === 'arm64' ? 'aarch64' : 'x64'
  const sources =
    target.platform === 'macos'
      ? {
          dmg: `dmg/MiraiHub_${release.version}_${arch}.dmg`,
          'app.tar.gz': 'macos/MiraiHub.app.tar.gz',
        }
      : {
          deb: `deb/MiraiHub_${release.version}_amd64.deb`,
          AppImage: `appimage/MiraiHub_${release.version}_amd64.AppImage`,
        }
  const files = Object.entries(sources).flatMap(([extension, source]) => {
    const name = assetName(target, extension, release.version)
    return [
      { source: resolve(build, source), name },
      ...(extension === target.updateFile
        ? [{ source: resolve(build, `${source}.sig`), name: `${name}.sig` }]
        : []),
    ]
  })
  for (const { source } of files)
    if (
      !existsSync(source) ||
      !statSync(source).isFile() ||
      !statSync(source).size
    )
      throw new Error(`Missing build output: ${source}`)
  const output = resolve(root, 'release-output')
  mkdirSync(output)
  for (const { source, name } of files)
    copyFileSync(source, resolve(output, name))
  writeFileSync(
    resolve(output, 'version.json'),
    JSON.stringify(
      {
        name: 'MiraiHub',
        ...release,
        commit,
        platform: target.platform,
        arch: target.arch,
      },
      null,
      2
    ) + '\n'
  )
  const checksums = readdirSync(output)
    .sort()
    .map(
      name =>
        `${createHash('sha256')
          .update(readFileSync(resolve(output, name)))
          .digest('hex')}  ${name}\n`
    )
    .join('')
  writeFileSync(resolve(output, 'SHA256SUMS.txt'), checksums)
  return output
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [tag, commit, targetId] = process.argv.slice(2)
    console.log(
      packageUnix({
        root: fileURLToPath(new URL('../', import.meta.url)),
        tag,
        commit,
        targetId,
        triple: process.env.RELEASE_TARGET || '',
      })
    )
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
