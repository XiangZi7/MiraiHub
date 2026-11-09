# README 图片

2026-11-09 更新。中英文 README 共用本目录素材。

## 当前首页素材

| 文件 | 内容 | 来源 |
| --- | --- | --- |
| `overview.png` | 白色背景、深浅色窗口产品图 | 内置 ImageGen；宣传图，不作为功能截图 |
| `feature-ssh-dark.png` | SSH 终端与远端文件 | 当前组件 + 演示数据 |
| `feature-database-dark.png` | SQL 编辑器、对象树、查询结果 | 当前组件 + 演示数据 |
| `feature-database-light.png` | 同一数据库工作区的浅色外观 | 当前组件 + 演示数据 |
| `feature-files-light.png` | 本地 / 远端双栏浏览 | 当前组件 + 演示数据 |
| `feature-redis-dark.png` | 前缀分组、键值编辑与 TTL | 当前组件 + 演示数据 |
| `feature-ai-dark.png` | AI 对话与工具调用 | 当前组件 + 演示数据；无模型请求 |
| `feature-er-light.png` | 四张示例表的外键关系 | 当前组件 + 演示数据 |
| `feature-designer-light.png` | 字段、类型、约束与注释 | 当前组件 + 演示数据 |
| `feature-monitor-light.png` | CPU、内存、磁盘、网络与系统信息 | 当前组件 + 固定演示指标 |

`showcase-*-zh.png` / `showcase-*-en.png` 是首页使用的中英文图文卡片，排版为左文右图，统一 1600 × 800。它们由 [readme-showcase.html](../../tests/readme-showcase.html) 直接排版截图，功能区域嵌入上述原始截图，未重绘 UI。`showcase-hero-*` 嵌入 AI 产品图，`showcase-appearance-*` 同时嵌入浅色工作区与表结构设计器。

[表结构设计器原图](feature-designer-light.png) · [产品图生成规格](product-visual-prompt.txt)

预览基于当前 v4.0.3 源码的 Vue 组件，在隔离 Chromium 会话中截图；不是已连接远程服务的 Tauri 实机验证。测试入口为 [readme-preview.html](../../tests/readme-preview.html)，IPC 在 [readme-preview.mjs](../../tests/readme-preview.mjs) 中隔离替换。所有地址、目录、数据、终端输出、模型对话与工具结果均为演示内容；不读取私人连接、不发起 SSH / 数据库连接或模型请求。

原有 `workspace.png`、连接与设置图、`database-workspace.png`、`ssh-workspace.png`、`server-monitoring.png` 等历史素材保留供其他文档引用，不再用于首页。

## 重新采集

```powershell
pnpm dev
# 另开终端
node scripts/capture-readme.mjs
# 原始截图更新后，重排中英文图文卡片
node scripts/capture-readme.mjs --showcase
```

默认使用已安装的 Chrome 或 Edge。可通过 `README_BROWSER` 指定 Chromium 路径，`README_PREVIEW_URL` 指定预览地址。使用 `--view=database --light` 等参数单独重拍。统一视口 1440 × 900、1.5 倍像素密度，输出 2160 × 1350 PNG。

检查所有界面加载完成、查询有结果、Redis 已选中键、AI 已显示对话；确认深浅色可读、边缘完整、没有错误提示。预览数据只服务于视觉展示，不能替代真实后端测试。

产品图生成提示词及参考来源见 [product-visual-prompt.txt](product-visual-prompt.txt)。功能截图直接来自组件渲染，不经 AI 重绘。

## English

The current homepage images were refreshed on 2026-11-09 from the v4.0.3 frontend components in an isolated Chromium session. IPC, connections, values, terminal output, monitoring data and AI responses are fixtures; these are feature demonstrations, not connected-service desktop validation. No user connections or credentials are read and no SSH, database or model requests are sent.

The hero is generated with built-in ImageGen using the light/dark database captures and the public app icon. Local HTML composes the original captures into 1600 × 800 Chinese and English showcase cards without redrawing the UI. The original historical screenshots remain available for other guides. Run the capture script above to reproduce the nine feature images and eighteen showcase cards.
