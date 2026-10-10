import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { pathToFileURL } from 'node:url'
import { parseReleaseTag } from './release-version.mjs'

export function updaterManifest({ tag, repository, signature, publishedAt = new Date().toISOString() }) {
  const { version } = parseReleaseTag(tag)
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) throw new Error('Invalid release repository')
  if (!signature?.trim() || !/^[A-Za-z0-9+/=\r\n]+$/.test(signature.trim())) throw new Error('Missing or invalid updater signature')
  const name = `MiraiHub_${version}_windows_x64_setup.exe`
  return {
    version,
    notes: `MiraiHub ${tag}\nhttps://github.com/${repository}/releases/tag/${tag}`,
    pub_date: publishedAt,
    platforms: {
      'windows-x86_64': {
        signature: signature.trim(),
        url: `https://github.com/${repository}/releases/download/${tag}/${name}`,
      },
    },
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const [tag, repository, directory] = process.argv.slice(2)
  const { version } = parseReleaseTag(tag)
  const signature = readFileSync(resolve(directory, `MiraiHub_${version}_windows_x64_setup.exe.sig`), 'utf8')
  writeFileSync(resolve(directory, 'latest.json'), JSON.stringify(updaterManifest({ tag, repository, signature }), null, 2) + '\n')
}
