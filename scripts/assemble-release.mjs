import {
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from 'node:fs'
import { createHash } from 'node:crypto'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { parseReleaseTag } from './release-version.mjs'
import { releaseTargets, assetName } from './release-targets.mjs'
import { updaterManifest } from './updater-manifest.mjs'

/** 校验每个平台的测试产物、提交与校验值，全部齐全后再合并为可发布附件。 */
export function assembleRelease({ input, output, tag, commit, repository }) {
  const release = parseReleaseTag(tag)
  if (!/^[0-9a-f]{40}$/.test(commit))
    throw new Error('Commit must be a full Git SHA')
  const files = []
  const entries = []
  for (const [id, target] of Object.entries(releaseTargets)) {
    const directory = resolve(input, `${id}-release`)
    const sums = new Map()
    for (const line of readFileSync(
      resolve(directory, 'SHA256SUMS.txt'),
      'utf8'
    )
      .trim()
      .split(/\r?\n/)) {
      const match = /^([a-f0-9]{64})  ([A-Za-z0-9_.-]+)$/.exec(line)
      if (!match || sums.has(match[2]))
        throw new Error(`Invalid checksums: ${id}`)
      sums.set(match[2], match[1])
    }
    for (const [name, checksum] of sums) {
      const actual = createHash('sha256')
        .update(readFileSync(resolve(directory, name)))
        .digest('hex')
      if (actual !== checksum)
        throw new Error(`Checksum mismatch: ${id}/${name}`)
    }
    const metadata = JSON.parse(
      readFileSync(resolve(directory, 'version.json'), 'utf8').replace(
        /^\uFEFF/,
        ''
      )
    )
    if (
      metadata.tag !== tag ||
      metadata.version !== release.version ||
      metadata.commit !== commit ||
      metadata.platform !== target.platform ||
      metadata.arch !== target.arch
    )
      throw new Error(`Release metadata mismatch: ${id}`)
    const names = [...new Set([...target.downloads, target.updateFile])].map(
      extension => assetName(target, extension, release.version)
    )
    const updateName = assetName(target, target.updateFile, release.version)
    names.push(`${updateName}.sig`, 'version.json')
    for (const name of names) {
      if (
        !sums.has(name) ||
        readFileSync(resolve(directory, name)).length === 0
      )
        throw new Error(`Missing checked release asset: ${id}/${name}`)
      if (name !== 'version.json')
        files.push({ source: resolve(directory, name), name })
    }
    for (const extension of target.downloads) {
      files.push({
        source: resolve(
          directory,
          assetName(target, extension, release.version)
        ),
        name: assetName(target, extension),
      })
    }
    entries.push({
      targetId: id,
      signature: readFileSync(resolve(directory, `${updateName}.sig`), 'utf8'),
    })
  }
  const manifest = updaterManifest({ tag, repository, entries })
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
        targets: Object.keys(releaseTargets),
      },
      null,
      2
    ) + '\n'
  )
  writeFileSync(
    resolve(output, 'latest.json'),
    JSON.stringify(manifest, null, 2) + '\n'
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
}

if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    const [
      tag,
      commit,
      repository,
      input = 'release-input',
      output = 'release-output',
    ] = process.argv.slice(2)
    assembleRelease({
      tag,
      commit,
      repository,
      input: resolve(input),
      output: resolve(output),
    })
  } catch (error) {
    console.error(error.message)
    process.exitCode = 1
  }
}
