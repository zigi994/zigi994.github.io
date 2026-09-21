# zigi 的个人作品集

零依赖的静态站点，发布在 GitHub Pages：

<https://zigi994.github.io>

跨越三种尺度的六个项目——屏幕、角色、空间。首页有一个可交互的「交互实验」区，
案例页里的 AI 工作台与智能茶器都是可以直接操作的原型。

## 本地预览

不需要 Node，也不需要任何依赖。双击根目录的 **`启动预览.cmd`** 即可，
浏览器会打开 <http://localhost:8787>。

> 必须通过 HTTP 打开。直接双击 `zigi994/index.html` 会因为浏览器对
> `file://` 的模块脚本限制而无法加载交互脚本（文字与图片仍会正常显示）。

也可以手动启动：

```powershell
powershell -ExecutionPolicy Bypass -File tools/serve.ps1 -Port 8787
```

站点在 `/`，自查工具挂在 `/__tools/`。

## 目录结构

```
zigi994/              发布的站点（GitHub Actions 直接上传这个目录）
  index.html          首页：hero / 宣言 / 作品索引 / 交互实验 / 关于
  work/*.html         六个案例详情页
  styles/             tokens · base · components · home · case · concept · transitions
  scripts/            motion（通用动效）· home · case · concept · navigation · sw-register
  assets/             压缩后的 WebP、可变字体、manifest.json（内含 LQIP 占位图）
  sw.js               Service Worker：离线与缓存策略
tools/                资源流水线与自查工具，刻意放在发布目录之外，不会被上传
```

`tools/` 里只有脚本进版本库；原始设计稿（`tools/src/`，约 45 MB）与截图产物不入库。

## 设计系统

配色不是从 HSL 均匀生成的，每个颜色都有实物出处——朱红漆、狮鬃橙、茶绿、
橡木、陶土、青瓷釉。刻意避开了紫→青渐变、霓虹色和玻璃拟态这类
一眼就能看出是生成的套路。所有强调色对底色都满足 4.5:1 对比度，
所以小字号的英文标签也能用。

字体：**Bricolage Grotesque**（拉丁标题、正文与标签）+ 系统中文字体栈。
拉丁字体做了子集，`unicode-range` 保证纯中文段落不会触发下载。中文没有用网络字体——
CJK 字库动辄数 MB，本机也没有 fontTools 可以做子集化。

设计变量集中在 `zigi994/styles/tokens.css`。每个页面的主题色由
`<body data-accent>` 决定，滚动到不同区块时平滑过渡。

组件样式按职责拆分：`components.css` 只放全站通用的导航、按钮、媒体框与页脚，
`home.css` / `case.css` / `concept.css` 只放页面级组合。图片框不再靠每页临时写
`object-fit`：默认 `.frame` 是有意裁切，`.frame--natural` 保留完整构图，
`.frame--pad` 用于透明或留白素材，`.frame--retina` 则限制位图最多按 2×
显示。需要缩放反馈时再叠加 `.frame--zoom`。

## 缓存策略

GitHub Pages 对所有响应统一下发很短的 `Cache-Control`，而且**无法配置响应头**，
所以缓存控制放在 Service Worker 里：

- **HTML 走 network-first**，失败才回落到缓存，最后是离线页。绝不能对 HTML 用
  cache-first，否则每次发布后都会看到旧页面。
- **CSS / JS 走 network-first**，确保与当前 HTML 属于同一版本。
- **字体 / 图标 / manifest 走 stale-while-revalidate**，按构建号分版本。
- **图片走 cache-first**，放在独立的长期缓存里，发版时不清空——文件名稳定、
  内容不会变。

构建号由 CI 把提交 SHA 替换进 `sw.js` 的占位符，激活时清理旧版本缓存。
另外页面之间用了 View Transitions 做转场，并在 hover 时预取目标页。

## 资源流水线

原始素材（`.ai`、大尺寸 PNG/JPG）通过 `tools/` 里的浏览器端流水线转成 WebP：
先用 pdf.js 栅格化 Illustrator 画板，再用 canvas 压缩、去背、生成 20px 的
LQIP 占位图，最后写入 `assets/manifest.json`。本机没有 ImageMagick、Node 或
可用的 Python，所以全部在无头 Chrome 里完成。

重新生成资源：启动本地服务后依次打开
`/__tools/pipeline.html`、`/__tools/cutout.html`、`/__tools/crop.html`。

发布用 master 生成响应式切图：

```powershell
powershell -ExecutionPolicy Bypass -File tools/run-tool.ps1 responsive-assets.html
```

该任务为 7 张 App 界面生成 480 / 960px 版本，为室内图生成 800 / 1600px
版本，并把 master、派生尺寸与路径写入 `assets/manifest.json`。HTML 里的
`srcset` 负责选择；首屏只给一个视觉焦点 `fetchpriority="high"`，其余首屏图
正常或低优先级，折叠线以下统一懒加载。所有 `<img>` 都写明 `width` / `height`
以避免解码前布局跳动。

抽取之前先把源文件复制成 `tools/source.pdf`（`.ai` 存盘时勾了 PDF 兼容就能直接读），
打开 `/__tools/pdf-sheet.html` 看一张总览图 —— 它回答「这个文件里到底有什么」。
趣宠的源文件有 12 个画板，其中 5 个是空的，而案例页一直写着「12 张界面稿」。

## 自查

`/__tools/audit.html` 会在多个宽度下逐页检查 JS 报错、失效图片、横向溢出与
对比度。对比度默认只能按祖先背景估算，要拿到真实数值就用
`tools/audit-drive.ps1` 驱动：它通过 CDP 截图，把文字背后**实际绘制的像素**
喂回页面，因此渐变、照片、canvas 与混合模式之上的对比度也是准的。

`tools/lint-tokens.ps1` 查的是审计查不到的另一类问题 —— 写错了但正好被后面的
覆盖规则掩盖住的声明。它有三条规则：浅色页上把 `--accent` 当前景色用（该用
`--accent-text`）、同一选择器在基础规则与自己的媒体查询里用了不同的 accent
层级、以及引用了没人声明又没给兜底值的自定义属性。`-SelfTest` 会先拿已知缺陷
验证规则本身能否命中。退出码等于错误数，可以用来拦提交。

另外三个脚本各查一件截图审计看不到的事：`tools/orphan-check.ps1` 量每段末行的
填充比例（中文右端不齐时容易把两个字甩到单独一行）；`tools/step-states.ps1`
分别测逐屏拆解在激活与未激活两态下的对比度，并给出两态的明度差
—— 前者是可读性底线，后者才是那个「聚焦」效果；`tools/dim-floor.ps1`
在改之前先扫一遍候选透明度会得到什么，回答「调到多少才够」。

写这类脚本要注意：令牌自带的 alpha 会和祖先的 opacity 相乘，
`--fg-1/2/3` 是同一个墨色配 0.82/0.72/0.64，只读 RGB 会把三者都当成不透明的
`--fg-0`，结果虚高一个多点。

`/__tools/measure.html` 输出关键元素的实际盒模型。
`tools/shot.ps1` 是无头截图脚本（会自己回收进程和临时配置目录）。

## 发布

推送到 `main` 分支后，`.github/workflows/deploy.yml` 会把 `zigi994/` 直接上传到
GitHub Pages（无构建步骤，只做一次构建号替换）。仓库
**Settings → Pages** 的 **Source** 需设为 **GitHub Actions**。
