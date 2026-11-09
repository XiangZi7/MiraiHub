import { invoke } from '@tauri-apps/api/core'
import { Update } from '@tauri-apps/plugin-updater'
import type { UpdatePackage } from '@/utils/app-updater'

const sources: Record<string, string> = {
  github: '',
  ghproxy: 'https://gh-proxy.com/',
  ghfast: 'https://ghfast.top/',
}

/** 通过原生检查创建标准 updater 资源，下载和签名校验继续使用官方插件。 */
async function checkSource(prefix: string): Promise<UpdatePackage | null> {
  const metadata = await invoke<ConstructorParameters<typeof Update>[0] | null>(
    'updater_check_source',
    { prefix }
  )
  if (!metadata) return null
  const update = new Update(metadata)
  return {
    version: update.version,
    download: (report, options) => update.download(report, options),
    /** 安装成功后由原生命令完成 macOS/Linux 重启，失败时继续保留错误状态。 */
    install: async () => {
      await update.install()
      await invoke('updater_restart')
    },
    close: () => update.close(),
  }
}

/** 按所选线路检查；下载失败后切换同一版本的备用资源，不混用版本或绕过签名校验。 */
export async function checkAppUpdate(
  source = 'auto',
  customPrefix = '',
  check: (prefix: string) => Promise<UpdatePackage | null> = checkSource
): Promise<UpdatePackage | null> {
  const prefixes =
    source === 'github'
      ? ['']
      : source === 'custom'
        ? [customPrefix.trim(), '']
        : Object.hasOwn(sources, source)
          ? [sources[source]!, '']
          : [sources.ghproxy!, sources.ghfast!, '']
  if (source === 'custom' && !customPrefix.trim())
    throw new Error('请填写下载加速地址')
  const routes = [...new Set(prefixes)]
  let index = 0
  let current: UpdatePackage | null = null
  let lastError: unknown
  for (; index < routes.length; index++) {
    try {
      current = await check(routes[index]!)
      if (!current) return null
      break
    } catch (error) {
      lastError = error
    }
  }
  if (!current) throw lastError
  const version = current.version
  return {
    version,
    /** 下载失败时释放当前资源，再查找同版本的备用线路。 */
    async download(report, options) {
      for (;;) {
        try {
          await current!.download(report, options)
          return
        } catch (error) {
          lastError = error
          await current!.close().catch(() => {})
          current = null
        }
        while (++index < routes.length) {
          try {
            const candidate = await check(routes[index]!)
            if (candidate?.version === version) {
              current = candidate
              break
            }
            await candidate?.close().catch(() => {})
          } catch (error) {
            lastError = error
          }
        }
        if (!current) throw lastError
      }
    },
    /** 仅安装当前线路已完成签名校验的安装包。 */
    install: () => current!.install(),
    /** 释放最后持有的原生更新资源，多次关闭保持幂等。 */
    close: async () => {
      await current?.close().catch(() => {})
      current = null
    },
  }
}
