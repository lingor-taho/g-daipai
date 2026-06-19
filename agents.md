# g-daipai 项目状态

**最后更新**: 2026-06-19

---

## 项目进度与接手信息维护约定

本文件用于记录继续本项目所需的进度、业务规则、架构状态、真实页面结论、部署注意事项和验证结果。后续每次出现重要改动、阶段规划或关键业务确认时，必须同步更新本文件，方便后续接手时直接了解当前状态。

更新原则：

- 代码实现完成后，补充“已实现内容 / 最近修复 / 最近验证命令”。
- 新阶段开始前，补充“当前状态 / 业务规则确认 / 下一步计划”。
- 真实页面测试发现问题时，补充“当前真实测试问题”和建议排查方向。
- 如果功能被临时停用，必须记录停用开关、原因、恢复条件和生产注意事项。
- 更新内容优先追加到对应日期小节；没有合适小节时，新建 `YYYY-MM-DD 功能名当前进度` 小节。
- 同步更新顶部 `最后更新` 日期。

---

## 项目概述

Yahoo 日本拍卖代拍系统：中国用户通过 Web 提交商品 URL、最高价和出价策略，Windows 服务器端 Chrome 插件轮询 API 并在 Yahoo Auction 页面自动执行竞拍、同步入札中状态和落札订单。

---

## 当前架构

```
用户浏览器 (React SPA, dev http://localhost:3035)
    │
    │ HTTP /api
    ▼
API Server (Express + SQLite, .env PORT=3034)
    │
    │ HTTP 轮询 /api/plugin/*
    ▼
Chrome Extension (yahoo-plugin/, Windows 服务器 Chrome)
    │  manifest.json + background.js + content.js
    ▼
Yahoo Auction 网站
```

生产部署通常在服务器 `C:\www\g-daipai`，本地工作区为 `D:\www\g-daipai`。

---

## 当前文件结构

```
D:/www/g-daipai/
├── yahoo-plugin/
│   ├── manifest.json        — Manifest V3
│   ├── background.js        — 任务轮询、出价执行、空闲同步入札中/落札、插件配置读取
│   ├── content.js           — 商品/入札中/落札页数据提取，出价页面操作
│   ├── background.test.js
│   └── content.test.js
├── src/
│   ├── client/              — React SPA (Ant Design Mobile)
│   │   ├── vite.config.js   — dev port 3035, proxy /api → localhost:3034
│   │   └── src/
│   │       ├── pages/
│   │       │   ├── Submit.jsx        — 提交任务，价格校验，多次出价配置，仅即決商品自动锁定即決
│   │       │   ├── TaskList.jsx      — 用户任务列表，提交页内嵌 6 个状态统计卡片
│   │       │   ├── ActiveBidding.jsx — 入札中，支持最高价/高値更新
│   │       │   ├── WonItems.jsx      — 落札商品
│   │       │   ├── Statistics.jsx    — 近 30 天落札税后总金额柱状图和 CSV 导出
│   │       │   └── Login.jsx
│   │       ├── utils/api.js
│   │       ├── utils/bidPrice.js
│   │       ├── utils/taskStats.js
│   │       └── utils/wonStats.js
│   ├── admin/               — 管理后台（支持移动端查看）
│   │   ├── layouts/AdminLayout.tsx — 后台布局，支持菜单折叠（展开 210px / 折叠 50px）
│   │   ├── Tasks.tsx
│   │   ├── Orders.tsx       — 订单管理，含用户名、运费、银行手续费、手续费(RMB)、大金额费用
│   │   ├── SpecialUserSettings.tsx — 特殊用户参数设置，按用户覆盖订单费用参数
│   │   ├── Users.tsx
│   │   ├── MultiBidSettings.tsx — 多次出价、入札/落札空闲同步配置
│   │   ├── DataCleanup.tsx      — 清理 30 天无用数据
│   │   ├── DataBatch.tsx        — 数据批处理顶部 Tabs 容器
│   │   ├── ManualOrderImport.tsx — 手动落札导入，日期范围、最多翻页、候选订单用户分配
│   │   ├── ShippingRefresh.tsx      — 按商品 ID 批量刷新运费
│   │   ├── ProductTypeRefresh.tsx   — 按商品 ID 批量刷新商品类型
│   │   ├── OrdersResync.tsx         — 按商品 ID 批量刷新落札商品
│   │   ├── TrackingRescan.tsx       — 按商品 ID 批量标记待收货订单重扫物流/单号并更新 Google 表
│   │   └── ProductDataDelete.tsx    — 按商品 ID 批量删除任务、订单、日志、入札缓存
│   ├── server/
│   │   ├── index.js         — Express API, CORS, pending task sweep
│   │   ├── models/index.js  — better-sqlite3 同步封装 + schema 兼容列
│   │   └── routes/
│   │       ├── auth.js
│   │       ├── task.js      — 用户任务、入札中、落札列表、近 30 天落札统计
│   │       ├── plugin.js    — 插件任务、状态、入札中同步、落札同步、配置
│   │       ├── proxy.js     — 商品信息抓取、服务端运费解析、内存缓存
│   │       └── admin.js
│   ├── shared/
│   └── db/init.sql
├── data/gdaipai.db          — SQLite
├── start.bat
└── agents.md
```

---

## 数据库 Schema 摘要

核心表：

- `users`: 用户、角色、上下级关系。
- `yahoo_accounts`: Yahoo 账号池预留字段，目前主要依赖服务器 Chrome 登录态。
- `tasks`: 竞拍任务，包含商品信息、当前价、即決价、税类型、商品类型、最高价、用户最高价、多次出价增量、策略、状态、是否最高价入札者、结束时间。`product_type` 标记 `normal` 普通商品或 `store` 商城商品；`pending_followup_max_price` 用于即时拍低价拆分场景，记录原始最高价，待商品当前价达标后自动追加 followup 任务。
- `bid_logs`: 出价日志。
- `orders`: 落札订单，`final_price` 现在只使用 Yahoo 落札页抓到的该商品价格，`won_at/won_time_text` 保存 Yahoo 落札时间。
- `bidding_items`: 插件从 Yahoo `/my/bidding` 同步的入札中商品状态，`status` 支持 `highest`、`outbid`、`stale`。
- `user_finance_overrides`: 特殊用户费用参数，按用户覆盖汇率调节、银行手续费、手续费(RMB)、大金额费用。
- `exchange_config`: 汇率配置。
- `config`: 全局配置，如多次出价开始时间、间隔、最低最高价、空闲同步间隔、出价并发数、数据清理参数。

`tasks.status` 常用值：`pending`、`processing`、`bidding`、`success`、`failed`、`cancelled`。

`tasks.strategy` 常用值：

- `direct`: 即时拍
- `multi_bid`: 多次出价
- `1min` / `2min` / `5min` / `10min`: 结束前策略

---

## 当前运行状态

| 服务 | 地址 | 状态 |
|------|------|------|
| API Server | http://localhost:3034 | 由 `.env PORT=3034` 配置 |
| React Client dev | http://localhost:3035 | Vite dev server |
| Admin | `src/admin` | Umi 管理后台 |
| Chrome Extension | `yahoo-plugin/` | 需在服务器 Chrome 中手动加载/更新 |

---

## 2026-06-14 插件并行调度已实现

已保存方案文档：`docs/superpowers/specs/2026-06-14-plugin-parallel-scheduler-design.md`。实施计划：`docs/superpowers/plans/2026-06-14-plugin-parallel-scheduler-plan.md`。

已把插件调度改为 3 条独立执行线：出价并行池、A/B 入札/落札监控同步、C/D/E/F/G 订单工作流。出价和 A/B、订单工作流三者可并行；PIN/验证码锁只影响 C/D/E/F/G；C/D/E/F/G 内部继续串行，并保持 G 导入优先于 C 交易开始、D 扫描、E 付款、F 确认收货。服务端新增 `/api/plugin/tasks?limit=N` 批量领取并 claim 出价任务，后台系统配置新增出价并发数（默认 2）和 Yahoo shipment API 都道府県代码选择（默认大阪 27）。A/B 监控按原同步间隔独立执行，并在完成后关闭自己创建的入札/落札 tab。

最近验证命令：`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node src/server/routes/plugin.test.js`、`node src/server/routes/proxy.test.js`、`npm run build --prefix src/admin`。

---

## 关键业务流程

### 商品提交

```
用户粘贴 URL/关键词 → getProductInfo()
  │
  ├─ 服务端 /api/proxy/fetch 获取商品信息和运费
  └─ 提交 /api/task/submit，保存商品信息、最高价、策略、税类型、结束时间
```

客户端提交前会校验：

- 必须有最高出价。
- 非即決出价时，最高出价的税前价必须 >= 商品当前税前价（支持起拍价出价）。
- 店铺含税商品会按税后可比较价格校验。
- 多次出价最高价不得低于后台“多次出价配置”的最低价，默认 `5000円`。
- 多次出价每次加价额度按 Yahoo 阶梯校验：最高价 `<5000円` 最低 `100円`，`5000-9999円` 最低 `250円`，`10000-49999円` 最低 `500円`，`>=50000円` 最低 `1000円`。

运费规则：

- 运费只在服务端商品信息解析时绑定到 `tasks.shipping_fee_text`。
- 插件商品快照、入札中同步、落札同步都不再更新运费。
- 历史缺失或错误运费通过后台“运费更新”按商品 ID 批量刷新。
- 服务端解析支持 `送料 落札者負担`、`送料 着払い`、`送料 無料`、固定 `XXX円`，以及 Yahoo shipment API 多物流方式取最小运费。

商品类型规则：

- 商品价格后显示 `（税0円）` 时标记为普通商品：`product_type=normal`。
- 商品价格后显示 `（税込）` 时标记为商城商品：`product_type=store`。
- 用户端抓取商品后会显示商品类型，并在提交任务时保存到 `tasks.product_type`。
- 历史缺失商品类型通过后台“商品类型更新”按商品 ID 批量刷新，只更新商品类型，不更新运费。

### 插件出价

```
background.js 每 10 秒轮询 /api/plugin/task
  │
  ├─ direct 任务立即执行
  ├─ 结束前策略按 end_time 和 lead window 执行
  └─ multi_bid 在全局开始时间后，按间隔重复尝试
```

出价前插件会打开商品页并刷新商品快照；若未进入策略窗口，会回写最新结束时间并把任务恢复为 `pending`。

插件单个任务执行增加 30 秒总超时保护：如果商品 tab 打开、页面注入、确认页或出价消息长时间无响应，会自动关闭任务 tab、将任务标记为 failed，并释放队列继续执行后续任务。超时错误写入稳定英文 `Task execution timeout after 30s; task tab closed`，前后端统一归类为“失败：响应超时”。Yahoo 页面出现 `入札に失敗しました / オークションにアクセスできませんでした` 弹窗时，也会识别为终止失败并关闭 tab。

多次出价任务在已出价后仍会继续按间隔执行；如果后续同步发现 `current_price > max_price`，或再次执行时下一口加价后金额超过用户最高价，会标记为 failed，不再一直停留在“已出价”。

`/api/plugin/task` 保留 `canIdleSync` 兼容返回；并行调度后，入札/落札监控同步由独立执行线按空闲同步间隔执行，不再使用“出价保护窗口”阻塞监控。

### 入札中同步

```
插件空闲 → 打开 https://auctions.yahoo.co.jp/my/bidding
  │
  ├─ 最高額で入札中 → status=highest
  └─ 高値更新 + 再入札する → status=outbid
```

入札中同步只写入商品 ID、链接、标题、图片、当前价、入札状态、同步时间；页面显示的运费、策略、最高价等来自本系统 `tasks` 表。同一商品多次提交时，用户端“入札中”按商品 ID 聚合，策略、最高价、运费等展示字段取最后提交的任务。

用户端 `入札中` 页面现在显示全部状态：

- 蓝色：`最高价入札中`
- 红色：`高値更新` + `再入札する`
- `direct` 且被超过时，右侧显示 `再入札` 按钮，跳转提交页并预填商品 URL。

### 落札同步

```
插件空闲 → 打开 https://auctions.yahoo.co.jp/my/won
  │
  └─ 提取每个商品的 Yahoo 落札页价格和落札时间 → /api/plugin/orders/sync
```

重要规则：`orders.final_price` 只使用 Yahoo 落札页该商品展示的 `XXX円` 价格。不得再用用户最高价、当前价或任务最高价兜底为落札价。客户端落札商品页也不再 fallback 到最高价。

落札同步不再更新运费。用户端落札商品和后台订单排序都按 `won_at` 优先，缺失时再按系统时间兜底。同一商品多次提交时，用户端“落札商品”的落札价、落札时间仍取实际落札订单，策略、最高价、运费等展示字段取最后提交的任务。

### 用户端统计页面

用户端菜单当前顺序：

```
提交任务 → 入札中 → 落札商品 → 统计页面
```

已去掉独立“任务列表”菜单，但提交任务页底部仍内嵌最近任务列表。提交任务页状态卡片保留 6 个：总任务、队列中、已出价、成功、出价失败、已终止；已去掉“执行中”卡片。

统计页面 `/stats` 显示近 30 天每日落札商品税后总金额柱状图：

- 柱体金额：每日落札商品税后总金额。
- 手机点击柱体、PC 鼠标移入柱体显示当天落札数量和金额。
- CSV 导出字段：商品id、商品名称、落札价、运费、落札时间。

---

## 后台管理

### 移动端适配

后台现在按屏幕宽度响应式切换：

- 桌面端（`>=768px`）保持原来的左侧菜单和 20px 内容间距。
- 手机端（`<768px`）隐藏左侧菜单，底部固定单行横向滚动导航：任务、账号、配置、清理、批量、导入、特殊、订单。
- 手机端顶部高度压缩为 52px，显示后台标题、Yahoo 登录状态、当前用户和退出按钮。
- 手机端内容区全宽，padding 改为 10px，并预留底部导航安全距离。
- 订单管理页手机端操作区改为纵向/换行布局，表格保留横向滚动，不强行压缩列。
- 系统配置页已分流程拆 Card，手机端保持单列表单；付款任务的最小/最大任务数在手机端自动上下排列。
- 数据批处理 Tabs 在手机端允许横向滚动。

### 菜单折叠（移动端优化）

后台支持菜单折叠功能，适配移动端查看：

- **展开状态**（210px）：显示完整菜单名称，无滚动条
- **折叠状态**（50px）：只显示菜单第一个字，最大化内容区域

菜单映射：

| 完整名称 | 折叠显示 |
|---------|---------|
| 任务报表 | 任 |
| 账号管理 | 账 |
| 系统配置 | 系 |
| 清理数据 | 清 |
| 数据批处理 | 批 |
| 导入订单 | 导 |
| 特殊用户设置 | 特 |
| 订单管理 | 订 |

移动端效果（375px 手机）：
- 展开：内容区 165px（44%）
- 折叠：内容区 325px（87%）
- 内容增加 97%，占比提升 43%

### 订单管理

订单管理页面字段：

- **用户名**：下单用户
- **商品 ID**：可点击跳转 Yahoo 商品页；后面显示商品类型标识，商城商品为红色 `商`，普通商品为绿色 `普`，缺失时显示 `-`
- **运费**：支持 4 种形式（無料、着払い、落札者負担、固定金额）
- **落札金额**：Yahoo 落札页抓取的价格
- **银行手续费**：日元，可在页面配置
- **手续费(RMB)**：人民币，可在页面配置
- **大金额费用**：人民币，可在页面配置，落札商品税后金额 >= 30,000円 时生效，默认 0
- **汇率**：可在页面配置
- **特殊用户设置**：订单管理页按钮进入，按用户覆盖汇率调节、银行手续费、手续费(RMB)、大金额费用；未填写字段继续使用订单管理默认值
- **应付款**：自动计算

应付款公式：
```
应付款 = (落札金额 + 运费 + 银行手续费) * 汇率 + 手续费(RMB) + 大金额费用
```

示例：
```
落札金额：20,000円
运费：1,000円
银行手续费：500円
汇率：0.05
手续费(RMB)：15元
大金额费用：0元（税后落札金额未达到 30,000円）
应付款 = (20000 + 1000 + 500) * 0.05 + 15 + 0 = 1090元
```

---

## 已修复 / 最近变更

| 日期 | 问题 | 修复 |
|------|------|------|
| 2026-06-19 | 店铺即决/购买手续商品提交后，后台“最高价”可能比 Yahoo 页面显示价低 1 日元，例如税前 `2856` 页面含税显示 `3,142円`，旧逻辑用 `Math.floor(2856 * 1.1)` 得到 `3,141`；同时即决任务保存时又把含税即决价折回税前价，导致 `u1051658399/t1110559761` 这类商品显示最高价低于当前价并可能提交失败 | 店铺即决 `pageData.items.winPrice` 转页面显示即决价时改为 `Math.round(value * 1.1)`，匹配 Yahoo 页面含税显示；即决任务保存 `max_price/user_max_price/buyout_price` 统一保留页面显示即决价，不再对 `tax_included` 即决价折税前；后台任务列表和队列统计对历史即决任务优先显示 `user_max_price/buyout_price`；插件即决执行路径明确跳过价格输入框，只点击 `購入手続きへ/今すぐ落札` 等按钮。真实抓取验证 `q1222339778=1,047円`、`o1113090605=523円`。验证：`node src/shared/biddingRules.test.cjs`、`node src/server/routes/task.test.js`、`node src/server/routes/proxy.test.js`、`node yahoo-plugin/content.test.js`、`node src/server/routes/admin.orders.test.js`、`node --check src/shared/biddingRules.cjs`、`node --check src/server/routes/proxy.js`、`node --check yahoo-plugin/content.js`、`node --check src/server/routes/admin.js` |
| 2026-06-19 | 后台调试 API 仍依赖后台登录 token，Codex 无法通过命令行直接读取生产服务器 `tasks.error_msg/bid_logs.error_msg`，排查商品错误还需要人工复制 token | 新增独立只读调试路由 `GET /api/debug/product/:productId`，通过环境变量 `ADMIN_DEBUG_TOKEN` 开启并校验 `X-Admin-Debug-Token` 请求头或 `debugKey` 参数；未配置 token 时返回 404，避免裸露。该接口返回与后台商品调试相同的任务、出价日志、订单、订单日志、插件诊断、商品快照、入札中缓存和关键配置，方便 Codex 直接按商品 ID 排查生产错误。验证：`node src/server/routes/debug.test.js`、`node src/server/routes/admin.orders.test.js`、`node --check src/server/routes/debug.js`、`node --check src/server/index.js`、`node --check src/config/index.js` |
| 2026-06-19 | 生产服务器出价失败只能在后台看到“系统原因/响应超时”等归类，排查具体商品仍需要进服务器数据库查 `tasks.error_msg`、`bid_logs.error_msg` 和插件诊断 | 新增后台只读调试接口 `GET /api/admin/debug/product/:productId`，后台鉴权后按商品 ID 一次返回商品快照、任务完整错误原文、出价日志、订单、订单状态日志、插件诊断、入札中缓存和关键配置；用于生产排查所有商品相关错误，不改变任何数据。验证：`node src/server/routes/admin.orders.test.js`、`node --check src/server/routes/admin.js`、`node --check src/server/routes/admin.orders.test.js` |
| 2026-06-19 | 后台导入订单页手机端“读取落札商品”按钮没有整行显示，宽度只跟文字内容走 | 为导入订单提交按钮 Form.Item 增加独立移动端样式，避开日期/最多翻页两列表单规则，按钮恢复整行自适应宽度。验证：`npm.cmd run build --prefix src/admin` |
| 2026-06-19 | 后台移动端表单修正后仍有回归：特殊用户设置和导入订单前三项标签/输入框在手机端变成上下两行；订单页顶部按钮两列布局不符合实际使用习惯 | 移动端表单改为作用到 Ant Design 内层 `.ant-form-item-row` 的两列网格，保证“银行手续费/手续费/大金额费用”和“开始日期/结束日期/最多翻页”标签与输入框同一行；订单页顶部恢复纵向按钮布局，结算汇率一行，下面“结算 / 支付 / 导出CSV”三个按钮各占一整行。验证：`npm.cmd run build --prefix src/admin` |
| 2026-06-19 | 后台移动端继续优化：订单页顶部结算区按钮和输入框对齐不一致，订单表字段过多；导入订单日期输入撑出版面；特殊用户设置顶部费用输入框宽度不统一 | 订单页将“本次结算汇率”改为“结算汇率”，手机端结算区改为两列网格，使“结算”和“导出CSV”等宽，“结算汇率”输入框与下方“支付”按钮右侧对齐；订单列表隐藏“银行手续费 / 手续费(RMB) / 大金额费用 / 特殊设置”四列；导入订单页开始日期、结束日期和最多翻页使用统一移动端表单网格宽度；特殊用户设置顶部三个费用输入框统一右侧对齐并等宽。验证：`npm.cmd run build --prefix src/admin` |
| 2026-06-19 | 普通商品抓物流单号时，整页文本/HTML 中的隐藏 input 属性、id/value/class、以及 script 源码里的数字可能被误当作单号；真实商品 `d1233518690` 中 script `hierarchyId: 2084314008` 仍可能被误抓 | 插件普通商品待发货扫描的单号候选改为明确三段优先级：第一从 `お届け情報/配送方法/伝票番号/追跡番号/お問い合わせ番号/お届け番号` 可见渲染文字中找带标签单号；第二只从 `#messagelist dd#body` 的渲染文字找无标签单号，不读取 hidden input、时间、用户 ID、`textContent` 或源码；第三两处都没有时回退顶部 `出品者` 名。普通商品不再做整页未标记 10-12 位数字兜底，避免 `script/style/hidden input` 等非页面显示内容参与匹配。新增回归测试覆盖 `currentMsgId value="3095037709"`、script `hierarchyId: 2084314008`、`お届け情報` 优先于消息区、消息区只有“银行振込…”时回退抓出品者名。验证：`node yahoo-plugin/content.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-19 | 后台移动端菜单和操作区需要更符合手机宽度：订单管理与账号管理菜单位置互换，特殊用户设置和订单管理顶部输入/按钮不应挤成多行；订单管理页运行 flag 区域手机端占用空间过大 | 后台菜单顺序调整为“任务报表 → 订单管理 → 系统配置 … → 特殊用户设置 → 账号管理 → 在线用户”；特殊用户设置页的“大金额费用(RMB)”默认费用输入框在手机端收窄并与文字同一行；订单管理页手机端“本次结算汇率 + 结算”同一行，“支付 / 导出CSV”同一行；`交易开始flag/扫描计数/导入flag/付款flag/确认收货flag/最近执行` 在手机端默认收起，点击“展开运行状态”后显示。验证：`npm.cmd run build --prefix src/admin` |
| 2026-06-19 | 生产服务器不方便每天手动进入命令行运行三表检查，需要一个双击即可检查且能保留历史结果的方式 | 新增 `scripts/check-product-health.js` 三表健康检查：汇总 `check-product-parity`、服务端商品快照读路径扫描、逐字段 fallback 使用量统计；每次运行会追加 JSONL 历史到 `logs/product-health-history.jsonl`，并显示最近 10 次结果。新增 `check-product-health.bat` 和 `检查三表模型健康状态.bat`，服务器双击即可运行并停留窗口查看结果；`logs/*.jsonl` 已加入 `.gitignore`，历史留在服务器本地。当前本地运行结果：`Status: OK`，parity/fallback/read path 均为 0。验证：`node scripts/check-product-health.test.js`、`node scripts/check-product-health.js`、`node scripts/check-product-parity.test.js`、`node scripts/check-product-read-paths.test.js`、`node --check scripts/check-product-health.js` |
| 2026-06-19 | 后台需要在“清理数据”菜单中新增按落札日期强制清理，用于清理早期人工标记完成的错误历史数据，并且包含成功落札订单、任务和商品信息 | 后台 `DataCleanup` 改为 Tabs：保留“日常清理”，新增“按日期强制清理”。新增 `/api/admin/data-cleanup/won-date/preview` 预览接口和 `/api/admin/data-cleanup/won-date/run` 执行接口，按 `orders.won_at` 判断，选择日期会包含当天及之前落札订单关联的 `products/tasks/orders/bid_logs/order_status_change_logs/bidding_items`；执行接口要求 `confirm: true`，页面执行前弹确认并提示备份数据库。日常清理语义不变，仍保护成功订单。验证：`node src/server/services/forceDateCleanup.test.js`、`node src/server/services/dataCleanup.test.js`、`node src/server/services/dataCleanupPolicy.test.js`、`node --check src/server/services/forceDateCleanup.js`、`node --check src/server/routes/admin.js`、`npm run build --prefix src/admin` |
| 2026-06-19 | 三表模型需要把“只读路径残留扫描”固化，避免后续代码重新直接读取 `tasks` 商品快照字段；人工扫描发现后台订单状态调试任务列表和订单结算查询仍直接读 `tasks.product_type/shipping_fee_text/tax_type` | 新增 `scripts/check-product-read-paths.js` 只读扫描脚本，检查服务端读路径中 `tasks` 商品快照字段必须通过 `products` fallback；修正后台状态调试任务查询和订单结算查询为 `LEFT JOIN products` + `COALESCE(products, tasks)`；新增脚本测试和后台查询断言。验证：`node scripts/check-product-read-paths.test.js`、`node scripts/check-product-read-paths.js`、`node src/server/routes/admin.orders.test.js`、`node --check src/server/routes/admin.js`、`node --check scripts/check-product-read-paths.js` |
| 2026-06-19 | 用户端登录后顶部操作区里“退出”和“风格”都在右侧，退出按钮离用户名较远 | 调整 `UserNav` 顶部布局：左侧显示“登录用户 + 退出”并保持适当间距，右侧只保留“风格”下拉。验证：`npm run build --prefix src/client`、`node --check src/client/src/styles.js` |
| 2026-06-19 | 夜晚主题下，落札商品列表中带状态底色的商品仍使用浅红/浅蓝硬编码背景，导致白色标题在浅色背景上不可读 | 新增主题级 `cancelledBg` / `completedBg` 颜色变量，落札商品取消/完成状态背景改为跟随主题；夜晚主题下使用深色状态背景，保证标题和详情可读。验证：`npm run build --prefix src/client`、`node --check src/client/src/styles.js` |
| 2026-06-19 | 登录页不应显示风格选择，也不应跟随登录后的风格选择；原“古典”主题与日系过于相近，后续改为夜晚模式 | 登录页移除风格下拉，并固定使用经典蓝白样式展示；登录后风格选择保留。原 `古典` 选项改名为 `夜晚`，配色调整为深蓝灰夜间模式（蓝色主色、青色辅色、深色卡片），与日系风格拉开差异。验证：`npm run build --prefix src/client`、`node --check src/client/src/styles.js` |
| 2026-06-19 | 用户端需要可切换界面风格，登录页和登录后页面都要跟随用户选择 | 用户端新增本地主题切换：经典、日系、清新、欧美、夜晚。登录页右上角和登录后退出按钮右侧均提供“风格”下拉框；选择写入 `localStorage`，默认经典。`styles.js` 改为 CSS 变量主题 token，登录页、导航、公告、卡片、按钮、输入框、统计图和主要列表跟随主题色。验证：`npm run build --prefix src/client`、`node --check src/client/src/styles.js` |
| 2026-06-19 | 真实输入诊断此前主要停留在插件 console 或订单错误字段，后续生产出错时无法仅通过 API 自行查询完整上下文 | 新增 `plugin_diagnostics` 持久化表和 `/api/plugin/diagnostics` 读写接口，保存真实输入、交易开始、付款和 PIN 相关诊断；插件在同捆/付款/配送変更 debugger 鼠标兜底以及 PIN Win32/debugger 输入时自动 POST 诊断；服务端交易开始失败、付款失败也同步落库。可按 `productId`、`orderId`、`type`、`limit` 查询，便于直接通过生产 API 排查。验证：`node yahoo-plugin/background.test.js`、`node src/server/routes/plugin.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/background.test.js`、`node --check src/server/routes/plugin.js`、`node --check src/server/routes/plugin.test.js`、`node --check src/server/models/index.js` |
| 2026-06-19 | 生产服务器无人值守运行时，真实鼠标/键盘兜底路径失败后缺少足够上下文，难以判断是 Chrome 未聚焦、窗口不在前台、页面未跳转还是按钮定位问题 | 插件真实输入路径增加诊断日志：同捆、付款确认、付款配送変更的 Chrome debugger 鼠标点击返回/错误中包含 `method/action/tabId/windowId/tabStatus/tabActive/windowFocused/windowState/title/url/text/point`；PIN 的 Win32/System SendKeys 和 debugger keyboard 路径记录 `method/windowTitle/stdout/url/tabStatus` 等信息。服务端 Win32 PIN 脚本 stdout 增加 `matchedTitle/foregroundHandle`。不改变实际点击和输入顺序。验证：`node yahoo-plugin/background.test.js`、`node src/server/routes/plugin.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/background.test.js`、`node --check src/server/routes/plugin.js`、`node --check src/server/routes/plugin.test.js` |
| 2026-06-19 | 生产服务器普通商品同捆交易开始偶发失败时，后台只显示 `bundle next page did not appear`，无法判断卡在关闭弹窗、开始同捆、确认地域还是最终决定哪一步 | 插件同捆动作等待下一页超时日志增加 action 名：后续会记录为 `bundle start next page did not appear`、`bundle decide next page did not appear`、`bundle confirm next page did not appear` 等，便于定位无人值守服务器 Chrome/RDP 会话下的具体失败步骤；不改变实际点击流程。验证：`node yahoo-plugin/background.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/background.test.js` |
| 2026-06-18 | 用户端需要保留蓝白色调，但列表页不应使用卡片边框；期望只有原版的淡灰横向分隔线 | 回滚“恢复用户端样式”提交，恢复蓝白色调、公告栏、copyright、后台通知配置等改动；仅将共享列表样式改为无外框、无圆角、无阴影，列表项只保留 `1px #eee` 底部分隔线；落札商品取消/完了状态只保留淡背景，不覆盖左右边框。验证：`npm run build --prefix src/client` |
| 2026-06-18 | 用户端暖色系视觉与最新要求不符，需要改为简约蓝白风格、纯白背景和偏蓝按钮 | 用户端共享样式切换为蓝白色板：页面背景改为纯白，卡片/输入框/列表使用浅蓝边框和轻量蓝色阴影，主按钮统一为蓝色；登录页、公告栏、导航、页脚、商品卡、提交提示、落札完成状态和统计图表移除暖色硬编码并统一蓝白简约风。验证：`npm run build --prefix src/client` |
| 2026-06-18 | 用户端提交表单、任务列表、入札中/落札列表和统计图表视觉风格仍偏默认控件，和新登录页/公告栏风格不统一 | 新增用户端共享样式 `src/client/src/styles.js`，统一页面背景、卡片、按钮、输入框、列表项、缩略图、分页和图表配色；提交页商品输入卡、商品卡、策略/价格表单、提交按钮改为暖色卡片 + 青色主按钮；入札中/落札商品/任务列表改为卡片式列表；统计页图表改为柔和卡片和青色/金色柱体。验证：`npm run build --prefix src/client` |
| 2026-06-18 | 用户端入口和登录后页面缺少正式品牌感、通知栏和统一页脚；运营通知无法从后台配置 | 用户端登录标题改为“日本Yahoo代拍系统”，登录页和登录后导航统一改为偏日系的暖色轻量视觉；登录后顶部新增后台可配置通知栏，支持文字滚动开关；所有用户端页面底部新增 `© 2026 Kumohiro Co., Ltd.`。后台系统配置新增“用户端通知栏”卡片，读写 `client_notice_text` / `client_notice_marquee`；用户端新增 `/api/task/site-config` 读取通知配置。验证：`node src/server/routes/task.test.js`、`node --check src/server/routes/task.js`、`node --check src/server/routes/admin.js`、`npm run build --prefix src/client`、`npm run build --prefix src/admin` |
| 2026-06-18 | 插件请求任务间隔此前在 `background.js` 写死为 10 秒，虽然 `/api/plugin/config` 已返回 `workerIntervalMs`，但插件没有使用，后台系统配置也没有入口调整 | 后台“系统配置”新增“插件轮询配置 / 请求任务间隔”，单位秒，默认 10 秒，保存为 `config.worker_interval_ms`；`/api/admin/multi-bid-config` 读写 `workerIntervalMs` 并限制 1-60 秒；`background.js` 改为使用配置动态重建 `setInterval`，仍保留 1 分钟 Chrome alarm 兜底。新增 background 回归测试覆盖 10 秒启动后配置改为 5 秒会清理旧 timer 并重建。验证：`node yahoo-plugin/background.test.js`、`node src/server/routes/admin.orders.test.js`、`node src/server/routes/plugin.test.js`、`npm run build --prefix src/admin`、`node --check yahoo-plugin/background.js`、`node --check src/server/routes/admin.js` |
| 2026-06-18 | 普通商品待发货扫描可能把自己的商品 ID 数字段误识别为物流单号。例如商品 `x1233207430` 页面上先出现 `オークションID：x1233207430`，旧逻辑会把 `1233207430` 当作 10 位单号，导致后面用户聊天里真正发出的单号不再继续抓取 | `content.js` 的物流单号候选归一化新增当前商品 ID 过滤：从当前 URL 的 `aid` / `auctionId` / `/jp/auction/` 提取 auctionId，候选数字若等于商品 ID 数字部分则跳过，并继续寻找后续候选；规则只做精确相等，避免误杀以同数字开头但更长的真实单号。新增回归测试覆盖 `x1233207430` 先出现、真实单号 `390166447193` 在后面的普通商品发货页面。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-18 | 三表模型继续收口低风险读/同步路径：入札中同步税类型仍只读最新 `tasks.tax_type`；待运费扫描回写 `products` 前的商品快照仍只从 `tasks` 取；商城同捆补录判断商品是否 store 也只看 `tasks.product_type/tax_type` | 三处改为 `products` 优先、`tasks` 回退：`syncBiddingItems()` 用 `COALESCE(products.tax_type, tasks.tax_type)` 判断商城税后价折税前；`updateScanStatus()` 的待运费 snapshot 用 `LEFT JOIN products` 后再 upsert，避免旧 task 字段反向覆盖商品表；`backfillStoreBundle()` 用 `COALESCE(products.product_type, tasks.product_type, ...)` 判断商城商品。新增对应 SQL 断言。验证：`node src/server/routes/plugin.test.js`、`node src/server/routes/admin.orders.test.js`、`node --check src/server/routes/plugin.js`、`node --check src/server/routes/admin.js` |
| 2026-06-18 | 三表模型继续收口后台任务展示路径：后台“任务看板”和“队列统计”的任务商品标题、图片、当前价、即決价、税类型、商品类型、运费、结束时间仍直接读取 `tasks` 商品快照字段 | 新增 `buildAdminTasksListQuery()`、`buildAdminPendingTasksQuery()`，两个只读查询改为 `LEFT JOIN products`，商品展示字段使用 `COALESCE(products, tasks)`；路由 `/api/admin/tasks` 和 `/api/admin/tasks/stats` 切到 query builder。只影响后台展示和下一任务预览，不改变出价领取、付款金额、订单状态流转或删除逻辑。验证：`node src/server/routes/admin.orders.test.js`、`node --check src/server/routes/admin.js`、`node --check src/server/routes/admin.orders.test.js`、`node scripts/check-product-parity.js` |
| 2026-06-18 | 并行调度已稳定后，后台仍保留“出价保护窗口”配置，服务端和插件 API 也继续暴露 `idleBidGuardMinutes`，容易让人误以为入札/落札监控仍会被临近出价阻塞 | 移除出价保护窗口功能面：后台系统配置删除该输入项；`/api/admin/multi-bid-config` 不再读写 `idle_bid_guard_minutes`；插件 `/api/plugin/task` 和 `/api/plugin/config` 不再返回 `idleBidGuardMinutes`；删除服务端 guard 计算函数和旧测试，新增回归测试确认残留数据库 key 不再被查询或返回。验证：`node src/server/routes/plugin.test.js`、`node --check src/server/routes/plugin.js`、`node --check src/server/routes/admin.js`、`node --check yahoo-plugin/background.js` |
| 2026-06-18 | 商城商品即決购买确认页如果显示“この出品者の他の商品とまとめて購入する”复选框，插件点击 checkbox 后没有确认页面已切到“今すぐ落札する”流程；在 checkbox 未真正生效或图 3 未出现时，后续逻辑可能继续点击右侧 `確認する`，导致跳过まとめて購入流程并最终落札判断依赖后续同步修正 | `content.js` 的 buyout 流程改为：命中まとめて購入 checkbox 时优先点击外层 `label`，点击后必须等待 `今すぐ落札する` 出现；若未出现则返回明确错误 `bulk purchase checkbox did not activate / bulk purchase flow did not activate` 并关闭任务 tab，不再继续点击右侧 `確認する`。新增回归测试覆盖 checkbox 已勾但图 3 未出现时不得点击 `確認する` 或最终落札按钮。真实页面手动验证 `k1226361177`：图 3 点击 `今すぐ落札する` 可到图 4 弹窗，未点击最终落札。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-18 | 三表模型进入 Operational Query Switch：生产 parity 已归零后，运行时队列仍有多处直接读取 `tasks` 商品快照字段，后续如果 `products` 已修正但旧任务字段残留，会让付款、交易开始、扫描、确认收货或 Google 表继续拿到旧标题/运费/商品类型 | 将插件运行查询逐步切到 `products` 优先、`tasks` 回退：`getTransactionStartJobs()`、`getPaymentJobs()`、`getScanJobs()`、`getConfirmReceiptJobs()`、Google 表追加 `getOrdersForSheetAppend()`、Google 表更新 `getOrderForSheetUpdate()` 均使用 `LEFT JOIN products` 和 `COALESCE(products, tasks)`；不改变订单状态流转、付款金额公式、扫描条件、Google 表列结构或旧 `tasks` 字段写入。新增测试断言这些运行查询必须 join `products`。验证：`node src/server/routes/plugin.test.js`、`node --check src/server/routes/plugin.js`、`node --check src/server/routes/plugin.test.js`、`node scripts/check-product-parity.test.js` |
| 2026-06-18 | 生产三表 parity 检查发现 `productsLatestTaskSnapshotMismatch: 1`，明细为商品 `m1233193360`：`tasks.shipping_fee_text` 已在待运费扫描后更新为 `1940円`，但 `products.shipping_fee_text` 仍停留在旧值 `落札者負担`；根因是 `/api/plugin/scan/status` 的 `waiting_shipping -> pending_payment` 分支只更新订单对应 `tasks.shipping_fee_text`，没有同步写入 `products` 商品快照 | `updateScanStatus()` 在写入待运费扫描结果前读取订单对应 task 商品快照，更新 `tasks.shipping_fee_text` 后同步调用 `upsertProductSnapshot()` 写入 `products.shipping_fee_text`，避免后续扫描再次制造 parity mismatch。新增回归测试覆盖待运费扫描写运费时必须 `INSERT INTO products`。生产已有单条历史差异可用一次性 SQL 将 `products.shipping_fee_text` 对齐到最新 task 后重新运行 parity。验证：`node src/server/routes/plugin.test.js`、`node --check src/server/routes/plugin.js`、`node --check src/server/routes/plugin.test.js`、`node scripts/check-product-parity.test.js` |
| 2026-06-17 | 生产 `/api/plugin/scan/jobs` 实测只返回 `pending_receipt`，普通 `pending_shipment` 待发货订单没有进入扫描队列，导致如 `l1233674201` 这类页面已有 `伝票番号` 的订单无法由扫描任务转待收货；根因是 `getScanJobs()` SQL 有一个 `SELECT MAX(... new_status = ?)` 占位符在 `WHERE IN (?, ?, ?)` 前面，参数顺序错位后把 `pending_shipment` 挤到重扫专用条件，反而把 `pending_receipt` 放进普通扫描集合 | 修正 `getScanJobs()` 参数顺序：第 1 个参数仅用于待发货起算时间，`IN` 明确传 `pending_shipment / waiting_shipping / pending_bundle`，只有 `pending_receipt + tracking_rescan_requested=1` 才作为单号重扫进入扫描。同步修正测试断言，并新增 `l1233674201` 截图形态回归测试，确认 `佐川急便 + 伝票番号 490459840452` 会解析为 `shipped`。验证：`node src/server/routes/plugin.test.js`、`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node --check src/server/routes/plugin.js`、`node --check src/server/routes/plugin.test.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-17 | 待发货订单在 Yahoo 落札同步中已能看到单号，但本地已有订单会被 `syncYahooWonOrders()` 按“已存在”直接跳过，导致 `pending_shipment` 不会转为 `pending_receipt`；例如商城商品交易页已有 `伝票番号` 时仍停在待发货 | 新增 `updateExistingWonOrderFromSync()`：落札同步遇到已有订单且带 `trackingNumber` 时，先补写单号和交易链接；若订单当前为 `pending_shipment`，直接转 `pending_receipt`，清理待发货提醒，写状态审计并按现有逻辑追加 Google 表。新增回归测试覆盖 `l1233674201` 形态的已有待发货订单同步到 `490459840452` 后转待收货。验证：`node src/server/routes/plugin.test.js`、`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node --check src/server/routes/plugin.js`、`node --check src/server/routes/plugin.test.js` |
| 2026-06-17 | 三表模型 Task 8 继续收口后台只读日志路径：`/api/admin/logs` 操作日志商品标题仍直接读取 `tasks.product_title` | 抽出 `buildAdminLogsQuery()`，操作日志商品标题改为 `COALESCE(products.product_title, tasks.product_title)`，只影响后台日志展示，不改变日志写入、任务状态、订单金额或自动执行逻辑。验证：`node src/server/routes/admin.orders.test.js` |
| 2026-06-17 | 三表模型 Task 8 继续收口后台只读调试路径：`/api/admin/orders/status-debug/:productId` 的订单排查信息仍直接读取 `tasks` 商品快照字段 | 抽出 `buildOrderStatusDebugOrdersQuery()`，状态调试接口的订单列表对商品类型、运费使用 `COALESCE(products, tasks)`，只影响只读排查输出，不改变任务列表、订单状态、金额、筛选或写入逻辑。验证：`node src/server/routes/admin.orders.test.js` |
| 2026-06-17 | 三表模型 Task 8 继续收口剩余只读路径：订单状态审计快照和后台“同用户日期范围订单”查询仍直接读取 `tasks` 商品快照字段 | `orderStatusAudit.js` 的审计快照查询增加 `products` join，并对商品类型、运费、税类型使用 `COALESCE(products, tasks)`；后台同用户日期范围订单查询同步改为商品 URL、运费、税类型、商品类型优先读 `products`，缺失回退 `tasks/orders`，不改变订单状态、金额、筛选或排序逻辑。验证：`node src/server/services/orderStatusAudit.test.js`、`node src/server/routes/admin.orders.test.js` |
| 2026-06-17 | 三表模型 Task 8 复核发现后台“运费更新”和“商品类型更新”仍只更新 `tasks.shipping_fee_text` / `tasks.product_type`，如果后续批量刷新会让 `products` 商品快照与最新任务字段产生不一致 | 抽出 `refreshProductShippingFee()`、`refreshProductType()`，两个后台批处理在更新 `tasks` 后同步 `upsertProductSnapshot()` 写入 `products`，保持批处理后的三表 parity。新增回归测试覆盖运费更新和商品类型更新都会写 `products`。验证：`node src/server/routes/admin.orders.test.js`、`node --check src/server/routes/admin.js`、`node --check src/server/routes/admin.orders.test.js`、`node src/server/services/productRepository.test.js`、`node scripts/check-product-parity.test.js` |
| 2026-06-17 | 服务器 Chrome 中 Yahoo PIN 页被关闭或当前没有任何 PIN/验证码页时，后台仍可能继续显示“Yahoo 需要 PIN 码验证”，尤其是未提交 PIN 的 `manual_captcha_challenge` 会残留 | `background.js` 将无验证页时的兜底清理从“只关闭已回答 challenge”改为“关闭所有残留 PIN challenge，已回答验证码也继续关闭；未回答文字验证码不自动关闭”。新增回归测试覆盖服务端残留未回答 PIN challenge、Chrome 已无验证页时会调用 `/api/plugin/manual-captcha/close`。验证：`node yahoo-plugin/background.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/background.test.js` |
| 2026-06-16 | 即时拍进入 Yahoo `入札内容の確認` 弹窗后，点击最终 `上記に同意のうえ 入札する` 后仍使用通用 10 秒结果等待，用户看到确认弹窗停留时间偏长 | `content.js` 新增普通即时拍最终确认结果等待 `DIRECT_BID_FINAL_OUTCOME_TIMEOUT_MS=3000`，只把 `direct + bid` 最终确认后的 `waitForBidOutcome()` 缩短到 3 秒；多次出价和即決/购买确认仍保留原 10 秒等待。新增回归测试覆盖截图中的 `上記に同意のうえ 入札する` 弹窗。验证：`node yahoo-plugin/content.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-16 | 即时拍填价后固定等待 10 秒才回到 Yahoo 确认/失败页，导致本地即时拍反馈慢；Yahoo 返回 `Rebid required: current bid is not high enough` 时前端未归类，显示成“失败：系统原因” | `background.js` 新增 pending final 等待区分：普通即时拍确认后 1.5 秒重试注入，商城/即決最终购买仍保留 10 秒长等待；`taskFailureReason.js` 将 `Rebid required` / `current bid is not high enough` 归类为“失败：出价后被超过”。验证：`node yahoo-plugin/background.test.js`、`node src/client/src/utils/taskFailureReason.test.mjs`、`node --check yahoo-plugin/background.js`、`node --check src/shared/taskFailureReason.js` |
| 2026-06-16 | 商城商品待发货扫描不应从全文兜底抓任意 `10-12` 位数字作为单号；同时所有商品都不能把 `0` 开头的 10/11 位电话当物流单号 | `content.js` 将物流单号候选统一走 `normalizeTrackingNumberCandidate()`，排除 `0` 开头数字候选；商城 `商品が発送されました` 分支只从 `伝票番号` / `追跡番号` / `お問い合わせ番号` 标签字段抓真实数字单号，不再扫描全文。商城无有效标签单号时直接按 `ストア情報 / ストア名` 兜底，再兜底顶部 `出品者`。新增回归测试覆盖商城全文无标签 `123456789012` 会改取 `SOFTomo`，以及普通商品 `080-9609-6438`、`0123456789` 不会被当单号。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-16 | 商城待发货/待收货扫描在无真实追踪号时，虽然已支持 `ストア情報 / ストア名` 兜底，但如果 Yahoo 页面把店铺信息放在结构化 `section > dl > dt/dd` 中，且可用 body 文本没有完整店铺区块，仍可能抓不到店铺名，导致单号没有写成如 `SOFTomo` | `content.js` 新增结构化店铺信息提取：优先扫描 `section` 中的 `ストア情報`，定位 `dt/th=ストア名` 后从对应 `dd/td` 取值，并清理 `ストア情報を確認する` 后续说明。新增回归测试覆盖用户提供的 `ストア名 SOFTomo` DOM 形态，确保 `trackingNumber=SOFTomo`、`trackingFallback=store_info_name`。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-16 | 后台“数据批处理 / 单号重扫”页面部分标题和表单 label 显示为 `\u5355...`、`\u5546...` 等转义文本；相邻“待收货补表格”说明文案也存在乱码风险 | 将 `DataBatch.tsx`、`TrackingRescan.tsx`、`ReceiptSheetBackfill.tsx` 的可见中文文案改为真实 UTF-8 中文，避免 JSX 属性把 `\uXXXX` 当普通文本渲染；同步恢复“待收货补表格”说明、按钮、表头等文案。验证：`npm run build --prefix src/admin`；Browser 打开 `http://127.0.0.1:8000/#/data-batch`，登录后台后检查“单号重扫”和“待收货补表格”两个 tab，DOM 中无 `\uXXXX` 和乱码，截图确认单号重扫页标题/label/结果区正常显示 |
| 2026-06-16 | 插件付款金额校验里，`parseYenAmount()` 只把 `無料` / `着払い` 当作 0 运费；付款页或订单运费文本为 `出品者負担` 时会返回 `null`，导致付款金额无法校验或误判不可用 | `yahoo-plugin/background.js` 的付款金额解析新增 `出品者負担` 按 0 处理；其他非数字运费逻辑不变，`落札者負担` 仍保持原有处理。新增回归测试覆盖 `送料 出品者負担` 解析为 0 且应付款金额等于落札价。验证：`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/background.test.js` |
| 2026-06-16 | 历史待收货订单因旧插件未识别 `お問い合わせ番号`，可能把卖家名等兜底信息误写成单号；需要按商品 ID 批量用最新页面解析逻辑重新抓取物流/单号，并同步修正数据库和 Google 代拍表已有行 | 新增 `orders.tracking_rescan_requested` 标记和后台“数据批处理 / 单号重扫”页面。输入商品 ID 后，服务端只标记对应 `pending_receipt` 订单并触发扫描；插件扫描任务会把该订单按待发货页面重扫，成功后覆盖 `shipping_company/tracking_number`、清除标记，并用当前订单数据按商品 ID 更新 Google 表 A:J 已有行，不重复追加。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node src/server/routes/plugin.test.js`、`node src/server/routes/admin.orders.test.js`、`node src/server/services/googleSheets.test.js`、`node src/shared/shippingRules.test.cjs`、`node yahoo-plugin/encoding.test.js`、`npm run build --prefix src/admin` |
| 2026-06-16 | 待发货扫描抓取物流单号时，标签字段只包含 `伝票番号` / `追跡番号`，缺少 Yahoo 页面常见的 `お問い合わせ番号`；若页面只显示该字段，插件会漏掉真实单号并可能落到卖家名兜底 | `content.js` 将 `お問い合わせ番号` 加回物流单号标签和字段截断标签，`未登録` 判断也同步覆盖该字段。新增回归测试覆盖 `お問い合わせ番号：1234-5678-9012` 后接 `配送希望日` 时仍提取为 `123456789012`。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node src/server/routes/plugin.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-16 | 同捆商品实际已进入待支付页，但系统仍停留在 `待同捆` 时，扫描流程只识别 `送料：数字円`，遇到 `送料：出品者負担`、`送料：無料` 或 `送料：着払い` 不会生成 `bundleShippingFeeText`，导致无法触发现有“主商品待支付、子商品同捆完了”的整组回写 | `content.js` 的待同捆扫描运费提取新增支付金额区块非数字运费识别：`支払い金額 ... 送料：出品者負担/無料/着払い` 保留原文写入 `bundleShippingFeeText`，继续走现有 `/api/plugin/scan/status` 同捆完成逻辑。`shippingRules.cjs` 的 `normalizeShippingFeeText()` 同步允许这三种文案落库，金额计算仍按 0 处理；数字运费逻辑不变。新增回归测试覆盖三种非数字运费文案和服务端整组回写。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node src/server/routes/plugin.test.js`、`node src/shared/shippingRules.test.cjs`、`node src/server/routes/admin.orders.test.js`、`node src/shared/payableRules.test.cjs`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-16 | 待发货扫描抓取物流/单号时，无真实追踪号的兜底只支持普通商品 `出品者情報 / 氏名`，商城页面对应字段是 `ストア情報 / ストア名`，可能导致商城已发货但无传票番号时无法记录可用标识 | `content.js` 新增 `extractStoreInfoName()`，从 `ストア情報` 区块读取 `ストア名`；商城 `商品が発送されました` 分支在没有真实追踪号时按 `ストア名 -> 出品者 -> 空` 兜底，`trackingFallback` 标记为 `store_info_name`。普通商品继续支持 `出品者情報 / 氏名`。新增回归测试覆盖商城 `ストア情報 / ストア名` 兜底。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node src/server/routes/plugin.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-16 | 插件重载后后台仍显示旧的“服务器确认中”，原因是服务端 `manual_captcha_challenge` 已经残留了 answered challenge；插件重启后如果 Chrome 中已经没有 PIN/验证码页，旧逻辑不会主动读取并关闭这个服务端状态 | `pauseIdleWorkForOpenManualPin()` 新增兜底清理：当当前没有任何 PIN/验证码 tab 时，读取 `/api/plugin/manual-captcha/current`，如果发现 challenge 已回答，则调用 `/api/plugin/manual-captcha/close` 清掉旧状态。这样即使验证流程已经结束、插件后来才重载，也会在下一轮轮询清掉后台“服务器确认中”。新增回归测试覆盖无验证页但服务端残留已回答 PIN challenge 的场景。验证：`node yahoo-plugin/background.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js` |
| 2026-06-16 | 后台人工验证码提交正确后进入 Yahoo PIN 页时，顶部提示仍可能一直停留在“服务器确认中”，因为插件在验证码提交后仍优先盯着旧 captcha tab，重复上报同一个已回答验证码 challenge，没有切换成 PIN challenge；最终 PIN 成功进入 `取引連絡` 等非验证页时也必须清理验证状态 | `background.js` 在验证码提交后的页面跳转等待中新增 `preferPin` 选项，发现 PIN 页时优先切换到 PIN tab；一旦当前页不再是 captcha，立即关闭旧 captcha challenge 并发布 PIN challenge。PIN 输入后若页面进入 `取引連絡` 或任何非 PIN/验证码页，会关闭当前 PIN challenge，后台不再显示“服务器确认中”。新增回归测试覆盖 `captcha -> PIN -> 取引連絡` 顺序：`challenge:captcha -> close:captcha -> challenge:pin -> close:pin`。验证：`node yahoo-plugin/background.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js` |
| 2026-06-16 | Chrome 扩展错误页出现 `Unexpected end of input`、`Could not establish connection. Receiving end does not exist`、`Frame with ID 0 was removed`、`Monitor sync failed` 等插件错误；其中 `Unexpected end of input` 指向服务器加载的 `background.js` 在约 1543 行被截断，属于部署文件不完整 | 仓库 `background.js` 语法正常且完整；需用仓库完整 `yahoo-plugin` 重新覆盖并在 Chrome 扩展页重新加载。代码侧将 A/B 监控同步临时 `/my/bidding`、`/my/won` tab 的 `Frame with ID ... was removed`、`Receiving end does not exist` 识别为页面关闭/刷新竞态，降级为 `console.warn` 并跳过本轮，不再写入 Chrome 扩展错误页；出价、交易开始、付款等严格流程仍保持失败上抛。验证：`node yahoo-plugin/background.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js` |
| 2026-06-15 | 对比历史提交确认乱码不是 Yahoo 页面问题，而是源码文件曾被 UTF-8 按 GBK/ANSI 解码后再次保存，导致日文/中文注释和少量运行字符串变成 `闂/閻/濠/婵/鈧/锟` 等不可逆乱码 | 新增 `.editorconfig` 和 `.gitattributes`，统一文本文件 `UTF-8 + LF`；清理 `content.js` 中已写入的乱码注释，恢复 `cleanupProductTitle()` 的 `商品 {auctionId}` fallback 为 `\u5546\u54c1` escape；`encoding.test.js` 增加常见 mojibake 字符检测，插件文件再次出现 BOM、替换符、GBK/ANSI 乱码或复制截断标记时测试直接失败。验证：`node yahoo-plugin/encoding.test.js`、`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node --check yahoo-plugin/content.js`、`git diff --check` |
| 2026-06-15 | 对比 `4ebdc8e` 发现当时落札价还能抓到，后续版本抓不到的直接差异在 `yahoo-plugin/content.js`：`extractOrderHistory()` 内查找纯价格 DOM 叶子节点的正则从 `数字+円` 被转码损坏成 `数字+闂?`，导致部分 Yahoo 落札记录的独立价格节点无法解析 | 将纯价格节点匹配改为稳定 ASCII 写法 `(?:\u5186|JPY)`，移除乱码 `闂...` 兜底，避免误抓或漏抓；新增真实 `円` 叶子价格测试，覆盖标题编号和落札价粘连时仍优先取独立价格节点。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js` |
| 2026-06-15 | 后台“落札商品更新”后，同批商品一个能更新落札价、另一个仍为空；原因不是抓价程序整体失效，而是某条 Yahoo 落札记录未解析到价格时服务端仍清除 `force_orders_resync`，并且同商品多任务时可能只标记最新 task、没有标记已有订单所在 task | `orders-resync/run` 改为优先标记已有订单对应的 task；插件 `/orders/sync` 查询任务时优先选择 `force_orders_resync=1` 的 task。同步时若 `order.price` 缺失，不再更新订单、不清除强制刷新标记，返回 `missingPrice` 让下次同步继续重试。验证：`node src/server/routes/plugin.test.js`、`node src/server/routes/admin.orders.test.js`、`node --check src/server/routes/plugin.js`、`node --check src/server/routes/admin.js` |
| 2026-06-15 | 后台订单管理部分订单“落札金额”为空，服务器数据里 `orders.final_price` 已是空值；风险点是落札商品强制刷新或手动导入候选重复扫描时，如果 Yahoo 本次未解析到价格，会覆盖已有金额 | `plugin.js` 更新已有订单时改为 `final_price = COALESCE(?, final_price)`，只在新抓到有效金额时覆盖；手动导入候选 `ON CONFLICT` 改为忽略 0 金额并保留已有候选金额。已空的生产数据需重新跑“落札商品更新”或手动补金额恢复。验证：`node src/server/routes/plugin.test.js` |
| 2026-06-15 | 再入札价格输入后页面停留太短，几乎看不到价格就提交，排查失败页不方便 | `content.js` 新增再入札专用提交前等待 `MULTI_BID_REBID_SUBMIT_DELAY_MS=1000`：再入札写入价格后等待 1 秒再点击 `入札する`；普通金额输入页仍保留 800ms。新增测试确保再入札提交前等待至少 1000ms。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-15 | 多次出价再入札价格正确，但点击 `入札する` 后 Yahoo 直接进入失败页，怀疑提交方式被 Yahoo 判定为异常 | 根因排查到 `content.js` 的出价流程 `clickElement()` 同时手动派发 `MouseEvent('click')` 并调用 `el.click()`，对 Yahoo React 按钮可能等于双提交。已改为只执行一次原生 `el.click()`，保留 pointer/mouse down/up，不再额外派发 click 事件；新增测试确保再入札提交按钮只触发一次 click。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-15 | 多次出价商品 `v1233335580` 出价和再入札流程都正确，但后续突然关闭 tab 并显示“失败：响应超时” | 根因是 `executeBidTask()` 外层单任务总超时固定 30 秒，多次出价的商品页加载、金额确认、再入札循环都算在同一个 30 秒里。`background.js` 新增 `getTaskExecutionTimeoutMs()`：普通任务仍 30 秒，多次出价 `multi_bid` 单独延长到 120 秒，避免连续再入札被总超时误杀；普通出价卡死保护不变。验证：`node yahoo-plugin/background.test.js`、`node yahoo-plugin/content.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/background.test.js` |
| 2026-06-15 | 多次出价再入札价格基础优先级调整：用户确认应优先使用 Yahoo 输入框默认价反推当前税前价，而不是优先页面可见当前价 | `content.js` 的再入札计算改为 `输入框默认价 - Yahoo最低加价单位 + 用户设置multi_bid_increment` 优先；只有输入框不可用或反推失败时才 fallback 到页面可见当前价/Yahoo 脚本价。新增冲突测试：即使页面可见当前价更高，只要输入框默认价可反推，就按输入框公式计算。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-15 | 多次出价再入札时如果插件没获取到商品当前价，可能用错误低价计算下一口，例如税后 1760/税前 1600 时应出 1850，却填成 251 | `content.js` 新增从 Yahoo 价格输入框默认值反推当前税前价的兜底：默认输入价 = 当前税前价 + Yahoo 最低加价单位，按阶梯 `<1000=10`、`<5000=100`、`<10000=250`、`<50000=500`、`>=50000=1000` 反推当前价，再加用户设置的 `multi_bid_increment`。后续已调整为再入札优先使用输入框反推价；输入框不可用时才 fallback 到页面当前价/脚本价。测试覆盖 `1700-100+250=1850`、`5500-250+250=5500`、`7000-250+500=7250`。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-15 | 本地 Chrome 扩展错误页仍出现 `[Yahoo Bid] Failed to inject content script: Error: No tab with id ...`，以及本地 API 未启动时的 `Failed to fetch` 被记为插件错误 | `background.js` 将 `No tab with id` 注入失败统一降级为 `console.warn`，严格流程仍抛错给调用方处理但不再通过 `console.error` 写入 Chrome 扩展错误页；新增 `logBackgroundIssue()`，把 `Failed to fetch/ERR_CONNECTION/ECONNREFUSED` 等本地网络断开错误降级为 warning，用于 idle action、sync bidding/items、Yahoo login status 等轮询日志。注意：`Failed to fetch` 仍表示 API `localhost:3034` 不可达，需要启动服务。验证：`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/background.test.js` |
| 2026-06-15 | Yahoo 再入札确认按钮实际 DOM 为 `<button ... data-cl-params="_cl_vmodule:rebid;_cl_link:cnfbtn;...">入札する</button>`，按钮可能不在先前定位到的弹窗容器内，旧逻辑会认为弹窗内找不到精确按钮 | `content.js` 的 `findRebidSubmitButton()` 增加 Yahoo 再入札确认按钮专用识别：容器内精确 `入札する` 优先；若未找到，只接受全页面中精确文本 `入札する` 且 `data-cl-params` 同时包含 `_cl_vmodule:rebid` 和 `_cl_link:cnfbtn` 的按钮。仍不会点击外层 `値段を上げて入札`。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-15 | 多次出价再入札阶段可能拿 Yahoo 页面脚本里的旧当前价作为加价基础，例如商品从税后 990/税前 900 出到 1150 后，其他用户自动加价到税后 1375/税前 1250，下一次应出 1250 + 用户加价额 250 = 1500，而不是脚本旧价 900 + 250 = 1150 或弹窗默认 1350 | `content.js` 将出价当前价读取拆成“脚本价”和“可见当前价”；正常商品页仍优先 Yahoo 脚本税前价，但检测到 `再入札が必要です` 时优先读取页面可见最新 `現在 ...円(税込)` 并折算税前后加用户设置的 `multi_bid_increment`。回归测试覆盖脚本旧价 900、页面显示 1375(税込)、弹窗默认 1350 时最终填入 1500。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-15 | 多次出价仍可能在 `再入札が必要です` 弹窗上叠加新的“入札”窗口，原因是找不到弹窗内精确 `入札する` 时仍 fallback 到全页面 `値段を上げて入札` | `content.js` 移除再入札分支的全页面出价入口兜底：只要检测到 `再入札が必要です`，就只允许在包含该文案的弹窗/页面块内精确点击 `入札する`；找不到则返回 `rebid submit button not found in active dialog` 并关闭任务 tab，不再打开第二层入札窗口。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-15 | 多次出价在金额输入页、确认页、再入札弹窗之间提交过快，Yahoo 可能还没刷新完就收到下一次点击，商品 `v1233335580` 本地表现为失败：系统原因 | `content.js` 的 multi_bid 流程新增提交节奏控制：填入价格后等待 800ms 再点 `確認する/入札する`，页面/弹窗切换后等待 2500ms 再进入下一步；Yahoo 系统错误、稍后重试、页面无法显示等文案纳入出价失败识别。新增回归测试确保价格输入后不会立即点击确认。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node src/server/routes/plugin.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-06-15 | Yahoo 系统错误页被插件识别后，如果错误消息是稳定英文 `Yahoo bid failed: Yahoo system error page`，用户端任务列表不应继续显示泛化的“失败：系统原因” | `src/shared/taskFailureReason.js` 新增 `Yahoo bid failed / Yahoo system error page / Yahoo error page / Yahoo access failure` 映射，显示为“失败：Yahoo页面错误”；`content.test.js` 覆盖 `v1233335580` 这类系统错误页返回稳定错误，`taskFailureReason.test.mjs` 覆盖前端标签。验证：`node yahoo-plugin/content.test.js`、`node src/client/src/utils/taskFailureReason.test.mjs`、`node --check src/shared/taskFailureReason.js` |
| 2026-06-15 | 普通商品、无同捆、有固定运费时，Yahoo 可能跳过“取引情報を入力する”页，直接进入配送/支付信息输入页，插件旧逻辑会直接把订单标为待支付，未点 `決定する/確定する` | content 状态识别新增 `paymentReady`；普通无同捆固定运费交易开始流程在标记 `pending_payment` 前，若当前页已有 `決定する` 或 `確定する`，会先完成前置提交再进入支付步骤。相关取引页点击流程改为可从当前状态继续。验证：`node yahoo-plugin/background.test.js`、`node yahoo-plugin/content.test.js`、`node yahoo-plugin/encoding.test.js` |
| 2026-06-15 | 手动导入订单确认后会自动触发交易开始，且确认导入后的批次信息仍留在当前页面 | 确认导入不再写 `transaction_start_requested` / `transaction_start_requested_source`，导入订单保持 `orders.order_status=NULL` 等待后续人工或定时交易开始；后台导入订单页新增“清空当前批次”按钮，调用 `DELETE /api/admin/manual-order-import/batches/:id` 删除当前批次和候选项。验证：`node src/server/routes/admin.orders.test.js`、`node src/admin/src/manualOrderImportState.test.js`、`npm run build --prefix src/admin` |
| 2026-06-15 | 后台提交 PIN/文字验证码后，在插件调用 Win32 输入和等待 Yahoo 页面确认期间，后台仍可能重新显示输入框，看起来像输入错误 | 后台人工验证提示新增“服务器确认中”状态：提交答案后隐藏输入框，直到插件关闭挑战或发布新的错误/后续挑战；验证码通过后短暂显示“验证通过！”再关闭。服务端保存同一已回答挑战时保留 `answer/answeredAt`，避免重复上报清空确认态；插件延后到页面跳转判断后再关闭 PIN/验证码挑战。验证：`node src/admin/src/manualVerificationState.test.js`、`node src/server/services/manualCaptcha.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`npm run build --prefix src/admin` |
| 2026-06-15 | 服务器 Chrome 插件加载的 `background.js` 片段开头出现 `锘縞onst`，并带有 `<有 ... 行代码未显示出来>` 截断标记，属于 BOM/复制转码损坏文件，Chrome 会把它当成非法 JS | 移除仓库 `yahoo-plugin/background.js` 开头 UTF-8 BOM；`yahoo-plugin/encoding.test.js` 扩展检查 BOM、BOM mojibake（`锘/縞`）和复制截断标记，避免损坏插件文件再次部署。服务器需重新复制/加载仓库里的完整 `yahoo-plugin` 文件，不要从聊天窗口或源码预览复制截断内容。验证：`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/background.js`、`node yahoo-plugin/background.test.js` |
| 2026-06-15 | 普通商品点击 `取引連絡` 后进入 `落札者削除されたため、取引はできません。` 页面时，旧交易开始流程仍可能继续按固定运费订单写成待支付 | `content.js` 的交易页状态新增 `cancelled` 识别；`background.js` 在交易开始页面初始状态发现 `cancelled` 时直接上报订单状态 `cancelled` 并关闭交易 tab，不再点击后续按钮；`/api/plugin/transaction-start/status` 允许空状态订单更新为 `cancelled`。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node src/server/routes/plugin.test.js`、`node yahoo-plugin/encoding.test.js` |
| 2026-06-15 | 插件 Service Worker 报 `[Yahoo Bid] Failed to inject content script: Error: No tab with id ...`，随后 `Monitor sync failed` | 根因是 A/B 入札/落札监控同步创建临时 `/my/bidding` 或 `/my/won` tab 后，tab 在等待加载/延迟期间已被关闭，后续仍尝试注入 `content.js`。`background.js` 新增 `No tab with id` 识别；仅监控同步的临时 tab 注入/发消息遇到 tab 消失时跳过本轮并记录 warning，不再作为插件错误抛出；出价、交易、付款流程仍保持严格失败。验证：`node yahoo-plugin/background.test.js`、`node --check yahoo-plugin/background.js`、`node yahoo-plugin/encoding.test.js` |
| 2026-06-15 | 普通商品取消页如果是在付款流程打开，旧逻辑仍按付款页找按钮，后台提示 `付款失败：商品ID ...，原因：页面按钮未找到` | 付款页面状态识别新增 `落札者削除されたため、取引はできません。` 取消文案；`executePaymentJob` 在初始页、交易信息提交后、入口点击/等待、确认/最终页等待等阶段发现 `cancelled` 时直接返回取消；`runPaymentJobs` 上报 `status='cancelled'`；`/api/plugin/payment/status` 支持把待支付/待结算/待确认收货订单更新为 `cancelled` 并清理付款请求，不再写付款失败提示。验证：`node yahoo-plugin/background.test.js`、`node src/server/routes/plugin.test.js`、`node yahoo-plugin/content.test.js`、`node yahoo-plugin/encoding.test.js` |
| 2026-06-15 | 多次出价在确认提交后出现 `再入札が必要です` 弹窗时，旧逻辑会全页查找出价入口，误点商品页外层 `値段を上げて入札`，导致在原弹窗上再叠一个“入札”窗口并最终超时 | `content.js` 的 multi_bid 流程新增再入札弹窗专用处理：检测到 `再入札が必要です` 时优先定位当前弹窗内精确文本 `入札する`，按当前价 + 多次出价加价额重新写入入札额后直接点击弹窗内按钮；只有找不到弹窗按钮时才兜底回外层入口。新增回归测试确保不会点击外层 `値段を上げて入札`，并会把 595 + 56 更新为 651。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js` |
| 2026-06-15 | 多次出价加价基础需要明确为“页面最新当前价的税前金额 + 多次出价加价额”，不能用弹窗输入框默认价格，也不能把商城 `税込` 当前价直接当税前价 | `content.js` 新增出价专用当前价读取：Yahoo 脚本原始价格优先；若从页面 DOM/正文读到 `税込` 当前价，会先按 `floor(税込/1.1)` 转回税前再加价。回归测试覆盖输入框默认 `50`、页面 `44円(税込)` 时填 `290`，页面 `330円(税込)` 时填 `550`。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node src/server/routes/plugin.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.js` |
| 2026-06-15 | 确认商品 `j1233320198` 页面显示 `330円(税込)`，但 Yahoo 页面脚本/结构化数据暴露 `price: 300`，多次出价应优先使用这个税前价 | `content.test.js` 新增脚本税前价优先测试：即使 DOM 当前价显示为 `999円(税込)`、输入框默认 `50`，只要 Yahoo 脚本 `pageData.items.price=300`，一次加价 250 时仍填 `550`。说明“250”仅为测试例，实际使用用户设置的 `multi_bid_increment`。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/content.test.js` |
| 2026-05-12 | `plugin.js` route 使用 `await` 但函数未声明 `async` | 添加 `async` |
| 2026-05-12 | routes 中 `db.getOne/getAll` 缺少 `await` | 补齐 async/await |
| 2026-05-12 | 服务端抓取 Yahoo 易被反爬 | 改为服务端 HTTP + Playwright fallback，并保留内存缓存兜底 |
| 2026-05-12 | `submitTask` 不保存商品 title/image/price | 提交时保存商品信息 |
| 2026-05-12 | `截旗前` 文案不准确 | 改为 `结束前` |
| 2026-05-24 | 入札中页只显示我方最高价商品 | `/api/task/bidding` 支持 `highest/outbid`，前端显示高値更新 |
| 2026-05-24 | 即时拍被超过后缺少再入札入口 | 入札中页面为 `direct + outbid` 增加 `再入札` 按钮 |
| 2026-05-25 | 落札价错误使用用户最高价/任务价格 | `final_price` 改为只使用 Yahoo 落札页抓到的价格 |
| 2026-05-25 | 客户端允许最高价低于/等于当前价提交 | 提交前阻断并提示当前价 |
| 2026-05-27 | 插件商品缓存和运费来源不统一 | 删除 `/api/proxy/cache`，插件不再写商品缓存，落札同步不再更新运费 |
| 2026-05-27 | 空闲同步可能挤占临近出价 | `/api/plugin/task` 曾增加出价保护窗口，默认 10 分钟内有任务时禁止空闲同步；该功能已在 2026-06-18 并行调度稳定后移除 |
| 2026-05-27 | 历史运费错误缺少修复入口 | 后台新增“运费更新”，按商品 ID 批量走服务端解析并更新任务运费 |
| 2026-05-27 | 多次出价最低价仍有硬编码风险 | 后台“多次出价配置”增加最低最高价参数，前后端统一读取，默认 `5000円` |
| 2026-05-27 | 后台订单排序与用户端不一致 | 后台订单改为按 Yahoo 落札时间 `won_at` 优先倒序 |
| 2026-05-27 | 即时拍商品税前价<1000 时无法直接出价>10000 | 客户端弹窗提示拆分两步出价；首单以 9000 提交并存 `pending_followup_max_price`，入札中/快照同步发现税前价≥1200 时自动以原最高价补一个 `direct` 即时拍（`client_request_id=followup-{id}` 幂等）。修复含税商品 followup 任务 max_price 折算、direct noStatus 死循环 |
| 2026-05-27 | 价格口径混乱（税前/税后） | 统一口径：`current_price`/`max_price` 始终税前，`user_max_price` 始终税后。修复 `getComparableCurrentPrice`、拆分判断、ActiveBidding 显示、`failPricedOutPendingTasks` SQL、content.js `validateCurrentPrice`、`syncBiddingItems` 入札中价格折算 |
| 2026-05-27 | 落札页价格抓取错误（吃到标题商品代码） | `extractOrderPrice` 新增 `findPriceElementText` 从 DOM 叶子节点查找纯价格元素，避免 textContent 跨元素拼接造成数字粘连（F26171 + 23,100円 → 2,617,123,100） |
| 2026-05-27 | 落札商品重复同步浪费性能 | `/api/plugin/orders/sync` 改为增量同步：从最新往老遍历，碰到第一条已有订单就 break。新增 `tasks.force_orders_resync` 列 + 后台"落札商品更新"页面，支持批量标记强制刷新 |
| 2026-05-28 | 起拍价无法出价 | 修改提交校验：最高价的税前价 >= 商品目前的税前价即可提交（支持起拍价出价）。修改前要求 > 当前价，导致起拍价商品无法出价 |
| 2026-05-28 | 后台订单管理字段不全 | 订单管理增加：用户名、运费（4种形式）、银行手续费(日元)、手续费(RMB)。应付款公式改为：(落札金额 + 运费 + 银行手续费) * 汇率 + 手续费(RMB) |
| 2026-05-28 | 后台菜单无法折叠，移动端体验差 | 后台布局增加菜单折叠功能，参考 YouTube 样式，点击左上角三横线图标可展开/收起侧边栏。折叠时宽度 50px，只显示菜单第一个字（任/用/服/系/清/运/落/订），适配移动端查看。去除菜单滚动条，界面更简洁 |
| 2026-05-28 | 用户端缺少近 30 天落札统计 | 新增 `/stats` 统计页面和 `/api/task/won-stats`，展示每日落札税后总金额柱状图，支持手机点击/PC hover 查看每日数量，并支持 CSV 导出商品id、商品名称、落札价、运费、落札时间 |
| 2026-05-28 | 用户端菜单和提交页状态卡片不够简洁 | 用户端去掉“任务列表”菜单，菜单改为“提交任务、入札中、落札商品、统计页面”；提交页统计卡片去掉“执行中”，保留其他 6 个卡片 |
| 2026-05-28 | 只有即決没有普通出价的商品会走错普通出价流程 | `proxy.js` 解析 `bidButtonGroup`，仅存在“今すぐ落札”且没有普通入札按钮时返回 `buyoutOnly=true`；提交页自动勾选并锁定即決、最高出价锁定为即決价；服务端收到 `buyout_only=true` 时强制 `bid_mode=buyout`；插件测试覆盖“今すぐ落札 → 落札する”链路 |
| 2026-05-28 | 订单管理缺少大金额费用和特殊用户单独参数 | 订单管理新增“大金额费用”，默认 0，仅税后落札金额 >= 30,000円 时计入；公式改为 `(落札金额 + 运费 + 银行手续费) * 汇率 + 手续费 + 大金额费用`。新增“特殊用户设置”页面，可按用户覆盖汇率调节、银行手续费、手续费(RMB)、大金额费用 |
| 2026-05-29 | Yahoo 入札失败弹窗可能卡住插件队列 | `content.js` 识别 `入札に失敗しました / オークションにアクセスできませんでした` 并返回失败关闭 tab；`background.js` 增加 30 秒任务级超时，tab 长时间无响应时自动关闭并标记 failed，避免 `isRunning` 一直占住导致后续任务无法执行 |
| 2026-05-30 | 缺少商品类型字段和历史补齐入口 | 新增 `tasks.product_type`，服务端按价格后 `（税0円）/（税込）` 判断普通/商城商品；用户端商品卡片显示商品类型；后台新增“商品类型更新”，支持按商品 ID 批量补齐 |
| 2026-05-30 | 后台订单管理商品类型不直观，商品 ID 易换行 | 订单管理商品 ID 后增加类型标识：红色 `商`、绿色 `普`、缺失 `-`；表格启用横向滚动并设置数据不换行 |
| 2026-05-30 | 落札商品更新说明误写会覆盖运费 | 后台“落札商品更新”说明改为“也会重新覆盖（落札价、落札时间）” |
| 2026-05-31 | 后台批处理菜单分散 | “运费更新 / 商品类型更新 / 落札商品更新”合并为“数据批处理”，页面顶部 Tabs 切换 3 个功能 |
| 2026-05-31 | 订单结算状态文案混用 | 订单管理勾选后点击“结算”改为 `pending_settlement`，显示“待结算”；`pending_payment` 继续保留为“待支付”供其他流程使用 |
| 2026-05-31 | 用户端列表分页和同商品多任务展示混乱 | 用户端“入札中”“落札商品”改为每页 10 条；同商品多次提交时，策略、最高价、运费等展示字段取最后提交的任务 |
| 2026-05-31 | 多次出价超最高价可能停留在已出价 | `current_price > max_price` 自动失败规则扩展到 `bidding + multi_bid`，避免已出价多次出价任务卡住 |
| 2026-05-31 | 多次出价最低加价规则不符合 Yahoo 阶梯 | 最低加价改为 Yahoo 阶梯：`<5000=100`、`5000-9999=250`、`10000-49999=500`、`>=50000=1000` |
| 2026-05-31 | 30 秒超时错误乱码导致显示系统原因 | 插件超时错误改为英文 `Task execution timeout after 30s; task tab closed`；旧乱码超时也归类为“失败：响应超时” |
| 2026-06-08 | 出价失败后即时落札兜底可能误把关联商品写成成功订单 | 插件出价执行报错时不再立即打开 `/my/won` 做 `confirmWonBeforeFail` 兜底，失败直接标记 `failed`；后续空闲落札同步只抽取同一商品容器内存在 `取引連絡` 链接的记录，避免页面底部推荐/关联商品被误同步为落札订单 |
| 2026-06-08 | 后台订单管理商品信息和运费显示不够直观 | 商品 ID 后新增“商品名称”（前 20 字，多余 `...`）和“落札时间”；移除单独“同捆运费”列，有同捆运费时在“运费”列显示 `原运费->同捆运费`，如 `780円->0円` |
| 2026-06-09 | `落札者負担` 商品抓取过慢 | 商品页已能构造 Yahoo shipment API URL 时最多只尝试一次 shipment API；如果未返回有效金额，直接保留页面解析到的 `落札者負担`，不再继续 Playwright 重复兜底 |
| 2026-06-09 | 点击 `取引連絡` 后出现 Chrome/Google PIN 浮层导致交易开始卡住 | PIN 页检测支持 `login.yahoo.co.jp/config/login?auth_lv=1...`；PIN 输入改为优先通过 Chrome debugger 发送真实数字键事件；验证码页继续人工录入日文并点击 `続ける`，正确后自动复用上次 PIN 完成二次 PIN |
| 2026-06-09 | 用户端显示网站汇率数值 | 提交页不再展示 `网站汇率` 数值或加载文案；汇率仍保留为内部人民币辅助出价换算和可用性判断使用 |
| 2026-06-09 | 商城即決商品 `q1175609593` 失败显示“低于当前价” | 即決不是最高价出价，而是按页面固定价格点击购买/落札；buyout 任务的价格字段仅用于展示/记录，不再参与 `current_price > max_price` 或税后合计金额高于用户最高价等普通出价失败判断 |
| 2026-06-09 | 商城购买确认页误点 PayPay `特典を確認する` 导致广告页反复打开 | 后台付款流程和即決购买流程都改为只从真正可点击元素中匹配完整文本严格等于 `確認する` 的按钮/链接，优先 `<a>確認する</a>`；`q1175609593` 走的是 `content.js` 即決购买流程，广告链接完整文本是 `特典を確認する`，不再因相似文案被误点 |
| 2026-06-09 | 商城即決最终确认弹窗反复点击前一页 `確認する` 导致超时 | `確認する` 精确匹配只用于购买内容确认页；最终弹窗 `購入を確定する` 作为 buyout 最终提交按钮单独识别，点击一次后等待 `購入が完了しました / ご購入ありがとうございます` 等完成文案，不再递归回去重复点前一页按钮 |
| 2026-06-09 | 商城即決最终确认按钮被重复提交 | 后台 pending final 二次检查等待从 3 秒改为 10 秒；`content.js` 对 buyout 最终 `上記に同意のうえ購入を確定する` 加同页幂等保护，点过一次后只等待完成结果，后续检查不再重复点击同一个最终购买按钮 |
| 2026-06-09 | 商城即決最终弹窗按钮完整文案不是单独 `購入を確定する` | `content.js` 新增专用 `findBuyoutFinalPurchaseButton()`，最终弹窗只从可点击元素中匹配包含 `購入を確定する` 的提交按钮；前一页 `確認する` 仍只由购买内容确认页专用逻辑处理，普通即決 `落札する` 兜底保留 |
| 2026-06-09 | 商城即決成功页 `/order/thank-you` 未识别导致显示“失败：系统原因”且 tab 不关闭 | `content.js` 把 `/order/thank-you` 明确识别为 buyout 成功页；真实页文案为 `購入が完了しました！`，识别成功后后台会按正常成功流程关闭任务 tab |
| 2026-06-09 | 商城即決无同捆勾选框时自动付款完成但订单应付款未计算 | 最终不新增自动付款标记；该类订单按商城正常流程空状态→待支付→结算→待结算→支付，支付页若已付款会以 `already_paid/success` 更新为 `pending_shipment`（待发货）。关键修正是商城 `落札者負担` 允许按 0 运费结算 |
| 2026-06-09 | 待发货订单结算后误进入支付流程风险 | 支付入口继续只允许 `pending_settlement` 且有应付款的订单；后台支付请求接口如果没有命中任何 `pending_settlement` 订单，不再写 `payment_requested=1`，避免待发货订单误触发付款任务 |
| 2026-06-09 | 后台批处理订单状态更新缺少“待发货” | “数据批处理 / 订单状态更新”下拉新增 `待发货`，后端 `order-status-refresh` 白名单允许 `pending_shipment`，用于手动修正已付款的商城即決订单 |
| 2026-06-09 | 商城即決待发货订单运费 `落札者負担` 导致不能勾选结算 | 后台结算规则增加商城例外：`product_type=store` 且运费文本为 `落札者負担` 时允许结算，并按 0 运费计算；普通商品仍不允许用 `落札者負担` 结算 |
| 2026-06-09 | 插件 JS 中存在不可恢复乱码字符 | 清理 `background.js` 中已坏掉的 `�/锟斤拷` 字符串，改为英文稳定错误/日志和 `\u5186`；新增 `yahoo-plugin/encoding.test.js`，扫描 `content.js/background.js`，发现 `�` 或 `锟斤拷` 立即失败，避免后续继续混入不可恢复乱码 |
| 2026-06-09 | 普通付款页未点击 `確認する` 就关闭，提示 `payment expected amount unavailable` | 根因不是 PayPay `特典を確認する` 广告按钮，而是付款前金额校验遇到无金额运费文本时直接失败。业务规则确认：`無料`、`着払い` 对所有商品都按 0 运费计算；`落札者負担` 只作为商城商品特殊规则按 0 运费计算。确认商品 `x1232305352` 是 `着払い`，插件付款校验已对齐该规则。新增截图场景测试，确认 PayPay 特典金额 `51,000円` 不会覆盖真实付款合计 `56,000円` |
| 2026-06-14 | 普通商品付款最终确认后停留 `ただいま決済処理中です` 中间页时，15 秒内未跳完成页会关闭 tab 并报支付失败 | 将最终付款确认后的完成页等待上限从 15 秒调整为 60 秒；等待仍是轮询式，若第 20 秒识别到 `購入が完了しました` 会立即成功并关闭 tab，不会等满 60 秒。订单状态处理逻辑暂不改变 |
| 2026-06-09 | 需要导入服务器 Chrome 手动落札订单 | 后台新增独立菜单“导入订单”，位置在“数据批处理”下方；页面支持默认昨天到今天、最多翻页默认 10、创建读取批次、候选订单可搜索选择归属用户、确认后写入 `tasks/status=success` 和 `orders/order_status=NULL`。插件在 D 扫描流程最前面优先执行导入批次，从 `/my/won` 最新列表翻页到日期范围之外或达到最大页数，补商品页快照运费/商品类型；正式导入后自动置 `transaction_start_requested=1`，后续从现有交易开始流程继续 |
| 2026-06-10 | 服务器上累积多个 Yahoo/Chrome PIN 窗口，且过期 PIN 页输入无动作 | `background.js` 把 `login.yahoo.co.jp/config/login?auth_lv=1...` 纳入 PIN 页识别；空闲非出价任务开始前如果已有 PIN 页，会暂停入札/落札/交易/扫描/付款/收货等 idle 流程，只保留一个 PIN tab 并关闭重复 PIN tab，出价任务仍按原轮询优先执行；后台提交 PIN 后，插件会先刷新 PIN 页、等待约 2 秒，再通过 Chrome debugger 发送数字键，避免超时错误页吞掉输入 |
| 2026-06-10 | PIN 页刷新后没有填入后台输入的 PIN | 后台提交 PIN 后仍会先刷新 PIN 页并等待约 2 秒；PIN 输入统一由 Chrome debugger 处理，后续已调整为真实键盘优先，避免刷新后的 Chrome PIN 浮层不接收普通脚本输入 |
| 2026-06-10 | PIN 成功后进入验证码，验证码后又出现新 PIN 页导致反复要求输入 PIN | 手动验证跳转不再只盯当前 tab；验证码/PIN 提交后会扫描本轮新开的 Yahoo 验证 tab，并优先切到新 PIN tab。若同一轮已有后台 PIN，会继续复用该 PIN 处理验证码后的二次 PIN，不再把它当成新的独立 PIN 挑战 |
| 2026-06-10 | 验证码阶段没有 PIN tab，空闲任务又打开新的 PIN 页造成循环 | 新增手动验证流程锁：只要出现 PIN 或验证码 tab，就标记 `manualVerificationFlowActive`；在 PIN/验证码整轮流程结束、没有任何验证 tab 前，所有入札/落札/交易/扫描/付款/收货等非出价 idle 任务都暂停，避免验证码页面期间重新触发新的 PIN |
| 2026-06-10 | Chrome 密码管理工具 PIN 浮层不接收 `Input.insertText` | PIN 输入改为默认模拟真实键盘：每个数字通过 Chrome debugger 发送 `rawKeyDown -> char -> keyUp`；`Input.insertText` 只作为真实键盘失败或页面仍停留 PIN 时的备用路径 |
| 2026-06-10 | Chrome debugger 真实键盘事件仍无法输入 Google 密码管理工具 PIN 浮层 | 新增服务端系统级输入接口 `POST /api/plugin/manual-pin/type`，由 Windows API Server 调用 `powershell.exe -STA` 执行 Win32 鼠标/键盘事件：先点击 PIN 输入区域，再用 `keybd_event` 逐位输入数字；插件刷新并激活 PIN tab 后优先调用该接口，失败时才退回 Chrome debugger 输入 |
| 2026-06-10 | PIN tab 打开但不一定在最前台，系统级输入可能发错窗口 | PIN 系统级输入前，插件会把 PIN tab 所在 Chrome 窗口恢复为 normal 并聚焦，再将目标 tab 设为 active/highlighted，短等后再次聚焦窗口，并把当前 tab 标题传给服务端用于优先激活正确 Chrome 窗口 |
| 2026-06-10 | PIN 输入失败时可能空 PIN 直接回车导致 Yahoo passkey 登录失败 | 服务端系统级 PIN 输入不再发送 Enter，也不再使用 `SendKeys.SendWait($pin)`；改为点击 PIN 框后只逐位模拟数字键，让 Chrome PIN 浮层自行校验，避免“未输入数字但回车提交空 PIN” |
| 2026-06-10 | PIN 输入成功进入验证码后立刻又回到 PIN 页 | 修复验证跳转选择优先级：如果当前 tab 已经是 `login.yahoo.co.jp/ncaptcha` 验证码页，即使旁边还有旧的 active PIN tab，也继续停留并处理当前验证码；只有新开的 PIN tab 才优先用于验证码通过后的二次 PIN |
| 2026-06-10 | 到达文字验证码页后 tab 被关闭，又重新打开新的 PIN 页 | `closeTabsForTransactionFlow()` / `closeTabsForScanFlow()` 清理交易/扫描临时 tab 时会二次读取 tab URL，跳过 `PIN/文字验证码` 手动验证 tab；即使验证码 tab 已记录在 `_gdaipaiCreatedTabIds` 中，也不再被 finally 清理关闭 |
| 2026-06-10 | 验证码页保留后仍新开 PIN，后台继续要求输入 PIN | 空闲入口发现已打开 `login.yahoo.co.jp/ncaptcha` 时，不再只暂停或优先处理 PIN；会激活验证码 tab 并调用 `handleManualVerificationIfPresent()` 截图提交 `type=captcha` 挑战到后台，覆盖旧 PIN 提示，同时阻断后续非出价 idle 任务继续打开新 PIN |
| 2026-06-10 | 验证码页出现后数分钟内后台仍停留 PIN 提示 | `syncIdleYahooPages()` 先处理已打开的 PIN/验证码 tab，再检查 `lastIdleSyncAt` 空闲同步间隔；手动验证不再被 idle 间隔节流挡住，避免验证码页已存在但插件不截图、不覆盖后台 PIN 提示 |
| 2026-06-10 | 后台菜单和订单参数位置需要调整 | 后台“用户账号管理”和“服务器账号”合并为“账号管理”，页面用 Tabs 展示两个功能；手机底部菜单改为单行横向滚动；订单管理顶部银行手续费/手续费/大金额费用参数移动到“特殊用户设置”页顶部，保存接口和功能不变 |
| 2026-06-10 | 付款失败后台提醒过长 | `/api/plugin/payment/status` 保存 `payment_alert_message` 前会摘要化错误，只保留商品 ID 和核心原因；过滤 `url/controls/candidates/synthetic/trusted` 等调试字段。类似 `action=review; wait=payment next page did not appear` 会显示为 `确认付款后页面未跳转`，便于手机端查看 |
| 2026-06-10 | 商品 `j1232680017` 付款点击确认后仍停留在 review 页 | 根因是 review 页存在 `ストアからの確認事項`，需要先点该区块右侧 `変更`，在编辑页把所有 checkbox 勾选后点击红色 `変更する` 返回 review 页，再继续点击右侧 `確認する`。插件付款流程已在 review 确认前增加该前置步骤，每个订单本轮只处理一次，避免重复进入确认事项页面 |
| 2026-06-10 | 店铺确认事项按钮按文本/区块扫描仍可能找不到或 JS click 不生效 | 根据真实 DOM 固定优先使用 `#cartopt a[data-cl-params*="_cl_link:cartopt"]` 点击 review 页 `変更`，使用 `#confirm a[data-cl-params*="_cl_link:update"]` 点击确认事项页红色 `変更する`；如果普通 JS click 后未进入下一页/未返回 review，会用 Chrome debugger 按元素中心点补一次真实鼠标点击，避免页面迅速关闭前实际没有完成变更 |
| 2026-06-10 | 店铺确认事项页面仍快速关闭，疑似未实际点击 `変更` | 店铺确认事项改为 Chrome debugger 真实鼠标点击优先：先按 `#cartopt` 的 `変更` 中心点真实点击进入编辑页；编辑页先只勾选所有 checkbox，不再先 JS 点击提交，再按 `#confirm` 的 `変更する` 中心点真实点击。若该子流程失败，本轮付款 tab 暂不关闭，便于现场观察停留页面；后台失败原因也按店铺确认事项细分显示 |
| 2026-06-10 | 店铺确认事项 review 页停留，`変更` 没进入编辑页 | 付款页状态识别新增 DOM 标记：`#cartopt` 直接判定存在店铺确认事项，`#confirm a[data-cl-params*="_cl_link:update"]` 判定编辑页。点击 `#cartopt` 后如果 15 秒未进入编辑页，会再执行一次主页面 DOM 点击同一按钮并继续等待，失败时保留 tab 并返回 `store confirmation edit page did not appear after trusted+js click` 方便定位 |
| 2026-06-10 | 查看源代码里没有 `変更`，说明按钮由 Yahoo 前端后渲染 | 模拟确认：源 HTML 只有 `ストアからの確認事項`，没有 `変更`；插件不能在 document complete 后立刻找按钮。店铺确认事项点击点现在会最多等待 15 秒，直到实时 DOM 出现 `#cartopt` 或标题 header/container 附近的 `変更` 后再点击；若状态里已有店铺确认事项，不再先要求识别到右侧 `確認する` |
| 2026-06-10 | 店铺确认事项 review 页 `変更` 按钮仍不稳定 | 不再依赖 review 页点击 `変更`；发现店铺确认事项后，插件直接按商品 ID 导航到 `https://buy.auctions.yahoo.co.jp/order/change/store-options?auctionId={productId}`。到变更页后等待 `#confirm a[data-cl-params*="_cl_link:update"]`，勾选所有 checkbox，再点击红色 `変更する` 返回付款确认页 |
| 2026-06-10 | 店铺确认事项变更页已打开但 checkbox 没有被勾选 | 变更页 checkbox/`変更する` 也是 Yahoo 前端后渲染；插件现在会等待最多 15 秒直到至少出现 1 个 `input[type="checkbox"]` 和提交按钮。不再要求 checkbox input 本身可见，隐藏 input 也会处理：点击 label/容器和 input，使用原生 checked setter 设置为 true，并派发 `input/change` 事件，覆盖 React 受控组件场景 |
| 2026-06-10 | 店铺确认事项 checkbox 已勾选但没有提交 `変更する` | 变更页提交改为 DOM 提交优先：勾选后直接对 `#confirm a[data-cl-params*="_cl_link:update"]` 执行 focus、mouse、click 和 Enter 键事件，并以返回 review/下一步页面作为成功条件；如果未返回，再用 Chrome debugger 真实鼠标点击按钮中心点兜底 |
| 2026-06-10 | 店铺确认事项页面一出现就勾选，Yahoo 前端状态未初始化导致提交仍认为未选择 | 变更页处理拆成只读等待、勾选、延迟、提交 4 步：先等 `document.readyState=complete`、checkbox/`変更する`/页面文本稳定且无骨架加载约 1.8 秒，再触发 checkbox；若 checkbox 已视觉选中，会先重置再最终选中，避免 DOM checked 与 React 内部状态不一致。勾选后等待 1.2 秒再单独点击 `変更する` |
| 2026-06-10 | 店铺确认事项 checkbox 视觉勾选但按钮仍不可提交，手工取消再勾选可提交 | checkbox 勾选改为 Chrome debugger 真实鼠标点击：读取每个 `input[type="checkbox"]`/label 的屏幕坐标后发送 `mouseMoved/mousePressed/mouseReleased`。若 checkbox 已显示选中，会先真实点击取消再真实点击选中，强制 Yahoo 前端收到与人工操作一致的交互事件；JS 设置 checked 仅保留为 debugger 不可用时兜底 |
| 2026-06-10 | 后台订单管理需要跨页自动选中和 CSV 导出 | 订单管理表格复选框不再限制状态，结算/支付状态检查延后到按钮点击时处理；首次勾选订单时按该订单用户跨页选中 `won_at` 从昨天到今天的所有订单，并缓存跨页订单数据。新增导出 CSV，字段为落札日期、用户名、商品链接、商品标题、落札价、运费、总价；导出只看原始 `shipping_fee_text`，遇到 `落札者負担/着払い` 弹窗输入本次导出运费，不写数据库且不使用同捆运费 |
| 2026-06-10 | 用户端管理员/代理切换用户下拉不支持搜索 | `src/client/src/components/UserNav.jsx` 将原 `Picker` 切换为 `Popup + SearchBar + List`，点击“当前账号”后弹出可搜索用户列表，按用户名和用户等级过滤；选中后继续复用原 `acting-user-change`、localStorage 和页面刷新逻辑 |
| 2026-06-11 | 后台订单管理同捆商品缺少组背景色 | 订单管理表格按 `bundle_group_id` 给同捆商品行标浅色背景；同一组保持同色，当前页相邻同捆组在两种浅色间交替，便于和 Google 表格一样区分同捆组 |
| 2026-06-11 | 系统配置中初始化订单状态入口风险较高，Google 表格页签名不可配置 | 后台“系统配置 / 交易开始任务”彻底取消“初始化订单状态”功能：前端按钮和后端 `/api/admin/transaction-start/reset-orders` 接口均移除。Google 表格配置新增“Google工作表名称”，保存到 `config.google_sheets_sheet_name`，后端追加/查找 Google 表格时优先使用该配置，未配置时继续兼容 `GOOGLE_SHEETS_SHEET_NAME` 和默认 `-代拍表-` |
| 2026-06-11 | 后续开发计划重新确认 | 生产环境暂未发现 `/my/won` 落札同步、默认信用卡付款、交易 tab 关闭问题；出价/查询 worker 隔离和批处理危险操作收口先保留以后讨论。PIN/验证码仍待继续处理：当前进入验证码页面后没有把验证码图片返回后台，并且还会再次打开 PIN 页面。待收货补表格页面说明不再写死 `-代拍表-`，改为读取当前 Google 工作表名称配置 |
| 2026-06-11 | 增加自动化回归入口 | 根目录新增 `npm run regression` / `npm run test:regression`，串行执行 Google Sheets 配置测试、后台订单测试、插件路由测试、Yahoo 插件 content/background/encoding 测试，以及后台和用户端生产构建，用于发布前确认现有流程没有被改坏 |
| 2026-06-11 | 导入订单点击“读取落札商品”报 `invalid config key` | 根因是早期实现会在 `createManualOrderImportBatch()` 创建批次后写 `scan_idle_counter=999` 以便插件优先执行导入扫描，但 `saveConfigValue()` 白名单只允许付款相关 key。已放行导入流程需要的配置 key；后续导入改为独立 idle 调度优先级后，不再写 `scan_idle_counter=999`，避免订单管理显示扫描计数异常 |
| 2026-06-11 | 导入订单等待插件读取但扫描 Flag 增加后仍未执行 | 导入读取从“普通 scan action 内优先执行”提升为后端 idle 调度优先级：只要存在 `manual_order_import_batches.status='requested'` 的批次，`/api/plugin/idle-action/next` 就直接返回 `scan` action，且优先于交易开始、扫描时间窗口和扫描计数；现有插件收到 scan 后仍按原逻辑先执行导入，导入无任务才执行普通扫描。创建导入批次不再修改普通扫描计数 |
| 2026-06-11 | 后台订单管理缺少导入任务状态可视化 | `/api/admin/idle-flags` 新增返回手动导入批次计数：待读取 `requested`、读取中 `scanning`、待确认 `ready`；订单管理顶部状态条在“扫描计数”后显示“导入flag：待读取 x，读取中 y，待确认 z”，便于判断导入是否已被插件领取 |
| 2026-06-11 | 导入订单读取失败 `normalizeVisibleText is not defined` | 根因是 `content.js` 的 `findWonHistoryNextPageUrl()` 使用 `normalizeVisibleText()` 判断 `/my/won` 下一页链接，但该 helper 只定义在 `extractOrderHistory()` 局部作用域内；导入扫描调用 `extractOrderHistory()` 后继续调用翻页函数时抛 ReferenceError。已将 `normalizeVisibleText()` 提升为 content 顶层共享函数，并新增测试覆盖落札历史下一页链接提取 |
| 2026-06-11 | 订单管理手机端结算汇率输入框换行 | 订单管理顶部操作区手机端将“本次结算汇率”和输入框包成 `admin-orders-rate-row` 两列布局，保持同一行显示；结算、支付、导出按钮仍保持手机端全宽纵向排列 |
| 2026-06-11 | 导入订单归属用户下拉 PC/手机显示不一致 | 手动导入订单页归属用户下拉对齐代拍账号切换样式：第一行用户名、第二行 `普通用户/代理用户`；不显示管理员用户，也不显示 `等级N`。确认导入后 `orders.order_status` 继续写 `NULL` 空状态，后端额外校验禁止将导入订单分配给管理员等级用户 |
| 2026-06-11 | 导入订单完成后仍自动刷新且无候选显示“待确认/待分配用户” | 导入页自动刷新改为只在 `requested/scanning` 时运行，完成后“刷新”仅作为手动按钮；`ready + candidate_count=0` 显示“读取完成（无新订单）”，禁用确认导入并提示跳过已存在数量。订单管理导入 flag 将 `ready` 拆为“待确认”和“已完成无新订单”，避免无候选批次继续显示待确认。验证：`node src/admin/src/manualOrderImportState.test.js`、`node src/server/routes/admin.orders.test.js`、`cd src/admin && npm run build` |
| 2026-06-11 | 导入订单 flag 和候选列表职责混淆 | 业务规则重新确认：`导入flag` 只表示插件读取队列是否还有任务，点击“读取落札商品”后为 `1`，插件把候选数据读取完成后恢复 `0`；候选列表的分配用户/填写运费/确认导入属于后续人工处理，不再影响导入队列 flag。订单管理顶部只显示 `导入flag：0/1`。确认导入时只导入已分配用户的候选订单，未分配候选直接跳过，不再阻断整批；候选运费可在导入页表格内编辑并随导入保存。验证：`node src/admin/src/manualOrderImportState.test.js`、`node src/server/routes/admin.orders.test.js`、`cd src/admin && npm run build` |
| 2026-06-11 | 导入订单运费输入框显示范围过宽，刷新按钮含义不清 | 导入页待处理候选只有原始运费为 `落札者負担` 或 `着払い` 时显示运费输入框，固定金额/免费等明确运费只展示文本，不再允许编辑；按钮文案改为“刷新当前列表”，功能仅为重新拉取当前批次状态和候选列表，不会重新创建读取队列或重新扫描 Yahoo。验证：`node src/admin/src/manualOrderImportState.test.js`、`node src/server/routes/admin.orders.test.js`、`cd src/admin && npm run build` |

---

## 2026-06-10 PIN 窗口处理修复

### 已实现内容

- `isLikelyManualPinTab()` 现在识别 `login.yahoo.co.jp/config/login?auth_lv=1&done=...`，避免图 3 这类 PIN 页被全局扫描漏掉。
- `syncIdleYahooPages()` 在执行任何空闲非出价工作前先检查已打开的 PIN tab；发现 PIN tab 时暂停本轮 idle 工作，并关闭重复 PIN tab，只保留一个窗口供后台输入 PIN。
- `handleManualVerificationIfPresent()` 拿到后台 PIN 后，先刷新当前 PIN 页并等待约 2 秒，再调用 debugger 输入逻辑，避免图 1 的“请求已超时”页面无法接收 PIN。
- PIN 输入路径默认模拟真实键盘，每个数字发送 `rawKeyDown -> char -> keyUp`；若真实键盘发送失败或短时间内仍停留在 PIN 页，再用 `Input.insertText` 作为备用，不依赖后台再次提交。
- 验证码/PIN 提交后的跳转会扫描同一轮新开的 Yahoo 验证 tab；如果验证码后出现新的 PIN tab，插件会切过去并复用本轮已有 PIN，避免后台反复弹新的 PIN 输入要求。
- 空闲非出价任务入口现在使用 `manualVerificationFlowActive` 流程锁；只要当前仍有 PIN 或验证码 tab，就不再执行新的 idle action，直到整轮手动验证流程结束。
- Chrome 密码管理工具 PIN 浮层属于浏览器级安全 UI，Chrome debugger 键盘事件可能无法穿透；插件现在优先调用 API Server 的系统级 Win32 输入。生产要求 API Server 与服务器 Chrome 运行在同一 Windows 交互桌面会话中，否则系统级鼠标/键盘事件无法投递到 Chrome。
- 系统级 PIN 输入前会强制前置目标 Chrome 窗口和 PIN tab：`windows.update({ focused: true, state: 'normal' })` + `tabs.update({ active: true, highlighted: true })`，并把当前 tab 标题传给服务端优先匹配窗口。
- 服务端 `manual-pin/type` 脚本会激活目标 Chrome 窗口，点击 PIN 输入区域，使用 Win32 `keybd_event` 逐位输入 PIN 数字；不发送 Enter，避免空输入直接提交导致 passkey 登录失败。
- `findManualVerificationTransitionTab()` 现在区分“新开的 PIN”和“旧 active PIN”：验证码通过后新开 PIN 仍会优先处理；但当前 tab 已经进入验证码时，不会被旧 PIN tab 抢回。
- 交易/扫描/付款 finally 清理 tab 时，手动验证页不再按普通 Yahoo 登录 tab 关闭；关闭前会通过 `chrome.tabs.get(id)` 再确认当前 URL，若是 `login.yahoo.co.jp/ncaptcha` 或 PIN 页则保留，避免验证码页被关掉后重新触发 PIN。
- 空闲入口发现验证码 tab 时会优先进入验证码处理，发后台 `type=captcha` 图片挑战并等待人工输入；只有没有验证码 tab 时才保留单个 PIN tab 并暂停其他非出价任务。
- PIN/验证码检查顺序高于 `lastIdleSyncAt` 空闲同步节流；即使刚执行过一次 idle，同一轮出现验证码也会立即提交后台图片。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
node yahoo-plugin\encoding.test.js
PowerShell 只解析不执行 `buildWindowsSendKeysScript()` 生成脚本
```

## 2026-06-08 落札误同步修复

### 已实现内容

- 插件出价执行报错后不再调用 `confirmWonBeforeFail()` 立即打开 `/my/won` 兜底确认；失败直接写入 `failed`，便于从失败原因排查真实出价问题。
- `/my/won` 落札同步抽取时，只接受同一商品容器内存在 `取引連絡` 链接的记录；页面底部推荐商品、关联商品、最近落札推荐等没有 `取引連絡` 的商品链接会被跳过。
- 后台“数据批处理”新增 `删除商品数据` Tab，接口为 `POST /api/admin/product-data-delete/run`。
- 删除范围：输入商品 ID 对应的 `tasks`、`orders`、`bid_logs`、`order_status_change_logs`、`bidding_items`；用于清理误同步造成的假成功任务/订单。

### 最近验证命令

```powershell
node yahoo-plugin\encoding.test.js
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```

---

## 当前风险 / 待做

| 优先级 | 事项 | 说明 |
|--------|------|------|
| 🔴 紧急 | 生产 Yahoo 落札页价格抽取需要实测 | 需确认实际 `/my/won` DOM 不会抽到错误容器或其他金额 |
| 🟡 中期 | 查询 worker 与出价 worker 隔离 | 当前已使用出价并行池、监控同步、订单工作流三条执行线；后续如查询订单操作变重，可考虑同一插件不同角色，或两个 Chrome Profile 分别负责出价/查询 |
| 🟡 中期 | 落札后实际运费更新 | 当前运费只来自商品提交时的服务端解析，落札后“落札者負担”更新为实际金额的逻辑尚未开发 |
| 🟡 中期 | 多次出价完整生产验证 | 需真实 Yahoo 登录态和临近结束商品测试 |
| 🟡 中期 | 订单管理页面完善 | Admin Orders 已有基础列表，业务流程未完整 |
| 🟢 低 | Yahoo 账号池管理 | 表和 UI 有雏形，实际调度仍主要依赖 Chrome 登录态 |

---

## 验证命令

常用回归：

```powershell
node src\server\routes\task.test.js
node src\server\routes\plugin.test.js
node src\server\routes\proxy.test.js
node src\server\routes\admin.orders.test.js
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
Set-Location ..\admin
npm run build
```

---

## 服务器更新命令

生产服务器项目目录通常为 `C:\www\g-daipai`：

```powershell
Set-Location C:\www\g-daipai
git fetch origin
git reset --keep origin/master
git rev-parse --short HEAD
git status --short
```

服务端代码、前端构建或插件代码更新后：

- API Server 需要按当前部署方式重启。
- 前端如使用构建产物，需要重新 build/发布。
- Chrome 插件代码更新后，需要在 Chrome 扩展页重载插件。

---

## 关键路径

- **插件目录**: `D:/www/g-daipai/yahoo-plugin/`
- **客户端目录**: `D:/www/g-daipai/src/client/`
- **API 服务**: `D:/www/g-daipai/src/server/index.js`
- **数据库**: `D:/www/g-daipai/data/gdaipai.db`
- **Schema**: `D:/www/g-daipai/src/db/init.sql`
- **后台数据批处理**: `D:/www/g-daipai/src/admin/src/DataBatch.tsx`
- **后台导入订单**: `D:/www/g-daipai/src/admin/src/ManualOrderImport.tsx`
- **后台运费更新 Tab**: `D:/www/g-daipai/src/admin/src/ShippingRefresh.tsx`
- **后台商品类型更新 Tab**: `D:/www/g-daipai/src/admin/src/ProductTypeRefresh.tsx`
- **后台落札商品更新 Tab**: `D:/www/g-daipai/src/admin/src/OrdersResync.tsx`
- **后台删除商品数据 Tab**: `D:/www/g-daipai/src/admin/src/ProductDataDelete.tsx`
- **服务端商品/运费解析**: `D:/www/g-daipai/src/server/routes/proxy.js`
- **插件调度/空闲同步**: `D:/www/g-daipai/yahoo-plugin/background.js`
- **Spec**: `D:/www/g-daipai/docs/superpowers/specs/2026-05-11-yahoo-auction-proxy-v2-design.md`

---

## 清理记录

- ✅ `/api/proxy/cache` — 已删除；插件不再向服务端写商品缓存
- ✅ `src/server/routes/product.js` — 已删除（旧 Playwright 代理接口）
- ✅ `docs/superpowers/plans/2026-05-11-yahoo-auction-proxy-plan.md` — 已删除
- ✅ `docs/superpowers/specs/2026-05-11-yahoo-auction-proxy-design.md` — 已删除
- ✅ `src/worker/` — 已删除

---

## 2026-06-01 交易开始功能当前进度

> 注意：本节为后续接手排查用。当前 `agents.md` 文件在终端中可能显示为乱码，但本节内容以当前需求为准。

### 当前状态

- 分支：`codex/transaction-start`。
- 已新增交易开始相关设计文档：`docs/superpowers/specs/2026-06-01-yahoo-transaction-start-design.md`。
- 已新增实施计划：`docs/superpowers/plans/2026-06-01-yahoo-transaction-start-plan.md`。
- 交易开始已按 2026-06-05 业务确认重新开启：`yahoo-plugin/background.js` 中 `TRANSACTION_START_ENABLED` 生产默认开启。
- 已在本地数据库把当天自动交易开始标记关闭：`transaction_start_requested=0`，`transaction_start_last_run_date=当天`。
- 停用原因：真实 Yahoo 页面测试时交易开始流程仍存在 tab 跟踪和按钮点击问题，继续运行会反复打开 Yahoo tab。

### 已实现内容

- `orders` 新增兼容字段：`transaction_url`、`bundle_group_id`、`transaction_started_at`、`transaction_start_error`。
- `/my/won` 落札同步尝试抽取每个商品的 `取引連絡` 链接，保存到 `orders.transaction_url`。
- 后台配置页已改为“入札、落札、交易开始、扫描、付款、收货配置”。
- 后台新增“手动执行交易开始”按钮：`POST /api/admin/transaction-start/request`。
- 后台曾新增“初始化订单状态”按钮；2026-06-11 已彻底取消该功能，前端按钮和后端 `/api/admin/transaction-start/reset-orders` 接口均已移除。
- 后台订单管理页新增 `交易开始flag`、`扫描flag`、`交易开始错误`，并显示新状态 `等待运费`、`待同捆`。
- 插件空闲同步流程已预留交易开始、扫描、付款、确认收货；扫描/付款/确认收货尚未实现。

### 业务规则确认

- “初操作”和“交易开始”是同一个业务名称，后续统一使用“交易开始”。
- 交易开始只处理 `orders.order_status` 为空的落札订单。
- 商城商品：不用打开 Yahoo 取引页，直接 `pending_payment`（待支付）。
- 普通商品：必须先进入 `取引連絡` 页面判断是否同捆。
- 普通商品如果没有同捆：
  - 运费不是 `落札者負担`：订单状态改为 `pending_payment`（待支付），关闭 tab。
  - 运费是 `落札者負担`：订单状态改为 `waiting_shipping`（等待运费），关闭 tab。
- 普通商品如果有同捆：
  - 关闭 Yahoo 同捆提示弹窗。
  - 抽取同捆列表商品 ID。
  - 用页面 `X件（落札数量：X）` 校验抽取数量。
  - 点击 `まとめて取引を依頼する` 或 `まとめて取引をはじめる`。
  - 到确认页点击 `決定する`。
  - 看到完成文案后，把同组所有订单标为 `pending_bundle`（待同捆）并写同一个 `bundle_group_id`。
  - 标记待同捆应发生在完成文案确认后、关闭 tab 前。

### 当前真实测试问题

真实 Yahoo 页面上仍有未解决问题：

1. 普通未同捆商品进入 `取引連絡` 后，状态能变化但 tab 没有可靠关闭。
2. 同捆商品页面点击 `閉じる` 后停在“まとめて取引”图1页面。
3. `まとめて取引を依頼する` 按钮页面 HTML 中存在类似 `まとめて取引を依頼する</button>`，但插件点击逻辑仍没有稳定触发跳转。
4. 曾出现重复开 tab；目前已尝试通过记录新增 tab 和关闭本次流程 tab 缓解，但未在真实页面确认完全可靠。
5. 曾出现 `bundle decide button not found`，原因推测是 `まとめて取引を依頼する` 点击后 Yahoo 新开/切到确认页 tab，而 background 仍在旧 tab 找 `決定する`。
6. `/my/won` 按商品 ID 找 `取引連絡` 时需要避免匹配到外层大容器，否则可能点错商品。

### 下一步计划

交易开始重新启用前，建议先做诊断版，不要继续盲改点击逻辑：

1. 旧计划要求保持 `TRANSACTION_START_ENABLED = false`；2026-06-05 已按最新业务确认改为生产默认开启，后续如再遇到真实页面异常再临时熔断。
2. 增加单商品诊断接口/按钮，只对指定商品 ID 执行一次交易开始，且不循环处理全部订单。
3. 在 `content.js` 的图1页面输出诊断信息：候选按钮数量、`tagName`、`textContent`、`value`、`disabled`、`href`、`onclick`、`role`、`getBoundingClientRect()`、点击前后 URL、点击前后 tab 数量。
4. 点击 `まとめて取引を依頼する` 后，background 必须确认当前 tab URL 是否变化、是否新开 tab、新 tab 是否为确认页、确认页是否存在 `決定する`。
5. 普通非同捆商品状态更新后，必须关闭本次流程创建或打开的所有 Yahoo 交易相关 tab。
6. 同捆流程失败时，应把同组商品加入本轮 processed 集合，避免同一组反复打开。
7. 2026-06-05 已把 `TRANSACTION_START_ENABLED` 恢复为生产默认开启。

### 最近验证命令

以下命令在当前改动过程中曾通过：

```powershell
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
Set-Location src\admin
npm run build
```

---

## 2026-06-02 扫描功能当前进度

### 当前状态

- 分支：直接在 `master` 开发；之前临时分支已清理，只保留 `master` / `origin/master`。
- 扫描任务复用现有空闲调度 `action: 'scan'`，后台“手动执行扫描”只把扫描 flag 更新为 5，不改变原调度架构。
- 不再新增或修改计划文件；后续功能直接按确认后的业务规则实现代码。

### 已实现内容

- `orders` 新增兼容字段：`bundle_shipping_fee_text`，用于同捆运费。
- 后台订单管理新增“同捆运费”列，仅后台展示；用户端和其他费用计算仍使用原 `shipping_fee_text`。
- 后台订单状态新增显示：
  - `waiting_shipping`：等待运费
  - `pending_bundle`：待同捆
  - `bundle_completed`：同捆完了
- `scan` 任务现在会获取：
  - `waiting_shipping`（等待运费）
  - `pending_bundle`（待同捆）
- `waiting_shipping` 扫描规则：
  - 只从 `支払い金額` 的括号内容里提取 `送料：xxx円`，不能取括号前总金额。
  - 有真实送料时，更新订单运费并改为 `pending_payment`。
  - 如果页面仍显示 `送料決定後、確定します。`，保持 `waiting_shipping` 不变。
- `pending_bundle` 扫描规则：
  - 页面显示 `まとめて取引を依頼中です。出品者からの連絡をお待ちください。`：不更新，关闭 tab。
  - 子商品弹窗 `出品者が、この商品を含めたまとめて取引に同意しました。取引内容をご確認ください。`：不更新，关闭 tab。
  - 主商品弹窗 `出品者がまとめて取引に同意しました。出品者から配送方法の連絡が届いています。確認し取引情報の入力へ進んでください。`：先点 `閉じる` 后继续判断。
  - 如果页面显示配送方法金额，如 `配送方法 定形郵便（110円）`：主商品 `bundle_shipping_fee_text=110円` 且 `order_status=pending_payment`；同组其他商品 `bundle_shipping_fee_text=0円` 且 `order_status=bundle_completed`。
  - 如果取引ナビ付款信息显示 `支払い金額 ... 送料：1,620円`：按同捆主商品处理，提取 `送料` 的金额，不取总金额。
  - 如果没有具体运费，会点击 `取引情報を入力する` -> `決定する` -> `確定する`；最终仍是 `送料決定後、確定します。` 时，保持 `pending_bundle` 不变。
  - 如果弹窗显示卖家希望单品交易：同组所有订单清空 `order_status`、`bundle_group_id`、`bundle_shipping_fee_text`，让后续交易开始按单品重新处理。

### 最近修复

- 同捆主商品成功后 tab 残留的根因不是完全没写关闭，而是原关闭范围只包含当前 `tab.id` 和已记录的 `_gdaipaiCreatedTabIds`；Yahoo 流程中新开/切换但未被记录的交易页可能漏关。
- 已新增扫描专用清理：扫描开始前记录已有 tab，结束时关闭本次扫描中新出现的 Yahoo 交易相关 tab。
- 主商品成功或同捆失败后，本轮扫描会跳过同一个 `bundle_group_id` 的剩余旧 job，避免同组子商品在本轮继续打开页面。

### 最近验证命令

以下命令在当前扫描改动过程中通过：

```powershell
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node src\server\routes\task.test.js
node src\server\routes\proxy.test.js
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\admin
npm run build
Set-Location ..\client
npm run build
```

---

## 2026-06-03 付款功能当前进度

### 当前状态

- 分支：`codex/payment-automation`。
- 已实现付款框架：后台结算/支付入口、全局付款 flag、付款提醒栏、付款配置、服务端付款队列、插件空闲调度付款分支。
- Yahoo 付款页面具体点击和成功/已结款 DOM 判断处于安全暂停状态，等待真实页面图片和 HTML 后补充。

### 已实现规则

- 结算自动勾选 `pending_payment` 和 `bundle_completed`。
- `pending_payment` 结算后进入 `pending_settlement`。
- `bundle_completed` 结算后保持 `bundle_completed`，不进入付款流程。
- 结算金额优先使用 `bundle_shipping_fee_text`，否则使用 `shipping_fee_text`。
- 特殊用户费用覆盖逻辑保持不变。
- 支付按钮只允许 `pending_settlement` 且应付款不为空的订单。
- `payment_requested=1` 时插件才执行付款队列。
- 本批成功后 flag 保持 1；直到没有剩余 `pending_settlement` 且应付款不为空的订单时才清 0。
- 付款失败时只显示全局提醒并暂停 flag，订单保持 `pending_settlement`。

---

## 2026-06-04 普通商品付款细节当前进度

### 当前状态

- 已按真实页面截图补充普通商品付款点击流程。
- 普通商品付款已实现；商城商品付款细节已在 2026-06-05 根据截图补充。
- 插件代码更新后，生产服务器 Chrome 扩展必须手动重载 `yahoo-plugin/` 才会生效。

### 已实现规则

- 打开订单 `transaction_url` 后先判断是否已支付。
- 页面出现 `出品者に支払い完了の連絡をしました。商品の発送連絡をお待ちください。` 时，按已支付处理，订单状态改为 `pending_shipment`（待发货），关闭 tab。
- 普通商品入口支持三种页面类型；其中前两种不需要前置操作，第三种需要先输入取引情報：
  - `Yahoo!かんたん決済で支払う`
  - `購入手続きする`
  - `取引情報を入力する` -> `決定する` -> 弹窗 `確定する`，完成后回到 `Yahoo!かんたん決済で支払う` 页面，再进入相同支付步骤。
- 进入购买手续页后，点击右侧订单金额下方 `確認する`。
- 点击前会校验页面显示支付金额是否等于 `final_price + effectiveShippingFeeText`；不一致则失败，不继续付款。
- 进入确认页后，点击 `上記に同意のうえ 購入を確定する` / `購入を確定する`。
- 最终确认页先按后台 `payment_page_stay_seconds` 取 `1-X` 秒随机停留，再点击最终确认。
- 完成页出现 `購入が完了しました！` 时，订单状态改为 `pending_shipment`，关闭 tab。
- 出现任何未知页面、金额不一致或按钮缺失，均按失败处理：写付款提醒栏、`payment_requested=0`、关闭 tab；处理中页只作为中间页继续等待完成页。

### 最近验证命令

以下命令在当前普通商品付款改动过程中通过：

```powershell
node yahoo-plugin\background.test.js
node yahoo-plugin\content.test.js
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node src\server\routes\task.test.js
node src\server\routes\proxy.test.js
node src\client\src\utils\bidPrice.test.mjs
```

---

## 2026-06-04 用户策略权限当前进度

### 当前状态

- 后台“用户账号管理”新增“可用出价策略”选项。
- 用户端提交任务页会按当前操作账号权限限制策略选择。
- 服务端 `/api/task/submit` 增加兜底校验，防止绕过前端直接提交不允许的策略。

### 已实现规则

- `users.bid_strategy_scope` 新增兼容字段，默认 `all`。
- 后台可选：
  - `全部都可以拍`：允许即时拍、多次出价、结束前 1/2/5/10 分钟。
  - `只能即时拍`：仅允许 `direct` 即时拍；即決模式也按即时拍处理。
- 前台登录用户等级为管理员（`user_level=3`）时不受被代拍用户策略限制；例如管理员选择只能即时拍的用户 A 代拍，仍可提交全部策略。
- `/api/auth/acting-users` 返回当前可操作账号的 `bid_strategy_scope`。
- 用户端账号切换时保存当前账号策略权限。
- 用户端提交页：
  - `只能即时拍` 用户只显示 `即时拍（立即）`。
  - 如果当前策略已是其他策略，会自动切回 `direct`。
  - 提交时再次检查，避免旧状态提交。
- 服务端提交页：
  - `direct_only` 用户提交 `multi_bid` 或结束前策略会返回 `403` 和 `该用户只能使用即时拍策略`。

### 最近验证命令

以下命令在当前策略权限改动过程中通过：

```powershell
node src\server\routes\task.test.js
node src\server\routes\admin.orders.test.js
node src\server\routes\plugin.test.js
node src\server\routes\proxy.test.js
node yahoo-plugin\background.test.js
node yahoo-plugin\content.test.js
Set-Location src\admin
npm run build
Set-Location ..\client
npm run build
```

---

## 2026-06-04 即时拍误判商品已结束排查

### 问题现象

- 生产服务器出现同一商品两条即时拍任务：
  - 较早提交任务显示 `失败：商品已结束`。
  - 稍后重新提交的同商品任务正常进入 `已出价`。
- 本地没有该生产数据，无法直接查询原始 `tasks.error_msg/end_time`。

### 排查结论

- 前台 `失败：商品已结束` 有两个来源：
  - 服务端 `expireOverduePendingTasks()` 写入 `Auction ended before plugin execution`。
  - 插件打开商品页后，`ensureTaskReadyByCurrentEndTime()` 根据商品页快照 `snapshot.endTime` 判断已结束。
- 同商品后续即时拍可以再次提交是当前规则允许的：`direct` 即时拍不属于“禁止重复提交”的自动策略；失败任务不会阻止后续重新提交。
- 本次代码中发现一个可导致误判的风险：`content.js` 的商品快照结束时间提取最后会从整页 body 文本抓第一个日期。Yahoo 页面若先出现出品日期、广告日期或其他非结束日期，插件可能把该日期当作结束时间，从而把任务标记为商品已结束。

### 已修复内容

- `yahoo-plugin/content.js`：
  - 商品快照 `endTime` 只接受明确结束时间来源：`endDate` meta、JSON-LD `priceValidUntil`、`time[datetime]`、`data-end-time`、结束时间相关节点里的完整日期。
  - 删除整页 body 第一个日期兜底，避免把非结束日期当成结束时间。
- `yahoo-plugin/background.js`：
  - 插件根据商品页快照判定已结束时，错误信息改为稳定英文 `Auction ended according to product page snapshot`，便于后续和服务端过期扫描区分。
  - 当时按前置要求保持 `TRANSACTION_START_ENABLED = false`；2026-06-05 已按最新业务确认恢复为生产默认开启。
- `yahoo-plugin/content.test.js`：
  - 新增测试：body 中普通日期不得作为 `endTime`。
  - 新增测试：明确 meta 结束时间仍可正常提取。

### 生产排查建议

如需确认截图中那条失败任务的真实来源，在生产服务器执行：

```powershell
Set-Location C:\www\g-daipai
@'
const db = require('./src/server/models');
const rows = db.db.prepare(`
  SELECT id, user_id, product_id, current_price, max_price, strategy, status,
         error_msg, end_time, created_at, updated_at
  FROM tasks
  WHERE product_id = 'r1232049114'
  ORDER BY id ASC
`).all();
console.log(JSON.stringify(rows, null, 2));
'@ | node
```

### 最近验证命令

以下命令在当前修复中通过：

```powershell
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
```

---

## 2026-06-04 统计页面金额口径修正

### 当前规则

- 用户端“统计页面”的近 30 天合计金额和每日柱状图金额，直接汇总 `orders.final_price`。
- `orders.final_price` 是 Yahoo 落札页抓取的最终落札金额；商城商品落札金额已是最终金额，不再按 `tax_included` 额外乘 `1.1`。
- 统计金额不包含运费、银行手续费、手续费 RMB、大金额费用，也不使用订单管理页的应付款。

### 已修复内容

- `/api/task/won-stats` 每日金额 SQL 从按 `t.tax_type = 'tax_included'` 额外乘 `1.1`，改为 `SUM(COALESCE(o.final_price, 0))`。
- 更新 `src/server/routes/task.test.js`，明确统计 SQL 不应包含 `tax_included` 或 `final_price * 1.1`。

### 最近验证命令

```powershell
node src\server\routes\task.test.js
node src\client\src\utils\wonStats.test.mjs
```

---

## 2026-06-05 商城订单空状态排查与修复

### 问题现象

- 生产截图显示后台订单中有 3 个商城商品（商品 ID 后红色 `商`），但 `订单状态` 为空，没有自动变成 `待支付`。
- 顶部状态显示：`交易开始flag: 0`，`扫描计数: 4 / 5`，`最近执行：自动 2026-06-04 00:00:45，取到 2 单，商城直接待支付 0 单，插件任务 2 单`。
- 表格里的 `最后操作时间` 是订单落札同步/更新订单的时间，不等于交易开始执行时间。

### 根因结论

- 商城商品变为 `pending_payment` 的逻辑在服务端 `/api/plugin/transaction-start/jobs` 内执行。
- 之前 `yahoo-plugin/background.js` 中 `TRANSACTION_START_ENABLED = false` 时，插件遇到 `idleAction.action === 'transaction_start'` 会完全跳过交易开始 jobs 接口。
- 这会导致普通商品真实 Yahoo 交易开始被安全停用的同时，商城商品的“服务端直接待支付”也被一起跳过。
- 扫描任务只处理 `waiting_shipping` 和 `pending_bundle`，不会处理 `order_status` 为空的商城订单，所以扫描计数到 5 也不会让这些商城订单变状态。

### 已修复内容

- 按最新业务确认，`TRANSACTION_START_ENABLED` 生产默认已改为开启：普通商品交易开始和商城商品直达待支付都会执行。
- 当空闲 action 为 `transaction_start` 时，插件会调用 `/api/plugin/transaction-start/jobs`；商城订单由服务端直接更新为 `pending_payment`，普通商品 jobs 由插件打开 Yahoo 取引页执行。
- 保留测试注入关闭普通交易开始的能力：`runTransactionStartJobs({ processNormalJobs: false })` 只刷新服务端商城状态，不打开普通商品交易 tab，用于以后需要临时熔断普通交易开始时保护商城订单。
- 新增插件回归测试：
  - `runTransactionStartJobs({ processNormalJobs: false })` 会请求 jobs 接口，但不会打开交易 tab。
  - 空闲调度遇到 `transaction_start` 且普通交易开始关闭时，仍会请求 jobs 接口并完成该 idle action。

### 生产处理注意事项

- 部署本次插件代码后，必须在服务器 Chrome 扩展页手动重载 `yahoo-plugin/`。
- 重载后可点击后台“手动执行交易开始”的“加入执行队列”，下一次插件空闲同步会处理空状态订单：商城直接改为 `待支付`，普通商品进入 Yahoo 交易开始流程。
- 自动执行也会在次日交易开始整点后处理前一天晚于上次交易开始同步到 `orders` 的订单。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
```

---

## 2026-06-05 用户端商品拍卖次数抓取

### 已实现内容

- 用户端提交任务页获取 Yahoo 商品信息时，服务端现在会解析商品拍卖次数 / 入札件数：
  - 优先读取 `pageData.items.bids`、`bidCount`、`bid_count` 等结构化字段。
  - 其次识别 Yahoo 页面链接文本里的 `0<!-- -->件</a>` / `12件</a>` 这类入札履历数量。
- `/api/proxy/fetch` 返回 `bidCount`。
- 提交任务页商品卡片在“当前合计金额”下一行显示小锤子图标 + `拍卖次数：X件`，0 次也会正常显示。
- `/api/task/submit` 保存 `bid_count` 到 `tasks.bid_count`；历史数据库启动时会自动补齐该列。
- 用户端提交最高价校验已按拍卖次数更新：
  - `bid_count=0`：最高价的税前价只需 `>= 当前税前价`，支持无人出价商品按起拍价提交。
  - `bid_count>0`：最高价的税前价必须 `>= 当前税前价 + Yahoo 最低加价`。
  - Yahoo 最低加价阶梯：`<5000=100`、`5000-9999=250`、`10000-49999=500`、`>=50000=1000`。
  - 示例：当前税前 `5500円` 且已有出价时，最低加价 `250円`，最低提交最高价为 `5750円`。
- 服务端 `/api/task/submit` 也增加同样兜底校验，防止绕过前端直接提交低于 Yahoo 最低加价的价格。

### 最近验证命令

```powershell
node src\server\routes\proxy.test.js
node src\server\routes\task.test.js
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
```

---

## 2026-06-09 取引連絡 PIN 与文字验证码处理

### 已实现内容

- 点击 `取引連絡` 后如果跳到 `login.yahoo.co.jp/config/login?auth_lv=1...`，插件会识别为 Yahoo/Chrome PIN 验证页，即使页面 DOM 里没有可操作输入框也会提醒后台输入 PIN。
- PIN 输入不再只依赖网页 input；优先通过 Chrome debugger 向当前 tab 发送真实数字键事件，适配 Google 密码管理器 PIN 浮层“直接键盘输入数字”的场景。
- PIN 输入后短轮询页面跳转；如果没进入验证码页或交易页，会再次提醒后台输入 PIN，并显示“上次 PIN 码可能错误，请重新输入 PIN 码”。
- 文字验证码页保持人工处理：后台显示截图，人工输入图中日文后，插件填入蓝色 `続ける` 按钮上方输入框并点击 `続ける`。
- 验证码通过后如果再次回到 PIN 页，插件自动复用上次成功输入的 PIN，再次键盘输入，完成后继续原 `取引連絡` 流程。
- 后台人工验证提示现在会显示插件传来的 `message`，用于展示 PIN 错误重试提示。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
Set-Location src\admin
npm run build
```

---

## 2026-06-08 用户端网站汇率与人民币辅助出价

### 已实现内容

- 新增用户端接口 `GET /api/task/website-rate`，从中国银行外汇牌价页面抓取 `日元` 的 `现汇卖出价`，按 `现汇卖出价 / 100 + 0.002` 计算网站汇率，并四舍五入保留 4 位小数。
- 网站汇率只保存在服务端内存缓存中，缓存 3 小时，不写入数据库，不复用后台订单结算汇率，也不影响订单应付款公式。
- 用户端提交页加载时会先读本地 `localStorage` 的网站汇率缓存；本地缓存缺失或过期时，静默请求 API。日元模式始终可用，汇率失败只影响人民币辅助输入。
- 提交页 `最高出价` 增加 `日元 / 人民币` 切换，默认日元；人民币模式下按 `Math.floor(人民币 / 网站汇率)` 转为日元后再走原有提交逻辑。
- 人民币只用于页面换算和展示，提交给 `/api/task/submit` 的仍是日元 `max_price`，后续任务、插件出价、落札同步、订单结算都不感知人民币。
- 个人商品也新增 `实际出价` 展示；人民币模式示例：`实际出价：100人民币 ≈2,247日元`。商城税前价会显示含税后的人民币和日元，例如 `实际出价：110人民币 ≈2,472日元`。
- 2026-06-09 追加调整：用户端不再展示 `网站汇率` 数值、加载文案或相关字样；汇率继续静默获取并仅作为人民币辅助出价换算和按钮可用性判断使用。
- 新增设计文档：`docs/superpowers/specs/2026-06-08-website-bid-rate-design.md`。
- 新增实施计划：`docs/superpowers/plans/2026-06-08-website-bid-rate.md`。

### 最近验证命令

```powershell
node src\server\routes\task.test.js
node src\client\src\utils\bidPrice.test.mjs
node src\client\src\pages\Submit.display.test.mjs
Set-Location src\client
npm run build
```

---

## 2026-06-05 付款任务随机化与等待点调整

### 业务规则确认

- 后台 `付款流程执行任务数` 改为范围配置：最小 X 到最大 X 个，例如 `2-5`。
- `payment_requested=1` 时，服务端每次从该范围内随机取一个整数作为本批付款任务数量，例如 `2/3/4/5`，再按落札时间顺序取对应数量的 `pending_settlement` 订单。
- `付款页面停留时间(秒)` 含义改为最大停留秒数 X。
- 插件进入最终确认页（存在 `上記に同意のうえ 購入を確定する` / `購入を確定する`）后，先随机停留 `1-X` 秒，再点击最终确认按钮；不允许 0 秒。
- 点击最终确认后出现 `ただいま決済処理中です。しばらくお待ちください。` 属于中间页，插件继续等待完成页，不按失败处理。
- 看到 `購入が完了しました！` 等完成文案后，订单状态改为 `pending_shipment`，关闭 tab。

### 已修复内容

- `src/admin/src/MultiBidSettings.tsx`：
  - 付款任务数改成 `paymentJobLimitMin` / `paymentJobLimitMax` 两个输入。
  - 付款页面停留时间最小值保持 `1` 秒。
- `src/server/routes/admin.js`：
  - 后台配置接口读写 `payment_job_limit_min` / `payment_job_limit_max`，并继续写 `payment_job_limit` 作为旧配置兼容。
  - 校验最小任务数不得大于最大任务数。
- `src/server/routes/plugin.js`：
  - `/api/plugin/payment/jobs` 按配置范围随机生成本批 limit，并返回 `limitMin/limitMax/limit`。
  - 未配置新字段时，继续用旧 `payment_job_limit` 作为固定数量。
- `yahoo-plugin/background.js`：
  - 最终确认页点击前随机等待 `1-X` 秒。
  - 图3处理中页不再作为失败状态，等待后续完成页。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node yahoo-plugin\background.test.js
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```

---

## 2026-06-05 后台付款提醒栏商品 ID 链接

### 已修复内容

- 后台顶部付款提醒栏（`payment_alert_message`）中的商品 ID 现在会渲染为可点击链接。
- 链接目标为 `https://auctions.yahoo.co.jp/jp/auction/{商品ID}`，点击后新窗口打开 Yahoo 商品页。
- 支持 `商品ID p123456789` 或提醒文本中出现的拍卖 ID 自动识别。

### 最近验证命令

```powershell
Set-Location src\admin
npm run build
```

---

## 2026-06-05 商城商品付款流程补充

### 业务规则确认

- 商城商品付款不再禁用。
- 付款任务打开商城商品 `取引連絡` / `transaction_url` 后，如果进入 `buy.auctions.yahoo.co.jp/order/status?...` 页面并出现红色 `購入手続きする`，插件点击该按钮。
- 点击 `購入手続きする` 后，后续进入普通商品付款步骤 A，继续复用普通商品付款流程；如果先出现 `Yahoo!かんたん決済で支払う`，会继续点击该入口，再进入确认金额 -> `確認する` -> `購入を確定する` -> 等待完成页。
- `購入が完了しました！` 是付款成功页面，普通商品和商城商品都适用；订单状态改为 `pending_shipment`（待发货），关闭 tab。
- 商城状态页出现 `ご購入ありがとうございます。商品の発送連絡をお待ちください。`，表示之前已经付款；订单状态改为 `pending_shipment`（待发货），关闭 tab。

### 已修复内容

- `yahoo-plugin/background.js` 移除 `productType=store` 付款禁用逻辑。
- 付款页面状态解析抽出为 `buildPaymentPageStateFromSnapshot`，便于覆盖真实截图文案。
- 成功识别补充：
  - `購入が完了しました！` -> `complete=true`
  - `ご購入ありがとうございます。商品の発送連絡をお待ちください。` -> `alreadyPaid=true`
- 商城入口 `購入手続きする` 使用现有 `purchaseProcedure` 点击动作；付款入口链支持连续处理 `購入手続きする` -> `Yahoo!かんたん決済で支払う` -> `確認する`。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
```

---

## 2026-06-05 付款页確認する按钮延迟加载修复

### 问题现象

- 付款任务进入 `購入手続き` 页面后，右侧订单金额下方红色 `確認する` 按钮有时因为 Yahoo 网络或页面脚本加载慢，短时间内还没有渲染出来。
- 旧逻辑在当前页面快照里没有 `hasReviewButton` 时会直接报错，导致付款任务卡在该页面并失败。

### 已修复内容

- `yahoo-plugin/background.js` 新增当前付款页状态等待逻辑：同一 tab 最多等待 15 秒，每 0.5 秒重新读取一次付款页状态。
- 当付款页已打开但 `確認する` 尚未出现时，插件会等待按钮加载完成后再点击，不再立即报 `payment entry button not found` / `payment review button not found`。
- 保持后续流程不变：点击 `確認する` 后进入最终确认页，再按后台配置随机等待 `1-X` 秒后点击 `購入を確定する`。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```

---

## 2026-06-08 商城同捆已付款补录

### 已实现内容

- 后台订单管理新增隐藏入口：双击 `订单状态` 单元格，可打开 `商城同捆已付款补录` 弹窗；页面不新增显眼按钮。
- 2026-06-08 追加修复：订单状态内容本身也绑定双击事件，并且非商城商品双击会提示“商城商品才支持同捆补录”，避免表格单元格事件没有触发时表现为无响应。
- 弹窗字段：
  - 主商品ID：默认使用当前双击订单商品 ID。
  - 子商品ID：支持全角逗号 `，` 和半角逗号 `,` 分隔。
  - 同捆运费：整数日元。
- 新增接口 `POST /api/admin/orders/store-bundle-backfill`。
- 补录结果：
  - 主商品 `order_status = pending_shipment`（待发货），`bundle_shipping_fee_text = 输入运费`。
  - 子商品 `order_status = bundle_completed`（同捆完了），`bundle_shipping_fee_text = 0円`。
  - 全组写入同一个新的 `bundle_group_id`。
- 校验规则：
  - 主商品和子商品都必须存在落札订单，且必须是商城商品。
  - 主商品不能同时作为子商品。
  - 不限制同一用户；不同用户同捆允许。
  - 拒绝 `completed`、`cancelled`、`pending_receipt` 状态订单。
- 状态日志 source 使用 `admin_store_bundle_backfill`，后台状态来源显示为 `商城同捆补录`。
- 新增设计文档：`docs/superpowers/specs/2026-06-08-store-bundle-backfill-design.md`。

### 最近验证命令

```powershell
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```

---

## 2026-06-06 同捆扫描输入按钮未点击修复

### 问题现象

- 商品 `s1113817953` 是同捆主商品，本地数据库仍为 `pending_bundle`，同组商品也仍为 `pending_bundle`。
- `/api/plugin/scan/jobs` 能取到该商品，并且该商品排在扫描队列第一位，说明问题不是服务端没有下发扫描任务。
- 订单没有 `order_status_change_logs`，说明插件没有成功回写 `bundle_shipping_fee_text` 或同捆状态变化。

### 根因判断

- 用户提供的真实 HTML 显示按钮为 `<a class="libBtnBlueL" ...>取引情報を入力する</a>`。
- 该页面同时可能包含 `出品者がまとめて取引に同意しました` 和 `出品者から配送方法の連絡が届いています` 文案，旧识别会优先返回 `main_agreed`。
- `main_agreed` 分支会先尝试点击 `閉じる`；但该 HTML 是页面内普通按钮，不是弹窗，没有 `閉じる`，所以流程直接退出，没有继续点击 `取引情報を入力する`。
- 该失败只写入 Chrome 扩展 console，不会写入数据库，因此后台看不到错误字段。

### 已修复内容

- `yahoo-plugin/content.js`：如果页面已经存在可点击的 `取引情報を入力する`，优先返回 `input_required`，不再先走 `main_agreed -> 閉じる`。
- `yahoo-plugin/content.js` / `background.js`：放宽 `取引情報を入力する` 按钮识别，允许中间有空白，并兼容 `role=button`、`onclick`、`tabindex`、`data-cl-params` 等 Yahoo 可点击容器。
- `yahoo-plugin/content.js` / `background.js`：保留同捆后续 `決定する / 確認する` 兼容。
- 新增回归测试：基于 `s1113817953` 页面 HTML，存在 `<a class="libBtnBlueL">取引情報を入力する</a>` 时必须识别为 `input_required` 并点击该链接。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
```

---

## 2026-06-06 交易信息输入后置き配 OK 弹窗处理

### 业务规则确认

- 点击 `取引情報を入力する` 后，Yahoo 可能弹出 `置き配場所（玄関前）が初期設定されました` 窗口。
- 该窗口不只出现在同捆商品，普通商品等其他交易信息输入流程也可能出现。
- 如果弹出该窗口，需要先点击 `OK`，再继续后面的 `決定する / 確認する / 確定する` 或付款流程。
- 如果不弹出，保持原流程不变。

### 已修复内容

- `yahoo-plugin/content.js`：新增 `detectPlacementDefaultModal()`，识别 `置き配場所...初期設定されました` + `OK` 按钮。
- `yahoo-plugin/content.js`：同捆/交易动作新增 `placementOk`，可点击弹窗中的 `OK`。
- `yahoo-plugin/background.js`：同捆扫描点击 `取引情報を入力する` 后，如果先出现 `canPlacementOk`，会先点 `OK`，再继续后续操作。
- `yahoo-plugin/background.js`：普通交易开始的 `completeBidderPaysShippingTransaction()` 也会先处理 `OK` 弹窗。
- `yahoo-plugin/background.js`：付款流程 `completePaymentTransactionInfoInput()` 点击 `取引情報を入力する` 后，也会处理 `OK` 弹窗，覆盖非同捆商品。
- 新增回归测试覆盖 content 侧弹窗识别/点击，以及付款流程 `transactionInfoInput -> placementOk -> transactionDecide`。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
```

---

## 2026-06-06 用户端商城税后出价最低加价修正

### 问题现象

- 商城商品选择 `税后价` 出价时，最低可出价提示里的当前价已经按税后价显示，但最低加价仍使用 Yahoo 税前加价。
- 示例：税前当前价 `4,500円`、税后当前价 `4,950円` 时，旧提示为 `当前税后价4,950円+最低加价100円=最低5,050円`。

### 业务规则确认

- 商城商品选择 `税前价`：最低加价保持 Yahoo 税前阶梯，例如 `4,500円 + 100円 = 4,600円`。
- 商城商品选择 `税后价`：最低加价也要按税后口径显示，即税前最低加价 `* 1.1`，例如 `4,950円 + 110円 = 5,060円`。

### 已修复内容

- `src/client/src/utils/bidPrice.js`：`getMinimumBidInputRequirement()` 在商城 `tax_after` 模式下，将展示用最低加价转换为税后口径。
- `src/client/src/utils/bidPrice.test.mjs`：新增 `currentPrice=4500`、`tax_after` 时 `increment=110`、`requiredPrice=5060` 的回归测试，并更新 `5000` 税前当前价对应的税后加价预期为 `275`。

### 最近验证命令

```powershell
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
```

---

## 2026-06-06 商城商品同捆付款单品处理

### 业务规则确认

- 付款流程中，商城商品即使页面提示可同捆购买，也不走本系统普通商品同捆逻辑。
- 商城商品同捆付款按一般商城商品单品付款处理，不写同捆运费、不改同捆订单状态。
- 图1普通商城付款页：点击红色 `購入手続きする`，进入后续普通商品支付步骤 A。
- 图2商城同捆提示页：如果有弹出框，先点击 `閉じる`；然后不要点红色 `まとめて購入手続きする`，必须点击下面的 `単品で購入手続きする`，再进入后续普通商品支付步骤 A。

### 已修复内容

- `yahoo-plugin/background.js`：付款页状态新增 `hasStoreBundlePurchaseNotice`、`hasPaymentCloseButton`、`hasSinglePurchaseProcedureButton`。
- `yahoo-plugin/background.js`：进入付款流程后，如果检测到商城同捆购买提示弹窗，先点击 `閉じる`。
- `yahoo-plugin/background.js`：付款入口按钮优先级改为 `単品で購入手続きする` > `Yahoo!かんたん決済で支払う` > `購入手続きする`，避免误点红色 `まとめて購入手続きする`。
- 新增回归测试覆盖商城同捆付款页动作顺序：`paymentClose -> singlePurchaseProcedure -> review -> finalize`。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```

---

## 2026-06-06 待发货扫描发货后追加 Google 代拍表

### 业务规则确认

- 扫描流程中，`待发货(pending_shipment)` 商品发现已发货后，订单状态更新为 `待收货(pending_receipt)`，同时追加 Google 表格。
- 表格地址：`https://docs.google.com/spreadsheets/d/1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4/edit?gid=0#gid=0`。
- 操作页签：`-代拍表-`。
- 追加字段顺序：
  - `落札日期`
  - `用户名`
  - `商品链接`
  - `商品标题`
  - `落札价`
  - `运费`
  - `同捆运费`
  - `总价`
  - `应付款`
  - `订单状态`
- 普通商品总价：`落札价 + 运费`。
- 同捆商品总价：`落札价 + 同捆运费`。
- 有同捆运费的商品组，需要把同组商品连续插入，并给整组商品行设置背景色；不同同捆组按组 ID 使用不同浅色，便于区分。

### 实现说明

- `src/server/models/index.js` 新增兼容列 `orders.google_sheet_appended_at`，用于防止扫描重试重复追加。
- `src/server/services/googleSheets.js` 新增 Google Sheets API 客户端：
  - 默认 spreadsheet id：`1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4`
  - 默认 sheet name：`-代拍表-`
  - 支持环境变量：
    - `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON`
    - 或 `GOOGLE_APPLICATION_CREDENTIALS`
    - 或 `GOOGLE_SHEETS_CLIENT_EMAIL` + `GOOGLE_SHEETS_PRIVATE_KEY`
    - 可选覆盖：`GOOGLE_SHEETS_SPREADSHEET_ID`、`GOOGLE_SHEETS_SHEET_NAME`
- 注意：服务端 API 写表不能直接复用插件 Chrome 已登录的 Google cookie。需要把目标表格共享给服务账号邮箱；如果未配置 Google 凭据，扫描状态更新不受影响，但会跳过表格追加。
- `src/server/routes/plugin.js` 在 `scan_pending_shipment_shipped` 成功后调用表格追加：
  - 普通订单只追加当前订单。
  - 如果当前订单属于有 `bundle_shipping_fee_text` 的同捆组，则一次性取整组未追加订单，连续追加并标色。
  - 表格追加成功后写入 `google_sheet_appended_at`。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
```

---

## 2026-06-06 普通商品付款多运费选择修复

### 问题现象

- 商品 `u1231877298` 抓取商品信息时取到最低运费 `185円`。
- Yahoo 普通商品付款输入页存在多个配送方法时，页面默认选中的配送方法可能不是系统抓取的最低运费，例如默认 `230円`。
- 旧付款流程直接点击右侧 `確認する`，没有先确认配送方法是否与订单运费一致，导致付款金额可能按 Yahoo 默认运费继续。

### 已修复内容

- `yahoo-plugin/background.js` 的付款页状态读取新增 `shippingOptions` 和 `selectedShippingAmountJpy`，只从 `配送方法` 区域识别配送 radio，避免误选上方 `コンビニ / PayPay / 銀行振込` 等付款方式。
- 普通商品付款流程在点击 `確認する` 前新增 `ensurePaymentShippingOption()`：
  - 如果当前选中配送金额与订单 `effectiveShippingFeeText / shippingFeeText` 一致，继续原流程。
  - 如果不一致，并且页面存在相同金额的配送选项，则自动选中对应 radio，例如从默认 `230円` 切换到 `クリックポスト 185円`。
  - 切换后重新读取页面状态，再执行原有付款金额校验和后续 `確認する -> 購入を確定する` 流程。
- 新增回归测试覆盖付款页配送选项识别，以及“默认运费 230円、订单运费 185円”时需要触发切换的判断。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```

---

## 2026-06-06 用户端最低出价提示修复

### 已实现内容

- Yahoo 最低加价阶梯补充 `<1000円` 区间：当前税前价小于 `1000円` 时最低加价为 `10円`；`1000-4999円` 仍为 `100円`，其他区间不变。
- 用户端提交页最低可出价提示按商品和价格类型显示：
  - 普通商品：继续显示 `当前价 X円 + 最低加价 Y円`。
  - 商城商品 + 税前价：显示 `当前税前价 X円 + 最低加价 Y円`。
  - 商城商品 + 税后价：显示 `当前税后价 X円 + 最低加价 Y円`，最低金额按页面显示税后价计算。
- 最低可出价 Toast 文案改为等式表达，例如 `当前税后价5,500円+最低加价250円=最低5,750円`。
- 同步更新服务端任务提交兜底校验和插件多次出价阶梯，避免客户端、服务端、插件规则不一致。

### 最近验证命令

```powershell
node src\client\src\utils\bidPrice.test.mjs
node src\server\routes\task.test.js
node yahoo-plugin\content.test.js
Set-Location src\client
npm run build
```

---

## 2026-06-06 扫描待发货状态当前进度

### 已实现内容

- `scan` 任务新增第三类取单状态：`pending_shipment`（待发货），与原 `waiting_shipping`、`pending_bundle` 分开处理。
- `orders` 新增兼容字段：`shipping_company`，用于保存物流公司；继续复用已有 `tracking_number`、`shipped_at`。
- 待发货扫描进入订单 `取引連絡` 后识别：
  - 商城未发货：`ご購入ありがとうございます。商品の発送連絡をお待ちください。`，保持待发货并执行超期提醒判断。
  - 商城已发货：`商品が発送されました。到着までお待ちください。`，抽取物流和单号，订单改为 `pending_receipt`（待收货）。
  - 商城取消：页面含 `キャンセルされました`，订单改为 `cancelled`（取消）。
  - 普通未发货：`出品者に支払い完了の連絡をしました。商品の発送連絡をお待ちください。`，保持待发货并执行超期提醒判断。
  - 普通已发货：`出品者から商品発送の連絡がありました。到着したら、受け取り連絡をしてください。`，抽取物流和单号，订单改为 `pending_receipt`（待收货）。
- 单号判断：
  - 优先从页面/取引消息中抽取 12 位数字，支持中间用 `-` 或空格分隔。
  - 抽不到单号时，用 `出品者` 名称兜底；如 `出品者： asua（9986）` 保存为 `asua`。
- 待发货超期提醒：
  - 按进入 `pending_shipment` 的状态日志时间计算，超过 7 天开始提醒。
  - 每个订单每天生成一条独立提醒，提醒 ID 为 `订单ID + 超期天数`；关闭后当天同一条不再重复。
  - 未关闭的旧提醒会保留，第二天继续新增下一条提醒；发货或取消后自动关闭该订单未关闭提醒。
  - 后台顶部新增待发货提醒栏，每条提醒可单独关闭，商品 ID 可点击跳 Yahoo。
- 用户端落札商品：
  - `cancelled` 显示红色 `取消` 标签，整行淡粉色背景。
  - `pending_receipt` 显示 `待收货`，`pending_shipment` 显示 `待发货`。
  - 有物流时显示物流和追踪号。
- 后台订单管理新增 `待收货`、`取消` 状态标签，并显示物流列。

### 待补充

- 发货后追加 Google 表格的具体表格地址、字段和认证方式尚未提供，当前仅完成订单状态与物流信息入库。
- 普通商品取消页面文案后续补充后，需要把专用文案加入 `pending_shipment` 扫描识别；当前通用 `キャンセルされました` 已可覆盖常见取消页。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
node src\server\routes\plugin.test.js
node yahoo-plugin\background.test.js
node src\server\routes\admin.orders.test.js
Set-Location src\client
npm run build
Set-Location ..\admin
npm run build
```

---

## 2026-06-06 即決误报失败后的落札同步修复

### 问题现象

- 本地商品 `u1231877298` 为即決任务，插件返回 `Yahoo入札失败：オークションにアクセスできませんでした`，用户端显示“失败：系统原因”。
- 实际 Yahoo 落札列表已经有该商品，但后台“订单管理”一直没有出现。

### 根因

- `/api/plugin/orders/sync` 只匹配 `tasks.status IN ('bidding', 'success')`，失败任务即使出现在 Yahoo 落札页也会被跳过。
- 同步逻辑遇到第一条已存在订单会直接 `break`，如果某个误报失败但实际落札的商品排在已同步订单后面，也不会继续扫描到。

### 已修复内容

- 落札同步现在信任 Yahoo 落札页：匹配任务状态扩展为 `bidding/success/failed`，如果 Yahoo 已落札，会把失败任务纠正为 `success` 并创建/更新订单。
- 已存在订单只 `continue` 跳过，不再中断当前落札页遍历，避免漏掉后面的误报失败落札商品。
- 抽出 `syncYahooWonOrders()` 并增加回归测试，覆盖“已存在订单在前，failed 实际落札商品在后”的场景。
- 插件失败回写前新增二次确认：出价流程捕获失败后，会先打开 Yahoo 落札页执行一次 `/orders/sync`；如果同步结果显示有新增落札订单，则不再把任务标记为 `failed`。
- 本地数据库已用同一同步逻辑修复 `u1231877298`：任务改为 `success`，新增订单 `orders.id=15`，落札价 `350円`。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node yahoo-plugin\background.test.js
```

---

## 2026-06-06 同捆扫描主商品未点击修复

### 问题现象

- 商品 `s1113817953` 是同捆主商品，数据库状态为 `pending_bundle`，同组 `bundle_group_id=bundle-20260602-s1113817953`。
- `getScanJobs()` 能取到该订单，且它在同组中排第一；`scan_idle_counter` 已被清零，说明扫描任务近期执行过。
- 订单状态日志为空，表示插件打开页面后没有回写扫描结果，也没有完成主商品操作。

### 根因

- 原同捆扫描只在 `extractBundleScanResult()` 返回 `unknown` 时才会检查并点击 `取引情報を入力する`。
- 真实页面如果先匹配成 `waiting_agreement` 或 `shipping_pending`，即使页面上已经出现主商品可点击操作按钮，旧逻辑也会直接返回，不点击、不回写。

### 已修复内容

- 同捆扫描点击条件放宽：当扫描结果为 `unknown`、`waiting_agreement` 或 `shipping_pending` 时，只要页面状态检测到 `canInputTransaction=true`，就继续点击 `取引情報を入力する` -> `決定する` -> `確定する`。
- 补充识别文案：`出品者がまとめて取引に同意しました。配送方法を確認し取引情報を入力してください。` 代表需要我方继续操作，不是等待运费；扫描结果标记为 `input_required` 并进入 `取引情報を入力する` 后续流程。
- 新增 `shouldAttemptBundleInputAction()` 并加回归测试，覆盖 `waiting_agreement + canInputTransaction` 可继续主商品操作，`child_agreed` 仍不会误点。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node yahoo-plugin\content.test.js
```

---

## 2026-06-05 入札确认误点推荐商品修复

### 问题现象

- 服务器 Chrome 插件在 Yahoo 入札弹窗里已填入金额后，停在红色 `確認する` 弹窗，没有进入下一步确认页。
- 同时页面下方 `この商品も注目されています` 推荐区的多个商品被打开，表现为 1 秒内出现多个非任务商品 tab。
- 同一用户、同一商品、同一价格和策略可能出现不同失败：`低于当前价`、`yahoo登录失败`、`系统原因`。根因是插件执行时页面状态不同，而不是用户端缓存。

### 根因结论

- 入札流程里的按钮查找范围是整页，遇到弹窗和页面推荐区同时存在同名/相似确认控件时，可能优先命中弹窗外的可点击元素。
- 入札流程内部的 `clickElement` 只发送普通 mouse/click 事件；如果 Yahoo 的 `確認する` 是 submit 按钮或依赖 pointer/表单提交事件，普通 click 可能不稳定。
- `/api/plugin/task` 先返回任务、插件再 PATCH `processing`，旧逻辑 PATCH 时未要求任务仍处于可执行状态；如果服务器 Chrome 有重复插件实例、多个 profile 或重复轮询，同一任务可能被并发执行，放大“短时间打开多个 tab”的问题。

### 已修复内容

- `yahoo-plugin/content.js`：出价按钮匹配现在优先在可见入札/落札 modal/dialog 内查找 `確認する` 等按钮，避免误点页面推荐区或弹窗外控件。
- `yahoo-plugin/content.js`：入札流程点击按钮时补发 `pointerdown/pointerup`，并在 submit 按钮上调用 `form.requestSubmit(button)`，提升 Yahoo 弹窗确认进入下一步的稳定性。
- `src/server/routes/plugin.js`：新增 `claimTaskForProcessing()`，`status=processing` 只允许仍为 `pending` 或 `bidding + multi_bid` 的任务原子改为 `processing`；并发执行器拿不到同一任务会收到 `success:false` 并跳过。
- 新增回归测试：
  - 入札弹窗和推荐区同时有 `確認する` 时，只点击弹窗内按钮。
  - submit 类型的 `確認する` 会触发表单 `requestSubmit()`。
  - 任务 claim SQL 必须限制在可执行状态，避免重复领取。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
node src\server\routes\plugin.test.js
```

---

## 2026-06-06 交易开始自动 flag 规则修正

### 业务规则确认

- `交易开始执行整点` 到达后，如果当天还没有执行过交易开始，服务端需要把 `transaction_start_requested` 自动更新为 `1`。
- 这个 flag 不再只代表手动点击“加入执行队列”，也代表“定时已到，等待插件空闲执行”；后台仍只展示这一个 flag。
- 5 点前等整点前手工执行交易开始，不影响到整点后自动把 flag 置为 `1` 再执行一次。
- 如果手工执行是在配置整点之后完成，则视为当天交易开始已覆盖，会写入当天执行日期，避免同一天继续自动重复执行。
- 插件完成 `transaction_start` 后仍会把 `transaction_start_requested` 清回 `0`，并写入 `transaction_start_last_run_date=当天`，避免当天重复自动执行。

### 已修复内容

- `src/server/routes/plugin.js` 新增 `ensureScheduledTransactionStartRequest()`：
  - 读取 `transaction_start_hour`、`transaction_start_requested`、`transaction_start_last_run_date`。
  - 当前整点达到配置值且当天未执行时，写入 `transaction_start_requested=1`。
- 手工按钮会把内部来源标记为 `manual`；整点自动置 flag 会把内部来源标记为 `auto`。该来源只用于判断是否带 `includeAfterCutoff` 和是否写入自动执行日期，不新增后台展示字段。
- `/api/plugin/idle-action/next` 在读取空闲 action 前会先同步自动 flag。
- `/api/admin/idle-flags` 在返回后台顶部 flag 前也会先同步自动 flag，所以后台刷新后能看到数据库 flag 变为 `1`。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node yahoo-plugin\background.test.js
```

---

## 2026-06-05 付款红色按钮点击增强

### 问题现象

- 付款任务进入 `購入手続き` 页面后，右侧红色 `確認する` 已经显示，但插件普通 JS click 后页面没有进入下一步，随后等待超时、关闭 tab 并标记付款失败。
- 推测原因是 Yahoo 前端按钮可能使用伪按钮 / React 事件 / 特定鼠标事件，单纯 `button.click()` 或 `form.requestSubmit()` 在真实页面上不稳定。

### 已修复内容

- 付款按钮识别范围扩展到 `[role="button"]`，避免 Yahoo 使用伪按钮时漏识别。
- Yahoo 付款页红色 `確認する` 实际 DOM 可能是 `<a data-cl-params="_cl_link:confirm;_cl_position:1;">確認する</a>`，插件现在优先选择 `data-cl-params` 含 `_cl_link:confirm` 且可见、有尺寸、未 disabled 的匹配元素，避免点到隐藏模板或不可点击的同名节点。
- 2026-06-09 追加：购买确认页的目标 `確認する` 只从真正可点击元素中匹配完整文本严格等于 `確認する` 的按钮/链接，优先 `<a>確認する</a>`。不要把 `span` 子元素作为付款 `review` 候选，也不要用包含关系或相似文案判断；PayPay 广告链接完整文本为 `特典を確認する`，必须排除。注意 `q1175609593` 这类商城即決商品走 `yahoo-plugin/content.js` 的即決购买流程，不是后台付款任务的 `background.js`。
- 2026-06-09 追加：`確認する` 精确匹配只适用于购买内容确认页；后续弹窗的 `購入を確定する` 必须作为最终提交按钮单独识别，点击一次后等待购买完成文案，不能再回到前一页 `確認する` 搜索逻辑。
- 2026-06-09 追加：最终弹窗按钮完整文字可能是 `上記に同意のうえ購入を確定する`；该按钮点过一次后，`content.js` 使用 `window.__G_DAIPAI_BUYOUT_FINAL_CLICKED__` 防止同页重复点击。后台 pending final 检查间隔为 10 秒，不再 3 秒后立刻再次触发。
- 2026-06-09 追加：商城即決最终弹窗使用专用 `findBuyoutFinalPurchaseButton()`，只匹配可点击元素中包含 `購入を確定する` 的提交按钮；不要把前一页 `<a>確認する</a>` 精确匹配逻辑复用到最终弹窗。普通即決的 `落札する` 仍作为 buyout 兜底保留。
- 2026-06-09 追加：商城即決购买完成后的真实 URL 为 `/order/thank-you?auctionId=...`，页面显示 `購入が完了しました！`。该 URL 必须视为成功结果；否则后台 pending final 超时会写失败且异常分支不一定关闭 tab。
- 2026-06-09 追加：商城即決无同捆勾选框时，`確認する -> 上記に同意のうえ購入を確定する -> /order/thank-you` 只作为插件出价成功页识别，不直接改订单状态。订单仍走商城正常链路：空状态→待支付→结算后待结算→支付；支付页已付款时按 `already_paid/success` 更新为 `pending_shipment`（待发货）。商城 `落札者負担` 在后台结算中按 0 运费处理。
- 2026-06-09 追加：`pending_shipment` 只能用于后台结算计算应付款，不能进入“支付”流程。支付按钮/支付任务仍只接受 `pending_settlement`；如果支付请求没有命中 `pending_settlement` 行，不设置 `payment_requested`。
- 普通付款点击会先补发 `pointerdown/mousedown/pointerup/mouseup/click` 事件。
- 如果点击 `確認する` 后 5 秒内没有进入下一付款状态，插件会使用 Chrome debugger 的 `Input.dispatchMouseEvent` 对按钮中心点再发送一次真实鼠标点击。
- 最终确认页 `購入を確定する` 也加入同样真实鼠标点击兜底。
- 失败诊断增强：如果真实鼠标点击后仍未进入下一页，错误信息会带上 `action`、普通点击结果、真实鼠标点击结果、当前 URL、页面按钮文本列表和候选按钮的 `tagName/text/disabled/role/href/rect`，用于判断是找不到按钮、按钮不可点，还是 Yahoo 页面点击后没有响应。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```
---

## 2026-06-06 数据批处理待收货补表格

### 已实现内容

- 后台“数据批处理”新增 Tab：`待收货补表格`。
- 新增后台接口：`POST /api/admin/receipt-sheet-backfill/run`，用于批量处理已经是 `pending_receipt`（待收货）但还没有写入 Google 表格的订单。
- 批处理复用扫描发货后的同一套 Google 表格追加逻辑：
  - 写入 `-代拍表-` 页。
  - 字段顺序为：落札日期、用户名、商品链接、商品标题、落札价、运费、同捆运费、总价、应付款、订单状态。
  - 表格 A1:J1 为空时自动写入表头。
  - 同捆商品会按同组连续追加，并使用组背景色；相邻同捆组颜色轮换。
- 重复判断规则：
  - 系统内通过 `orders.google_sheet_appended_at IS NULL` 过滤，追加成功后写入 `google_sheet_appended_at`，避免扫描重试或后台补写重复追加。
  - 当前不会读取 Google 表格已有内容做二次去重；如果表格里有人工手动添加的旧行，系统无法识别。当前表格为空时可直接使用。
- 后台补表页为了避免 Windows/服务器编码差异导致 TSX 乱码，中文显示文本使用 Unicode 转义保存，浏览器显示仍为中文。
- 2026-06-06 字段更新：Google 表格去掉 `应付款`、`订单状态`，改为 `物流`、`单号`；当前字段顺序为：落札日期、用户名、商品链接、商品标题、落札价、运费、同捆运费、总价、物流、单号。
- Google 表格样式会在追加时自动应用：表头自动覆盖为最新字段、首行冻结、表头深色底白字加粗、A:J 自动列宽。同捆组背景色逻辑保留。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-06 待发货扫描物流字段修正

### 问题

- 服务器商品 `c1232119416` 为商城商品，订单仍停留在 `pending_shipment`，`shipping_company` 和 `tracking_number` 为空。
- 服务器查询显示该订单已有 `transaction_url=https://buy.auctions.yahoo.co.jp/order/status?auctionId=c1232119416`，说明不是交易链接缺失，而是待发货扫描进入取引页后没有稳定识别已发货物流字段。

### 已修复内容

- `yahoo-plugin/content.js` 的待发货扫描现在优先从 DOM 表格/块元素按字段名抽取物流和单号：
  - 商城商品：`配送業者` -> 物流，`伝票番号` -> 单号。
  - 普通商品：`配送方法` -> 物流，`追跡番号` -> 单号。
- 普通商品物流字段会去掉运费部分，例如 `ゆうバック（送料:880円）` 保存为 `ゆうバック`。
- 保留旧兜底逻辑：如果字段里没有单号，继续从聊天文本里找 12 位数字；仍找不到时用出品者名称兜底。
- 新增回归测试覆盖商城/普通两类 DOM 表格字段。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
```
---

## 2026-06-07 后台系统配置 Google 表格地址

### 已实现内容

- 后台“系统配置”页面新增 `Google表格地址` 只读配置项。
- 地址由服务端 `/api/admin/multi-bid-config` 返回，来源为当前 Google Sheets 追加逻辑实际使用的 `GOOGLE_SHEETS_SPREADSHEET_ID`，未配置环境变量时显示默认表格：
  `https://docs.google.com/spreadsheets/d/1NFDVdBAdi3S6RzS3u7LEd0jX-etlyATioVfghXm-GB4/edit?gid=0#gid=0`
- 该字段仅用于后台显示当前导入/追加的 Google 表格地址，不改变 Google Sheets 写入逻辑；如需切换表格，仍按当前服务端环境变量配置方式处理。

### 最近验证命令

```powershell
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-07 交易开始最近执行摘要修正

### 问题

- 后台订单管理顶部 `最近执行` 原来只显示 `回写 X 次`，其中成功状态回写和失败错误回写都会计数。
- 交易开始插件任务失败时，系统会写入 `transaction_start_error`，但 `orders.order_status` 保持空；这会让页面看起来像“没有执行过”，实际是执行后失败。

### 已实现内容

- 后台订单管理顶部 `最近执行` 改为显示：回写总数、成功数、失败数、未更新数。
- 如果最近执行日志里有失败原因，会在摘要中展示最多 2 条错误，方便直接判断是否是 Yahoo 页面、登录态或取引页点击失败。

### 最近验证命令

```powershell
Set-Location src\admin
npm run build
```
---

## 2026-06-07 交易开始空状态订单取单规则修正

### 问题

- 业务规则要求交易开始处理 `orders.order_status` 为空的落札订单。
- 旧取单 SQL 额外要求关联任务 `tasks.status='success'`，自动执行时还按执行整点做 cutoff，导致部分空状态订单不会进入交易开始。

### 已修复内容

- `/api/plugin/transaction-start/jobs` 改为以订单空状态为准取单：`orders.order_status IS NULL OR orders.order_status=''`。
- 不再用 `tasks.status='success'` 或执行整点 cutoff 排除空状态订单；手动和自动交易开始都会拿到全部空状态落札订单。
- 后台订单管理把 `交易开始错误` 列移动到 `订单状态` 后面，方便直接看到空状态订单是否是交易开始失败。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-07 交易开始 flag 置位时间修正

### 业务规则确认

- 后台设置的 `交易开始执行整点` 不是一个 0-59 分钟的小时区间。
- 自动交易开始 flag 应在“设置整点后 1 分钟”置为 `1`：
  - 设置 `0`：`00:01` 开始置 `transaction_start_requested=1`。
  - 设置 `5`：`05:01` 开始置 `transaction_start_requested=1`。
- 到达该时间前，即使小时已经相同，也不能提前置 flag。

### 已修复内容

- `src/server/routes/plugin.js` 新增分钟级判断：`isTransactionStartReady()`，自动置 flag 改为比较当天 `transaction_start_hour:01:00`。
- `/api/plugin/idle-action/next`、`ensureScheduledTransactionStartRequest()`、`completeIdleAction()` 统一使用“整点后 1 分钟”判断。
- `/api/admin/idle-flags` 后台顶部状态同步使用同一判断，避免后台显示和插件调度不一致。
- 后台系统配置字段文案改为 `交易开始执行整点后1分钟`，输入框后缀显示 `点01分`。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-07 交易开始自动执行槽位规则修正

### 业务规则确认

- 自动交易开始不再按“每天只能执行一次”判断。
- 自动交易开始按当前后台配置小时生成执行槽位：`YYYY-MM-DD-HH`。
- 同一个槽位只执行一次；如果当天把配置从已执行过的小时改到后面的小时，后面的小时到 `HH:01` 后还会再置 flag。
- 如果当天把配置改到一个已经过点的小时，不补跑当天，等明天该小时 `HH:01` 再置 flag。
- 手动执行不占用自动执行槽位，不影响当天后续按配置自动执行。

### 示例

- 设置 `0`：`00:01` 自动置 `transaction_start_requested=1`，执行完成记录槽位 `当天-00`。
- 同一天后面改为 `9`：`09:01` 自动再次置 `transaction_start_requested=1`，执行完成记录槽位 `当天-09`。
- 同一天 9 点后再改为 `2`：当天不补跑；第二天 `02:01` 自动置 `transaction_start_requested=1`。

### 已修复内容

- `src/server/routes/plugin.js` 新增自动执行槽位判断，使用 `transaction_start_last_run_slot` 记录已完成的自动槽位。
- 自动置 flag 会参考 `transaction_start_hour` 的配置更新时间，避免把配置改到当天已经过点的小时后立即补跑。
- 保留旧日志兼容：没有 `transaction_start_last_run_slot` 时，会从当天最近一次自动执行日志推断旧槽位，避免部署后同一配置小时重复执行。
- `/api/admin/idle-flags` 使用相同槽位规则显示后台顶部 `交易开始flag`。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-07 付款最终确认处理中页等待修正

### 问题

- 普通商品付款最终确认页点击 `購入を確定する` 后，Yahoo 会先显示 `ただいま決済処理中です。しばらくお待ちください。` 中间过程页。
- 旧逻辑只等待 5 秒，未看到完成页就进入失败/兜底流程并关闭 tab，导致实际 Yahoo 付款成功但系统反馈支付失败。

### 已修复内容

- `yahoo-plugin/background.js` 最终确认按钮点击成功后，固定等待完成页最多 15 秒。
- 15 秒内出现处理中页不判失败，继续等待 `購入が完了しました！` / 已付款完成状态。
- 15 秒后仍未看到完成页，才按付款失败处理并关闭 tab。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```
---

## 2026-06-07 确认收货功能实现

### 当前状态

- 确认收货任务已实现，复用现有插件空闲任务体系，新增独立 action：`confirm_receipt`。
- 前置数据状态已有：`pending_receipt`（待收货）、`completed`（完了）。
- Google 表格已新增“读取表格行颜色并按商品 ID 匹配”的能力。

### 业务规则确认

- 后台新增确认收货启动时间，默认每天 `18:01` 执行：
  - 配置项保存前面的整点小时，默认 `18`。
  - 到设置整点后 1 分钟时，自动置 `confirm_receipt_requested=1`。
  - 同交易开始一样支持手动执行。
  - 同一自动执行槽位只执行一次；如果改到当天已过点小时，不补跑当天，等第二天该小时 `HH:01`。
- 后台新增“收货商品颜色配置”，默认黄色 `#ffff00`。
- 确认收货 Flag 为 `1` 时，只处理 `orders.order_status='pending_receipt'` 的订单。
- 处理前必须去 Google 表格找该商品所在行：
  - 按商品 ID 匹配。
  - 该行 A-J 任意一个单元格背景色命中后台配置颜色，即允许执行确认收货。
  - 商品 ID 找不到、颜色不匹配或读取表格失败时跳过，不改订单状态。
- 普通商品：
  - 打开 Yahoo `取引連絡` 页面。
  - 勾选 `商品を受け取りました。`。
  - 等 `受け取り連絡` 按钮变红/可点击后点击。
  - 出现 `すべての取引が完了しました! またYahoo!オークションをご利用ください。` 后，订单状态更新为 `completed`（完了），关闭 tab。
- 同捆商品：
  - 待收货状态只会在主商品上。
  - 主商品按普通商品流程确认收货成功后，同一 `bundle_group_id` 的所有子商品一起更新为 `completed`。
- 商城商品：
  - 不打开 Yahoo 页面，直接把订单状态更新为 `completed`，关闭/不创建 tab。
- 用户端“落札商品”页面需要把 `completed` 显示为 `完了`。

### 已实现内容

- 后台“系统配置”新增确认收货执行整点配置，默认 `18`，到 `HH:01` 自动置 `confirm_receipt_requested=1`；规则与交易开始一致，按 `YYYY-MM-DD-HH` 槽位防重复，手动执行不占自动槽位。
- 后台“系统配置”新增“收货商品颜色配置”，默认 `#ffff00`，保存时标准化为 HEX；后台订单管理顶部新增 `确认收货flag` 展示。
- 后台“系统配置”已按流程拆分为多个功能块：多次出价、入札/落札空闲同步、交易开始任务、扫描任务、付款任务、确认收货任务、Google 表格配置，避免所有配置挤在同一个区块。
- 后台新增“手动执行确认收货”按钮：`POST /api/admin/confirm-receipt/request`。
- Google Sheets 新增按商品 ID 查找行并检查 A-J 任意单元格背景色是否命中配置色的能力；未命中颜色的待收货订单会跳过，不修改订单状态。
- 插件新增 idle action：`confirm_receipt`。空闲任务链路按 `C 交易开始 -> D 扫描(计数到阈值) -> E 付款 -> F 确认收货` 执行。只要没有执行 C/D，执行 E、F 或空闲 none 后都会让扫描计数 `+1`。
- 服务端新增 `/api/plugin/confirm-receipt/jobs` 和 `/api/plugin/confirm-receipt/status`：
  - 只取 `orders.order_status='pending_receipt'` 的订单；
  - 商城商品直接更新为 `completed`；
  - 普通商品由插件打开取引页执行确认收货；
  - 同捆主商品确认成功后，同一 `bundle_group_id` 下 `pending_receipt` / `bundle_completed` 订单一起更新为 `completed`。
- 插件普通商品流程：打开取引页，勾选 `商品を受け取りました。`，点击 `受け取り連絡`，等待出现 `すべての取引が完了しました` 后回写成功并关闭 tab。
- 用户端“落札商品”页新增 `completed -> 完了` 状态显示。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node yahoo-plugin\background.test.js
Set-Location src\admin
npm run build
Set-Location src\client
npm run build
```

---

## 2026-06-07 付款页配送方式选择修正

### 问题

- 普通商品 `u1231877298` 本地付款失败，提醒为 `payment amount mismatch: expected 535円, found 910円`。
- 该单系统金额为 `落札价 350円 + 运费 185円 = 535円`，是正确金额。
- Yahoo 付款页实际为 `350円 + コンビニ手数料 330円 + 默认配送 230円 = 910円`。
- 生产环境默认付款方式应为 `クレジットカード`，插件不能自动改为 `銀行振込`；本地无信用卡导致的便利店手续费不作为自动切换银行的依据。

### 已修复内容

- 强化配送方式选择：多个配送方式时，按系统抓取商品时保存的运费选择对应配送 radio，例如选择 `クリックポスト 185円`。
- Yahoo 付款页初始可能只显示当前默认配送和 `変更する` 按钮；`変更する` 不是页面唯一文案，且真实 DOM 为标题 `配送方法` 所在的 `section` 下，外层 `<div role="button">` 包住配送摘要，右侧普通 `span` 文本为 `変更する`。
- 插件现在会按配送上下文匹配展开按钮：优先找标题为 `配送方法` 的 `section`，只在该 section 内查找 `変更する` 文案，并实际点击最近的 `[role="button"]` 外层；兜底时才按 `配送方法` 标题之后、下一个业务区块之前，或父级/祖先文本含配送关键词（`おてがる配送`、`送料`、`クリックポスト` 等）匹配，不会按全页面第一个 `変更する` 点击。
- 如果普通 JS 点击展开后仍未看到目标运费，插件会对配送区域的 `変更する` 中心点补一次 Chrome debugger 真实鼠标点击，再读取配送选项并选择系统保存运费，避免隐藏的 `185円` 选项未被看到就继续按默认 `230円` 校验失败。
- 折叠状态下 Yahoo 可能已经把其他运费 radio 留在隐藏 DOM 中；插件现在只把可见的配送 radio/label/行容器算作可选项。隐藏的 `185円` 不会让流程跳过展开。
- 选择运费时优先点击可见的 label/行容器，再同步触发 radio 的 `input/change`，避免只改隐藏 input 导致 Yahoo 页面金额不刷新。
- 2026-06-07 追加：展开配送时会同时触发 `変更する` span、外层 `[role="button"]` 的鼠标事件，并对 role button 补发 `Enter` / `Space` 键盘事件；如果仍失败，付款失败原因会附带 `expand=...`、`trustedExpand=...`、`visibleState=...` 诊断信息，用于确认是否定位到 section、是否成功真实点击、可见运费列表是什么。
- 2026-06-07 追加修正：付款页状态摘要可能因为前 500 字还在 `お支払い方法` 区域而没有包含 `配送方法`，旧逻辑会跳过展开配送，直接进入金额校验并报 `expected 535円, found 910円`。现在只要页面金额和系统期望金额不一致，且订单存在有效运费，就会强制尝试展开/选择配送，不再依赖 `textSample` 是否已经包含 `配送方法`。
- 2026-06-07 真实测试结论：`u1231877298` 从 `910円` 变为 `865円` 代表运费已从 `230円` 成功改为 `185円`，剩余差额 `330円` 是当前本地 Yahoo 默认 `コンビニ` 付款方式的手续费。插件不自动修改付款方式，因此本地无信用卡时仍会按金额不一致阻断付款；生产信用卡默认应无该手续费。
- 付款金额不一致错误现在会识别 `手数料330円` 这类付款方式手续费，错误中附带 `paymentMethodFee: 330円 (current payment method adds fee)`，避免继续误判为运费未选中。
- 不自动修改付款方式；付款方式保持 Yahoo 当前选中项，生产环境应使用默认信用卡。
- 选择配送方式后会等待页面金额刷新，再执行原有金额校验；金额不一致仍会阻断付款。
- 新增回归测试覆盖：配送初始折叠且默认 `230円` 时，插件会先展开配送方式，再选中系统保存的 `185円` 配送，最终以 `535円` 继续付款。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```
---

## 2026-06-07 普通商品待发货扫描修正

### 已实现内容

- 普通商品待发货扫描中，如果页面已显示“出品者から商品発送の連絡がありました”，但 `追跡番号` 为 `未登録（反映されるまでお待ちください）`，插件不再当作已发货处理；保持 `pending_shipment`，继续走“是否增加提醒”逻辑并关闭 tab。
- 上述规则只作用于普通商品取引页；商城商品扫描逻辑保持不变。
- 普通商品已发货但没有 12 位追踪号时，单号兜底来源由顶部 `出品者` 名称改为 `出品者情報` 区块里的 `氏名`，例如 `毛利　好之助`；只有没有该字段时才继续回退旧的出品者名称。
- 新增回归测试覆盖 `追跡番号：未登録` 和 `出品者情報 -> 氏名` 兜底。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
```
---

## 2026-06-07 Yahoo PIN / 文字验证码人工协同

### 已实现内容

- 插件打开 `取引連絡` / 取引页时，如果跳到 Yahoo 人工验证页，会自动暂停当前流程并把验证需求同步到后台顶部提醒栏。
- 后台提醒栏复用 `config.manual_captcha_challenge` 存储当前验证挑战，支持两种类型：
  - `type='pin'`：只显示 PIN 输入框和“提交 PIN”按钮。
  - `type='captcha'`：显示验证码图片、输入框和“提交验证码”按钮。
- PIN 页面识别：
  - 插件会优先按 Yahoo 登录/账号验证域名和 URL 关键字判断可能的 PIN 页；
  - 再读取页面文本和输入框，匹配 `PIN`、`確認コード`、`認証コード`、`セキュリティコード`、`コード` 等文字。
- PIN 协同流程：
  - 后台顶部出现“Yahoo 需要 PIN 码验证，请输入 PIN 后继续任务”；
  - 管理员输入 PIN 后，插件轮询 `/api/plugin/manual-captcha/answer/:id` 拿到答案；
  - 插件自动填入 Yahoo PIN 输入框并点击继续/确认类按钮；
  - 如果验证码之后再次回到 PIN 页，会复用刚才的 PIN 自动再填一次，不再重复提醒管理员输入。
  - 如果 PIN 提交后仍停在 PIN 页，不会继续复用同一个 PIN，而是重新在后台提醒栏要求输入。
- 文字验证码协同流程：
  - 跳到 `https://login.yahoo.co.jp/ncaptcha...` 时，插件激活验证码 tab；
  - 使用 `chrome.tabs.captureVisibleTab` 截取可见页，并优先裁出验证码图片区域；裁剪失败时回退为整页截图；
  - 验证码图片以 data URL 写入服务端，后台 `/api/admin/idle-flags` 返回当前待处理验证码；
  - 管理员输入图中日文后，插件自动填入 Yahoo 验证码输入框并点击 `続ける`。
  - 如果验证码输入错误后 Yahoo 仍停留在验证码页面，插件下一轮会重新截图并再次发到后台提醒栏，直到验证码通过或达到循环上限。
- 验证流程最多循环 6 步，覆盖 `PIN -> 验证码 -> PIN -> 取引页` 这类链路，避免无限卡住。
- 每次 PIN / 验证码提交并成功填入后，插件会关闭对应后台提醒；验证结束后继续原来的取引页流程。
- 前台用户端新增管理员提醒栏：
  - 新接口 `/api/task/manual-verification-alert` 只对登录用户 `user_level >= 3` 且当前挑战为 `type='pin'` 时返回提醒；
  - 前台所有已登录页面顶部会显示 `后端有事情要处理！`；
  - 没有 PIN 挑战、挑战关闭、或登录用户不是前台管理员时，前台提醒栏不显示。
- 该功能是人工协同，不做自动识别验证码，也不绕过 Yahoo 验证；后续拿到真实 PIN 页面源码/截图后，仍可能需要微调输入框和按钮选择器。

### 最近验证命令

```powershell
node src\server\services\manualCaptcha.test.js
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
node src\server\routes\task.test.js
node src\client\src\utils\manualVerificationAlert.test.mjs
Set-Location src\admin
npm run build
Set-Location src\client
npm run build
```
---

## 2026-06-07 Google 表格配置凭据路径显示

### 已实现内容

- 后台“系统配置 -> Google 表格配置”在 Google 表格地址下面新增只读备注字段：`Google JSON文件绝对路径`。
- 该字段来自服务端 `.env` 的 `GOOGLE_APPLICATION_CREDENTIALS`，服务端会用 `path.resolve()` 转为绝对路径后返回。
- 如果使用的是 `GOOGLE_SHEETS_SERVICE_ACCOUNT_JSON` 或 `GOOGLE_SHEETS_CLIENT_EMAIL` / `GOOGLE_SHEETS_PRIVATE_KEY` 这类非文件方式，则该路径为空，页面显示未配置文件路径的占位提示。
- 迁移服务器时，需要同时迁移 `.env` 配置和该 JSON 文件；Chrome 登录的 Google 账号不影响该 service account 方式的 Google Sheets API 调用。
- 2026-06-07 追加：Google 表格地址和 JSON 文件绝对路径默认锁定不可编辑；后台新增“允许修改 Google 表格配置”勾选框，勾选后才允许修改。
- 勾选后保存会把表格 ID 写入 `config.google_sheets_spreadsheet_id`，把 JSON 路径写入 `config.google_application_credentials`，并立即覆盖当前 Node 进程的 Google Sheets 运行配置。
- Google Sheets 写表和确认收货颜色匹配任务执行前会从 `config` 表加载这两个覆盖值；如果没有数据库覆盖值，则继续使用 `.env` 中的 `GOOGLE_SHEETS_SPREADSHEET_ID` / `GOOGLE_APPLICATION_CREDENTIALS`。

### 最近验证命令

```powershell
node src\server\services\googleSheets.test.js
node src\server\routes\plugin.test.js
Set-Location src\admin
npm run build
```
---

## 2026-06-06 待收货物流单号显示与抽取修正

### 已实现内容

- 待发货扫描抽取 `伝票番号` / `追跡番号` 时，只保存第一段 12 位数字，支持中间用 `-` 或空白分隔。
  - 示例：`3901-6644-7193配送状況を調べる...08096096438` 保存为 `390166447193`。
  - 如果字段值里没有 12 位单号，不再把整段字段文字保存为单号；继续走聊天 12 位单号和出品者名称兜底。
- 用户端“落札商品”列表不再显示物流和追踪号；后台订单管理仍保留物流字段用于管理查看。
- 新增回归测试覆盖带外部链接/后续文字的传票号字段。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
Set-Location src\client
npm run build
```
---

## 2026-06-06 商城即決价格税后口径修正

### 问题

- 商城商品抓取时，`currentPrice` 仍按系统内部税前口径保存并由用户端展示时乘 `1.1`，但 `buyoutPrice` 如果来自 Yahoo `pageData.items.winPrice`，之前直接返回税前值。
- 结果用户端商品卡显示当前价为税后，但即決价格仍显示税前，例如 `winPrice=250091` 被显示为 `250,091円（税込）`，正确应显示 `275,100円（税込）`。

### 已实现内容

- `src/server/routes/proxy.js`：商城商品 `tax_included` 且即決价来自 `pageData.items.winPrice` 时，返回给前端前乘 `1.1` 转为税后口径。
- `yahoo-plugin/content.js`：插件商品快照同样对 `pageData.items.winPrice` 的商城即決价乘 `1.1`，避免刷新快照时写回税前即決价。
- `currentPrice` 仍保持税前口径，沿用现有出价校验/提交逻辑。
- 新增回归测试覆盖 `price=250091`、`winPrice=250091`、页面显示税込时，`buyoutPrice=275100`。

### 最近验证命令

```powershell
node src\server\routes\proxy.test.js
node yahoo-plugin\content.test.js
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
```

---

## 2026-06-08 确认收货按钮点击修正

### 问题

- Yahoo 普通商品受取連絡页同时存在两个 `value="受け取り連絡"` 按钮：
  - 灰色 `.jsOffReceiveButton / libBtnDisL`，默认显示，点击只会 `javascript:void(0)`。
  - 红色 `.jsOnReceiveButton`，默认 `display:none`，勾选 `商品を受け取りました。` 后才显示，并带真实 `/buyer/ship?...` 跳转。
- 插件之前只按按钮文字匹配，可能点到灰色假按钮，导致页面停留在受取連絡页，后台提示 `receipt completion text not found`。

### 已实现内容

- `yahoo-plugin/background.js` 确认收货状态识别新增：
  - 识别复选框是否已勾选。
  - 识别 `受け取り連絡` 真实按钮是否可见可用。
  - 把 `.jsOffReceiveButton / libBtnDisL` 视为不可提交按钮。
- 复选框普通点击后如果按钮仍未启用，会使用 Chrome debugger 派发真实鼠标点击兜底。
- 提交按钮点击只选择可见且可用的 `.jsOnReceiveButton`，避免再点灰色假按钮。
- 新增回归测试覆盖确认收货先遇到灰色按钮、兜底勾选后再点击真实按钮的流程。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
```

---

## 2026-06-08 出品者情報氏名兜底修正

### 问题

- 普通商品待发货扫描在没有 12 位追踪号时，会用 `出品者情報` 栏里的 `氏名` 作为单号兜底。
- 真实 Yahoo 页面可能把整个 `取引情報` 放在一个大 `div` 的 `textContent` 中，里面同时包含 `お届け情報`、`落札者情報` 和 `出品者情報`。
- 旧逻辑在这个大文本里直接匹配第一个 `氏名`，会误取 `落札者情報` / `お届け情報` 的姓名，例如 `GAO YUN`，而不是 `出品者情報` 的 `エーシー　商事`。

### 已修复内容

- `yahoo-plugin/content.js` 新增 `extractSellerInfoSectionText()`，先把文本裁剪到 `出品者情報` 区块后，再抽取该区块里的 `氏名`。
- 保持原优先级不变：有真实 12 位 `伝票番号` / `追跡番号` 时仍优先使用真实单号；只有没有单号时才使用 `出品者情報 -> 氏名` 兜底。
- 新增回归测试覆盖：同一个大 `取引情報` 文本块里同时存在 `落札者情報 氏名: GAO YUN` 和 `出品者情報 氏名: エーシー　商事` 时，兜底结果必须是 `エーシー　商事`。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
```

---

## 2026-06-08 用户端完了状态样式调整

### 已实现内容

- 用户端 `落札商品` 页面中，订单状态 `completed -> 完了` 的标签保持默认绿色；整条商品行背景改为淡蓝色，和取消订单整行淡红色同一逻辑。
- 仅调整用户端展示样式，不改变订单状态值和后台订单管理样式。

### 最近验证命令

```powershell
Set-Location src\client
npm run build
```

---

## 2026-06-08 商品页登录误判修正

### 问题

- 商品 `f1232542390` 本地出价时，Yahoo 商品页打开后没有跳转登录页，也没有执行出价，任务直接失败为 `需要登录 Yahoo`。
- 根因是 `executeBidV3()` 在商品页执行前扫描整页文本，只要页面里出现 `ログイン...必要` / `ログインしてください` 这类普通提示文案，就提前返回登录失败。
- 业务判断确认：`https://auctions.yahoo.co.jp/jp/auction/{商品ID}` 商品页本身不应做登录失败判断；如果真的未登录，Yahoo 会跳到 `login.yahoo.co.jp` 或账号验证域名，不会停留在商品页。

### 已修复内容

- `yahoo-plugin/content.js` 新增 `isYahooLoginPageUrl()`，出价执行入口只在当前 URL 为 `login.yahoo.co.jp` / `account.edit.yahoo.co.jp` 时返回 `需要登录 Yahoo`。
- 商品页即使包含登录提示文案，也继续走正常出价按钮查找和点击流程。
- 保留 `detectYahooLoginStatus()` 对 `/my/won`、入札中、交易页、扫描页等同步流程的登录状态上报逻辑，不影响后台顶部 Yahoo 登录状态显示。
- 新增回归测试覆盖：商品页文本含 `ログインが必要` 时，不能在出价执行入口直接返回 `需要登录 Yahoo`。

### 最近验证命令

```powershell
node yahoo-plugin\content.test.js
```

---

## 2026-06-08 运费优先 Yahoo shipment API

### 问题

- 部分商城商品页面说明里有卖家自定义运费表，程序按页面文字解析时可能取到第一行地区运费，例如 `v1232498111` 取到北海道 `1,570円`。
- 同一商品通过 Yahoo shipment API 按当前默认地区 `prefCode=27` 返回真实配送方式 `佐川急便（宅配便） 910円`。

### 已修复内容

- `src/server/routes/proxy.js` 商品抓取改为：只要能从页面构造 Yahoo shipment API URL，就优先调用 shipment API。
- shipment API 返回有效金额时，覆盖页面说明/表格解析出来的运费。
- shipment API 参数缺失、请求失败或无有效金额时，仍回退到原有页面解析结果。
- HTTP 抓取和 Playwright 兜底抓取都应用相同优先级。
- 新增回归测试覆盖：页面说明表先出现 `1,570円`，但 shipment API 返回 `910円` 时，最终运费必须是 `910円`。
- 2026-06-09 追加优化：`落札者負担` 被识别为有效兜底结果；如果 shipment API 已尝试但超时或没有有效金额，直接返回 `落札者負担`，不再继续 Playwright + shipment API 重复兜底，避免类似 `j1230839418` 抓取耗时被多次超时放大。

### 最近验证命令

```powershell
node src\server\routes\proxy.test.js
```

### 真实验证

- `v1232498111` 当前服务端抓取结果：`shippingFeeText=910円`。

---

## 2026-06-08 商城税前价最低出价校验修正

### 问题

- 商城商品选择 `税前价` 输入最高出价时，前端先把输入税前价换算成税后实际出价，再在提交校验里把税后价折回税前。
- 折回函数会按 10 円向下取整，导致用户输入 `10093` 税前价时，实际用于最低出价校验的值变成 `10090`。
- 例如商品当前税前价 `9841`、已有入札最低加价 `250`，最低可出价应为 `10091`；用户输入 `10093` 本应通过，但旧逻辑误报低于最低可出价。

### 已修复内容

- `src/client/src/utils/bidPrice.js` 新增 `getMinimumBidComparableInputPrice()`。
- 商城商品 `税前价` 模式下，最低出价校验直接使用用户输入的税前日元，不再进行“税前 -> 税后 -> 税前”的二次换算。
- `税后价` 模式和普通商品逻辑保持原有口径。
- 新增回归测试覆盖：`currentPrice=9841`、`bidCount>0`、税前输入 `10093` 时，应满足最低 `10091`。

### 最近验证命令

```powershell
node src\client\src\utils\bidPrice.test.mjs
Set-Location src\client
npm run build
```
---

## 2026-06-08 税后折税前不再按 10 円取整

### 问题

- 商城商品含税金额折回税前金额时，旧逻辑使用 `Math.floor((price / 1.1) / 10) * 10`，会额外按 10 円向下取整。
- Yahoo 出价金额允许末尾为 1 円等非 10 円档金额，因此该取整会把有效价格压低。
- 例：`11103 / 1.1 = 10093.636...`，正确系统税前价应为 `10093`，旧逻辑会变成 `10090`。

### 已实现内容

- 前台提交页、服务端任务提交、插件 followup 任务、入札中同步的“税后折税前”逻辑统一改为 `Math.floor(price / 1.1 + 1e-6)`。
- 不再做 `/10` 后再 `*10` 的 10 円档取整。
- `2460` 含税即決价对应的系统税前出价从 `2230` 调整为 `2236`。
- 新增/更新回归测试覆盖：`11103 -> 10093`，以及入札中同步和 followup 创建时不再变成 `10090`。

### 最近验证命令
```powershell
node src\server\routes\task.test.js
node src\server\routes\plugin.test.js
node src\client\src\utils\bidPrice.test.mjs
node src\client\src\utils\submitValidation.test.mjs
Set-Location src\client
npm run build
```
---

## 2026-06-11 维护性整理规划

### 当前状态

- 本阶段目标是提升代码可读性、可维护性和后续扩展安全性，重点解决同一业务规则多处重复、同一配置多处读取和状态常量分散的问题。
- 当前只进入规划阶段，尚未改动业务代码、数据库结构、API 路径、接口返回字段、插件轮询顺序或订单/任务状态流转。
- 已确认 `agents.md`、`Android-app.md` 文件本身为 UTF-8 正常中文；此前 PowerShell 默认输出编码导致终端显示乱码，不代表文件损坏。
- 注册流程按实际业务为后台分配用户；本轮维护性整理不把 App 套壳作为实施范围。

### 业务规则确认

- 改动前必须保证现有流程不变化、不影响已有数据、不引入已实现功能的新 bug。
- 第一优先级是行为保持型抽取：先新增共享常量/纯规则函数和测试，再逐步替换重复实现。
- 禁止在本阶段修改 `data/gdaipai.db`、运行生产数据清理/批处理/删除类接口、调整 SQLite schema 或改变任何现有状态值。

### 下一步计划

- 正式计划文档：`docs/superpowers/plans/2026-06-11-maintainability-rule-boundaries.md`。
- 推荐先执行计划中的 Task 1-4：
  - 建立当前回归基线。
  - 提取订单状态、税类型、商品类型、任务状态、Yahoo 低价规则等常量。
  - 提取价格换算规则。
  - 提取出价规则，并消除 `src/server/routes/task.js` 反向依赖 `src/server/routes/plugin.js`。
- 后台“清理数据”已纳入规划：当前行为保持不变，只清理超过保留天数的 `failed/cancelled/bidding` 任务及关联日志/缓存，成功落札数据不清理。后续如果要扩大到长期无效的 `pending/processing` 等状态，必须另做 dry-run 统计、明确状态/年龄规则、排除真实成功订单，并先在 SQLite 备份上验证。
- 每个小阶段必须运行对应 focused tests，阶段结束运行：

```powershell
npm run regression
```

---

## 2026-06-11 服务器备份与恢复脚本

### 已实现内容

- 项目根目录新增 `备份.bat`：关闭服务后双击执行，确认后自动创建 `backups/g-daipai-backup-YYYYMMDD-HHMMSS.zip`。
- 项目根目录新增 `恢复.bat`：关闭服务后双击执行，自动列出 `backups` 下已有 `g-daipai-backup-*.zip`，输入序号选择恢复。
- 恢复前会自动生成一份当前状态备份：`backups/g-daipai-before-restore-YYYYMMDD-HHMMSS.zip`，用于恢复操作失败或选错备份时回退。
- 备份内容包括程序源码、配置文件、SQLite 数据库、插件文件和文档。
- 为避免备份包过大和递归打包，脚本排除：`backups`、`.git`、各级 `node_modules`、前端/后台 `dist`、`*.log`、`*.tmp`。
- 脚本内容使用纯 ASCII 提示，避免 Windows `cmd.exe` 在不同代码页下解析 UTF-8 中文批处理内容出错；文件名保留中文。

### 使用注意

- 执行备份/恢复前必须先关闭 API Server、前端 dev server、后台 dev server，以及服务器 Chrome 插件相关 Chrome 窗口，避免 SQLite 写入中复制。
- 恢复不会删除 `backups`、`.git`、`node_modules`、`dist`，主要恢复源代码、配置和数据库。当前维护性整理不改依赖，因此不备份 `node_modules` 不影响回退。

### 最近验证命令

```powershell
cmd /c "echo N|备份.bat"
cmd /c "echo N|恢复.bat"
```

---

## 2026-06-11 维护性整理第一部分实施记录

### 已实现内容

- 新增服务端共享规则模块，使用 `.cjs` 以兼容当前 Express/CommonJS 路由：
  - `src/shared/domainConstants.cjs`：集中订单状态、任务状态、税类型、商品类型、出价模式、Yahoo 低价规则常量。
  - `src/shared/priceRules.cjs`：集中税前/税后换算、税类型归一、商品类型归一。
  - `src/shared/biddingRules.cjs`：集中 Yahoo 最低加价阶梯、最低可出价、低价拆分规则、即決价格解析。
- 新增对应回归测试：
  - `src/shared/orderStatus.test.cjs`
  - `src/shared/priceRules.test.cjs`
  - `src/shared/biddingRules.test.cjs`
- `src/server/routes/task.js` 不再从 `src/server/routes/plugin.js` 引入 `DEFAULT_MULTI_BID_MIN_PRICE`、`shouldSplitDirectBidByYahooLowPriceRule`、`YAHOO_LOW_PRICE_INITIAL_BID`，改为依赖共享规则模块，消除用户任务提交逻辑对插件路由的反向依赖。
- `src/server/routes/plugin.js`、`src/server/routes/admin.js`、`src/server/routes/proxy.js` 替换等价重复常量/纯函数为共享模块引用。
- 保留原有导出函数名和 API 行为，例如 `calculateBidMaxPrice`、`getTaxIncludedPrice`、`getMinMultiBidIncrement`、`resolveBuyoutTaskPrices`、`shouldSplitDirectBidByYahooLowPriceRule`，避免影响现有测试和调用方。
- 未修改数据库 schema、未运行清理/批处理接口、未改变任务/订单状态值、未改变插件轮询或 idle action 顺序。

### 最近验证命令

```powershell
npm run regression
node src\shared\orderStatus.test.cjs; node src\shared\priceRules.test.cjs; node src\shared\biddingRules.test.cjs; node src\server\routes\task.test.js; node src\server\routes\proxy.test.js; node src\server\routes\plugin.test.js; node src\server\routes\admin.orders.test.js
npm run regression
```

验证结果：以上命令均通过。

---

## 2026-06-15 Multi-bid timing and timeout update

Implemented:

- `yahoo-plugin/content.js`: reduced the multi-bid page step wait from 2500ms to 800ms. The explicit wait after filling the rebid price remains 1000ms before clicking `入札する`.
- `yahoo-plugin/content.js`: `waitForBidOutcome()` now returns rebid-required after the rebid state is stable for 500ms instead of waiting for the full 10s outcome timeout.
- `yahoo-plugin/content.js`: multi-bid pages report `BID_PROGRESS` to the background script when price is filled, confirm/final/rebid buttons are clicked, or the bid entry button is clicked.
- `yahoo-plugin/background.js`: multi-bid task timeout is now extendable. Base timeout is 60s, every `BID_PROGRESS` extends the deadline by 10s, and the hard maximum is 10 minutes.
- `yahoo-plugin/content.js`: cleaned several previously broken mojibake literals into stable Unicode escape / ASCII strings while validating the plugin after the timing change.

Recent verification:

```powershell
node yahoo-plugin\content.test.js
node yahoo-plugin\background.test.js
node yahoo-plugin\encoding.test.js
node --check yahoo-plugin\content.js
node --check yahoo-plugin\background.js
```

Result: all commands passed.

---

## 2026-06-13 确认收货流程取消订单检查

### 已实现内容

- 确认收货队列除原有 `pending_receipt` 外，新增拉取 `pending_payment`（待支付）和 `pending_settlement`（待结算）订单作为 `cancel_check` 检查任务。
- `cancel_check` 任务会打开订单的 `transaction_url`，兼容 `buy.auctions.yahoo.co.jp/order/status?auctionId=...` 页面。
- 插件确认收货页面状态解析新增取消识别：
  - `落札者削除されました`
  - `取引がキャンセルされました`
  - `キャンセルされました`
- 命中取消文案后，插件回写 `/api/plugin/confirm-receipt/status`，后端把订单状态更新为 `cancelled`。
- 后端取消回写只允许作用于 `pending_payment`、`pending_settlement`、`pending_receipt`，并写入订单状态审计日志，来源为 `confirm_receipt_cancel_check`。
- 用户端落札商品页已有取消展示：订单状态为 `cancelled` 时显示红色“取消”，整行背景为淡粉色，本次无需额外修改前端。

### 业务规则确认

- 待支付/待结算订单没有取消文案时，不执行确认收货按钮逻辑，也不回写状态，直接跳过该检查任务。
- 普通确认收货仍只对 `pending_receipt` 且 Google Sheets 颜色匹配的订单执行。
- 商城商品原有确认收货直接完成逻辑保留；新增取消检查通过 `jobType=cancel_check` 单独分支处理，避免误把待支付/待结算商城订单直接置为完成。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node yahoo-plugin\background.test.js
node src\shared\orderStatus.test.cjs
npm run regression
```

验证结果：以上命令均通过。

---

## 2026-06-12 Google 表格追加行默认白底黑字修复

### 问题

- 订单追加到 Google 表格时，新插入行会沿用上一行字体颜色，导致历史行如果被改成红色/其他颜色，新订单也可能不是默认黑色。
- Google Sheets `values.append` 插入的新行也可能继承表头或上一行背景色，普通订单行会变成淡蓝色等非默认背景。

### 已实现内容

- `appendRows()` 在 Google Sheets `values.append` 后，会对本次新增的 A:J 行执行 `repeatCell` 格式化。
- 新增行始终设置 `textFormat.foregroundColor` 为黑色 `{ red: 0, green: 0, blue: 0 }`。
- 普通新增行始终设置 `backgroundColor` 为白色 `{ red: 1, green: 1, blue: 1 }`，不再继承表头/上一行背景色。
- 如果调用方传入同捆背景色，继续使用同捆背景色覆盖默认白底，不影响原有按颜色标记/查询逻辑。

### 最近验证命令

```powershell
node src\server\services\googleSheets.test.js
node src\server\routes\plugin.test.js
```

验证结果：以上命令均通过。

### 后续补充目标：商品表渐进引入

- 用户确认长期目标采用 `products / tasks / orders` 更清晰的数据模型：`products 1:N tasks`，`products 1:0/1 orders`，`orders` 可保留 `task_id` 指向来源/成功任务。
- 该目标优先级排在当前维护性整理之后，当前阶段不改数据库、不做迁移、不切换读写路径。
- 推荐后续作为单独计划执行：
  1. 新增 `products` 表作为商品权威快照表。
  2. 任务提交/商品抓取时 upsert `products`，同时继续写 `tasks` 旧商品字段保持兼容。
  3. 插件商品快照/扫描流程逐步改为更新 `products.current_price / bid_count / end_time / last_scanned_at` 等实时字段。
  4. 用户端和后台列表逐步改为从 `products + latest task + order` 组合展示。
  5. `orders` 直接关联 `product_id`，并可保留 `task_id` 表示来源任务。
  6. 清理策略继续保护真实成功落札订单；扩展清理长期无效任务前必须先 dry-run 统计并明确保留规则。

---

## 2026-06-11 维护性整理第二部分实施记录

### 已实现内容

- 新增 `src/shared/shippingRules.cjs`，集中运费文本标准化、运费金额解析、订单是否可结算、同捆运费优先规则。
- 新增 `src/shared/payableRules.cjs`，集中后台订单应付款公式和 Google 表格应付款公式。
- 新增对应测试：`src/shared/shippingRules.test.cjs`、`src/shared/payableRules.test.cjs`。
- `src/server/routes/admin.js` 改为引用共享运费和应付款规则，保留原有导出名 `calculateOrderPayable`、`canSettleShippingFeeText`、`parseShippingFeeToNumber`。
- `src/server/routes/plugin.js` 改为引用共享 `normalizeShippingFeeText`、`parseShippingFeeToNumber`、`calculateSheetPayable`、`applySheetUserFinance`。
- 现有规则保持不变：`無料`、`着払い`、`落札者負担` 按 0 运费解析；普通商品 `落札者負担` 不允许结算；商城商品 `落札者負担` 允许按 0 运费结算；大金额费用按税后落札金额 `>=30000円` 生效。

### 最近验证命令

```powershell
node src\shared\shippingRules.test.cjs; node src\shared\payableRules.test.cjs; node src\server\routes\admin.orders.test.js; node src\server\routes\plugin.test.js
npm run regression
```

验证结果：以上命令均通过。

---

## 2026-06-12 普通落札者負担交易开始状态补偿

### 问题

- 普通商品且运费为 `落札者負担` 时，如果插件已在 Yahoo 取引页完成交易开始，但服务重启或异常导致 `/api/plugin/transaction-start/status` 回写失败，本系统订单状态会继续为空。
- 再次执行交易开始时，Yahoo 实际页面已经处于“送料連絡待ち / 支払い金額は送料決定後に確定”的支付阶段，没有可点击的 `決定する / 確定する` 按钮；旧逻辑可能写入 `button not found for trusted click` 错误，后台仍无法进入后续处理。

### 已实现内容

- `completeBidderPaysShippingTransaction()` 如果打开取引页时页面已经是 `waitingShipping`，会直接成功返回，不再尝试点击交易开始按钮。
- `executeTransactionStartJob()` 对上述恢复场景回写 `waiting_shipping`（等待运费），保持普通 `落札者負担` 的现有业务口径：运费还未确定前不是 `pending_payment`。
- 新增回归测试覆盖：普通 `落札者負担` 订单状态为空、Yahoo 页面已是等待送料确定的支付阶段时，插件必须回写 `waiting_shipping`，且不点击任何交易开始按钮。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node src\server\routes\plugin.test.js
node yahoo-plugin\encoding.test.js
npm run regression
```

验证结果：以上命令均通过。

---

## 2026-06-12 PIN 验证超时页恢复修复

### 问题

- 服务器 Chrome 中 Yahoo 登录/PIN 页如果停留过久，会出现“此请求已超时”弹窗。
- 后台已经显示 PIN 输入框并提交 PIN 后，插件可能只暂停 idle 流程，不会重新接管已打开的 PIN 页执行“刷新 -> 输入 PIN -> 进入验证码/后续页面”。
- 既有 `handleManualVerificationIfPresent` 虽然支持传入 `pinAnswer`，但普通 PIN 页分支仍可能重新创建新的 PIN 挑战并等待，导致已提交的 PIN 没有被直接使用。

### 已实现内容

- 新增插件只读接口 `GET /api/plugin/manual-captcha/current`，返回当前未关闭验证码/PIN 挑战的状态；用于插件恢复已回答的 PIN 挑战，不改业务数据表。
- 插件 idle 暂停遇到已打开 PIN 页时，会检查当前 PIN 挑战是否已经有后台答案；如有答案，则接管该 tab，先刷新页面，再输入 PIN，之后继续原有验证码/后续页面处理。
- `handleManualVerificationIfPresent` 支持外部传入的 PIN 答案直接使用一次；如果输入后仍停留 PIN 页，才重新要求后台输入，避免错误 PIN 无限复用。
- `waitForManualVerificationPageTransition` 增加最大轮询次数保护，避免异常环境下时间不推进导致等待循环无法退出。
- 新增回归测试覆盖 `login.yahoo.co.jp/config/login?src=auc&done=...` 这类超时登录页已有 PIN 答案后的恢复流程。
- 补充修复：PIN 输入后如果已经到达 `/ncaptcha` 文字验证码页，跳转选择优先停留当前验证码页；手动验证流程会绑定一个验证 tab 走完，旁边出现的新 PIN tab 会被标记为本轮重复验证页，后续 idle 轮询不会再接管它；验证码截图失败时也会用占位图覆盖后台挑战为 `captcha`，避免后台继续显示旧 PIN 输入框。
- 补充修复：验证码页优先从 Yahoo 页面 DOM 中提取可见 `img/canvas` 验证码图片，转为 `data:image/...;base64` 发给后台；只有 DOM 提取和 Chrome 截图都失败时才显示兜底提示，方便管理员无法登录服务器时仍可在后台查看验证码图片并输入文字。
- 补充修复：空闲轮询发现当前 active 验证页是 PIN 页时，会优先同步后台为 `type=pin` 挑战，即使服务端还残留旧验证码挑战或旁边还有旧验证码 tab；管理员提交 PIN 后下一轮继续走已回答 PIN 恢复流程，保证后台提示跟服务器 Chrome 当前 Yahoo 页面一致。
- 补充修复：验证码图片回传改为优先使用 Chrome Debugger `Page.captureScreenshot` 截取当前 Yahoo 页面已经渲染出的验证码区域，不刷新页面、不重新请求验证码图片 URL；普通 `captureVisibleTab` 作为第二截图兜底，只在截图都失败时才使用页面已有 `canvas/data:image` 的安全 DOM 兜底，避免后台图和 Yahoo 当前验证码不一致。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node src\server\services\manualCaptcha.test.js
node src\server\routes\plugin.test.js
node yahoo-plugin\encoding.test.js
npm run regression
```

验证结果：以上命令均通过。

---

## 2026-06-13 普通商品同捆开始流程修复

### 问题

- 服务器上普通商品同捆交易开始失败，后台显示 `bundle next page did not appear`。
- 真实页面流程为：同捆开始页关闭提示后，先点 `まとめて取引をはじめる`，进入お届け地域确认页，再点 `まとめて取引を依頼する`，之后才进入 `決定する` 页面。
- 原插件普通同捆交易开始只执行 `close -> start -> decide`。第一个 `start` 后如果进入 `まとめて取引を依頼する` 中间页，后台仍等待 `canDecide`，因此超时。

### 已实现内容

- 新增普通同捆专用 helper `completeNormalBundleRequest()`，只用于 `EXTRACT_TRANSACTION_START_INFO.available` 的普通同捆分支。
- 普通同捆点击序列调整为：`close -> start -> 如果仍有 canStart 再 start -> decide`。
- 未修改付款、商城即決、收货、Google Sheets、订单状态流转或三表模型逻辑。
- 新增 `yahoo-plugin/background.test.js` 回归测试，覆盖 `close -> start -> start -> decide` 的普通同捆中间页流程。

### 最近验证命令

```powershell
node yahoo-plugin\background.test.js
node yahoo-plugin\content.test.js
```

验证结果：以上命令均通过。

---

## 2026-06-13 后台在线用户页面

### 已实现内容

- 新增 `user_sessions` 表，用于记录前台用户端登录会话，包含用户、token id、登录时间、最后访问时间和失效时间。
- 前台 `/api/auth/login` 登录成功后记录会话；管理员 `/api/auth/admin-login` 不计入在线用户。
- 鉴权中间件会在前台用户请求 API 时刷新 `last_seen_at`，旧版无 `jti` 的 token 不会生成在线会话记录。
- 后台新增接口 `GET /api/admin/online-users`，只展示 `role='user'` 且 `expires_at` 未过期的用户会话，按用户聚合显示有效会话数。
- 后台底部新增菜单“在线用户”，页面展示用户名、用户类型、有效会话数、最近登录、最后访问、失效时间，每 30 秒自动刷新。

### 注意事项

- 该功能从部署后新登录的前台用户开始记录；部署前已经登录但 token 中没有会话 id 的用户，需要重新登录后才会显示。
- 在线用户只表示 token 未失效，不代表浏览器页面一定正在打开。

### 最近验证命令

```powershell
node src\server\services\onlineUsers.test.js
npm run build --prefix src\admin
```

验证结果：以上命令均通过。

---

## 2026-06-13 后台订单归属用户重分配

### 已实现内容

- 后台“订单管理”用户名列支持双击打开“修改订单绑定用户”弹窗。
- 用户选择控件沿用手动导入订单的可搜索下拉框，数据来自 `/api/admin/users/options`，展示所有非管理员用户（包含代理用户），排除管理员。
- 新增接口 `PUT /api/admin/orders/:id/user`，只允许绑定到 `role='user'` 的用户。
- 重分配会更新该订单来源任务，以及同一商品、原用户下的相关任务 `tasks.user_id`；不修改订单状态、付款金额、运费、结算字段或支付/交易流程。

### 最近验证命令

```powershell
node src\server\routes\admin.orders.test.js
npm run build --prefix src\admin
```

验证结果：以上命令均通过。

---

## 2026-06-13 在线用户活动判定修正

### 已实现内容

- 在线用户判定从“只看登录时写入的 `user_sessions`”调整为“有效前台用户 token 最近有 API 活动”。
- 鉴权中间件在每次前台用户 API 请求时会 upsert `user_sessions`，刷新 `last_seen_at`；旧版无 `jti` 的有效 token 会按 JWT 原文派生稳定 session id，因此不需要用户重新登录。
- 在线用户列表只显示 `expires_at` 未过期且 `last_seen_at` 在最近 15 分钟内的前台用户；管理员账号仍不计入在线用户。
- `role='user'` 但 `user_level>=3` 的前台管理员账号也不计入在线用户，避免 gaoyun 这类管理员在在线用户页显示为普通用户。
- 该功能表示“最近有活动的用户”，不是 7 天 token 未过期就一直在线。

### 最近验证命令

```powershell
node src\server\services\onlineUsers.test.js
```

验证结果：通过。

---

## 2026-06-13 三表模型 Task 1-7 实施进度

### 当前状态

- 已完成 `products / tasks / orders` 三表模型第一阶段实施，计划文件为 `docs/superpowers/plans/2026-06-13-three-table-product-model.md`。
- 新增 `products` 表作为商品快照表，并新增 `orders.product_id`；旧的 `tasks` 商品字段继续保留并继续写入，保证兼容。
- 启动时会幂等回填 `products`，并从来源 `tasks.product_id` 补齐 `orders.product_id`。
- 用户提交、后台手动导入、插件商品快照、入札中同步、落札同步已开始双写 `products`。
- 用户端展示类读路径已切到 `products + fallback tasks`：任务列表、入札中、落札商品、近 30 天落札统计导出。
- 后台订单管理列表也已对商品 URL、运费、税类型、商品类型使用 `products + fallback tasks`。
- 付款、交易开始、收货、Google Sheets、插件 idle action 顺序、订单状态流转仍保持原有 `tasks/orders` 字段读取，未切到 `products`，避免再次引入支付金额、运费或状态判断问题。
- 后台“按商品 ID 删除数据”会同步删除 `products`；自动/手动过期数据清理不会删除 `products`。
- 新增只读 parity 脚本 `scripts/check-product-parity.js`，用于上线前检查商品快照一致性。

### 本地 parity 检查结果

```powershell
node scripts\check-product-parity.js
```

输出：

```text
Product parity check (read-only)
Database: D:\www\g-daipai\data\gdaipai.db
tasksWithoutProductRow: 0
ordersWithoutProductId: 0
ordersProductIdMismatch: 0
productsLatestTaskSnapshotMismatch: 0
```

### 最近验证命令

```powershell
node src\server\services\productRepository.test.js
node src\server\services\dataCleanup.test.js
node src\server\routes\task.test.js
node src\server\routes\plugin.test.js
node src\server\routes\admin.orders.test.js
node scripts\check-product-parity.test.js
node scripts\check-product-parity.js
npm run regression
```

验证结果：以上命令均通过。

### 后续注意事项

- 生产部署前先停服务并备份 `data/gdaipai.db`。
- 生产部署后先运行 `node scripts\check-product-parity.js`，确认 4 个计数为 0 或可解释，再考虑后续阶段。
- 不要在本阶段删除 `tasks` 上的商品字段。
- 不要直接把付款、交易开始、收货、Google Sheets 等操作路径切到 `products`；这些属于后续阶段，需要覆盖商城即決、普通着払い、落札者負担、同捆和待发货等支付状态测试后再做。

---

## 2026-06-13 数据清理策略边界抽取

### 当前状态

- 把数据清理可删除状态从 `dataCleanup.js` 中抽到独立策略模块。
- 本次只整理“清理哪些任务状态”的边界，不修改支付、交易开始、付款任务、收货任务、插件轮询、idle action 顺序或任何订单状态流转逻辑。
- 清理范围保持不变：只清理超过保留天数的 `failed`、`cancelled`、`bidding` 任务及关联出价日志、订单和入札缓存。
- 成功落札数据继续明确保护：`success`、`pending`、`processing` 不纳入当前清理策略。

### 已实现内容

- 新增 `src/server/services/dataCleanupPolicy.js`：
  - `CLEANUP_TASK_STATUSES = ['failed', 'cancelled', 'bidding']`
  - `PRESERVED_TASK_STATUSES = ['success', 'pending', 'processing']`
  - `shouldCleanupTaskStatus()`
  - `buildCleanupStatusSqlList()`
  - `buildCleanupScopeDescription()`
- 新增 `src/server/services/dataCleanupPolicy.test.js`，覆盖可清理状态、保留状态和说明文本。
- `src/server/services/dataCleanup.js` 改为引用策略模块；保留原导出 `CLEANUP_STATUSES`，SQL 仍生成 `status IN ('failed', 'cancelled', 'bidding')`，避免影响现有测试和调用方。

### 最近验证命令

```powershell
node src\server\services\dataCleanupPolicy.test.js
node src\server\services\dataCleanup.test.js
npm run regression
```

验证结果：以上命令均通过。

---

## 2026-06-13 三表模型完善后的清理数据需求

### 当前状态

- 用户重新确认：后台“清理数据”涉及删除数据，属于破坏性操作，不应在三表模型仍处于渐进引入阶段时提前切换。
- 当前代码继续保留旧清理逻辑，不在本阶段改动：按已配置保留天数清理旧的 `failed/cancelled/bidding` 任务及关联日志/缓存。
- 本需求只作为三表模型稳定后的后续事项记录，避免现在提前实现后随着表结构变化再次返工。

### 后续业务规则

- 等 `products / tasks / orders` 三表结构和生产 parity 稳定后，再重做后台“清理数据”。
- 新清理语义以落札表为成功保护来源：`orders` 只记录成功落札商品；凡不在 `orders` 中的商品，都视为非成功商品，可按后台配置的保留天数清理。
- 清理对象应以商品维度处理：删除不在落札表中的过期商品对应的 `tasks` 和 `products` 数据，并同步清理关联 `bid_logs`、`bidding_items` 等缓存/日志。
- 新版本清理前必须先做 dry-run 统计，显示将清理的商品数、任务数、日志数、入札缓存数；确认不会删除 `orders` 中已落札商品后，再允许执行真实删除。
- 落札表中的商品必须被保护：只要 `orders.product_id` 存在该商品，关联 `products` 和历史任务不应被普通清理删除。

### 后续实现注意

- 不要在当前三表第一阶段直接实现该规则。
- 不要因为旧 `tasks.status` 是 `success` 就单独判断成功；三表稳定后的成功保护应以 `orders` 是否存在该 `product_id` 为准。
- 需要更新后台清理页面说明、清理日志字段和自动清理日志输出；建议新增 `product_count` 和 dry-run 结果展示。

---

## 2026-06-13 商品表类型缺失覆盖修复

### 问题

- 生产部署三表模型后，`node scripts\check-product-parity.js` 发现 `productsLatestTaskSnapshotMismatch: 1`。
- 具体商品 `v1233172964` 确认是真实商城商品，但 `products.product_type=normal`、最新 `tasks.product_type=store`。
- 根因：`upsertProductSnapshot()` 对缺失的 `product_type` 默认归一为 `normal`；入札同步等扫描快照不传 `product_type` 时，会把已有或真实的 `store` 覆盖成 `normal`。

### 已实现内容

- `src/server/services/productRepository.js` 调整商品快照归一逻辑：
  - 只有调用方明确传入 `tax_type/taxType` 时才写入 `tax_type`。
  - 只有调用方明确传入 `product_type/productType` 时才写入 `product_type`。
  - 缺失类型字段时传 `NULL`，由 upsert SQL 的 `COALESCE(excluded.field, products.field)` 保留已有商品表值。
- `src/server/services/productRepository.test.js` 增加回归测试，覆盖扫描快照缺失类型字段时不会默认写 `tax_zero/normal`。

### 最近验证命令

```powershell
node src\server\services\productRepository.test.js
```

验证结果：通过。

---

## 2026-06-13 普通商品同捆付款金额校验修复

### 问题

- 普通商品同捆付款时，Yahoo 付款页展示的是同捆组整体应付金额。
- 旧逻辑中插件付款校验只按当前付款主订单计算：`主商品落札价 + 同捆运费`。
- 业务确认：同捆付款金额应为 `同捆组全部商品落札价合计 + 同捆运费`。例如主商品 1000 円、子商品 500 円、同捆运费 200 円，付款页应核对 1700 円，而不是 1200 円。

### 已实现内容

- `src/server/routes/plugin.js` 的 `/api/plugin/payment/jobs` 付款任务增加 `paymentFinalPrice` 字段。
- 有 `bundle_group_id` 的付款任务会汇总同组 `pending_settlement` 主订单和 `bundle_completed` 子订单的 `orders.final_price`，作为付款页金额校验的商品合计。
- `finalPrice` 继续保留为当前主商品落札价；插件付款金额校验优先使用 `paymentFinalPrice`，再加 `effectiveShippingFeeText`。
- `yahoo-plugin/background.js` 付款校验现在会按 `paymentFinalPrice + 同捆运费` 比对 Yahoo 页面 `お支払い金額`。
- 新增回归测试覆盖服务端同捆付款 job 汇总金额，以及插件同捆付款金额校验。

### 最近验证命令

```powershell
node src\server\routes\plugin.test.js
node yahoo-plugin\background.test.js
node yahoo-plugin\encoding.test.js
npm run regression
```

验证结果：以上命令均通过。

---

## 2026-06-13 商城商品税后价最低出价校验修复

### 问题

- 前台提交商城商品时，用户选择“税后价”并输入的最高出价已经等于或高于提示里的最低可出价，仍被提示“最高出价不能低于最低可出价”并阻止提交。
- 真实截图场景：
  - 当前税后价 33,049 円，最低加价 550 円，最低可出价 33,599 円，用户输入 33,599 円仍被拦截。
  - 当前税后价 31,350 円，最低加价 550 円，最低可出价 31,900 円，用户输入 32,500 円仍被拦截。
- 根因：提示文案按税后输入口径计算最低价，但实际比较时把税后输入先折回税前，再拿税前值和税后最低价比较，导致 33,599 被折为 30,544 后错误判定低于 33,599。
- 业务补充确认：税后输入场景也必须以 Yahoo 税前口径判断。先按税前当前价 + Yahoo 税前最低加价得出最低税前价，再向上换算成税后提示价；遇到 1 円折算差额时按多 1 円提示，避免提交后税前价偏低。

### 已实现内容

- `src/client/src/utils/bidPrice.js` 修正商城商品税后价最低出价提示：最低要求先按税前价计算，再用 `ceil(税前最低价 * 1.1)` 向上换算成税后最低提示。
- 税前价输入模式保持原逻辑不变；税后价输入模式会把 33,599 这类折算后低 1 円的边界提示为 33,600。
- `src/client/src/utils/bidPrice.test.mjs` 增加回归测试，覆盖税后价边界需要向上补 1 円、以及明显高于最低可出价两个场景。
- 服务端提交接口未发现同类最低可出价二次校验；本次修复点限定在前台提交页价格校验。

### 最近验证命令

```powershell
node src\client\src\utils\bidPrice.test.mjs
npm run build --prefix src\client
node src\server\routes\task.test.js
```

验证结果：以上命令均通过。
