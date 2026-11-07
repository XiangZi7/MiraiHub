/**
 * ~/.ssh/config 导入与公钥部署（ssh-copy-id）相关类型，
 * 与 Rust 侧 `ssh/openssh_config.rs`、`ssh/key_deploy.rs` 的序列化结构一一对应。
 */

/** 解析警告。kind 是稳定标识，前端据此翻译；detail 是原文信息 */
export interface OpenSshWarning {
  kind: string
  detail: string
}

/** ProxyJump 展开后的一跳 */
export interface OpenSshJumpHop {
  /** 引用同文件里的 Host 别名时为该别名 */
  alias: string | null
  host: string
  port: number
  user: string
}

/** 一个可导入的主机 */
export interface OpenSshHost {
  alias: string
  host: string
  port: number
  user: string
  /** 已展开 ~ 的私钥路径 */
  identityFile: string | null
  /** 完整跳板链，按连接顺序 */
  jump: OpenSshJumpHop[]
  warnings: OpenSshWarning[]
}

/** 预览结果 */
export interface OpenSshImportPreview {
  /** 读取的配置文件路径 */
  path: string
  /** 配置文件是否存在 */
  found: boolean
  hosts: OpenSshHost[]
  /** 文件级警告：Match 块、Include 失败等 */
  warnings: OpenSshWarning[]
}

/** 公钥部署结果：added 新追加，exists 远端已存在 */
export interface DeployKeyResult {
  status: 'added' | 'exists'
  fingerprint: string
}
