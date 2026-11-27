# <img src="public/logo-app-icon.png" width="32" height="32" alt="" /> MiraiHub

[下载桌面版](https://github.com/XiangZi7/MiraiHub/releases/latest) · [功能](#功能) · [界面预览](#screenshots) · [English](README.en.md)

## 📦 下载与安装

| 系统 | 下载 |
| --- | --- |
| **Windows** | [![Setup x64](https://img.shields.io/badge/Setup-x64-0078D4?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTAgMGg3djdIMHpNOSAwaDd2N0g5ek0wIDloN3Y3SDB6TTkgOWg3djdIOXoiLz48L3N2Zz4%3D)](https://github.com/XiangZi7/MiraiHub/releases/latest) [![Portable ZIP x64](https://img.shields.io/badge/Portable%20ZIP-x64-0078D4?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTAgMGg3djdIMHpNOSAwaDd2N0g5ek0wIDloN3Y3SDB6TTkgOWg3djdIOXoiLz48L3N2Zz4%3D)](https://github.com/XiangZi7/MiraiHub/releases/latest) |
| **macOS** | [![DMG Apple Silicon](https://img.shields.io/badge/DMG-Apple%20Silicon-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/XiangZi7/MiraiHub/releases/latest) [![DMG Intel x64](https://img.shields.io/badge/DMG-Intel%20x64-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/XiangZi7/MiraiHub/releases/latest) |
| **Linux** | [![AppImage x64](https://img.shields.io/badge/AppImage-x64-FCC624?style=flat-square&logo=linux&logoColor=FCC624)](https://github.com/XiangZi7/MiraiHub/releases/latest) [![DebPackage x64](https://img.shields.io/badge/DebPackage-x64-D70A53?style=flat-square&logo=debian&logoColor=white)](https://github.com/XiangZi7/MiraiHub/releases/latest) |

[安装与更新说明](docs/RELEASING.md#工作流与下载) · [Windows ZIP 所需的 WebView2](https://developer.microsoft.com/microsoft-edge/webview2/)

<a name="功能"></a>

## 🧰 功能

| 功能 | 支持 |
| --- | --- |
| 🖥️ [SSH 终端](docs/ssh-operations.md) | 跳板机、端口转发、分屏、命令与路径补全、搜索、录制与回放 |
| ⌨️ 本地终端 | 本地 Shell、终端搜索、文件面板 |
| 🪟 Windows 远程桌面 | RDP 全屏与分辨率设置、双向文本和文件剪贴板 |
| 📂 [文件管理](docs/ssh-operations.md#文件上传与下载) | SFTP 双栏、上传下载、目录同步、远端文件行内重命名、本地拖放与跨 SSH 复制 |
| 🐳 Docker | 容器启停与重启、Compose 分组、健康与资源详情、日志筛选 |
| 📈 [服务器监控](docs/ssh-operations.md) | CPU、内存、磁盘与网络 |
| 🗄️ [数据库](docs/database.md) | MySQL、MariaDB、TiDB、PostgreSQL、SQLite，支持 SQL 编辑、数据编辑、表结构设计和 ER 图 |
| 🔑 [Redis](docs/redis.md) | 键值编辑、命令面板、实例状态、慢日志、大键扫描、发布与订阅 |
| 🤖 [AI Agent](docs/ai-agent.md) | 终端与数据库助手、SQL 生成与改写、自定义模型 |
| 🎨 [外观与主题](docs/theme-skins.md) | 深浅色、皮肤、界面与终端字体、[界面语言](docs/languages.md) |

<a name="screenshots"></a>

## 🖼️ 界面预览

<table>
  <tr>
    <td align="center" width="50%" valign="top"><strong>SSH 终端与远端文件</strong><br /><a href="docs/images/feature-ssh-dark.png"><img src="docs/images/feature-ssh-dark.png" width="100%" alt="SSH 终端与远端文件" /></a></td>
    <td align="center" width="50%" valign="top"><strong>本地与远端双栏文件</strong><br /><a href="docs/images/feature-files-light.png"><img src="docs/images/feature-files-light.png" width="100%" alt="本地与远端双栏文件" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>Docker 容器管理</strong><br /><a href="docs/images/feature-docker.png"><img src="docs/images/feature-docker.png" width="100%" alt="Docker 容器管理" /></a></td>
    <td align="center" width="50%" valign="top"><strong>Docker 容器日志</strong><br /><a href="docs/images/feature-docker-logs.png"><img src="docs/images/feature-docker-logs.png" width="100%" alt="Docker 容器日志" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>本地终端与文件复制</strong><br /><a href="docs/images/feature-file-copy.png"><img src="docs/images/feature-file-copy.png" width="100%" alt="本地终端与文件复制" /></a></td>
    <td align="center" width="50%" valign="top"><strong>Windows 远程桌面连接设置</strong><br /><a href="docs/images/feature-rdp.png"><img src="docs/images/feature-rdp.png" width="100%" alt="Windows 远程桌面连接设置" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>数据库 · 深色</strong><br /><a href="docs/images/feature-database-dark.png"><img src="docs/images/feature-database-dark.png" width="100%" alt="数据库 · 深色" /></a></td>
    <td align="center" width="50%" valign="top"><strong>数据库 · 浅色</strong><br /><a href="docs/images/feature-database-light.png"><img src="docs/images/feature-database-light.png" width="100%" alt="数据库 · 浅色" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>表结构设计</strong><br /><a href="docs/images/feature-designer-light.png"><img src="docs/images/feature-designer-light.png" width="100%" alt="表结构设计" /></a></td>
    <td align="center" width="50%" valign="top"><strong>ER 关系图</strong><br /><a href="docs/images/feature-er-light.png"><img src="docs/images/feature-er-light.png" width="100%" alt="ER 关系图" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>Redis 键值编辑</strong><br /><a href="docs/images/feature-redis-dark.png"><img src="docs/images/feature-redis-dark.png" width="100%" alt="Redis 键值编辑" /></a></td>
    <td align="center" width="50%" valign="top"><strong>AI Agent</strong><br /><a href="docs/images/feature-ai-dark.png"><img src="docs/images/feature-ai-dark.png" width="100%" alt="AI Agent" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>服务器监控</strong><br /><a href="docs/images/feature-monitor-light.png"><img src="docs/images/feature-monitor-light.png" width="100%" alt="服务器监控" /></a></td>
    <td align="center" width="50%" valign="top"><strong>外观设置</strong><br /><a href="docs/images/showcase-appearance-zh.png"><img src="docs/images/showcase-appearance-zh.png" width="100%" alt="外观设置" /></a></td>
  </tr>
</table>

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
