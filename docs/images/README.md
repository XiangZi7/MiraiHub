# README 图片维护 / README image maintenance

## 简体中文

两份 README 共用本目录的图片。`overview.png` 是当前产品展示图，四个功能截图位暂时使用 `screenshot-placeholder.svg`，不会产生图片缺失链接。

| 展示位置 | 建议文件名 | 当前状态 |
| --- | --- | --- |
| 顶部产品展示图 | `overview.png` | 已放入现有产品图。 |
| SSH 终端与远端文件 | `ssh-workspace.png` | 待补充。 |
| 数据库工作台 | `database-workspace.png` | 待补充。 |
| 服务器监控 | `server-monitoring.png` | 待补充。 |
| AI Agent | `ai-agent.png` | 待补充。 |

添加截图：

1. 将图片按上表命名，放入 `docs/images/`。
2. 打开根目录的 [README.md](../../README.md) 和 [README.en.md](../../README.en.md)，找到对应截图标题下方的 HTML 注释。
3. 将该位置的 `src="docs/images/screenshot-placeholder.svg"` 改为实际图片路径，并去掉 `alt` 中的“截图待补充”或“screenshot coming soon”。两份 README 都需要修改。
4. 预览 Markdown，确认中英文页面的图片和描述一致。

例如 SSH 截图替换为：

```html
<img src="docs/images/ssh-workspace.png" width="100%" alt="SSH 终端与远端文件" />
```

顶部展示图可直接覆盖 `overview.png`，无需修改 README。功能截图建议统一为 16:10，宽度至少 1440 px；也可使用其他比例或 WebP / JPG，同步修改图片路径即可。无需补齐所有截图，一次替换一个位置也可以。

## English

Both READMEs share the images in this directory. `overview.png` contains the current product image. The four feature slots use `screenshot-placeholder.svg` until screenshots are available, so all image references resolve.

| Position | Suggested filename | Status |
| --- | --- | --- |
| Hero product image | `overview.png` | Existing product image included. |
| SSH terminals and remote files | `ssh-workspace.png` | To be added. |
| Database workspace | `database-workspace.png` | To be added. |
| Server monitoring | `server-monitoring.png` | To be added. |
| AI Agent | `ai-agent.png` | To be added. |

To add a screenshot:

1. Save it under `docs/images/` with the filename above.
2. Open the root [README.md](../../README.md) and [README.en.md](../../README.en.md). Find the HTML comment below the corresponding screenshot title.
3. Replace that slot's `src="docs/images/screenshot-placeholder.svg"` with the actual image path. Remove “截图待补充” or “screenshot coming soon” from its `alt` text. Update both READMEs.
4. Preview the Markdown and check that both language versions show the correct image and description.

For example, the SSH screenshot becomes:

```html
<img src="docs/images/ssh-workspace.png" width="100%" alt="SSH terminals and remote files" />
```

To update the hero image, overwrite `overview.png`; no README changes are needed. A consistent 16:10 ratio and a width of at least 1440 px work well for feature screenshots. Other ratios, WebP, and JPG are also supported; update the paths accordingly. Screenshots can be added one at a time.
