# 竞价雷达 C.A.R.

纯浏览器 A 股集合竞价研究面板。没有后端、数据库或云盘；候选数据随静态站点发布，实时行情由浏览器直连新浪公开行情接口，计算和缓存全部在用户设备本地完成。

## 运行

```bash
npm install
npm run dev
```

生产构建与预览：

```bash
npm run build
npm start
```

构建产物位于 `dist/`，可以部署到任意静态网站托管服务。

## 功能

- 每日唯一推荐：模型分扣除风险惩罚后排序。
- 9:15—9:30 打开或点击页面时，浏览器直连全市场行情并重新计算 9:25 推荐。
- 非竞价时段只刷新行情快照，不把收盘数据伪装成竞价结果。
- 候选池、最近一次计算结果和当前交易日快照缓存于浏览器本地。
- PWA：支持“添加到主屏幕”，Service Worker 缓存应用壳，断网时可打开上次页面。
- 风险控制：短期过热、换手过高和公告风险会扣分或进入风险否决区。

## 数据更新

每日收盘后先生成最新模型结果，再运行：

```bash
npm run refresh-preview
npm run build
```

也可以指定模型文件：

```bash
MODEL_OUTPUT=/absolute/path/optimized_monday_watchlist_YYYY-MM-DD.json npm run refresh-preview
```

`refresh-preview` 会同时更新：

- `data/strategy.json`：构建备用数据。
- `public/strategy.json`：静态站点运行时从同源加载的最新候选池。

## 数据边界

- 行情来自公开网页接口，可能延迟、限流或调整跨域策略。
- 页面关闭后浏览器不能保证在后台执行 9:25 计算；重新打开页面会自动刷新。
- 本项目不连接券商、不执行交易，也不构成投资建议。

## GitHub Pages 自动发布

- 固定地址：`https://yjh832.github.io/auction-radar/`
- GitHub Actions 在每次推送到 `main` 后自动构建并发布。
- `npm run publish`：构建、提交并推送当前修改。
- `npm run sync`：监听电脑端源码变化并自动提交、推送。
- 手机页面每30秒检查一次 `/version.json`，发现新构建后自动刷新。

首次发布：

```bash
npm run publish
```

持续自动同步：

```bash
npm run sync
```
