# zigi 的个人作品集

零依赖的静态站点，发布在 GitHub Pages：

<https://zigi994.github.io>

跨越三种尺度的七个项目——屏幕、角色、空间。首页有一个可交互的「交互实验」区，
案例页里的 AI 工作台与智能茶器都是可以直接操作的原型。

## 本地预览

不需要 Node，也不需要任何依赖。双击根目录的 **`启动预览.cmd`** 即可，
浏览器会打开 <http://localhost:8787>。

> 必须通过 HTTP 打开。直接双击 `site/index.html` 会因为浏览器对
> `file://` 的模块脚本限制而无法加载交互脚本（文字与图片仍会正常显示）。

也可以手动启动：

```powershell
powershell -ExecutionPolicy Bypass -File site/_tools/serve.ps1 -Port 8787
```

## 目录结构

```
site/                 发布的站点（GitHub Actions 直接上传这个目录）
  index.html          首页：hero / 宣言 / 作品索引 / 交互实验 / 关于
  work/*.html         七个案例详情页
  styles/             tokens · base · components · home · case · concept
  scripts/            motion（通用动效）· home · case · concept
  assets/             压缩后的 WebP + manifest.json（内含 LQIP 占位图）
  _tools/             资源流水线与自查工具，未纳入版本控制
_archive/             早期的 Vite + React 版本，仅保留在本地
```

## 修改内容

- 文案与项目信息直接写在对应的 HTML 里，没有数据层。
- 设计变量集中在 `site/styles/tokens.css`：配色、字阶、间距、缓动曲线。
- 每个页面的主题色由 `<body data-accent>` 决定，滚动到不同区块时会平滑过渡。

## 资源流水线

原始素材（`.ai`、大尺寸 PNG/JPG）通过 `site/_tools/` 里的浏览器端流水线
转成 WebP：先用 pdf.js 栅格化 Illustrator 画板，再用 canvas 压缩、去背、
生成 20px 的 LQIP 占位图，最后写入 `assets/manifest.json`。
本机没有 ImageMagick 或 Node，所以全部在无头 Chrome 里完成。

重新生成资源：启动本地服务后依次打开
`/_tools/pipeline.html`、`/_tools/cutout.html`、`/_tools/crop.html`。

## 自查

`/_tools/audit.html` 会在 390 / 820 / 1500 三个宽度下逐页检查
JS 报错、失效图片与横向溢出；`/_tools/measure.html` 输出关键元素的实际盒模型。

## 发布

推送到 `main` 分支后，`.github/workflows/deploy.yml` 会把 `site/` 直接上传到
GitHub Pages（无构建步骤）。仓库 **Settings → Pages** 的 **Source** 需设为
**GitHub Actions**。
