// 构建、打包、更新清单与下载表共用的首批桌面目标。
export const releaseTargets = {
  'windows-x64': {
    triple: 'x86_64-pc-windows-msvc',
    platform: 'windows',
    arch: 'x64',
    updater: 'windows-x86_64',
    downloads: ['setup.exe', 'portable.zip'],
    updateFile: 'setup.exe',
  },
  'macos-x64': {
    triple: 'x86_64-apple-darwin',
    platform: 'macos',
    arch: 'x64',
    updater: 'darwin-x86_64',
    downloads: ['dmg'],
    updateFile: 'app.tar.gz',
  },
  'macos-arm64': {
    triple: 'aarch64-apple-darwin',
    platform: 'macos',
    arch: 'arm64',
    updater: 'darwin-aarch64',
    downloads: ['dmg'],
    updateFile: 'app.tar.gz',
  },
  'linux-x64': {
    triple: 'x86_64-unknown-linux-gnu',
    platform: 'linux',
    arch: 'x64',
    updater: 'linux-x86_64',
    downloads: ['deb', 'AppImage'],
    updateFile: 'AppImage',
  },
}

/** 为安装包与更新包生成包含版本号的发布附件名。 */
export function assetName(target, extension, version) {
  if (!version) throw new Error('Missing release asset version')
  if (
    !Object.values(releaseTargets).includes(target) ||
    ![...target.downloads, target.updateFile].includes(extension)
  )
    throw new Error('Unsupported release asset')
  const separator =
    extension === 'setup.exe' || extension === 'portable.zip' ? '_' : '.'
  return `MiraiHub_${version}_${target.platform}_${target.arch}${separator}${extension}`
}
