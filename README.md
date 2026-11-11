# 一日一植 · Plant Diary

每天一张植物照片，写下它带来的启发与感想。一个适配手机与电脑的植物日记本，使用纯 HTML / CSS / JavaScript，部署到 GitHub Pages，无需后端、数据库或构建依赖。

## 已实现

- 月历首页：周一开始，照片缩略图、今日标记、月份切换、年月选择与回到本月。
- 每日详情：大图、植物名称、完整感想，以及上一篇 / 下一篇。
- 编辑：上传或拖放照片、写感想、补写过去日期、更换照片、修改与删除日记。每天一篇，照片必填，名称和感想选填。
- 上传自动生成最长边 1600 px 的 JPEG 和最长边 360 px 的日历缩略图；去除原始 EXIF 信息。支持 JPG、PNG、WebP、AVIF、GIF（静态首帧），最大 25 MB；HEIC 请先转为 JPG。
- GitHub API 云端同步：照片、缩略图与文字一次性提交；保存成功后其他设备可直接读取，无须等待 Pages 重新部署。
- 按日期合并其他设备的更新。同一天有冲突时保留当前编辑内容，允许先查看云端版本，再确认是否重新载入；不会静默覆盖。
- 只有 GitHub 确认提交成功才显示同步成功。网络、权限或保存错误时保留当前编辑框中的内容；离开页面前提示未保存修改。
- 默认只在当前浏览器会话中保存连接。显式勾选私人设备选项后才跨会话保留；可随时断开。

新仓库的日记数据为空；首页橡皮树图片只是封面，不会作为日记或统计数据。所有真实记录均由你创建。

## 首次部署到 GitHub Pages

1. 将本项目文件提交并推送到 **Ilikectrlmusic/plant-diary 的 `main` 分支**。
2. 在仓库 **Settings → Pages → Build and deployment → Source** 选择 **GitHub Actions**。
3. `.github/workflows/pages.yml` 会在推送 `main` 时运行单元测试、组装静态文件并部署。首次设置后如果未触发，可以在 **Actions → Deploy Plant Diary to GitHub Pages → Run workflow** 手动运行。
4. 等待部署成功，网站地址为 `https://ilikectrlmusic.github.io/plant-diary/`。

也可像参考仓库 long-journey 一样，在 Pages 中选择 **Deploy from a branch → main → /(root)**。应用全部使用相对路径，并包含 `.nojekyll`。两种方式选其一；若使用分支部署，不需要手动运行 Actions 部署任务。

`npm run build` 只将 `index.html`、`assets/`、`data/`、`photos/`（存在时）、`edit/` 与 `.nojekyll` 复制到 `dist/`，不包含测试或开发脚本。无需自定义域名。`/edit/` 可直接进入今日编辑器。

## 连接与写日记

连接方式沿用 [long-journey](https://github.com/Ilikectrlmusic/long-journey)：

1. 点击网站右上角的 GitHub 按钮，或直接点击「写下今天」。
2. 在 GitHub 创建 **Fine-grained personal access token**。Resource owner 选择拥有仓库的账号；Repository access 只选择 **plant-diary**。
3. 在 Repository permissions 中将 **Contents** 设为 **Read and write**（Metadata 默认只读即可）。选择合适的有效期。
4. 将密钥填入网站的连接窗口。**不要将密钥写入源码、仓库、日记或聊天。**
5. 上传植物照片，写下今天的感想，然后点击「保存并同步」。

密钥仅由浏览器发送给 `api.github.com`。默认保存在 `sessionStorage`（当前标签页会话）；「在这台私人设备上保持连接」使用 `localStorage`。共享设备不要勾选此项。密钥无效、过期或缺少权限时会提示重新连接，每台编辑设备需各自连接。网站不使用第三方脚本或字体。

公开访问者可以阅读，只有持有仓库写权限与有效密钥的人可以保存。公开仓库中的照片和文字都是公开的，删除后 Git 历史仍可能保留旧版本，不适合存放私密信息。站点不会在未连接时假装保存成功，也没有离线自动保存；刷新或关闭前请先保存或复制尚未提交的内容。

## 数据与同步

- 文字和照片路径：`data/diary.json`，格式为 `{ "schemaVersion": 1, "entries": { "YYYY-MM-DD": { "title", "note", "image", "thumbnail", "updatedAt" } } }`。
- 照片：`photos/YYYY-MM-DD-随机标识.jpg`，缩略图对应 `-thumb.jpg`。更换或删除照片时，在同一提交中移除不再引用的旧文件。
- 页面优先读取 GitHub Contents API 最新数据。限流或网络错误时尝试已发布版本，并明确提示可能滞后。两者都失败会显示读取错误，不把失败解释成空日记。
- 保存通过 Git Database API 创建 blobs、tree、commit，再以 `force: false` 更新 `main`。文字、照片和缩略图对读者同时可见，不存在只保存了一半的日记。
- 保存前从同一 commit 读取数据，按日期比较原始版本并合并。分支并发变化最多重试三次，每次重新读取并检测冲突；同日冲突始终要求人工核对。提交响应丢失时会重新读取确认，不贸然显示成功。
- 照片优先从 GitHub raw URL 加载，失败后尝试 Pages 中的对应路径。

## 本地开发

需要 **Node.js 22+**，本环境使用 Node.js 24。不需要运行 `npm install`。

```sh
cd /workspace/plant-diary
npm run dev
```

默认监听 `0.0.0.0:4173`，可通过 `PORT` 修改。支持根路径与 `/plant-diary/` 仓库前缀，以及 `/edit/`。云环境的进程不会随快照保留，新任务需重新启动。直接使用已有隔离检出，不需要创建 Git worktree。

```sh
npm test          # 数据模型、并发合并、原子提交与错误恢复
npm run build    # 生成 GitHub Pages 静态发布目录 dist/
npm run test:browser  # 先启动开发服务；真实 Chromium 的交互验证
```

浏览器测试使用预装的 Python Playwright 与 `/usr/bin/chromium`；可用 `CHROMIUM_PATH` 和 `TEST_URL` 覆盖默认值。缺少 Playwright 时，在自己的 Python 虚拟环境中安装 `playwright`，并安装 Chromium。浏览器测试拦截并模拟全部 GitHub API 与照片请求，不使用真实密钥，也不向 GitHub 写入记录。测试覆盖手机和桌面布局、照片上传、自动连接并保存、跨设备读取、日期补录、冲突、权限失败与重试、删除、文字安全显示、未保存提醒、断开连接与已发布版本回退。

本地页面默认仍连接真实的 plant-diary 仓库；手动输入真实密钥并保存会更新云端，请使用测试套件进行无副作用验证。

## 图片

封面：来自 Unsplash 的植物摄影，下载自 [原图 CDN](https://images.unsplash.com/photo-1501004318641-b39e6451bec6)，随站点本地发布，浏览时无需访问第三方图片服务。图标为项目内的 SVG。
