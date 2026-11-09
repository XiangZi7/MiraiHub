import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseReleaseTag } from './release-version.mjs'
import { releaseTargets, assetName } from './release-targets.mjs'

/** 为所有已验证的桌面产物生成更新清单，旧调用仍默认生成 Windows 清单。 */
export function updaterManifest({
  tag,
  repository,
  signature,
  entries = [{ targetId: 'windows-x64', signature }],
  publishedAt = new Date().toISOString(),
}) {
  const { version } = parseReleaseTag(tag)
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository))
    throw new Error('Invalid release repository')
  const platforms = {}
  if (!entries.length) throw new Error('Missing updater targets')
  for (const entry of entries) {
    const target = releaseTargets[entry.targetId]
    if (!target || platforms[target.updater])
      throw new Error('Invalid or duplicate updater target')
    if (
      !entry.signature?.trim() ||
      !/^[A-Za-z0-9+/=\r\n]+$/.test(entry.signature.trim())
    )
      throw new Error('Missing or invalid updater signature')
    platforms[target.updater] = {
      signature: entry.signature.trim(),
      url: `https://github.com/${repository}/releases/download/${tag}/${assetName(target, target.updateFile, version)}`,
    }
  }
  return {
    version,
    notes: `MiraiHub ${tag}\nhttps://github.com/${repository}/releases/tag/${tag}`,
    pub_date: publishedAt,
    platforms,
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const [tag, repository, directory] = process.argv.slice(2)
  const { version } = parseReleaseTag(tag)
  const signature = readFileSync(
    resolve(directory, `MiraiHub_${version}_windows_x64_setup.exe.sig`),
    'utf8'
  )
  writeFileSync(
    resolve(directory, 'latest.json'),
    JSON.stringify(updaterManifest({ tag, repository, signature }), null, 2) +
      '\n'
  )
}
