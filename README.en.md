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
| 🖥️ | **SSH & local terminals** | Multiple connection tabs, password / key auth, split terminals, terminal search, saved commands, and startup presets |
| 📁 | **Remote files** | Browse, create files and folders, drag-and-drop upload, and download over SFTP with a unified transfer center; edit and save remote text directly |
| 🗄️ | **Database workspace** | MySQL / PostgreSQL: object tree, data editing, table designer, SQL and import / export; Redis: key scanning, value previews and editing, TTL and command console |
| 📈 | **Server monitoring** | CPU, memory, disk, network, and uptime collected over SSH, no agent to install on the server |
| 🤖 | **AI Agent** | Chat inside SSH, database, and Redis workspaces with model profiles, streamed replies, attachments, history, and context compression; choose per-action approval, auto read-only, or full access |
| 🔌 | **MCP extensions** | Connect local stdio or remote Streamable HTTP servers, expose tools by connection type, and review tool arguments before approval |
| 🛠️ | **Server operations** | Local port forwarding, batch commands, SSH key management, connection groups and tags, encrypted backup and restore |
| 🎨 | **Personalization** | Chinese / English with system detection, theme skins, custom colors and backgrounds, UI scaling, resizable split views |

## Screenshots

**Database workspace with AI split view**: the running desktop app connected to a local MySQL server, with the SQL editor and real query results. The query returns demonstration constants only.

![Database workspace with AI split view, captured from the desktop app](docs/images/database-workspace.png)

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
      <a href="docs/images/ai-agent.png"><img src="docs/images/ai-agent.png" alt="AI model profiles and Responses settings in the desktop app" /></a><br />
      <sub><b>AI model profiles and API formats</b></sub>
    </td>
    <td width="50%" align="center">
      <a href="docs/images/skin.png"><img src="docs/images/skin.png" alt="Theme settings and the built-in preview in the desktop app" /></a><br />
      <sub><b>Theme skins, backgrounds, and live preview</b></sub>
    </td>
  </tr>
</table>

These five captures come from the **v2.0.25 Windows desktop development build**. Connection forms show unsaved example addresses; windows inside theme cards are the app's built-in skin previews. Service addresses, project names, and local private key paths have been hidden. Click a gallery image to view its original size.

<details>
<summary><b>Earlier SSH file and server monitoring screenshots</b></summary>

The repository's earlier desktop captures are kept below to illustrate these layouts. Existing SSH connections timed out or disconnected during this capture session, so these two images were not refreshed. Controls may differ from the current version.

![Earlier SSH terminal and remote file screenshot](docs/images/ssh-workspace.png)

![Earlier server monitoring screenshot](docs/images/server-monitoring.png)

</details>

## Download & install

Grab the latest build from [Releases](https://github.com/XiangZi7/MiraiHub/releases/latest). Only **Windows x64** is published today; macOS / Linux builds are not available yet.

| File | Notes |
| --- | --- |
| `MiraiHub_<version>_windows_x64_setup.exe` | Installer, follow the wizard |
| `MiraiHub_<version>_windows_x64_portable.zip` | Portable build, extract and run `miraihub.exe`; requires [WebView2 Runtime](https://developer.microsoft.com/microsoft-edge/webview2/) |
| `SHA256SUMS.txt` / `version.json` | Checksums plus version and source commit metadata |

> Builds are not code-signed yet, so Windows SmartScreen may show an "Unknown publisher" warning; choose "Run anyway". User data lives in the system app-data directory and does not move with the portable ZIP.

## Quick start

1. **Add a connection**: Create an SSH, local terminal, or database connection from the sidebar. Enter the address, port, and credentials; organize with groups and tags.
2. **Open a workspace**: After connecting over SSH, use the terminal, file panel, and server overview. For databases, browse objects, edit data, or run SQL.
3. **Configure AI (optional)**: In **Settings → AI Agent**, add a service URL, API format, model ID, and API key, then save and test.
4. **Work with the agent**: Open the AI Agent tab or split view in a workspace. Review any proposed command or SQL before confirming.

AI features require your own model service with tool-calling support. Presets for OpenAI, Claude, DeepSeek, Doubao, Gemini, and custom endpoints are included. Supported formats are **OpenAI Chat Completions compatible**, **OpenAI Responses**, and **Claude Messages**; select the format your service implements. The Gemini preset uses its OpenAI-compatible endpoint. See the [AI Agent guide](docs/ai-agent.md).

### Keyboard shortcuts

| Action | Default shortcut |
| --- | --- |
| Command palette | `Ctrl+K` |
| New local terminal | `Ctrl+T` |
| Search | `Ctrl+Shift+F` |
| Remote file panel | `Ctrl+O` |
| Search terminal contents | `Ctrl+F` |
| Run SQL / Redis command | `Ctrl+Enter` |
| Enter / exit fullscreen | `F11` / `Esc` |

Global shortcuts can be changed in **Settings → Shortcuts**. Terminal and query shortcuts apply within their workspace.

## Supported scope

| Module | Supported | Limits |
| --- | --- | --- |
| Desktop | Windows x64 | The release workflow builds Windows only; macOS / Linux builds are not published yet |
| SSH | Passwords, private keys, SOCKS5 / HTTP CONNECT proxies, local port forwarding | Forwarding binds to local loopback; reverse and dynamic SOCKS forwarding are not available |
| Relational databases | MySQL, PostgreSQL | SQL editing, table design, and SQL import / export apply to these engines |
| Redis | Single node, logical DB switching, SCAN, previews for six common data types | No Cluster routing or Sentinel discovery; String editing requires Redis 6.0+ and suitable permissions |
| Server monitoring | System and resource metrics over SSH | Requires permission to run the relevant system commands; no monitoring agent installation |
| AI Agent | Three API formats, tool calling, MCP extensions | Bring your own model service with support for the selected format and tool calling |

## Privacy & security

- **Model requests**: Conversations, attachments you add, and tool results are sent to the model service you configure. SSH passwords, private keys, and terminal buffers are not read automatically.
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
| [AI Agent](docs/ai-agent.md) | Model configuration, chat history, action confirmation, data handling |
| [Redis workspace](docs/redis.md) | Connections, key previews, TTL, command console, AI tools |
| [SSH operations](docs/ssh-operations.md) | Port forwarding, remote editing, batch commands, connection backups |
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

A `LICENSE` file has not been added yet; the license is pending confirmation by the maintainer.

<div align="center">
  <sub>Made with ❤️ by <a href="https://github.com/XiangZi7">XiangZi</a></sub>
</div>
