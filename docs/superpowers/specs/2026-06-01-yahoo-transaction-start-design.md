# Yahoo 落札订单交易开始设计

最后更新: 2026-06-01

## 目标

在插件空闲同步时，除了现有入札中同步和落札同步，增加落札订单的“交易开始”操作。交易开始只处理订单状态为空的落札订单；执行后订单必须进入以下状态之一：

- `pending_payment`: 待支付
- `waiting_shipping`: 等待运费
- `pending_bundle`: 待同捆

自动交易开始每天只触发一次，默认北京时间 1 点。后台可手动触发，手动触发可多次执行，但仍然必须经过现有空闲同步间隔和出价保护窗口。

## 范围

本阶段实现空闲操作调度骨架和交易开始操作。扫描、付款、确认收货只预留调度位置，不实现 Yahoo 页面动作。

## 数据模型

在 `orders` 表新增兼容列：

- `transaction_url TEXT`: Yahoo 取引連絡链接，从 `/my/won` 同步时抓取。
- `bundle_group_id VARCHAR(64)`: 同捆组标识，同一组商品写同一个值。
- `transaction_started_at DATETIME`: 交易开始处理成功时间。
- `transaction_start_error TEXT`: 交易开始失败原因，成功后清空。

复用现有 `orders.order_status`：

- `pending_payment`: 待支付。商城商品直接进入；普通商品且运费不是 `落札者負担` 也进入。
- `waiting_shipping`: 等待运费。普通商品且系统运费为 `落札者負担`，没有同捆时进入。
- `pending_bundle`: 待同捆。同捆依赖已发起，等待出品者联络。

`tasks.product_type='store'` 判定商城商品；其他按普通商品处理。

## 配置

后台“入札、落札配置”改名为“入札、落札、交易开始、扫描、付款、收货配置”。保留现有参数：

- 空闲同步间隔
- 出价保护窗口
- 多次出价参数

新增参数：

- `transaction_start_hour`: 交易开始自动执行整点，默认 `1`，范围 `0-23`。
- `transaction_start_requested`: 手动执行标记，后台按钮置为 `1`，插件执行成功或没有可处理订单后清零。
- `transaction_start_last_run_date`: 自动执行日期，格式 `YYYY-MM-DD`，用于保证每天只自动触发一次。
- `scan_start_hour`: 扫描开始整点，默认 `1`。
- `scan_end_hour`: 扫描结束整点，默认 `20`。
- `scan_every_idle_runs`: 扫描间隔计数，默认 `5`。
- `scan_idle_counter`: 入札/落札后没有执行更高优先级动作时累加。

建议后台默认把出价保护窗口设置为 15 分钟。

## 空闲操作调度

插件仍然先通过 `/api/plugin/task` 判断是否有出价任务以及是否允许空闲同步。只有 `canIdleSync=true` 时才执行后续空闲操作。

一次空闲同步流程：

1. 执行入札中同步。
2. 执行落札同步，并保存落札订单的 `transaction_url`。
3. 请求 `/api/plugin/idle-action/next` 获取一个后续动作。
4. 按优先级最多执行一个后续动作：交易开始、扫描、付款、确认收货、无动作。

后续动作优先级：

1. 如果交易开始 flag 为 1，执行交易开始，完成后清零。
2. 否则如果扫描计数达到配置次数且当前小时在扫描时间范围内，执行扫描并清零计数。
3. 否则如果存在付款任务，执行付款。
4. 否则如果确认收货 flag 为 1，执行确认收货并清零。
5. 否则扫描计数加 1。

每天到达 `transaction_start_hour` 后，服务端把交易开始 flag 视为 1，并写入当天 `transaction_start_last_run_date`，避免同一天重复自动触发。手动触发直接把 `transaction_start_requested=1`。

## 交易开始服务端接口

新增插件接口：

- `GET /api/plugin/transaction-start/jobs`: 返回全部订单状态为空的候选订单，不限制 20 条。
- `POST /api/plugin/transaction-start/status`: 插件回写单个或一组订单处理结果。
- `POST /api/plugin/idle-action/complete`: 插件回写空闲动作完成，用于清 flag 和计数。

候选订单条件：

- `orders.order_status IS NULL OR order_status = ''`
- 关联 `tasks.status='success'`
- 已有 `orders.final_price`

服务端可直接处理商城商品：如果 `tasks.product_type='store'`，不用下发给插件，直接写 `pending_payment` 和 `transaction_started_at`。

普通商品必须有 `transaction_url`。如果缺失，订单保持空状态并写 `transaction_start_error='missing transaction_url'`，方便下一次落札同步补齐后重试。

## Yahoo 页面执行

插件普通商品流程：

1. 打开 `orders.transaction_url`。
2. 如果出现“まとめて取引できます”弹窗，点击“閉じる”。
3. 判断页面是否存在“まとめて取引を依頼できる商品”区域。
4. 如果存在同捆区域：
   - 抽取页面显示的 `X件（落札数量：X）`。
   - 抽取同捆列表商品 ID。
   - 校验抽取数量等于页面显示数量，且商品 ID 不重复。
   - 调服务端校验这些商品都已存在对应空状态或未处理订单；校验失败则不点击 Yahoo 按钮，记录错误。
   - 写入同一个 `bundle_group_id`，订单状态为 `pending_bundle`。
   - 点击“まとめて取引をはじめる”。
   - 在确认页选择配送地区，默认使用当前页面已有默认值；没有默认值时选择后台配置或固定大阪府。
   - 点击“決定する”。
   - 看到“まとめて取引を依頼中です。出品者からの連絡をお待ちください。”后关闭 tab。
5. 如果不存在同捆区域：
   - 运费不是 `落札者負担`，回写 `pending_payment`。
   - 运费是 `落札者負担`，回写 `waiting_shipping`。
   - 关闭 tab。

同捆操作必须先完成本系统数量校验，再点击 Yahoo 的发起同捆按钮，避免系统标记和 Yahoo 实际操作不一致。

## 落札同步增强

`content.js` 的 `/my/won` 抽取需要在每个订单容器中额外寻找“取引連絡”链接，并作为 `transactionUrl` 回传。服务端 `/api/plugin/orders/sync` 在 upsert 订单时保存到 `orders.transaction_url`。

实现前先用本地已登录 Yahoo 落札页面验证是否能从 `/my/won` 抽到该链接。

## 后台展示

订单管理页：

- 订单状态增加“等待运费”“待同捆”展示。
- 商品 ID 后已有商品类型标识保持不变。
- 可增加“交易链接”或错误提示列，便于排查 `transaction_url` 缺失和同捆数量校验失败。

配置页：

- 页面标题改为“入札、落札、交易开始、扫描、付款、收货配置”。
- 增加交易开始整点输入。
- 增加“手动执行交易开始”按钮。
- 增加扫描时间范围和间隔次数输入。

## 错误处理

- Yahoo 未登录：沿用现有登录状态上报，停止本次交易开始。
- `transaction_url` 缺失：不打开商品页，记录错误，等待落札同步补齐。
- 同捆数量不一致：不点击 Yahoo 同捆按钮，记录错误。
- 同捆商品未在系统订单中找到：不点击 Yahoo 同捆按钮，记录错误。
- 页面按钮找不到或确认文案没出现：记录错误并关闭 tab，下次仍可重试空状态订单。

## 测试

服务端：

- 自动交易开始每天只触发一次。
- 手动交易开始可多次触发。
- 商城订单直接变 `pending_payment`。
- 普通订单按运费变 `pending_payment` 或 `waiting_shipping`。
- 同捆组批量写 `pending_bundle` 和同一个 `bundle_group_id`。
- 同捆数量校验失败不改状态。

插件/content：

- `/my/won` 能抽取 `transactionUrl`。
- 交易页能识别同捆弹窗、关闭按钮、商品列表、数量文本、确认按钮、完成文案。
- 非同捆页面不会误判为同捆。

回归：

- `node src\server\routes\plugin.test.js`
- `node src\server\routes\admin.orders.test.js`
- `node yahoo-plugin\content.test.js`
- `node yahoo-plugin\background.test.js`
- `Set-Location src\admin; npm run build`
