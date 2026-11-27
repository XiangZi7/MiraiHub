# <img src="public/logo-app-icon.png" width="32" height="32" alt="" /> MiraiHub

[Download desktop app](https://github.com/XiangZi7/MiraiHub/releases/latest) · [Features](#features) · [Screenshots](#screenshots) · [简体中文](README.md)

<p align="center">
  <a href="https://github.com/XiangZi7/MiraiHub/releases"><img src="https://img.shields.io/github/v/release/XiangZi7/MiraiHub?style=flat-square&amp;color=8b5cf6&amp;logo=github&amp;logoColor=white" alt="GitHub Release" /></a>
  <a href="https://github.com/XiangZi7/MiraiHub/releases"><img src="https://img.shields.io/github/downloads/XiangZi7/MiraiHub/total?style=flat-square&amp;color=8b5cf6&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNOCAydjhtLTMtMyAzIDMgMy0zTTIgMTB2NGgxMnYtNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg%3D%3D" alt="Downloads" /></a>
  <a href="https://github.com/XiangZi7/MiraiHub/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/XiangZi7/MiraiHub/release.yml?style=flat-square&amp;label=release&amp;logo=githubactions&amp;logoColor=white" alt="Release Workflow" /></a>
  <img src="https://img.shields.io/badge/Windows-x64-0078D4?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTAgMGg3djdIMHpNOSAwaDd2N0g5ek0wIDloN3Y3SDB6TTkgOWg3djdIOXoiLz48L3N2Zz4%3D" alt="Windows x64" />
  <img src="https://img.shields.io/badge/macOS-Intel%20%2F%20Apple%20Silicon-000000?style=flat-square&amp;logo=apple&amp;logoColor=white" alt="macOS Intel and Apple Silicon" />
  <img src="https://img.shields.io/badge/Linux-x64-FCC624?style=flat-square&amp;logo=linux&amp;logoColor=FCC624" alt="Linux x64" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/License-MIT-777777?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNOCAydjEybS00IDBoOE0yIDVoMTJNNCA1IDIgMTBoNHpNMTIgNWwtMiA1aDR6IiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8%2BPC9zdmc%2B" alt="MIT License" /></a>
  <a href="#community"><img src="https://img.shields.io/badge/QQ_group-442179941-12B7F5?style=flat-square&amp;logo=qq&amp;logoColor=white" alt="QQ group: 442179941" /></a>
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
  <a href="docs/ssh-operations.md"><img src="https://img.shields.io/badge/SSH-Terminal-4EAA25?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMS41IDNoMTN2MTBoLTEzek00IDZsMiAyLTIgMm00IDBoNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg%3D%3D" alt="SSH terminal" /></a>
  <a href="docs/ssh-operations.md"><img src="https://img.shields.io/badge/SFTP-Files-0096C7?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMS41IDR2OWgxM1Y1LjVIOEw2LjUgNHoiIGZpbGw9Im5vbmUiIHN0cm9rZT0id2hpdGUiIHN0cm9rZS13aWR0aD0iMS41IiBzdHJva2UtbGluZWNhcD0icm91bmQiIHN0cm9rZS1saW5lam9pbj0icm91bmQiLz48L3N2Zz4%3D" alt="SFTP file management" /></a>
  <a href="docs/images/feature-file-copy.png"><img src="https://img.shields.io/badge/Local-Terminal-64748B?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMS41IDNoMTN2MTBoLTEzek00IDZsMiAyLTIgMm00IDBoNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg%3D%3D" alt="Local terminal" /></a>
  <a href="docs/images/feature-rdp.png"><img src="https://img.shields.io/badge/RDP-Remote%20Desktop-0F6CBD?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMS41IDIuNWgxM3Y5aC0xM3pNOCAxMS41VjE0bS0zIDBoNiIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg%3D%3D" alt="Windows Remote Desktop (RDP)" /></a>
  <a href="docs/ssh-operations.md"><img src="https://img.shields.io/badge/Server-Monitoring-F59E0B?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMSA4aDNsMi00IDMgOCAyLTRoNCIgZmlsbD0ibm9uZSIgc3Ryb2tlPSJ3aGl0ZSIgc3Ryb2tlLXdpZHRoPSIxLjUiIHN0cm9rZS1saW5lY2FwPSJyb3VuZCIgc3Ryb2tlLWxpbmVqb2luPSJyb3VuZCIvPjwvc3ZnPg%3D%3D" alt="Server monitoring" /></a>
  <a href="docs/ai-agent.md"><img src="https://img.shields.io/badge/AI-Agent-8B5CF6?style=flat-square&amp;logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBkPSJNMyA1aDEwdjhIM3pNOCAydjNNMSA4djJtMTQtMnYyTTYgOHYxbTQtMXYxIiBmaWxsPSJub25lIiBzdHJva2U9IndoaXRlIiBzdHJva2Utd2lkdGg9IjEuNSIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIi8%2BPC9zdmc%2B" alt="AI Agent" /></a>
</p>

<p align="center">
  <a href="docs/database.md"><img src="https://img.shields.io/badge/MySQL-supported-4479A1?style=flat-square&amp;logo=mysql&amp;logoColor=white" alt="MySQL supported" /></a>
  <a href="docs/database.md"><img src="https://img.shields.io/badge/MariaDB-compatible-003545?style=flat-square&amp;logo=mariadb&amp;logoColor=white" alt="MariaDB compatible via the MySQL protocol" /></a>
  <a href="docs/database.md"><img src="https://img.shields.io/badge/TiDB-compatible-EF4135?style=flat-square&amp;logo=tidb&amp;logoColor=white" alt="TiDB compatible via the MySQL protocol" /></a>
  <a href="docs/database.md"><img src="https://img.shields.io/badge/PostgreSQL-supported-4169E1?style=flat-square&amp;logo=postgresql&amp;logoColor=white" alt="PostgreSQL supported" /></a>
  <a href="docs/database.md"><img src="https://img.shields.io/badge/SQLite-supported-003B57?style=flat-square&amp;logo=sqlite&amp;logoColor=white" alt="SQLite supported" /></a>
  <a href="docs/redis.md"><img src="https://img.shields.io/badge/Redis-supported-DC382D?style=flat-square&amp;logo=redis&amp;logoColor=white" alt="Redis supported" /></a>
</p>

## 📦 Download & install

| OS | Download |
| --- | --- |
| **Windows** | [![Setup x64](https://img.shields.io/badge/Setup-x64-0078D4?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTAgMGg3djdIMHpNOSAwaDd2N0g5ek0wIDloN3Y3SDB6TTkgOWg3djdIOXoiLz48L3N2Zz4%3D)](https://github.com/XiangZi7/MiraiHub/releases/latest) [![Portable ZIP x64](https://img.shields.io/badge/Portable%20ZIP-x64-0078D4?style=flat-square&logo=data%3Aimage%2Fsvg%2Bxml%3Bbase64%2CPHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHZpZXdCb3g9IjAgMCAxNiAxNiIgd2lkdGg9IjE2IiBoZWlnaHQ9IjE2Ij48cGF0aCBmaWxsPSJ3aGl0ZSIgZD0iTTAgMGg3djdIMHpNOSAwaDd2N0g5ek0wIDloN3Y3SDB6TTkgOWg3djdIOXoiLz48L3N2Zz4%3D)](https://github.com/XiangZi7/MiraiHub/releases/latest) |
| **macOS** | [![DMG Apple Silicon](https://img.shields.io/badge/DMG-Apple%20Silicon-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/XiangZi7/MiraiHub/releases/latest) [![DMG Intel x64](https://img.shields.io/badge/DMG-Intel%20x64-000000?style=flat-square&logo=apple&logoColor=white)](https://github.com/XiangZi7/MiraiHub/releases/latest) |
| **Linux** | [![AppImage x64](https://img.shields.io/badge/AppImage-x64-FCC624?style=flat-square&logo=linux&logoColor=FCC624)](https://github.com/XiangZi7/MiraiHub/releases/latest) [![DebPackage x64](https://img.shields.io/badge/DebPackage-x64-D70A53?style=flat-square&logo=debian&logoColor=white)](https://github.com/XiangZi7/MiraiHub/releases/latest) |

[Installation and updates](docs/RELEASING.md#工作流与下载) · [WebView2 for Windows ZIP](https://developer.microsoft.com/microsoft-edge/webview2/)

<a name="features"></a>

## 🧰 Features

| Feature | Includes |
| --- | --- |
| 🖥️ [SSH terminal](docs/ssh-operations.md) | Jump hosts, port forwarding, split panes, command and path completion, search, recording and playback |
| ⌨️ Local terminal | Local shells, terminal search and file browser |
| 🪟 Windows Remote Desktop | RDP full screen, resolution controls and two-way text and file clipboard |
| 📂 [File management](docs/ssh-operations.md#文件上传与下载) | Dual-pane SFTP, upload and download, folder sync, inline remote renaming, local drag-and-drop and cross-SSH copying |
| 🐳 Docker | Start, stop and restart containers, group by Compose project, inspect health and usage, filter logs |
| 📈 [Server monitoring](docs/ssh-operations.md) | CPU, memory, disk and network |
| 🗄️ [Databases](docs/database.md) | MySQL, MariaDB, TiDB, PostgreSQL and SQLite with SQL, data editing, table design and ER diagrams |
| 🔑 [Redis](docs/redis.md) | Key editor, command panel, server status, slow log, big-key scans and Pub/Sub |
| 🤖 [AI Agent](docs/ai-agent.md) | Terminal and database assistance, SQL generation and rewrites, custom models |
| 🎨 [Appearance](docs/theme-skins.md) | Light and dark themes, skins, interface and terminal fonts, [interface languages](docs/languages.md) |

<a name="screenshots"></a>

## 🖼️ Screenshots

<table>
  <tr>
    <td align="center" width="50%" valign="top"><strong>SSH terminal and remote files</strong><br /><a href="docs/images/feature-ssh-dark.png"><img src="docs/images/feature-ssh-dark.png" width="100%" alt="SSH terminal and remote files" /></a></td>
    <td align="center" width="50%" valign="top"><strong>Local and remote file panes</strong><br /><a href="docs/images/feature-files-light.png"><img src="docs/images/feature-files-light.png" width="100%" alt="Local and remote file panes" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>Docker container management</strong><br /><a href="docs/images/feature-docker.png"><img src="docs/images/feature-docker.png" width="100%" alt="Docker container management" /></a></td>
    <td align="center" width="50%" valign="top"><strong>Docker container logs</strong><br /><a href="docs/images/feature-docker-logs.png"><img src="docs/images/feature-docker-logs.png" width="100%" alt="Docker container logs" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>Local terminal and file copy</strong><br /><a href="docs/images/feature-file-copy.png"><img src="docs/images/feature-file-copy.png" width="100%" alt="Local terminal and file copy" /></a></td>
    <td align="center" width="50%" valign="top"><strong>Windows Remote Desktop connection settings</strong><br /><a href="docs/images/feature-rdp.png"><img src="docs/images/feature-rdp.png" width="100%" alt="Windows Remote Desktop connection settings" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>Database · Dark</strong><br /><a href="docs/images/feature-database-dark.png"><img src="docs/images/feature-database-dark.png" width="100%" alt="Database · Dark" /></a></td>
    <td align="center" width="50%" valign="top"><strong>Database · Light</strong><br /><a href="docs/images/feature-database-light.png"><img src="docs/images/feature-database-light.png" width="100%" alt="Database · Light" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>Table designer</strong><br /><a href="docs/images/feature-designer-light.png"><img src="docs/images/feature-designer-light.png" width="100%" alt="Table designer" /></a></td>
    <td align="center" width="50%" valign="top"><strong>ER diagram</strong><br /><a href="docs/images/feature-er-light.png"><img src="docs/images/feature-er-light.png" width="100%" alt="ER diagram" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>Redis key editor</strong><br /><a href="docs/images/feature-redis-dark.png"><img src="docs/images/feature-redis-dark.png" width="100%" alt="Redis key editor" /></a></td>
    <td align="center" width="50%" valign="top"><strong>AI Agent</strong><br /><a href="docs/images/feature-ai-dark.png"><img src="docs/images/feature-ai-dark.png" width="100%" alt="AI Agent" /></a></td>
  </tr>
  <tr>
    <td align="center" width="50%" valign="top"><strong>Server monitoring</strong><br /><a href="docs/images/feature-monitor-light.png"><img src="docs/images/feature-monitor-light.png" width="100%" alt="Server monitoring" /></a></td>
    <td align="center" width="50%" valign="top"><strong>Appearance settings</strong><br /><a href="docs/images/showcase-appearance-en.png"><img src="docs/images/showcase-appearance-en.png" width="100%" alt="Appearance settings" /></a></td>
  </tr>
</table>

[Development and releases](docs/RELEASING.md) · [Report an issue](https://github.com/XiangZi7/MiraiHub/issues)

## ⚠️ Disclaimer

MiraiHub is provided under the [MIT License](LICENSE). When using third-party APIs, model services, or data sources, follow applicable laws and service terms and assume the risks of use.

<a name="community"></a>

## 💬 Community & support

| QQ Group 2 · 657282337 | QQ Group 1 · 442179941 |
| :---: | :---: |
| <a href="https://github.com/user-attachments/assets/d74218a8-8731-4f2a-9925-feb96ca46929"><img src="https://github.com/user-attachments/assets/d74218a8-8731-4f2a-9925-feb96ca46929" width="240" alt="QR code for QQ Group 2" /></a> | <a href="https://github.com/user-attachments/assets/83786a34-cf75-4268-9f28-7ceb180cc329"><img src="https://github.com/user-attachments/assets/83786a34-cf75-4268-9f28-7ceb180cc329" width="240" alt="QR code for QQ Group 1" /></a> |

[LINUX DO](https://linux.do/)

## 🤝 Related links

[HotPulse · Trending topics](https://hotpulse.pages.dev/) · [Anime](https://tv.yxcr.top/)

## 📈 Star history

[![MiraiHub star history](https://api.star-history.com/svg?repos=XiangZi7/MiraiHub&type=Date)](https://www.star-history.com/?repos=XiangZi7%2FMiraiHub&type=Date)
