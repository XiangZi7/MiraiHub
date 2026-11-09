<div align="center">
  <img src="public/logo-app-icon.png" width="88" alt="MiraiHub logo" />
  <h1>MiraiHub</h1>
  <p><strong>A unified workspace for servers and development infrastructure</strong></p>
  <p>SSH terminals · Remote files · Databases · Server monitoring · AI Agent</p>
  <p>
    <a href="https://github.com/XiangZi7/MiraiHub/releases"><img src="https://img.shields.io/github/v/release/XiangZi7/MiraiHub?style=flat-square&amp;color=8b5cf6" alt="GitHub Release" /></a>
    <a href="https://github.com/XiangZi7/MiraiHub/releases"><img src="https://img.shields.io/github/downloads/XiangZi7/MiraiHub/total?style=flat-square&amp;color=8b5cf6" alt="Downloads" /></a>
    <a href="https://github.com/XiangZi7/MiraiHub/actions/workflows/release.yml"><img src="https://img.shields.io/github/actions/workflow/status/XiangZi7/MiraiHub/release.yml?style=flat-square&amp;label=release" alt="Release Workflow" /></a>
    <img src="https://img.shields.io/badge/Windows-x64-0078D4?style=flat-square" alt="Windows x64" />
    <img src="https://img.shields.io/badge/Tauri-2-24C8D8?style=flat-square" alt="Tauri 2" />
    <img src="https://img.shields.io/badge/Vue-3-42B883?style=flat-square" alt="Vue 3" />
  </p>
  <p>
    <a href="https://github.com/XiangZi7/MiraiHub/releases/latest"><strong>Download</strong></a> ·
    <a href="#quick-start">Quick start</a> ·
    <a href="#documentation">Docs</a> ·
    <a href="https://github.com/XiangZi7/MiraiHub/issues">Report an issue</a> ·
    <a href="README.md">简体中文</a>
  </p>
</div>

<br />

![MiraiHub product overview](docs/images/overview.png)

MiraiHub is a desktop workspace built with **Tauri 2 + Rust + Vue 3**. It brings server connections, file transfers, database operations, monitoring, and AI assistance into a single tabbed window for developers and server administrators.

Manage development, test, and server environments in one place: inspect services over SSH, transfer and edit configuration files, query databases, and ask AI Agent to help analyze the current connection.

> The image above is an AI-generated product visual. The Screenshots section below uses captures from the running Windows desktop app. Features and controls may vary by version.

## Features

| | Feature | Description |
| :-: | --- | --- |
| 🖥️ | **SSH & local terminals** | Password / private-key / ssh-agent authentication, keyboard-interactive and second-factor prompts, host fingerprint confirmation, multi-hop jump hosts; PowerShell, CMD, and Git Bash locally |
| ⏺️ | **Terminal productivity** | Command search and completion, variable-based snippets, startup presets, SSH output recording and asciicast v2 playback, optional reconnect after unexpected disconnects |
| 📁 | **Dual-pane file manager** | Browse local and remote files side by side, drag or batch transfer, preview directory differences and sync in one direction, edit permissions, delete directories recursively, and resolve remote text save conflicts |
| 🗄️ | **Multiple database engines** | MySQL, MariaDB, TiDB, PostgreSQL, and SQLite: object browsing, data editing, table design, SQL, and import / export; PostgreSQL schema switching |
| 🧩 | **Database design & operations** | ER diagrams, schema comparison and migration SQL, CHECK / trigger design, execution plans, backup / restore, session monitoring, and user / privilege management, depending on the engine |
| ✨ | **SQL & data AI tools** | Generate / rewrite SQL, repair errors, explain and optimize queries, optional inline completion, result Q&A and charts, test-data rules, and Markdown / HTML data dictionaries |
| 🔑 | **Redis workspace** | SCAN and colon-based groups, create and edit six key types, rename keys, manage TTL, preview pattern-based batch deletion, command completion and history |
| 📈 | **Server monitoring** | CPU, memory, disk, network, uptime, and resource threshold alerts over SSH, with an option to ask AI for analysis; no server-side agent required |
| 🤖 | **AI Agent** | Chat in SSH, database, and Redis workspaces with prompt templates, image / file attachments, encrypted history, tool timelines, context compression, and token usage; search and read large text attachments in chunks |
| 🔌 | **MCP extensions** | Connect local stdio or remote Streamable HTTP servers, expose tools by connection type, and review tool arguments before approval |
| 🛠️ | **Connections & operations** | Local / remote / dynamic SOCKS5 tunnels, database connections over SSH, OpenSSH config import, public-key deployment, batch commands, groups and tags, encrypted connection backups |
| 🪟 | **Tabbed split views** | Drag connection tabs to workspace edges, switch connections independently in each pane, and retain session and editor state |
| 🎨 | **Personalization** | Chinese / English with system detection, light / dark / system appearance, theme skins, custom colors and backgrounds, UI scaling |

## Recent additions & workflows

- **Connect more database engines**: Open SQLite files or select MariaDB / TiDB over the MySQL protocol. Remote databases can reuse a saved SSH connection for tunneling. Development / testing / production labels and read-only connections help distinguish targets; dangerous production operations require typing the database name.
- **Write and troubleshoot SQL**: Generate or rewrite SQL from natural language, review the proposed changes, repair failing statements, and inspect execution plans. Snippets support placeholder navigation; parameterized queries accept `:name`, `?`, and `$1`. Query tabs retain recent results and let you pin them.
- **Deliver database structure**: Inspect foreign-key relationships in an ER diagram, compare source and target databases, and copy migration SQL. Generate Markdown / HTML data dictionaries or ask AI for test-data rules, preview the rows locally, then insert them.
- **Manage database operations**: Use `mysqldump` / `pg_dump` for backups and `mysql` / `psql` for restore, with built-in SQL import / export as a fallback. SQLite supports database-file backups. MySQL / PostgreSQL also offer session monitoring and user / privilege management.
- **Connect, transfer, and replay**: Import `~/.ssh/config`, configure jump hosts, and confirm host fingerprints. Preview local / remote directory differences and sync selected new or changed files. Fill command variables, request inline AI suggestions, or record and replay SSH output.
- **Edit Redis collections directly**: Manage Hash, List, Set, Sorted Set, and Stream entries, create and rename keys, and edit TTL. Batch deletion starts with a scan preview and confirmation; the console adds completion and history.
- **Arrange connections around your task**: Open connections in tabs and drag them to workspace edges for side-by-side views. SSH workspaces also offer terminals, remote files, monitoring, and AI panels. Launching the desktop app again focuses the existing instance.
- **Export query results directly**: Export tables and query results as SQL, Excel, CSV, JSON, TXT, or an HTML data dictionary. Table exports can use the current page or the filtered dataset; track progress and cancel from the transfer center.
- **Control AI context**: Attach up to 16 files per message, including at most four images. Text / Office attachments are encrypted locally; the model receives previews and can search or read relevant chunks. Configure request limits, token windows, and output limits per profile; standard / extended / deep presets provide 4 / 16 / 64 MB of local text context.
- **Update in the app**: Check for updates in **Settings → About**, then download and install the available version, or download manually from Releases.

These additions cover changes since the previous README update and were checked against **v4.0.0 source on 2026-11-09**; they were not all introduced in v4.0.0. Individual release packages may differ. See the [database guide](docs/database.md) for engine-specific limits. Local message capacity and the model's token window are separate settings; increasing local capacity does not expand the model window.

## Screenshots

**Current workspace and command palette**: a local terminal in the Windows desktop development app, with shortcuts to connections, files, SQL, and search. The shell was opened without running demonstration commands; local paths are concealed.

![v3 workspace, local terminal, and command palette in the desktop app](docs/images/workspace.png)

<table>
  <tr>
    <td width="50%" align="center">
      <a href="docs/images/ssh-connection.png"><img src="docs/images/ssh-connection.png" alt="SSH connection settings in the desktop app" /></a><br />
      <sub><b>SSH connection, authentication, and tags</b></sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/images/redis-connection.png"><img src="docs/images/redis-connection.png" alt="Redis connection settings in the desktop app" /></a><br />
      <sub><b>Redis connection and logical database selection</b></sub>
    </td>
  </tr>
  <tr>
    <td width="50%" align="center">
      <a href="docs/images/ai-agent.png"><img src="docs/images/ai-agent.png" alt="Unsaved official AI example profile in the desktop app" /></a><br />
      <sub><b>AI model profiles and API formats</b></sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/images/ai-capacity.png"><img src="docs/images/ai-capacity.png" alt="AI task capacity and model token budgets in the desktop app" /></a><br />
      <sub><b>Task capacity, token budgets, and retries</b></sub>
    </td>
  </tr>
  <tr>
    <td colspan="2" align="center">
      <a href="docs/images/skin.png"><img src="docs/images/skin.png" width="900" alt="Theme settings and the built-in preview in the desktop app" /></a><br />
      <sub><b>Theme skins, backgrounds, and live preview</b></sub>
    </td>
  </tr>
</table>

These six images were captured on **2026-10-30** from the **v3.0.9 Windows desktop development app**, using that day's existing frontend build in the real Tauri WebView2. SSH, Redis, and AI forms are unsaved examples; no model requests were sent. The database window inside the theme screen is a built-in preview. Private service addresses, key paths, and local directories are concealed. Click a gallery image to view its original size.

<details>
<summary><b>Earlier database, SSH file, and server monitoring screenshots</b></summary>

Earlier connected desktop captures are retained below to illustrate these layouts. No authenticated SSH or database connection was used for this refresh, so these three images were not updated. Controls may differ from the current version.

**v2.0.25 database workspace with AI split view**: a live local MySQL connection using a constants-only query.

![Earlier database workspace and AI split view](docs/images/database-workspace.png)

![Earlier SSH terminal and remote file screenshot](docs/images/ssh-workspace.png)

![Earlier server monitoring screenshot](docs/images/server-monitoring.png)

</details>

## Download & install

Grab the latest build from [Releases](https://github.com/XiangZi7/MiraiHub/releases/latest). Only **Windows x64** is published today; macOS / Linux builds are not available yet.

Existing users can also check for app updates in **Settings → About**.

| File | Notes |
| --- | --- |
| `MiraiHub_<version>_windows_x64_setup.exe` | Installer, follow the wizard |
| `MiraiHub_<version>_windows_x64_portable.zip` | Portable build, extract and run `miraihub.exe`; requires [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) |
| `SHA256SUMS.txt` / `version.json` | Checksums plus version and source commit metadata |

> Builds are not code-signed yet, so Windows SmartScreen may show an "Unknown publisher" warning; choose "Run anyway". User data lives in the system app-data directory and does not move with the portable ZIP.

## Quick start

1. **Add a connection**: Create an SSH, local terminal, or database connection from the sidebar. Import SSH hosts from `~/.ssh/config`, select a local file for SQLite, or enter the address, port, and credentials for other connections. Organize them with groups and tags.
2. **Open a workspace**: After connecting over SSH, use the terminal, file panel, and server overview. For databases, browse objects, edit data, or run SQL.
3. **Configure AI (optional)**: In **Settings → AI Agent**, add a service URL, API format, model ID, and API key, then save and test.
4. **Work with the agent**: Open the AI Agent tab or split view, choose an approval mode in the composer, and review proposed commands or SQL according to that mode.

AI features require your own model service with tool-calling support. Presets for OpenAI, Claude, DeepSeek, Doubao, Gemini, and custom endpoints are included. Supported formats are **OpenAI Chat Completions compatible**, **OpenAI Responses**, and **Claude Messages**; select the format your service implements. The Gemini preset uses its OpenAI-compatible endpoint. See the [AI Agent guide](docs/ai-agent.md).

### Keyboard shortcuts

| Action | Default shortcut |
| --- | --- |
| Command palette (outside the SQL editor) | `Ctrl+K` |
| New local terminal | `Ctrl+T` |
| Search | `Ctrl+Shift+F` |
| Remote file panel | `Ctrl+O` |
| Search terminal contents | `Ctrl+F` |
| Run SQL / Redis command | `Ctrl+Enter` |
| Run SQL statement at the cursor | `Ctrl+Shift+Enter` |
| Generate / rewrite SQL with AI (inside the editor) | `Ctrl+K` |
| Inspect SQL execution plan (inside the editor) | `Ctrl+E` |
| Format SQL | `Shift+Alt+F` |
| Inline SSH command suggestion (when AI is available) | `Ctrl+I` |
| Enter / exit fullscreen | `F11` / `Esc` |

Global shortcuts can be changed in **Settings → Shortcuts**. Terminal and query shortcuts apply within their workspace.

## Supported scope

| Module | Supported | Limits |
| --- | --- | --- |
| Desktop | Windows x64 | The release workflow builds Windows only; macOS / Linux builds are not published yet |
| SSH | Passwords, private keys, ssh-agent, keyboard-interactive auth, jump hosts, proxies, three tunnel types | At most five jump hosts; jump chains cannot be combined with a target proxy. All tunnel listeners are loopback-only; dynamic SOCKS5 supports unauthenticated CONNECT only |
| Relational databases | MySQL, MariaDB / TiDB over MySQL, PostgreSQL, SQLite | Design and operations vary by engine. SQLite uses local files, has no server session / user management or database alteration / deletion, and some schema migrations require manual work |
| Redis | Single node, logical DB switching, six editable key types, batch deletion, command console | No Cluster routing or Sentinel discovery. TTL-preserving String editing requires Redis 6.0+; collection editing needs the relevant commands and EVAL permission |
| Server monitoring | System and resource metrics over SSH | Requires permission to run the relevant system commands; no monitoring agent installation |
| AI Agent | Three API formats, tool calling, MCP extensions | Bring your own model service with support for the selected format and tool calling |

## Privacy & security

- **Model requests**: Conversations, attachment previews / requested chunks, and tool results go to your configured model service. SSH Agent can read recent output from connected sessions with `read_terminal`, defaulting to the current session; inline command suggestions send recent terminal context. SQL AI sends the SQL, schema, errors, or result samples needed by the feature. SSH passwords and private-key files are not read automatically.
- **Local storage**: On Windows, AI settings and chat history are encrypted with DPAPI for the current user. Connection settings, plus any passwords or key passphrases you choose to save, live in local WebView storage.
- **Connection backups**: Credentials are excluded by default; including them requires a separate backup password.
- **Action approval**: AI actions follow the selected permission mode. External MCP tools require individual confirmation in both per-action and auto read-only modes. Stopping a task does not roll back completed operations.

## FAQ

<details>
<summary><b>The portable build will not open, or reports a WebView2 error.</b></summary>

Extract the entire ZIP before running `miraihub.exe` and keep the bundled resource folders. Ensure WebView2 Runtime is installed. The installer is configured to install the runtime if it is missing.

</details>

<details>
<summary><b>Why do SSH, databases, or AI fail when I only run <code>pnpm dev</code>?</b></summary>

`pnpm dev` starts the browser frontend. Native features are provided by the Rust backend; use `pnpm tauri dev` to start the complete desktop application.

</details>

<details>
<summary><b>My model service works in another client but reports a protocol error here.</b></summary>

Check the base URL, model ID, API key, and API format. Select **OpenAI · Responses** for services using `/responses`, or Messages for native Claude endpoints. The model must support tool calling. The app does not switch formats automatically; see [AI Agent](docs/ai-agent.md).

</details>

<details>
<summary><b>How do I move connections to another computer?</b></summary>

Export in **Settings → Backup & restore**, then read the backup and review its restore plan on the new computer. Set a separate backup password to include credentials. Private key files, AI settings, and chat history are not included. See [SSH operations](docs/ssh-operations.md#连接备份).

</details>

## Development

| Dependency | Version |
| --- | --- |
| Node.js | 22.22.2 |
| pnpm | 10.33.0 (pinned by `packageManager`) |
| Rust | 1.96.0 |
| Windows | Visual Studio C++ Build Tools, Windows SDK, WebView2 Runtime |

```powershell
git clone https://github.com/XiangZi7/MiraiHub.git
cd MiraiHub
pnpm install --frozen-lockfile
pnpm tauri dev          # start the frontend and the desktop app
```

```powershell
pnpm test                                                        # frontend and release-logic tests
cargo test --locked --manifest-path src-tauri/Cargo.toml --lib   # Rust backend tests
pnpm build                                                       # type check and frontend build
pnpm release:build                                               # build the Windows installer
pnpm release [patch|minor|major] [--dry-run]                     # release: bump version, tag, and push
```

`pnpm dev` alone previews the frontend; native features such as SSH and databases need the Tauri app. See the [release guide](docs/RELEASING.md) for details.

## Documentation

The guides below are written in Simplified Chinese unless noted.

| Guide | Topics |
| --- | --- |
| [Database workspace](docs/database.md) | Engines, data editing, SQL / AI, table design, ER diagrams, schema comparison, backup and operations |
| [AI Agent](docs/ai-agent.md) | Profiles, prompt templates, attachment search, SQL / terminal assistance, approvals and data handling |
| [Redis workspace](docs/redis.md) | Six editable key types, TTL, batch deletion, command history, AI tools, monitoring integration status |
| [SSH operations](docs/ssh-operations.md) | Jump hosts, authentication, three tunnel types, file sync, terminal recording, batch commands and backups |
| [Theme skins](docs/theme-skins.md) | Themes, custom backgrounds, colors, split layouts |
| [Interface languages](docs/languages.md) | Chinese / English switching and system language detection |
| [Frontend architecture](docs/FRONTEND_ARCHITECTURE.md) | Directory responsibilities, routing, session caching, store conventions |
| [Performance](docs/PERFORMANCE.md) | Performance notes and verification records |
| [Releasing](docs/RELEASING.md) | Automated releases, version management, local packaging |
| [Screenshot maintenance](docs/images/README.md) | README image naming and replacement (bilingual) |

## Contributing

Use [Issues](https://github.com/XiangZi7/MiraiHub/issues) for bugs and feature requests, and pull requests for code, docs, or translation improvements.

- **Report a bug**: Include the app version, OS version, reproduction steps, and expected result. Strip passwords, private keys, and API keys from screenshots and logs.
- **Submit a change**: Keep each PR focused on one issue and describe how it was verified. Update docs and both language READMEs when behavior changes.

## License

This project is licensed under the [MIT License](LICENSE), Copyright (c) 2026 XiangZi.

Commercial use, modification, distribution, and closed-source use are permitted, provided the copyright and permission notices are retained. The software is provided "as is", without warranty; see [LICENSE](LICENSE) for the full terms. Third-party dependencies and assets remain subject to their respective licenses.

<div align="center">
  <sub>Made with ❤️ by <a href="https://github.com/XiangZi7">XiangZi</a></sub>
</div>
