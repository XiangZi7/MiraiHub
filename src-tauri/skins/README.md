# 皮肤目录

每个子目录是一套皮肤，目录名就是皮肤 id。安装后这个目录位于程序所在文件夹的 `skins/` 下，直接改文件即可换皮，改完重启 MiraiHub（或在设置的「主题皮肤」页点「重新加载皮肤」）生效。

```
skins/
└── kuriyama-mirai/
    ├── skin.json        清单：名称、说明、图片与样式表文件名
    ├── background.png   背景图（PNG / JPG / WebP 均可，在 skin.json 里指定文件名）
    └── skin.css         样式表：覆盖 :root 上的颜色变量
```

`skin.json` 的字段都是可选的：

| 字段 | 含义 |
| --- | --- |
| `name` | 卡片标题 |
| `description` | 卡片副标题 |
| `caption` | 卡片右下角小字 |
| `quote` | 卡片里的引言 |
| `colorScheme` | `light` 或 `dark`，决定终端配色和取色器默认值 |
| `background` | 背景图文件名，默认 `background.png` |
| `stylesheet` | 样式表文件名，默认 `skin.css` |

样式表里可以覆盖的颜色变量见 `src/assets/styles/main.css` 的 `@theme` 段。

`pnpm dev` 在浏览器里预览时，Vite 开发服务器把这个目录挂在 `/skins` 下；发布包里它位于程序旁边。
