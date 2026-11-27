# MiraiHub

[下载桌面版](https://github.com/XiangZi7/MiraiHub/releases/latest) · [功能](#功能) · [English](README.en.md)

## 下载与安装

| 系统 | 下载 |
| --- | --- |
| **Windows** | [![Setup x64](https://img.shields.io/badge/Setup-x64-0078D4?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTAgMGg3djdIMHpNOSAwaDd2N0g5ek0wIDloN3Y3SDB6TTkgOWg3djdIOXoiLz48L3N2Zz4%3D)](https://github.com/XiangZi7/MiraiHub/releases/latest) [![Portable ZIP x64](https://img.shields.io/badge/Portable%20ZIP-x64-0078D4?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTAgMGg3djdIMHpNOSAwaDd2N0g5ek0wIDloN3Y3SDB6TTkgOWg3djdIOXoiLz48L3N2Zz4%3D)](https://github.com/XiangZi7/MiraiHub/releases/latest) |
| **macOS** | [![DMG Apple Silicon](https://img.shields.io/badge/DMG-Apple%20Silicon-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/XiangZi7/MiraiHub/releases/latest) [![DMG Intel x64](https://img.shields.io/badge/DMG-Intel%20x64-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/XiangZi7/MiraiHub/releases/latest) |
| **Linux** | [![AppImage x64](https://img.shields.io/badge/AppImage-x64-FCC624?style=flat-square&logo=linux&logoColor=FCC624)](https://github.com/XiangZi7/MiraiHub/releases/latest) [![DebPackage x64](https://img.shields.io/badge/DebPackage-x64-D70A53?style=flat-square&logo=debian&logoColor=white)](https://github.com/XiangZi7/MiraiHub/releases/latest) |

[安装与更新说明](docs/RELEASING.md#工作流与下载) · [Windows ZIP 所需的 WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)

## 功能

| 功能 | 支持 | 截图 |
| --- | --- | --- |
| 🖥️ [SSH 终端](docs/ssh-operations.md) | 跳板机、端口转发、分屏、命令与路径补全、搜索、录制与回放 | [SSH 终端](docs/images/feature-ssh-dark.png) |
| ⌨️ 本地终端 | 本地 Shell、终端搜索、文件面板 | [工作区](docs/images/feature-file-copy.png) |
| 🪟 Windows 远程桌面 | RDP 全屏与分辨率设置、双向文本和文件剪贴板 | <a href="docs/images/feature-rdp.png"><img src="docs/images/feature-rdp.png" width="180" alt="Windows 远程桌面连接设置" /></a> |
| 📂 [文件管理](docs/ssh-operations.md#文件上传与下载) | SFTP 双栏、上传下载、目录同步、远端文件行内重命名、本地拖放与跨 SSH 复制 | <a href="docs/images/feature-file-copy.png"><img src="docs/images/feature-file-copy.png" width="180" alt="本地文件复制" /></a><br />[SFTP 双栏](docs/images/feature-files-light.png) |
| 🐳 Docker | 容器启停与重启、Compose 分组、健康与资源详情、日志筛选 | <a href="docs/images/feature-docker.png"><img src="docs/images/feature-docker.png" width="180" alt="Docker 容器管理演示" /></a><br />[容器日志](docs/images/feature-docker-logs.png) |
| 📈 [服务器监控](docs/ssh-operations.md) | CPU、内存、磁盘与网络 | [监控面板](docs/images/feature-monitor-light.png) |
| 🗄️ [数据库](docs/database.md) | MySQL、MariaDB、TiDB、PostgreSQL、SQLite，支持 SQL 编辑、数据编辑、表结构设计和 ER 图 | [数据库](docs/images/feature-database-dark.png) · [表设计](docs/images/feature-designer-light.png) · [ER 图](docs/images/feature-er-light.png) |
| 🔑 [Redis](docs/redis.md) | 键值编辑、命令面板、实例状态、慢日志、大键扫描、发布与订阅 | [键值编辑](docs/images/feature-redis-dark.png) |
| 🤖 [AI Agent](docs/ai-agent.md) | 终端与数据库助手、SQL 生成与改写、自定义模型 | [AI 面板](docs/images/feature-ai-dark.png) |
| 🎨 [外观与主题](docs/theme-skins.md) | 深浅色、皮肤、界面与终端字体、[界面语言](docs/languages.md) | [外观设置](docs/images/showcase-appearance-zh.png) |

[本地开发与发布](docs/RELEASING.md) · [问题反馈](https://github.com/XiangZi7/MiraiHub/issues)

## ⚠️ 免责声明

MiraiHub 按 [MIT 许可证](LICENSE) 提供。使用第三方 API、模型服务或数据源时，请遵守适用法律及服务条款，并自行承担使用风险。

## 💬 交流与支持

| QQ 交流 2 群 · 657282337 | QQ 交流群 · 442179941 |
| :---: | :---: |
| <a href="https://github.com/user-attachments/assets/d74218a8-8731-4f2a-9925-feb96ca46929"><img src="https://github.com/user-attachments/assets/d74218a8-8731-4f2a-9925-feb96ca46929" width="240" alt="QQ 交流 2 群二维码" /></a> | <a href="https://github.com/user-attachments/assets/83786a34-cf75-4268-9f28-7ceb180cc329"><img src="https://github.com/user-attachments/assets/83786a34-cf75-4268-9f28-7ceb180cc329" width="240" alt="QQ 交流群二维码" /></a> |

[LINUX DO](https://linux.do/)

## 🤝 友情链接

[HotPulse · 全网热点聚合](https://hotpulse.pages.dev/) · [番剧](https://tv.yxcr.top/)

## 📈 Star 趋势

[![MiraiHub Star 趋势](https://api.star-history.com/svg?repos=XiangZi7/MiraiHub&type=Date)](https://www.star-history.com/?repos=XiangZi7%2FMiraiHub&type=Date)
