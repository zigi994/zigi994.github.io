# zigi 的个人作品集

使用 Vite + React 制作，并通过 GitHub Pages 发布：

<https://zigi994.github.io>

## 本地预览

需要 Node.js 20.19+ 或 22.12+。

```bash
npm install
npm run dev
```

终端会显示一个本地网址，通常是 `http://localhost:5173`。

## 修改内容

- 姓名、介绍、关于和联系方式：`src/data/site.js`
- 作品目录和批注：`src/data/work.js`
- 颜色、字体和版式：`src/styles.css`

`site.js` 里的 `contact.email` 目前留空。填入邮箱后，页面会自动显示可点击的邮箱地址。

## 发布

推送到 `main` 分支后，`.github/workflows/deploy.yml` 会自动构建并发布网站。

在 GitHub 仓库中打开 **Settings → Pages**，将 **Source** 设为 **GitHub Actions**。第一次发布通常需要一两分钟。

## 添加完整案例

先为案例制作页面，再把页面地址写入 `src/data/work.js` 对应项目的 `href`。有地址后，批注区会自动出现“阅读完整案例”链接。
