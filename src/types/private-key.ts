/** 私钥记录只保存路径和展示信息，绝不读取或持久化私钥正文。 */
export interface StoredPrivateKey {
  /** 私钥绝对路径，同时作为唯一标识。 */
  path: string
  /** 文件名或扫描得到的密钥名。 */
  label: string
  /** local 来自 ~/.ssh 扫描，imported 来自系统文件选择器。 */
  source: 'local' | 'imported'
  addedAt: number
}

export interface PrivateKeyRegistrySnapshot {
  keys: StoredPrivateKey[]
  /** 空串表示还没有指定默认私钥。 */
  defaultPath: string
}
