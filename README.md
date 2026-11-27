# <img src="public/logo-app-icon.png" width="32" height="32" alt="" /> MiraiHub

[下载桌面版](https://github.com/XiangZi7/MiraiHub/releases/latest) · [功能](#功能) · [界面预览](#screenshots) · [English](README.en.md)

<p align="center">
  <a href="https://github.com/XiangZi7/MiraiHub/releases"><img src="https://img.shields.io/github/v/release/XiangZi7/MiraiHub?style=flat-square&amp;color=8b5cf6&amp;logo=github&amp;logoColor=white" alt="GitHub Release" /></a>
  <a href="https://github.com/XiangZi7/MiraiHub/releases"><img src="https://img.shields.io/github/downloads/XiangZi7/MiraiHub/total?style=flat-square&amp;color=8b5cf6&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNOCAydjhtLTMtMyAzIDMgMy0zTTIgMTB2NGgxMnYtNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg%3D%3D" alt="Downloads" /></a>
  <a href="https://github.com/XiangZi7/MiraiHub/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/XiangZi7/MiraiHub/release.yml?style=flat-square&amp;label=release&amp;logo=githubactions&amp;logoColor=white" alt="Release Workflow" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0078D4?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTAgMGg3djdIMHpNOSAwaDd2N0g5ek0wIDloN3Y3SDB6TTkgOWg3djdIOXoiLz48L3N2Zz4%3D" alt="Windows x64" />
  <img src="https://img.shields.io/badge/macOS-Intel%20%2F%20Apple%20Silicon-000000?style=flat-square&amp;logo=apple&amp;logoColor=white" alt="macOS Intel and Apple Silicon" />
  <img src="https://img.shields.io/badge/Linux-x64-FCC624?style=flat-square&amp;logo=linux&amp;logoColor=FCC624" alt="Linux x64" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-777777?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNOCAydjEybS00IDBoOE0yIDVoMTJNNCA1IDIgMTBoNHpNMTIgNWwtMiA1aDR6IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8%2BPC9zdmc%2B" alt="MIT License" /></a>
  <a href="#community"><img src="https://img.shields.io/badge/QQ%E7%BE%A4-442179941-12B7F5?style=flat-square&amp;logo=qq&amp;logoColor=white" alt="QQ群：442179941" /></a>
</p>

<p align="center">
  <img src="https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square&amp;logo=tauri&amp;logoColor=24C8D8" alt="Tauri 2" />
  <img src="https://img.shields.io/badge/Rust-2021-DEA584?style=flat-square&amp;logo=rust&amp;logoColor=DEA584" alt="Rust 2021 edition" />
  <img src="https://img.shields.io/badge/Vue-3-42B883?style=flat-square&amp;logo=vuedotjs&amp;logoColor=42B883" alt="Vue 3" />
  <img src="https://img.shields.io/badge/TypeScript-5.9-3178C6?style=flat-square&amp;logo=typescript&amp;logoColor=white" alt="TypeScript 5.9" />
  <img src="https://img.shields.io/badge/Vite-8-646CFF?style=flat-square&amp;logo=vite&amp;logoColor=white" alt="Vite 8" />
  <img src="https://img.shields.io/badge/Tailwind_CSS-4-06B6D4?style=flat-square&amp;logo=tailwindcss&amp;logoColor=06B6D4" alt="Tailwind CSS 4" />
  <a href="https://hub.xerj.org/contributors/XiangZi7"><img src="https://hub.xerj.org/contributors/XiangZi7/badge.svg" alt="XERJ Corpus Hub Contributor" /></a>
</p>

<p align="center">
  <a href="docs/ssh-operations.md"><img src="https://img.shields.io/badge/SSH-Terminal-4EAA25?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMS41IDNoMTN2MTBoLTEzek00IDZsMiAyLTIgMm00IDBoNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg%3D%3D" alt="SSH 终端" /></a>
  <a href="docs/ssh-operations.md"><img src="https://img.shields.io/badge/SFTP-Files-0096C7?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMS41IDR2OWgxM1Y1LjVIOEw2LjUgNHoiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4%3D" alt="SFTP 文件管理" /></a>
  <a href="docs/images/feature-file-copy.png"><img src="https://img.shields.io/badge/Local-Terminal-64748B?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMS41IDNoMTN2MTBoLTEzek00IDZsMiAyLTIgMm00IDBoNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg%3D%3D" alt="本地终端" /></a>
  <a href="docs/images/feature-rdp.png"><img src="https://img.shields.io/badge/RDP-Remote%20Desktop-0F6CBD?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMS41IDIuNWgxM3Y5aC0xM3pNOCAxMS41VjE0bS0zIDBoNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg%3D%3D" alt="Windows 远程桌面 (RDP)" /></a>
  <a href="docs/ssh-operations.md"><img src="https://img.shields.io/badge/Server-Monitoring-F59E0B?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMSA4aDNsMi00IDMgOCAyLTRoNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg%3D%3D" alt="服务器监控" /></a>
  <a href="docs/ai-agent.md"><img src="https://img.shields.io/badge/AI-Agent-8B5CF6?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMyA1aDEwdjhIM3pNOCAydjNNMSA4djJtMTQtMnYyTTYgOHYxbTQtMXYxIiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8%2BPC9zdmc%2B" alt="AI Agent" /></a>
</p>

<p align="center">
  <a href="docs/database.md"><img src="https://img.shields.io/badge/MySQL-supported-4479A1?style=flat-square&amp;logo=mysql&amp;logoColor=white" alt="支持 MySQL" /></a>
  <a href="docs/database.md"><img src="https://img.shields.io/badge/MariaDB-compatible-003545?style=flat-square&amp;logo=mariadb&amp;logoColor=white" alt="通过 MySQL 协议兼容 MariaDB" /></a>
  <a href="docs/database.md"><img src="https://img.shields.io/badge/TiDB-compatible-EF4135?style=flat-square&amp;logo=tidb&amp;logoColor=white" alt="通过 MySQL 协议兼容 TiDB" /></a>
  <a href="docs/database.md"><img src="https://img.shields.io/badge/PostgreSQL-supported-4169E1?style=flat-square&amp;logo=postgresql&amp;logoColor=white" alt="支持 PostgreSQL" /></a>
  <a href="docs/database.md"><img src="https://img.shields.io/badge/SQLite-supported-003B57?style=flat-square&amp;logo=sqlite&amp;logoColor=white" alt="支持 SQLite" /></a>
  <a href="docs/redis.md"><img src="https://img.shields.io/badge/Redis-supported-DC382D?style=flat-square&amp;logo=redis&amp;logoColor=white" alt="支持 Redis" /></a>
</p>

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

<a name="community"></a>

## 💬 交流与支持

| QQ 交流 2 群 · 657282337 | QQ 交流群 · 442179941 |
| :---: | :---: |
| <a href="https://github.com/user-attachments/assets/d74218a8-8731-4f2a-9925-feb96ca46929"><img src="https://github.com/user-attachments/assets/d74218a8-8731-4f2a-9925-feb96ca46929" width="240" alt="QQ 交流 2 群二维码" /></a> | <a href="https://github.com/user-attachments/assets/83786a34-cf75-4268-9f28-7ceb180cc329"><img src="https://github.com/user-attachments/assets/83786a34-cf75-4268-9f28-7ceb180cc329" width="240" alt="QQ 交流群二维码" /></a> |

[LINUX DO](https://linux.do/)

## 🤝 友情链接

[HotPulse · 全网热点聚合](https://hotpulse.pages.dev/) · [番剧](https://tv.yxcr.top/)

## 📈 Star 趋势

[![MiraiHub Star 趋势](https://api.star-history.com/svg?repos=XiangZi7/MiraiHub&type=Date)](https://www.star-history.com/?repos=XiangZi7%2FMiraiHub&type=Date)
