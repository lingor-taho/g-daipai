# g-daipai 项目说明与当前计划

**最后更新**: 2026-10-26

本文件是后续接手本项目的主说明和计划记录。只保留当前仍有用的架构、业务规则、生产注意事项、验证命令和下一步计划；已解决且无后续价值的流水记录不要继续堆在这里。

---

## 维护约定

- 每次重要改动后，更新本文件的“当前状态 / 当前主计划 / 最近重要变更 / 验证命令”。
- 真实生产问题只记录结论、影响范围、修复方式和后续注意，不记录冗长排查过程。
- 已确认解决且不再影响后续设计的问题，可以从“当前主计划”移除。
- 新计划优先放在本文件“当前主计划”；复杂计划再另存到 `docs/superpowers/plans/`。
- 修改数据库、插件支付/交易/扫描、任务状态流转前，必须先确认本文件中的业务边界。
- 兼容 Yahoo 页面改版时复用原流程，只调整页面按钮／文字识别；同捆拒绝关闭弹窗后直接走原普通商品流程，不另建业务分支或跳过原判断。后续功能能复用原流程就复用，不自行扩大规则范围。

---

## 项目概述

2026-10-26 按用户新授权，代理互斥补齐API最终校验：在原商品锁内、SQLite立即写事务中先按实际提交用户查组策略与冲突，再分配Yahoo账号及建任务；默认exclusive只允许首个无本人任务的同组用户进入，HTTP并发及独立Node进程并发均验证只有一条任务／归属。本人已有该商品任意状态任务仍优先放行，已有多人参与均可各自续拍；第三个首次用户继续拦截。前端预检保留，与API共用组归属／冲突SQL；confirm／allow仍走原多账号分配，自动加价／内部续拍不加拦截。单条／批量逐件及管理员代下属均覆盖，无schema／后台／插件变化；本项只需更新API task.js和agentProductPolicy.js并重启，未部署，详见0at。

2026-10-26 用户端手机任务列表长标题撑宽及字体自动放大已本地修复：任务列表独立作用域下内容flex项允许收缩、长英文任意位置换行，保留13px标题／12px说明及原状态／终止操作。根html设置text-size-adjust与-webkit-text-size-adjust为100%，不禁止用户手动缩放；提交页内嵌列表同步生效。仅用户端静态样式，发布用户端dist，无API／后台／插件／schema变化；320／393／1200浏览器及构建通过，iPhone真机待更新验收，详见0as。

2026-10-26 重新提交任务后刷新旧拍卖记录已本地接入：普通／商城用户单条及批量任务创建成功时，在原账号分配／建任务事务中清空已有auction_history_html、auction_history_data；重复请求、校验／分配失败不清空，自动多次加价／低价续拍、扫描及快照更新不触发。移除本商品旧采集队列项并作废领取，迟到结果不能回写，其他商品继续；沿原手动／定时流程等本轮结束再采。复用config保存本轮旧订单边界，未变化的旧落札订单不触发提前采集，新订单／新won_at沿原落札时间采集，成功／过期入库后清理标记。无schema／订单历史／任务历史／前端／插件变化；更新API task.js及auctionHistory.js并重启，未部署或修复生产c1248070488，详见0ar。

2026-10-26 代理组策略补齐本人已有任务优先：查询组内冲突时逐商品排除当前提交用户已存在任意状态任务的商品；即使同组多人已分别提交，彼此后续加价／再次提交均沿原规则。本人无该商品任务时仍按组策略互斥／提醒，第三个新用户不放行；不同账号不影响本人资格，批量逐商品判定。只调整services/agentProductPolicy.js的只读查询，无前端／任务提交API／账号分配／schema变化；需更新该服务并重启API，无需重发两端dist或插件。验证见0aq，未部署。

2026-10-26 用户端管理员切换到代理级用户后，退出后同样显示齿轮，读取及修改当前代理的原组策略；切到普通用户隐藏。设置API用数据库中的登录等级和原切换权限核验目标，代理本人仍只改本组，普通用户不能设置。设置请求固定当前用户上下文，切换时关闭菜单并忽略旧请求返回，避免串组。复用原config键，无schema／任务API／后台／插件变化；需更新auth路由重启API和用户端dist，验证见0aq，未部署。

2026-10-26 用户端代理组同商品策略已本地接入：登录代理级用户或选中代理的用户端管理员在退出后显示齿轮，下拉三选一，默认互斥；服务器复用config按代理ID保存。代理本人及直属普通下属提交时先一次查询策略和组内其他用户的商品任务，任意任务状态均占用，同用户不互斥、不同代理组隔离。用户端决定阻止／继续确认／直提，再沿原多账号分配；任务API、后台及插件不重复执行代理策略。批量同样提交前整批检查，互斥或取消时保留输入、不入队，提示列出冲突商品。需更新auth路由及新服务并重启API、更新用户端dist，无schema／后台／插件变更；未部署或操作真实任务，详见0aq。

2026-10-25 主／备用账号后台验证界面统一复用ManualVerificationAlert：沿原普通Input、日文输入／回车提交、确认中及关闭反馈，账号参数保持隔离。插件新增PIN前无邮箱输入框的手机确认码发送页分支：只点“他の方法でログイン”，弹层只点“パスキー”，不点发送确认码／SMS；中途日文验证码与PIN沿原流程，锁定单个验证标签、不刷新前置页；接管本轮新子页后关闭原页及本轮重复页，验证码／PIN互跳只接管本轮所属新页。允许两轮，第三次进入停止并显示“登录方式跳第三次验证，请人工处理！”，session持久化次数及失败，不自动重放失败。需更新插件background.js并reload、API services/manualCaptcha.js并重启、后台dist；无用户端／schema变化，未部署或操作真实登录。详见0ap。

2026-10-25 普通商品即时拍补齐已有最高出价成功识别：仅normal＋direct＋bid，复用原可见最高入札者状态及自动入札上限，已有上限达到或超过任务max_price时沿原success／noBid回写，不使用noStatus，不再次出价。定时／多次／商城／即决、其他出价及税额校验保持。仅更新插件content.js并reload，无API／两端dist／schema变化，未部署或修正生产任务v1245429643，详见0ao。

2026-10-25 邮箱前置验证已本地改为连续交接原文字验证码／PIN：邮箱及PIN复用单个登录标签，锁定后也清理重复登录页，本次子标签接管后关闭原验证页。首次沿原刷新一次，返回邮箱第二次直接收取新邮件并单次提交，不刷新Yahoo、不复用已用邮件；第三次进入邮箱停止并提示“邮箱跳第三次验证，请人工处理！”。次数及已读邮件标识保存Chrome session，工作进程重启不重置上限，完整验证完成或验证页消失后清理；不保存验证码。主／备用后台第三次报错均隐藏继续，API拒绝继续。仅邮箱成功不能结束整个流程，仍交原PIN；PIN刷新跳回邮箱先交接、不填PIN。需更新插件background.js并reload、API services/manualCaptcha.js并重启及后台dist；无用户端／schema变更，未部署或操作真实登录。详见0an。

2026-10-22 顶部未发货超期提醒改由后台原idle-flags轮询按各账号系统订单生成，不再依赖插件识别Yahoo未发货页面。仅读pending_shipment，起算时间沿原最近进入待发货的审计时间、缺失回退订单updated_at／created_at；超过7个完整日才提醒。复用原shipment-{订单ID}-{完整天数}去重、关闭后同一天不重弹、下一天继续提醒及扫描确认发货／取消后的自动关闭，原提醒文案保持。物流扫描、订单状态、金额及账号归属不变。仅更新API routes/admin.js、routes/plugin.js并重启，无插件／两端dist／schema变化；未部署或修改生产订单，验证与注意见0am。

2026-10-21 后台消息订单的P读取／发送已按用户提供trade/buyer页面本地适配：按已存fleamarket类型直达同商品secure交易页，不再回退普通落札列表；仅读消息列表，空列表沿原暂无消息标记。发送仅填该消息框、等待“取引メッセージを送る”可用后单次点击，新增匹配消息出现才确认成功，不点评价。消息转成原dl/dd及已支持v2标记，沿原API存储与两端展示，用户端无需修改。仅发布插件background.js并在各账号reload，无API／两端dist／schema更新；未部署或发送真实消息，附件无历史消息，非空结构用模拟数据验证，真实有消息页待验收，详见0al。

2026-10-21 旧P成交时间补充独立维护脚本scripts/repair-fleamarket-order-time.js及根目录双击入口repair-fleamarket-order-time.bat。默认只读预览，--apply先用SQLite在线备份并检查备份，再在单个立即事务内仅更新products.product_type=fleamarket且满足旧UTC时刻与日本文字对应的orders.won_at；已一致、缺失或矛盾记录跳过，不按Z前缀判断。普通／商城、显示文字、金额、状态、账号、物流及任务保持。生产只读核验z708102256订单2444原14:45:23.838Z／文字10/20 23:45，应按现有口径转为15:45:00.000Z；普通d1248717488订单2440原14:52Z／文字22:52。用户已反馈更新重启API，历史修复尚未执行；现有debug API只读，不增设写接口。运行方式与验证见0ak。

2026-10-21 按用户要求，P成交时间的保存／读取统一沿普通／商城现有口径：共用原normalizeYahooWonTimeText，将日本时间文字按服务器本地时区解析为won_at；won_time_text仍保存日本时间文字，成交列表共用原按won_at倒序及文字优先展示。普通／商城逻辑原样保留，不统一改成实际UTC时刻，不自动重写已有P订单。需更新API routes/plugin.js、services/fleamarketPurchase.js和新增services/yahooWonTime.js并重启，无两端静态／插件／schema变化，未部署生产，验证见0aj。

2026-10-19 用户端顶部登录用户名过长时单行省略，退出及风格控件禁止压缩换行；登录页复用原localStorage凭证自动进入提交页，并补齐标准账号／密码自动填充及表单提交语义。未登录时回填已保存用户名，不保存明文密码；原7天有效期及API失效校验保持。仅用户端dist更新，无API／插件／schema变化；手机微信实际存储保留仍需部署后验收，验证见0ai。

2026-10-19 后台批处理“订单状态更新”新增“取消”（cancelled），复用原按商品ID更新对应订单及状态审计流程，结果显示“取消”；普通／商城／P均支持。保留为空／完了／待发货原选项，不改任务、金额或Yahoo交易动作。需更新API routes/admin.js并重启、后台dist；无schema／插件／用户端变化，未部署或修改生产订单。

2026-10-18 P单条任务提交改用普通／商城类似的信息复用：前端商品快照齐全时直接创建任务，不再强制访问Yahoo；P无截止时间不触发补抓，信息缺失仍沿原抓取兜底。重复任务／已有订单／结果未知拦截保留，实时可购买性及最终商品价格由原插件领取后核验。仅需更新API task.js并重启，无插件／两端静态／schema变化；未部署或操作真实购买，详见0ag。

2026-10-18 收藏列表标题下复用搜索列表类型展示：普通绿色全称标签、商城红色全称标签、P使用Yahoo!フリマ标识；仅读收藏已保存类型，旧收藏缺类型时不猜测，沿原查看后补齐机制。仅用户端展示，更新用户端dist；验证：ProductSearchPopup展示检查、用户端构建、390／1200浏览器检查、编码与diff检查，无API／插件／数据库变化。

2026-10-18 按用户新范围补齐此前暂缓的P类型判断：已入库任务／订单／恢复／交易与付款排除／拍卖记录／Google商品链接改以products.product_type为准，移除后续流程的Z ID及旧URL兜底，快照归一化不再把Z自动改P。插件按任务／订单下发类型分流；缺类型停止执行，P合法ID及同商品URL核验保留。收藏补存productType及按类型生成的URL，旧收藏先读取商品详情，优先核对商品表类型再回填本地；再入札／详情跳转携带类型，初次无类型的用户输入仍走原识别。无schema变更，需同步更新API／shared、用户端dist及各账号插件background.js并reload，详见0af。

2026-10-17 首页抓取卡类型全称标签已沿用成交商品页的类型配色：普通绿色、商城红色、P紫色，移除全称模式的统一蓝色覆盖；共用全称标签的搜索列表同步一致，文字和布局保持。仅用户端静态展示，更新用户端dist，验证见0ae。

2026-10-17 按用户限定，仅管理端商品链接改为商品表类型权威：订单／查询订单／任务／队列／下一任务／两类报表／两类CSV／顶部Google失败、未发货、付款文字和拍卖记录提醒，全部由products.product_type选择域名，不按Z前缀或旧URL兜底。缺失／无效类型不生成链接，批处理提示后停止该件更新。管理端刷新额外传已存类型，HTTP／浏览器抓取及缓存也按该类型隔离，快照URL沿本次类型链接写回；proxy默认用户抓取行为保持。Google实际写表、插件／购买／物流／收货／拍卖采集／快照类型归一化规则未改，详见0ad。

2026-10-17 P商品链接遗漏已本地统一修复：共享productUrl.cjs按类型／Z ID生成フリマ链接，缺URL及旧拍卖URL都兼容；后台查询订单／报表／任务／下一任务／订单和两类CSV、用户端成交／再入札／统计及统计API采用共享函数。后台刷新运费／类型使用正确抓取及写回URL，类型刷新支持fleamarket。普通p开头拍卖ID保持普通链接。不改真实历史数据／订单状态，部署需更新API与共享文件并重启、更新两端dist，详见0ac。

2026-10-17 P商品列表文案统一为“购入成功／购入价／购入时间”，普通／商城保留原落札文案，共用成交商品导航及页面标题保持。仅用户端显示变更，无价格／状态／数据库变化，验证与部署见0ab。

2026-10-17 P下架商品已本地接入原已结束展示：抓取P页若缺少有效“購入手続きへ”购买按钮（主item_buy_button或同商品secure order入口）即auctionStatus=ended；原JSON-LD缺货判断仍保留。用户提交页在本次读取时固定P结束标志，复用图片红色已结束角标并隐藏全部出价设置／提交表单，不加其他页面角标或定时刷新。服务端原P最新信息结束校验直接阻止任务创建。需更新API proxy.js并重启及用户端dist，无schema／插件／后台变化，详见0aa。

2026-10-17 P商品成色显示已本地修复：原解析仅把JSON-LD NewCondition映射新品，UsedCondition忽略具体成色而返回空，导致z705858626详情显示未显示。现优先读取商品信息表“商品の状態”右侧文本，并用同表商品ID匹配目标，返回“やや傷や汚れあり”等原站具体成色；缺表仍保留原NewCondition新品回退，不猜二手等级。成色提取本身不改价格、普通商城解析或交易流程；P出售状态的最新按钮规则见0aa。仅更新API proxy.js并重启，无schema／插件／两端静态变化，详见0z。

2026-10-17 P商品Google写表失败已本地修复：生产z705858626订单2339已待收货且物流完整，但C列商品链接校验仅支持拍卖URL，P/item/链接被拦在Google请求之前。productIdsFromSheetCell补齐官方P链接识别，写前校验及已有行查重共用；后台各商品提醒链接统一按P／普通选择正确域名。P扫描HTTP测试改为经过真实appendRows服务、只模拟Google传输，覆盖此前漏测校验。需更新API googleSheets.js并重启及后台dist，无schema／插件／用户端变化；部署后用原待收货补表格修复历史失败单，已存在则跳过。未操作生产或真实表格，详见0y。

2026-10-17 P确认收货新增中间成功提示适配：提交评价后可先出现“受取評価と取引が完了しました”弹窗，仅读该可见弹窗内OK并单次点击，再等待“すべての取引が完了しました”最终标题才沿原API回写完了；打开时已有该弹窗也先关OK再只读核对，不重新评价。普通／商城流程不变，仅插件background.js更新后reload，无API／数据库／两端静态变更，详见0x。

2026-10-17 P确认收货已按真实HTML本地接入：沿原Google颜色匹配与工作领取，进入同商品trade/buyer后勾选“商品の内容を確認しました”，按钮可用才点击“受取評価をして取引を完了する”，如出现0x的结果提示先单次点击OK，仅读到可见完成标题“すべての取引が完了しました”后沿原API更新completed（完了）。已人工完成页面直接already_completed回写，不点击；失败不写成功。新增动作仅P分支，普通／商城原收货主体不变。批量弹窗P跳过提示移到输入标题正上方并全行标红。需更新插件并reload及用户端dist，无API／schema更新，详见0w。

2026-10-17 P已发货页已按用户HTML本地适配：同商品trade/buyer页可见标题“商品の到着をお待ちください”确认已发货，#deliverystatus右侧链接读取单号，物流公司按用户最新要求固定“お問い合わせ”。单号完整后沿原扫描API进入待收货并写Google表格，渲染未完成／单号冲突暂缓不写空值；确认收货现已按0w适配。仅更新插件background.js并reload，无API／schema／两端静态变化，详见0v。

2026-10-17 后台订单管理及查询订单中，商品ID后的类型标识补齐紫色P（product_type=fleamarket），普通绿色普／商城红色商保持原样。仅后台静态展示，需更新后台dist，无API／数据库／插件变化，详见0u。

2026-10-17 P购买金额规则已按用户最新要求改为商品原价：最终弹窗仅核对商品摘要“送料無料”旁价格与任务提交价；不读取支付合计，不因优惠券／积分或0元实付中止。API begin校验itemPrice后沿原方式保存确认意图，成功页仍需同商品done URL＋「購入が完了しました」，订单final_price取任务已核对原价（11700商品即使实付10880仍存11700）。需同步更新API并重启、插件background.js并reload，无schema／两端静态变化，未部署或真实购买，详见0t。

2026-10-17 用户端关键词搜索仅一件且无后续页时，输入框改回填完整商品链接，并使用同一链接抓取详情；普通／商城优先原 standardUrl、缺失时使用原拍卖详情URL，P始终使用paypayfleamarket的/item/URL。多结果选择与直接ID输入流程保持。仅更新用户端dist，无API／插件／数据库结构变化；验证见0s。

2026-10-17 本地隐藏 P 商品首页抓取卡的拍卖次数，普通／商城保持；入札中再入札按钮在原图片下方与图片右边缘对齐。按日期强制清理发现同样遗漏账号归属，现与显式商品删除共用完整关联清理和商品锁，整批同步事务失败全部回滚，预览与删除共用统计条件。原按 won_at 选中整件商品、删除其全部用户／全部账号记录的范围不变，包含 P 商品；后台提示已说明，未部署或清理生产数据，详见0r。

2026-10-17 后台“删除商品数据”已本地补齐快照和多账号归属清理：原任务删除只把 yahoo_product_assignments.task_id 置空，商品／账号／用户占用行仍留存，导致换用户无法提交。现按目标商品在同步事务中清理所有账号归属、快照、任务／订单及关联数据，包括无任务的孤立归属、按product_id关联的孤立订单；删除失败整体回滚，批量逐件返回错误。提交与删除复用按商品串行锁，清理旧批量行并阻止持有已删批量行的旧准备任务重新写入。隔离数据库已复现并验证“原用户提交→旧删除遗留→修正删除→不同用户复用原Yahoo账号成功”，其他商品／用户／账号数据保留。需更新API并重启后，对生产z705858626重新执行删除；本轮未修改生产数据，详见0q。

2026-10-17 P功能整体审查已补充异常恢复与边界：购买结果未知后，插件可领取原成交账号下超过2分钟未更新的P任务，只读打开同商品done页核对双成功标识／金额，确认后沿原原子接口补建待发货订单；不点击购买、不重新入队、不换账号。领取轮换并限制并发／重复领取，未确认则保留未知并退避。购买begin明确4xx拒绝不再误记为未知；网络断线／5xx仍保守处理。P重复提交在详情抓取前拒绝（待执行／未知结果／已有订单），商品快照只用本次读取数据，忽略旧客户端的截止时间／标题／当前价／图片／运费／入札数。普通交易开始与付款队列增加P排除，普通商品保留原流程。详见0p；未部署、未真实购买或收货。

2026-10-17 P 商品交易扫描沿原订单队列：为P单独新开secure `/item/{id}/trade/buyer`，明确未发货文字保持待发货；最新已发货标题／单号／固定“お問い合わせ”的适配见0v。状态和Google写表沿原API。确认收货已按0w接入，人工已完成页可直接同步。拍卖记录仍要求html与data两字段均为空，P在入队／领取／回写排除，不影响小写p前缀普通商品；详见0o。

2026-10-17 P 商品独立购买流程已本地接入（替代下方旧阶段的“实际购买未接入”）：插件打开フリマ商品页，点击「購入手続きへ」，可选关闭置き配初期设置提示，再点击「購入内容を確認する」与确认弹窗「OK」。等待处理中页面，必须同商品 secure `/item/{id}/order/done` URL 与「購入が完了しました」文字共同出现才回写成功；不使用此前误写的等待发货文字。任务成功与订单 pending_shipment 在同一事务提交，直接写成交账号／金额／时间，不从落札页补单，不进入普通交易开始／付款／扫描。最终 OK 前持久化结果待确认标记，中断后不自动重买；领取与重复回写保护保留。详见0n，未部署、未操作真实购买或生产数据。

2026-10-17 上轮集成检查：`npm run regression` 完整通过，覆盖P单条即决／批量逐行跳过、后台导入排除P、多账号任务／订单、原交易／付款／验证码、两端构建及手机／PC浏览器。商品类型／详情／收藏URL、再入札布局及成交列表展示按0j～0m的最新要求整合；历史分阶段验证记录保留。上述上轮改动已同步GitHub，未部署生产。

2026-10-17 用户端批量及成交列表已本地调整：批量逐行跳过P商品，统一提示「不支持フリマ商品！」，普通／商城行仍原顺序入队；全P批次也无详情抓取／任务写入。现有批量持久化结果保留逐行跳过原因，前端入队后立即提示。导航与页面标题改「成交商品」；仅P列表项使用成交成功／成交价／成交时间，图片下仅保留可编辑备注旗子，暂停图标、拍卖记录图标及最高价小图表隐藏。普通／商城条目的落札文案、图标与图表不变；无订单状态或时间数据改写。需更新API task.js、共享fleamarket.cjs／batchBid.cjs和用户端dist并重启API，无schema／插件改动，未部署，详见0m。

2026-10-17 按最新要求开放P（fleamarket）单条即决任务提交（替代0h禁购）：移除首页暂不可购买提示和表单隐藏，P强制即决／direct，价格与策略控件沿原仅即决规则锁定；API保留フリマURL与商品类型，核对最新商品和精确即决价格，拒绝缓存兜底、已售出、缺价格、价格变化及ID不符，不生成定时／跟随加价任务。原批量入口仅支持普通即时竞价，P仍提示改用单商品入口。后台导入P跳过规则保持。首页抓取卡移除标题前的普／商／P，仅保留原全称标签与信息；详情和列表类型标识不改。只开放任务提交，不接入插件フリマ实际购物流程；未操作真实购买或生产数据，详见0l。

2026-10-17 后台导入订单已本地跳过 P（fleamarket）商品：插件扫描落札列表时先按类型／Z ID／フリマURL过滤，不抓详情、不上报候选；若补抓快照才识别フリマ也不加入。API接收再过滤，旧批次确认时先把待处理フリマ标为 skipped_unsupported 并忽略其分配，不创建商品／任务／订单；普通（含小写p开头拍卖ID）和商城原流程保留。仅影响手动导入线，不改自动落札同步、支付／交易、历史已导入订单。需更新插件background.js并reload、API及共享识别文件并重启、后台静态文件；无schema迁移，未部署，详见0k。

2026-10-17 新增独立 fleamarket 商品类型：复用既有 product_type 字段，不新增数据库列；共享归一化、详情／搜索返回、缓存及商品快照写入均保留此类型。用户端フリマ全称「フリマ 商品」为紫色底，简写「P」；详情标题前统一显示普／商／P，搜索普通／商城商品标题下显示原全称类型标签，フリマ保留原站 logo。フリマ列表入口改「購入」、详情行动按钮改「去購入」，详情不显示拍卖次数／截止时间；原关闭按钮及普通／商城详情保持。入札中再入札按钮移到左图最高价下方，资格和跳转不改。フリマ购买／提交／批量禁令继续生效，仅新增类型和显示，不接入实际购物或付款。需更新 API／共享文件和用户端静态文件并重启 API；无插件／schema 变化，未部署，详见 0j。

2026-10-17 用户端商品类型标识已本地统一：首页抓取后的商品卡保留原独立的普通／商城文字标签和所有商品信息，仅在标题前追加标识；入札中、落札商品、失败分析列表在商品 ID 后显示同一组件。样式对齐后台：普通绿色「普」、商城红色「商」，优先使用 product_type／productType，缺少时沿原共享 normalizeProductType 按税类型回退；フリマ不标成普通／商城，保持只读禁购。失败分析仅补充返回既有 products.product_type，不改筛选、价格、历史或状态。需更新 API 的 failureAnalysis.js 与用户端静态文件并重启 API，无 schema／插件／后台改动，未部署生产，详见 0i。

2026-10-17 Yahoo!フリマ现仅开放用户端搜索和详情，购买流程待业务明确后另行设计。Z/z ID 与 paypayfleamarket URL 使用正确 `/item/{id}` 抓取，搜索列表标题下显示原站标识；详情保留标题、价格、图片、说明、运费等只读信息。撤销上轮仅即决提交支持：商品卡下提示「Yahoo!フリマ 暂时无法购买，请联系管理员！」并隐藏全部出价设置与提交按钮；前端提交处理、单条 API、严格批量提交及批量解析均拦截，在抓取／商品写入／任务创建／账号分配前拒绝。普通／商城商品维持原流程。需更新 API、共享工具与用户端静态文件并重启 API，无插件／schema 改动，未部署或操作真实购买，详见 0h。

2026-10-16 邮箱验证后直达 PIN 的交接已本地修复：邮箱单次提交后保留原文字验证码识别，并复用 detectManualPinPage 识别已加载且不再为邮箱页的 PIN 页面，关闭邮箱 challenge 后返回原 PIN 流程；本次新开子标签同样支持，已有无关标签不接管。上轮超时后点击继续时若原标签已为 PIN，直接交接，不再刷新 Yahoo／读取 Gmail。单次刷新与提交、60秒收信／30秒转换、错误中断及原 PIN 输入保持；只需更新插件 background.js 并 reload，无 API／前端／数据库变化，未部署或操作真实 Yahoo，详见 0f。

2026-10-14 商品名称搜索已本地兼容 Yahoo 新版搜索页：旧 Products__list 解析保留，缺少旧容器时读取 __NEXT_DATA__ 的 search.items.listing；渲染页面按 searchItems 主列表顺序读取并去重，只有主列表实际出现的 featuredListing 商品参与，不混入页面其他推荐模块。未渲染页面仅读分页 listing。搜索 URL、每页 50、b=1/51/101、弹层／选中后详情与原商品业务保持；原次へ识别保留，缺少链接时通过列表总数及本页位置判断后续页。只需更新 API routes/proxy.js 并重启 API，无前端／插件／schema 更新。用户提供 HTML 与实时 Yahoo 两个关键词前两页验证通过；未部署生产或创建实际任务，详见 0g。

2026-10-13 付款流程兼容新版已发货文字：仅 buildPaymentPageStateFromSnapshot 的 alreadyPaid 文案识别补入「商品が発送されました」且符合原确认收货 paidOrShipped 的到货提示，复用现有识别。待结算任务读取该页面后沿原已付款成功回写到 pending_shipment（待发货），不点击支付／确认收货按钮；其他付款资格、状态回写、金额／运费及失败中断均不改。只需更新插件 background.js 并 reload，无 API／前端／schema 更新，未修改真实 x1247287408 或操作 Yahoo。

2026-10-13 普通商品交易开始误入付款路径已本地修复：仅新版 `/trade/top` 的购买手续文案可作为交易信息入口，旧 `/buyer/top` 购买入口仍交原付款流程，直达 `/buyer/payment` 的链接不在交易开始点击。交易确认严格匹配「確定する」，不匹配「購入を確定する」；MAIN world 与 content 点击均拒绝付款页面。原运费分支、同捆、订单状态、付款资格、金额核对与失败中断规则不改。只需更新插件 background.js／content.js 并在 profile reload，未部署或改动生产订单，详见 0f。

2026-10-13 按用户纠正，提交页「已结束」角标／出价表单仅在读取商品信息成功时判断并固定。本次读取未结束就始终保持原显示，超过截止时间／聚焦／可见状态变化不再更新；只有重新获取才重判。移除定时器及持续检查，提交处理仅读固定状态；API 原过期提交保护不变。仅用户端静态文件，无 API／插件／schema 改动，见 0f。

2026-10-12 用户提交页增加已结束商品只读展示：有效截止时间早于现在时，仅提交任务页抓取后商品卡图片左上角红色「已结束」，其他列表／搜索／收藏／详情不加角标；隐藏全部出价设置／策略／提交按钮，商品信息、详情及任务列表保留。页面跨过截止时间自动更新，提交处理再次核对；API 在新建任务／分配 Yahoo 账号前拒绝过期截止时间。缺失／无效截止时间保留原流程，无价格／策略变更。需更新 API、共享时间工具与用户端静态文件并重启 API，见 0f。

2026-10-12 商品结束失败提示与后台列溢出已本地修复：快照确认已结束并写 failed 时原子保存结束原因，重复回写保护不变；已有 failed＋空原因任务仅在诊断精确匹配任务／商品／账号及结束原文时只读补充展示。任务／队列的提交用户列省略长名字，状态列 100→190，表格总宽随之 1214→1304，保持单行左右滑动。需更新 API 与后台静态文件并重启 API，不需插件／用户端更新，不改出价规则或实际历史数据，详见 0f。

2026-10-12 用户删除已本地改为完整关联清理：只允许用户端普通／代理用户，用户端管理员等级及服务器管理员禁止删除。有订单或任务时 API 先返回二次确认提示，确认后连同关联数据删除；没有订单／任务时其他关联数据直接清理。一个同步事务完成并捕获异常，保护其他用户／共享商品，下级仅解除归属，旧登录 token 失效。需更新 API 与后台静态文件并重启 API，无 schema／插件变更；未删除实际用户，详见 0f。

2026-10-12 修正手机任务表挤压换行：此前账号列 ellipsis 触发表格固定布局，而主任务表没有横向 scroll，其他未指定宽度列被挤成竖排。现任务／队列共用表保留各字段单行所需宽度，开启横向滚动；订单原其他列宽不变。两处账号标题统一「YH」，宽度 64；手机菜单保持原单行左右滑动。仅后台静态文件，见 0f。

2026-10-12 后台内容顶部取消账号在线／登录文字区，主账号说明和备用账号状态标签均移除，无提醒不留空白；在线状态继续通过红绿灯查看。保留原主／备用账号验证码、付款及其他实际提醒。仅更新后台静态文件，无 API／插件／数据库变更，验证见 0f。

2026-10-12 后台任务报表／订单管理的账号列标题缩短为「执行Yh／成交Yh」，列宽从 140 缩至 88，长账号使用省略显示。仅更新后台静态文件，不改账号取值或业务，手机／PC 验证见 0f。

2026-10-12 普通商品同捆拒绝后的新版单品入口已本地兼容：识别「購入手続きをする／購入手続きする」及原「取引をはじめる」，页面状态、MAIN world 点击及 content 点击一致。关闭拒绝弹框后先进入单品信息页，再按原运费类型完成信息确认；落札者负担仍进入等待运费，不跳过确认直接标待支付。只需更新插件 background.js、content.js 并分别 reload；不改 API、数据库或实际订单。验证与验收见 0f，真实新版后续页面待用户更新验收。

2026-10-12 拍卖记录数组最新同分钟超过 2 条有效出价记录时，若第一条价格小于或等于第二条，改存第二条用户名及价格；其他分钟、恰好 2 条或第一条更高时保留原规则。商品时间／当前价原本从归一化数组首条更新，自动沿用新选取结果，原非落札且历史时间严格更晚的更新条件保留。仅需更新 API 服务文件并重启，无前端／插件／schema 变更；已有记录不自动覆盖，未部署生产。详见 0e。

2026-10-11 拍卖记录采集和失败分析的时间条件已本地修正：非落札商品按商品结束时间，任一账号已落札（含人工导入）按落札时间；各用户的任务、出价记录及其他采集/订单业务规则不变。需更新 API、用户端静态文件并重启 API，已有漏采商品通过原手动/定时采集入口重新入队；未部署生产。说明和验证命令见主计划 0e。

Yahoo 日本拍卖代拍系统。中国用户通过 Web 提交商品 URL、最高价和出价策略；Windows 服务器上的 Chrome 扩展轮询 API，在 Yahoo Auction 页面自动执行竞拍、同步入札中状态、同步落札订单，并处理交易开始、付款、扫描物流和确认收货等订单流程。

生产侧已连续运行稳定；用户端商品名称多结果搜索已支持 Yahoo 列表分页弹层和选中后详情确认，并支持按用户隔离的浏览器本地商品收藏。当前后续重点是三表模型收尾、用户本地商品缓存提速，以及 Windows Chrome 小窗口下 PIN/文字验证码截图稳定性。

2026-10-10 Yahoo 多账号已本地实现：可配置主账号与多个备用、插件固定绑定、商品账号用户归属、逐级黑名单转交及成交账号订单流程。共享配置保持每插件并发上限，flag／验证／提醒独立。首次迁移自动备份有任务的数据库，保留原任务状态；processing 沿用旧版 60 秒超时恢复，重试仍用原价格和策略。尚未部署生产，先仅 A 验收后再加备用；详细操作与边界见根目录 yahoo-multi-account-plan.html 3.0 和主计划 0f。

2026-10-11 入札／落札自动同步增加错误页与加载超时的单次恢复、逐账号页面诊断和失败数据保护。自动同步专用页完整读取后才上报，实际故障根因仍需新日志确认。更新插件 background.js、manifest.json 并在各 profile 重载；不需更新 API 或数据库，验收见 0f。

2026-10-11 修复用户端登录后闪回：提交页原来读取 /api/plugin/config，多账号插件鉴权返回 401 后触发用户端清凭证。现改读用户鉴权的 /api/task/bid-config，仅返回原多次出价开始时间、间隔和最低价，复用插件配置读取函数；插件接口仍要求账号绑定。临时数据库＋真实登录／接口／390/1200 浏览器验证首次登录、后续轮询及刷新保持登录，共享配置一致，插件配置与领取接口不允许用户 token 越权。需同步更新 API 与用户端静态文件并重启 API，无数据库迁移或出价／付款规则变化，未操作真实 Yahoo 或生产数据。

2026-10-10 插件重载等待与后台登录状态：新实例首次认证前的 60 秒内，消息领取遇到明确“已有在线插件”409 时静默等待，保留后台 45 秒旧实例保护；其他错误、状态回写、已认证后冲突和持续冲突不吞掉。后台左侧与手机顶部已按用户最新要求改为红绿灯，不显示文字和编号，主账号先排、备用沿原顺序，每行最多 4 个，多于 4 个由下箭头展开／收起。绿色表示插件在线且 Yahoo 登录回报正常，未登录／待确认／离线均为红色；点击或悬停灯点可查账号身份和具体状态。重载修复需更新插件 background.js 后 reload；红绿灯仅更新后台静态文件，无 API 或数据库变更。专项、原插件回归及后台构建通过，最新红绿灯浏览器检查覆盖 360/390/1200，未操作真实 Yahoo。

2026-10-10 多账号检查修复：批次提前停止时按原领取凭证归还尚未执行的订单，正常无变化扫描和收货取消检查结束领取；订单领取恢复按 0f 的最新规则处理，不新增人工核对入口。出价页面消息校验本次凭证、活动执行与来源 tab，执行中的心跳/快照/回写固定原凭证。订单改用户恢复原有“同商品、原用户全部历史任务一起转移”的范围，撤销新增的目标账号冲突禁令；无冲突时同步分配归属，有其他账号名额时保留已有分配，落札同步以已有订单及成交账号为准。需同步更新 API 与插件并 reload；尚未部署或操作真实 Yahoo。

2026-10-10 补齐四处多账号保护：明确黑名单转交时，同商品、同用户在原账号排队的任务原子跟随新归属，保留价格、策略和定时设置；后续账号耗尽时这些待执行任务一起失败，历史已结束任务不改账号。领取时再次检查商品账号用户归属；2026-10-11 已取消失败结果对后续提交和队列的拦截及人工核对入口。时间／快照回写不能覆盖已落札或失败状态，失效快照不能更新商品或生成 followup；正常定时退回 pending 和本次未出价调度保留。交易开始的四处执行资格检查明确跳过时归还原领取，不修改暂停状态，不重放已执行未知操作。无 schema 变更；需更新 API、插件并 reload，尚未部署生产。

2026-09-18 本地已完成待收货 Google 表格追加/补写前查重，待用户部署 API 和后台后验证；历史重复行保持不动。

2026-09-27 本地已完成普通商品落札订单暂停、24 小时后在交易开始领取时恢复、后台 Yahoo 消息发送及用户端恢复入口；尚未部署生产或操作真实 Yahoo 订单。

2026-09-28 本地将 Yahoo 消息拆为独立执行线，按插件工作轮询领取，后台有待处理消息时每 2 秒刷新结果；API、后台及插件需一起部署，生产实际耗时待验证。

2026-09-28 本地启动脚本已改为前端按需构建和 HTTP 就绪检查；首次建立构建记录后，未变化的前端跳过编译，服务全部就绪立即结束等待。服务器启动耗时待部署验证。

2026-10-02 本地已接入 PIN 前的邮箱验证码：后台显示“需要邮箱验证码。”及“继续”，插件从同一 Chrome 已登录的 Gmail 读取新验证码。每次点击仅刷新 Yahoo 一次、填入并提交一次；邮件等待 60 秒，提交后进入文字验证码页等待 30 秒，失败由用户再次点击继续。API、后台和插件需一起部署，真实 Gmail/Yahoo 页面待验证。

2026-10-08 针对 Gmail 搜索后停住并等待 60 秒的反馈，本地修复邮件列表缺少最新邮件 ID 或标识位于标题子元素时无法点开邮件的问题；缺失列表 ID 时改读详情记录旧邮件，随后从候选邮件详情核对新验证码。Gmail 搜索缓存未更新时仅刷新本轮 Gmail tab。此次只需更新插件并 reload，真实服务器 Gmail 页面待验收。

---

2026-10-05 本地批量即时拍已改为 API 持久化队列：入队成功立即关闭输入弹窗，后台按批次和行顺序补全商品并创建任务；期间用户可继续提交单条或更多批次。每件补全后立即进入原出价队列；整批提交结束后仅在有提交失败时显示失败商品与原因，出价结果仍查看任务列表；后台准备进度仅显示待处理商品，处理完自动隐藏，提交错误仅在用户端提示；刷新、关页和 API 重启不丢失已入队工作。尚未部署生产或提交真实 Yahoo 任务。

2026-10-05 本地后台“队列中”非零数字可点击展开/收起队列详情。详情包含等待补全行和所有等待出价任务（含尚未到时的定时任务），支持分页、展开时每 5 秒刷新及队列清空自动收起。仅增加后台只读查询与展示，保持原任务提交和插件领取流程。

2026-10-07 用户端“批量添加”按钮移至“商品ID / 商品链接 / 商品名称”标题行右侧，输入框恢复完整宽度；仅调整布局，批量提交行为不变。验证使用现有 Submit 展示检查、用户端构建、编码检查及 diff 检查（命令见 0b）。

2026-10-07 用户端入札中、落札商品列表图片可点击打开现有商品详情弹层，复用多图轮播、完整商品说明及收藏；入札中底部“去竞拍”跳转原提交页并带入商品，落札商品底部“关闭”。通过 ProductItemDetailPopup 共用列表字段转换和原商品详情加载入口，ProductSearchPopup 的 detailAction 默认仍为关闭，原单商品详情行为不变。仅需更新用户端静态文件。验证：`node src/client/src/pages/ActiveBidding.display.test.mjs`、`node src/client/src/pages/WonItems.display.test.mjs`、`node src/client/src/components/ProductSearchPopup.display.test.mjs`、`npm run build --prefix src/client`、`node scripts/encoding-guard.js`、`git diff --check`。尚未部署生产。

2026-10-07 按用户要求将程序回滚到 `8b94020` 的功能状态，取消商品详情拍卖次数点击及拍卖记录抓取，移除对应 API、前端记录视图和专项测试；保留批量添加按钮移位、入札/落札商品图片详情及各自底部按钮。回滚通过新提交保留 Git 历史。用户端重新构建，API 需在部署后重启才能移除已加载的记录接口。验证：商品详情、入札/落札展示检查、原 proxy 测试、用户端构建、编码及 diff 检查。

2026-10-07 本地用户端统计扩展为近 90 天：落札金额柱体变细，日期刻度保留首尾并每 5 天显示；下方新增每日全部任务数的活跃指数和每日落札数/当日任务数的收获指数折线图。API、用户端需一起更新；尚未部署生产（验收见当前主计划 0c）。

2026-10-07 本地入札中标题增加“失败分析 → 返回”切换，展示当前账号已提交、已到期且未落札的商品，排除仍在入札中的商品。每次用户任务提交的最高价显示一个三角，任务执行中的多次加价不计入；只读现有商品快照，不抓取落札价。尚未部署生产（验收见当前主计划 0d）。

2026-10-08 本地新增插件拍卖记录采集：`products.auction_history_html` 保存第一页全部记录的独立 HTML，`auction_history_data` 保存全部分页去重后的 JSON 数组；明确历史过期时两字段写入“数据已过期”。后台新增北京时间分钟配置（默认 01:20）、手动入队及订单页拍卖记录 flag。空闲工作顺序改为交易开始、到期扫描、付款、确认收货、导入、拍卖记录；独立消息线不变。API、后台、用户端与插件需同步更新；尚未部署或读取真实 Yahoo 历史。

## 当前架构

2026-10-08 失败分析“最终出价”和两页小图表统一从非终止任务读取；三角悬停时间与外部标签均使用北京时间。收获指数无数据日按 0% 补齐，折线连续。需同步部署 API 与用户端并重启 API。

2026-10-08 本地用户端统计页三张图默认滚动到最新日期，三段统计说明移至图表下方的独立卡片。收获指数已于 2026-10-09 改为每日落札数 / 当日到期下架商品数，按当前账号已提交商品去重；活跃指数仍计全部任务。需同步更新 API 和用户端。

2026-10-07 落札列表已在落札时间下方复用紧凑价格图，以落札价为基准，显示每次用户提交的最高价及首尾提交时间。API 与用户端需同步部署；本地查询、构建和手机/PC 模拟页面验证通过。

```text
用户浏览器 / React Client
    |
    | HTTP /api
    v
API Server / Express + SQLite
    |
    | HTTP polling /api/plugin/*
    v
Chrome Extension / yahoo-plugin on Windows Chrome
    |
    v
Yahoo Auction
```

常用地址与目录：

- 本地工作区：`D:\www\g-daipai`
- 生产目录通常为：`C:\www\g-daipai`
- API：`http://localhost:3034`
- 用户端静态服务：`http://localhost:3035`
- Chrome 扩展目录：`yahoo-plugin/`

---

## 主要代码位置

- `yahoo-plugin/background.js`: 插件轮询、出价池、订单工作流、付款/交易/扫描/确认收货。
- `yahoo-plugin/content.js`: Yahoo 页面解析、商品/入札中/落札数据提取、页面点击操作。
- `src/server/routes/task.js`: 用户任务提交、任务列表、落札商品、用户统计。
- `src/server/routes/plugin.js`: 插件任务领取、状态回写、订单同步、诊断上报。
- `src/server/routes/admin.js`: 后台任务/订单/报表/批处理/配置。
- `src/server/models/index.js`: SQLite schema 初始化与兼容列维护。
- `src/server/services/productRepository.js`: `products` 商品快照归一化、写入、回填相关逻辑。
- `src/client/src/pages/Submit.jsx`: 用户提交商品与出价配置。
- `src/client/src/utils/bidPrice.js`: 用户端价格换算、出价展示与校验辅助。
- `scripts/check-product-read-paths.js`: 检查是否还有直接读取旧 `tasks` 商品快照字段的路径。
- `scripts/check-product-health.js`: 检查 `products` 商品展示核心字段完整性。
- `scripts/check-product-parity.js`: 检查三表关系与商品快照一致性。

---

## 数据模型现状

目标模型：

```text
products.product_id 1 --- N tasks.product_id
products.product_id 1 --- 0/1 orders.product_id
orders.task_id      N --- 0/1 tasks.id
```

当前状态：

- 代理互斥现由前端预检及API原子建任务双层校验；本人已有任务继续放行，同组首次并发只成功一个，见0at。
- 手机任务列表长英文撑宽及自动字体放大已本地修复；仅需发布用户端dist，真实iPhone待验收，见0as。
- 普通／商城成功新提交会使旧拍卖记录失效，按本轮结束时间重新采集；原自动加价、失败及重复请求保留记录，发布／验证见0ar。
- 代理组同商品策略本地完成；本人已有该商品任务优先放行，仅首次参与查同组其他用户。服务器保存与只读查询，用户端提交前拦截，部署范围与验证见0aq。
- `products` 已作为商品快照表引入。
- 运行查询已大量改为 `products` 优先、旧 `tasks` 字段回退。
- `orders.product_id` 已用于订单和商品关系。
- 生产侧暂时不急于删除 `tasks` 中的旧商品快照字段。
- 下一阶段要做的是“读写边界硬化”和“删冗余字段前的迁移准备”，不是直接删字段。

长期字段职责：

- `products`: 商品 URL、标题、图片、当前价、即决价、入札数、税类型、商品类型、运费文本、结束时间等商品快照。
- `tasks`: 用户出价意图、策略、最高价、任务状态、出价执行状态和错误。
- `orders`: 落札事实、成交价、交易 URL、付款/发货/收货状态和结算字段。

旧冗余字段候选：

- `tasks.product_url`
- `tasks.product_title`
- `tasks.product_image_url`
- `tasks.current_price`
- `tasks.buyout_price`
- `tasks.bid_count`
- `tasks.tax_type`
- `tasks.product_type`
- `tasks.shipping_fee_text`
- `tasks.end_time`

这些字段最终应从 `tasks` 删除，但必须先完成当前主计划中的审计、payload 边界硬化、生产备份和迁移验证。

---

## 当前主计划

### 0at. 代理互斥在API原子创建任务时执行最终校验

用户本次明确授权API补互斥，取代0aq初版“仅前端拦截、接受首次并发”的边界。仍保留“本人已有该商品任意状态任务则不互斥”，不是删除续拍例外：此前同组多人已参与时均沿原价格／策略／Yahoo归属规则继续提交，无本人任务的新用户才查同组其他人任意状态任务。不同组独立，actual actingUser决定归属，代理本人及下属同规则，用户端管理员代下属同样执行。客户端传policy／force／confirmed或伪造等级不能绕过真实数据库策略。confirm与allow不加最终互斥，仍可能返回原账号不可分配提示。

agentProductPolicy提取共用组归属SQL、冲突SQL及默认策略归一化，前端预检接口继续使用只读异步查询；新增同步assertSubmissionAllowed仅由任务创建事务调用。task.js沿原同商品锁完成验证／抓取后，在SQLite BEGIN IMMEDIATE写事务内先校验exclusive，再原createAssignedTask分配和建任务，最后原拍卖记录失效；冲突409返回“代理组内该商品有人提交，请联系代理！”，不建任务、不占备用账号、不清拍卖记录。已有请求ID直接返回原任务。单条／旧批量逐件接口／持久化批量工作进程共用此函数，已接收批量在实际处理每件时读取当时最新策略，冲突按原批量失败结果提示，其他商品继续。自动多次加价和内部followup沿原路径，不加策略判断。事务不包含网络抓取，不增加前端请求；入库前商品快照更新保持原顺序，冲突时可能已保存正常商品快照。

验证：`node scripts/run-isolated-regression.cjs src/server/routes/agentProductPolicy.submit.test.js`（真实HTTP双前端均预检通过后的同时提交＋两个独立Node进程共用数据库同时建任务，均仅一任务／一Yahoo归属；本人加价、两人原先已参与、pending／processing／success／failed／cancelled、第三人拦截、管理员代提交、跨组、请求ID去重、伪造前端标志无效、confirm／allow及原账号错误、批量双入队仅一件任务成功）；`node scripts/run-isolated-regression.cjs src/server/routes/agentProductPolicy.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/task.historyRefresh.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/plugin.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/task.batch.test.js`；`node scripts/run-isolated-regression.cjs src/server/services/batchTaskQueue.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/task.test.js`；`npm run encoding:guard`；`git diff --check`。并发专项已加入总回归，本轮未跑完整总回归，无生产／真实Yahoo操作。

发布本项只需API routes/task.js及services/agentProductPolicy.js并重启，无新增接口／字段／索引／两端dist／插件变更。前端原预检保留、不需改变；前一项0as手机布局仍有独立用户端dist待发布，勿混淆部署范围。

### 0as. 手机任务列表长标题换行及文字自动缩放

用户提供iPhone截图中长英文品牌串把部分条目flex内容撑宽，右侧状态及说明被裁切；代码字号始终为标题13px、说明12px，页面未固定移动浏览器text-size-adjust，字体不一致符合iOS自动文字放大的表现，但本机无iOS WebKit运行时，不宣称已真机复现该放大机制。

新增用户端src/index.css由main.jsx引入：html的-webkit-text-size-adjust及text-size-adjust设100%，viewport保持可手动缩放；仅.client-task-list内.adm-list-item-content-main设min-width:0与overflow-wrap:anywhere。TaskList添加专用class，独立任务页与提交页内嵌列表共用，其他列表不扩大布局选择器范围。不改字体数值、标题数据、价格／时间／状态、操作及提交流程。仅需发布用户端dist，无API／后台／插件／数据库变化，未部署，真实iPhone更新后验收。

验证：`npm run build --prefix src/client`、`node scripts/task-list-mobile.browser.test.cjs`、`node src/client/src/pages/TaskList.display.test.mjs`、`node src/client/src/pages/Submit.display.test.mjs`、`npm run encoding:guard`、`git diff --check`。浏览器专项320／393／1200宽度，覆盖截图同类日英长标题、无空格英文、短标题、状态及终止按钮，任务独立／内嵌列表统一13px／12px、内容无横向溢出、控件可见及手动缩放未被禁用；截图.test-artifacts/task-list-mobile-{tasks,submit}.png，已加入总回归，本轮未跑完整总回归。

### 0ar. 成功提交新任务后失效旧拍卖记录，避免重上架沿用旧记录

普通／商城单条及批量逐件成功建任务后触发，P排除；仅挂在submitAuctionTask实际创建任务路径，不挂通用商品快照函数，也不挂多次出价状态回写或processPendingFollowupTasks。原分配事务外再包同一同步事务，创建任务／归属及记录失效原子完成；清空失败则任务和归属回滚。请求ID命中已有任务直接返回，校验／分配失败不清记录。普通读取、插件快照／扫描及自动加价均不触发。

同时清空products.auction_history_html及auction_history_data（含“数据已过期”），不删字段／商品／任务／订单／bid_logs。若本商品在旧采集队列，移除本商品并清理该项失败次数；只有本商品持有队首领取时作废claim／lease及账号上下文，旧页回写stale，其他商品已领取工作保留；队列空时复位requested，不立即重新入队。随后沿原手动／定时入队，等本轮结束或新落札后采集，不在提交时抓Yahoo。多次提交为空时保持空，不增加Yahoo访问。

复用config键auction_history_refresh:{商品ID}保存失效时原订单ID／won_at快照，重复提交保留边界；只影响标记商品的采集资格：未变旧订单忽略，按本轮products.end_time等待；新订单或同订单新won_at出现时沿原落札时间判断，新落札时间无效／缺失不回退。无标记商品保持原资格规则。标记批量一次读取，正常／明确过期入库后删除，不改任何订单时间／状态／账号。没有旧历史／旧队列／旧订单的首次提交不创建标记。前端蓝三角仍是用户任务历史，不因清空Yahoo拍卖记录删除。

验证：`node scripts/run-isolated-regression.cjs src/server/routes/task.historyRefresh.test.js`；`node src/server/services/auctionHistory.test.js`；`node yahoo-plugin/auctionHistory.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/plugin.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/task.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/task.batch.test.js`；`node scripts/run-isolated-regression.cjs src/server/services/batchTaskQueue.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/task.endedSubmit.test.js`；`npm run encoding:guard`；`git diff --check`。专项覆盖普通／商城／P排除、过期记录、两字段边界、成功／重复／失败／分配失败、重复加价、低价续拍及插件扫描不触发、在途与其他商品领取保护、旧订单保留／同订单新成交／缺失成交时间、重新采集入库清标记、异常任务与归属回滚。新增专项已加入总回归，本轮不运行全量构建回归（无前端改动）。

发布：只需API routes/task.js与services/auctionHistory.js并重启，无schema迁移、两端dist或插件更新。未部署／未改生产c1248070488；已经成功成交且不会再提交的历史商品，可用原后台拍卖采集清空与手动入队修复，不能宣称本次已修复。

### 0aq. 用户端代理组同商品提交策略

2026-10-26 最新补充：每个商品先看当前实际提交用户是否已有tasks记录（任意状态、任意Yahoo账号）；已有则从conflicts排除，互斥和提醒均不阻止本人续拍／加价。本人没有任务时，仍以同组其他用户任意状态任务判断冲突。因此并发首次参与的A／B后续都能继续，但首次参与的C仍互斥或提醒。批量逐商品处理，自己已有的商品不影响其他首次商品的冲突判断；原价格／策略／归属／账号分配及最终提交API保持原样。只读查询NOT EXISTS复用现有用户／商品任务索引，不新增网络请求，不改表。此次仅更新services/agentProductPolicy.js并重启API，无需前端dist／后台／插件更新。已有代理／管理员设置发布范围保持下文原说明。

此补充验证：`node scripts/run-isolated-regression.cjs src/server/routes/agentProductPolicy.test.js`（真实隔离数据库／HTTP，A／B两账号及pending／processing／success／failed／cancelled均可续拍，C首次仍冲突，代理代下属、跨组、批量混合、confirm不重复提醒、任务及归属无写入）；`node scripts/agent-product-policy.browser.test.cjs`（沿用已构建用户端验证单条／批量无冲突直提及原三策略）；`npm run encoding:guard`；`git diff --check`。未执行完整总回归，未部署或操作真实任务。

实际登录的代理级用户可设置本组策略；用户端管理员（数据库role=user、user_level=3）在切换到其权限内的代理用户时，也可读取及修改该代理设置，切到普通用户不显示齿轮且API拒绝保存。代理登录始终只改自己，即使切到下属或伪造其他代理ID也不会改变目标；普通用户不能设置。默认exclusive（同商品互斥），另有confirm（提醒后允许继续）、allow（无提醒）。复用config的agent_product_policy:{代理ID}键，无schema迁移。前端切换到不同用户时关闭菜单、清空旧设置、重新查询；重选当前用户保留设置。读写固定token与所选用户ID，忽略已切走的异步结果。下属各自登录同样实时读取所属代理策略；代理代下属及管理员切换已有权限用户时按实际提交用户所属组查询，组外普通用户不参与。

管理员补充验证沿用下方HTTP、浏览器专项及用户端构建、编码、diff检查：真实数据库验证管理员指定代理读写、A／B隔离、下属继承、普通／无效目标拒绝；390／1200浏览器验证退出后齿轮、按选择读写、切普通用户隐藏、切回及刷新保留原代理策略、重选当前用户保持可操作。截图.test-artifacts/admin-agent-policy-{宽度}.png。本次未运行完整总回归，未部署。

单条／批量入口在发送原任务提交请求前调用/auth/agent-product-policy/check，只返回策略及冲突商品ID，不分配账号、不建任务。组内只查其他用户tasks，含代理本人及直属普通下属，所有状态均占用；同一用户按原规则，不按Yahoo账号隔离。互斥提示“代理组内该商品有人提交，请联系代理！”，提醒提示“代理组内该商品有人提交，是否继续？”并提供继续／取消；allow直接放行。批量一次查询最多50件，有冲突时整批停在输入窗口（附冲突ID），取消不入队，用户可调整后重交；继续则原批量入队。查询失败不提交、账号切换后不提交旧上下文。策略通过才沿原任务及多账号分配，因此策略2继续或策略3仍可能收到原账号不可分配提示。

初版仅用户端拦截的范围已被用户后续新授权替代：exclusive现在同时在任务API实际建任务的立即事务中最终校验，单条／批量工作进程均覆盖，堵住首次并发及直接API绕过；本人已有任务继续放行，confirm／allow保持原逻辑，见0at。设置功能原发布范围仍是auth.js／agentProductPolicy.js及用户端dist；本次最终校验的增量只需task.js／agentProductPolicy.js重启API。后台、插件及schema无需更新，未部署／未创建真实任务。

验证命令：`node scripts/run-isolated-regression.cjs src/server/routes/agentProductPolicy.test.js`、`node scripts/agent-product-policy.browser.test.cjs`（先构建用户端）、`node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/task.batch.test.js`、`node scripts/fleamarket-browser.test.cjs`、`node src/client/src/pages/Submit.display.test.mjs`、`node src/client/src/utils/batchSubmit.test.mjs`、`npm run build --prefix src/client`、`npm run encoding:guard`、`git diff --check`，本轮均通过。390／1200像素实测设置默认及保存、下属无齿轮、互斥不发请求、提醒取消／继续、allow沿原账号错误、无冲突放行、查询失败不提交及批量入口；截图.test-artifacts/agent-policy-settings-{宽度}.png。代理策略HTTP与浏览器专项已加入总回归；本轮未执行完整总回归。

### 0ap. 主备用验证界面复用与其他登录方式前置

主号原验证码展示／普通Input／Enter／提交后确认中／关闭／文字验证码结束提示抽为ManualVerificationAlert，主／备用都传入各自challenge和account_id。IME组合输入的Enter不提交，异步操作期间防重复，文字验证码不再使用密码框。原账号轮询和其他提醒保持。

新前置仅识别Yahoo登录页的发送确认码按钮与“他の方法でログイン”，或含SMS选项的“他の方法でログイン”弹层。只单次点击链接及唯一可用“パスキー”；原文字验证码截图／填写、后续PIN输入与前台锁继续复用。无关页面、已有邮箱／验证码输入框不进入新分支；按钮缺失／禁用及30秒无预期跳转报错。初始加再次回跳最多两轮，第三次不点击、不发短信，后台报“登录方式跳第三次验证，请人工处理！”。Chrome session保留次数及失败，重启不重置；失败后保留原页等待人工处理，验证完成／验证页消失后清理。分支开始与等待跳转时持续清理重复登录页，复用同一流程锁；仅本轮所属新子标签可接管并关闭原页及本轮重复子页，验证码／PIN相互跳转也沿用此锁，不接管或清理旧无关验证码页。

API复用现有manual_captcha_challenge存储，新增login提醒类型，无答案／继续入口，只用于进度／错误与关闭；不新增schema或登录凭据。需同步发布插件background.js（各账号reload）、服务端services/manualCaptcha.js（重启API）和后台dist。未部署，未执行真实Yahoo／Gmail登录、发送确认码或操作生产数据。

验证：alternativeLogin专项以本地页面执行真实识别／点击脚本，覆盖精确链接／弹层パスキー、禁用按钮不点背后链接、验证码输入框排除、无关URL／纯文字不点、初次及二次回跳完整日文→PIN、第三次停止、worker重启上限、缺按钮／超时；补测并发请求共用流程、初始重复登录页清理、同次打开多个子验证页仅留接管页、接管后次数不重置、验证码／PIN互跳不接管旧无关页面。原emailVerification、background、多账号、manualCaptcha服务、后台显示与构建、360／390／1200多账号浏览器、语法／编码／diff检查通过。浏览器验证备用日文普通Input、IME不误提交、Enter提交及确认中、主备请求account_id隔离；真实手机IME与Yahoo新页仍需部署后验收。

### 0ao. 普通即时拍已最高且上限达标时返回成功

生产v1245429643任务13746失败日志已含最高入札者／300円，后续同步也为highest／300，但即时拍在商品详情页继续读取310円出价合计而误报超价；该310具体来源无完整面板记录，不作为已确认税额。用户批准仅补已有最高上限达标判断，不调整其他出价／税额规则。

本地仅将原定时已达上限成功分支复用于normal＋direct＋bid；返回success、noBid、closeTab和原已有上限，沿现有后台成功回写。最高提示缺失、上限缺失／不足继续原流程；商城／即决／定时／多次规则保持。按本次用户要求，旧“即时拍可降低已有上限”测试改为已有上限覆盖任务目标即成功，不再重新提交。

验证：`node yahoo-plugin/content.test.js`覆盖300上限／300任务／310再次出价合计、已有上限高于任务、上限不足、缺最高提示、缺有效上限、商城及即决边界，保留原税额／定时／多次和出价回归；另运行background、语法、编码及diff检查。仅本地模拟，未真实出价、未部署或修改失败任务。发布仅更新`yahoo-plugin/content.js`后在各账号reload，无API／数据库／两端静态更新。

### 0an. 邮箱验证回跳与单标签保护

已按2026-10-25要求本地修改。邮箱仅是前置步骤，继续完成原文字验证码和PIN；第二次邮箱不刷新Yahoo，第三次在收信／提交前停止。异常提示区分收信超时、页面变化、提交失败、Yahoo拒绝及跳转超时。主／备用账号均显示指定错误，隐藏继续，API保留服务端拒绝保护；人工处理后沿原关闭提醒／页面恢复。

验证：邮箱专项覆盖两次邮箱后交接PIN、第三次零提交／零额外刷新、worker重启上限、锁定后重复登录页清理、原邮件防旧码和超时路径；原插件、多账号、验证码服务与后台显示测试及后台构建通过，语法／编码／diff检查通过。只跑本地模拟，真实Yahoo／Gmail连续登录仍需部署后人工验收，不主动触发真实登录。

部署：`yahoo-plugin/background.js`更新后在各账号reload；`src/server/services/manualCaptcha.js`更新后重启API；发布本轮`src/admin/dist`。不改订单／交易／付款／扫描／任务流转、账号归属或数据库结构。

### 0am. 未发货超期提醒脱离Yahoo扫描识别

生产只读核验h1246666276订单2219：2026-10-12 06:35:42 UTC进入pending_shipment，至10月22日上午约9天20小时；插件近期持续扫描但返回unknown，旧流程因此未生成提醒。未知结果的具体Yahoo页面识别原因尚需实际页面核验，本次不修改解析。

新增refreshPendingShipmentAlerts，由后台原idle-flags逐账号轮询调用；用系统待发货订单与原起算时间计算，复用原addPendingShipmentAlert，不需插件在线或页面匹配成功。支持普通／商城／P，商品关联优先orders.product_id并兼容旧task关联。原完整天数、提醒ID、每日重复／关闭、提示文字和扫描自动关闭机制保持，不改变扫描领取、付款、物流或订单状态。只生成当前超期天数的提醒，不补造过去每天的提醒。

部署：更新src/server/routes/admin.js与src/server/routes/plugin.js并重启API，后台原轮询即可生效；无需静态构建、插件reload或schema迁移。本轮仅本地修改与隔离库测试，未部署生产。

验证命令：`node scripts/run-isolated-regression.cjs src/server/routes/shipmentAlerts.test.js`（真实后台HTTP轮询／关闭、无插件生成、7／8天边界、每日去重及翌日提醒、普通／商城／P、多账号隔离、审计时间优先及回退、无效时间跳过、订单不变、原扫描发货自动关闭）；`node scripts/run-isolated-regression.cjs src/server/routes/plugin.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/admin.orders.test.js`；`node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.test.js`；`npm run encoding:guard`；`git diff --check`。专项已加入npm run regression。

### 0al. P商品交易消息读取与发送

仅productType=fleamarket走新解析，商品ID仅作P合法性与同商品URL核验，不据ID决定类型。P固定打开`https://paypayfleamarket-sec.yahoo.co.jp/item/{id}/trade/buyer`，忽略缺失／旧transaction_url；普通／商城保留原入口与解析。按附件消息容器sc-15ad2869-0、列表sc-9985ddbc-0下ul和消息输入框／精确按钮文字定位，仅序列化列表内容、转义文本，不存卖家资料、表单、评价、订单或隐私说明。消息HTML使用原dl/dd及data-gdaipai-message-v2标记，避免正文包含“取引情報”等字样被原保护误判；两端无需改动。

P发送先等待列表渲染，用原生textarea setter及input/change通知React，最多8秒等待精确“取引メッセージを送る”按钮可用，重新核对URL／连接／输入内容后只点一次。随后比较列表中匹配文字条数增加，历史同文不算新成功；未确认沿原失败回写，不自动重发，先到Yahoo核对。消息工作45秒上限、账号领取、订单状态、扫描及确认收货主体保持。

验证通过：`node yahoo-plugin/fleamarketMessages.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/yahooMessages.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/fleamarketTrade.test.js`、`node yahoo-plugin/multiAccount.test.js`、`node yahoo-plugin/encoding.test.js`、`node src/client/src/pages/WonItems.display.test.mjs`、`node src/admin/src/MessageRead.display.test.js`、`node --check yahoo-plugin/background.js`、`node scripts/encoding-guard.js`、`git diff --check`。专项覆盖附件空列表、模拟非空／文本转义、两端原渲染函数、错域／错商品／缺列表／隐藏／禁用不点击、React延迟启用、启用期间换页不点击、单次发送、原同文不作成功、P原API领取／保存／发送且订单状态保持；已加入总回归入口，未运行完整总回归。仅插件background.js更新并在各profile reload；未部署／操作真实Yahoo。附件原列表为空，真实有历史消息结构及真实发送需更新后验收。

### 0ak. 旧P订单成交时间一次性修复

生产API更新重启后仍需单独修复旧P订单。服务器更新仓库后，可双击根目录repair-fleamarket-order-time.bat直接执行备份和修复；无需再次重启API。命令行预览：`node scripts/repair-fleamarket-order-time.js`，执行：`node scripts/repair-fleamarket-order-time.js --apply`。默认按项目.env／进程DATABASE_URL定位数据库，可用`--database <路径>`指定；须使用与API相同的服务器时区。修复复用普通／商城的normalizeYahooWonTimeText，以原won_at推断历史年份，不按当前年份重算，也不盲目全部加一小时。仅旧值转换成日本时间后与原won_time_text相符且转换差异不超过24小时才修复，已一致及异常记录跳过；不确定的跨年记录不猜测。won_time_text和orders.updated_at等其他字段保持。批次使用条件更新防并发覆盖，失败全回滚；可重复执行。

备份使用SQLite在线backup，包含WAL已提交内容，quick_check通过才写入。备份在源数据库旁，以`.fleamarket-time-时间戳-UUID.db`结尾，旁有`.changes.json`记录原值和计划值。无需停止API，不导入models或运行schema迁移，也不调用Yahoo／Google。生产历史修复尚未执行，当前API只有只读诊断，需服务器本地执行入口后再核验实际结果。

验证命令：`node scripts/repair-fleamarket-order-time.test.js`、`node scripts/repair-fleamarket-order-time.js`（只读）、`node scripts/encoding-guard.js`、`git diff --check`。测试在Asia/Shanghai、Asia/Tokyo及UTC全部通过，覆盖旧值修正、原年份、已正确跳过、类型权威／旧task关联、缺失与矛盾跳过、只改won_at、真实WAL备份及原值核验、重复执行、异常全回滚、命令行预览。已加入总回归入口，本轮未运行完整总回归。本地库无P订单，预览0件；未修改生产数据库。

### 0aj. P成交时间保存与读取沿普通／商城

原P直接以购买成功确认时刻的ISO值写won_at，而普通／商城将Yahoo日本时间文字按服务器本地时区转换；北京时间服务器上混排会相差一小时。按用户明确要求保留普通／商城既有口径，将原解析函数无行为变化地提取至services/yahooWonTime.js，P先生成日本时间文字，再调用同一函数保存won_at，精度也沿原分钟。普通／商城仍用同一函数，跨年规则不改；P异常恢复仍用确认成功时刻生成文字，不猜测真实购买时间。成交列表已共用读取／排序／展示，因此无需新增P分支或改静态文件。旧P订单保持原值，部署本身不会修正截图中的历史记录。

验证命令：`node scripts/run-isolated-regression.cjs src/server/routes/fleamarketPurchase.time.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/fleamarketPurchase.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/plugin.test.js`、`node src/client/src/pages/WonItems.display.test.mjs`、`node scripts/encoding-guard.js`、`git diff --check`。以上均通过，时间专项分别在Asia/Shanghai、Asia/Tokyo及UTC环境通过。新增隔离数据库专项通过实际P完单、普通／商城写单和用户鉴权GET /api/task/won验证保存同值、分钟精度、混合排序及原文字返回，重复确认不改时间；加入总回归入口，本轮未运行完整总回归。需同步更新上述三个API文件并重启，不改真实数据库或历史订单。

### 0ai. 手机顶部单行与记住登录

顶部登录用户名容器允许收缩，长名显示省略号并保留完整title；退出按钮和风格选择保持单行。原用户端已持久化token，但直接重开/login仍显示空表单，现存在凭证时自动进入/submit，API拒绝失效凭证后沿原401处理回登录。登录表单增加username／current-password自动填充语义，使用标准submit支持键盘提交；不在网页存储明文密码，不改变原7天有效期。浏览器清理站点数据或主动退出后仍需登录，微信内置浏览器的实际持久化行为需部署后手机验收。

验证命令：`npm run build --prefix src/client`、`node scripts/run-isolated-regression.cjs scripts/client-login.test.cjs`、`node scripts/encoding-guard.js`、`git diff --check`。浏览器专项覆盖360／390／1200长中文名、控件同排与无横向溢出，真实隔离登录、轮询／刷新、保存浏览器存储后关闭重开/login自动进入、退出及无效凭证返回登录、密码不落localStorage。仅需发布用户端dist，无API／插件／schema变化，未部署生产。

### 0ah. 批量订单状态新增取消

后台批处理“订单状态更新”新增“取消”（cancelled），复用原按商品ID更新对应订单及状态审计流程，结果显示“取消”；普通／商城／P均支持。保留为空／完了／待发货原选项，不改任务、金额或Yahoo交易动作。需更新API routes/admin.js并重启、后台dist；无schema／插件／用户端变化，未部署或修改生产订单。

验证：`node scripts/run-isolated-regression.cjs src/server/routes/admin.orderStatusRefresh.test.js`（真实HTTP、三类商品批量取消、其他商品保留、不存在商品失败、非法状态拒绝及审计）、原admin.orders专项、后台构建、编码及diff检查。专项已纳入regression。

### 0ag. P提交复用已读取商品信息

P单条提交在标题、图片、当前价、即决价、税类型、商品类型及运费齐全时复用前端快照，不再强制重抓Yahoo；无拍卖截止时间不视为缺失。旧客户端信息不全时保留原抓取及结果校验；商品表已有类型仍优先，P保持direct／buyout，不接入批量。提交时已有订单、待执行任务及购买结果未知拦截不变。原插件仅在同商品页面沿可用购买入口执行，最终确认弹窗商品原价必须等于任务价格，API begin再次校验后才允许最终OK；下架无入口沿原等待超时失败，不写成功，价格变化在购买确认前停止。结果未知不重买、成功页双标识及原子建单保持。替代此前0l／0p等记录中“每次提交强制实时重抓”的规则。

提交前完整回归补正浏览器测试：P图标定位限定在“商品搜索结果”弹层，避免收藏弹层关闭动画期间的同款图标造成strict mode多匹配；产品代码和断言数量不变。完整验证`node scripts/run-isolated-regression.cjs`已通过，隔离数据库运行原`npm run regression`全部步骤，包含原交易／付款／扫描、多账号、两端构建及390／1200浏览器检查。

验证命令：`node scripts/run-isolated-regression.cjs src/server/routes/fleamarket.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/fleamarketPurchase.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/task.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/task.batch.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/task.endedSubmit.test.js`、`node yahoo-plugin/fleamarketPurchase.test.js`、`node scripts/encoding-guard.js`、`git diff --check`。新增覆盖完整P快照不重抓、无截止时间、信息缺失补抓、提交金额矛盾及插件无购买入口失败；复核原价格变化、未知结果、重复购买保护。仅更新API routes/task.js并重启；插件只补测试，不需reload，无两端静态或schema更新，未部署生产或操作真实Yahoo。

### 0af. 后续P流程及收藏统一使用保存类型

共享getStoredProductType／isStoredFleamarketProduct仅识别normal／store／fleamarket字段，不读ID、URL或旧isFleamarket标志；原isFleamarketProduct保留给首次用户输入和批量原始文本识别。共享productUrl.cjs按保存类型生成链接，无类型不生成。购买接口与任务状态校验从products重新读取类型，P未知结果恢复和原普通付款队列移除Z SQL条件；普通Z与P非Z的类型冲突样本按记录类型分流，实际P页面ID格式和URL／成功标题验证不放宽。快照仅保留显式有效类型，缺字段时不覆盖既有类型，不自动重写历史数据。扫描／收货／拍卖记录任务携带类型，拍卖记录仅normal／store且两字段为空时入队；手动导入也按已取得的类型过滤。Google追加／更新读取商品表类型生成C列链接，缺类型沿原失败提醒处理，查重、补写、金额、状态及真实交易动作保持。

收藏快照新增productType和规范URL；旧记录缺类型时不在前端猜URL，先以原ID请求详情，resolveStoredType先读取商品表，存在有效类型时覆盖旧收藏类型，否则沿原初次抓取取得信息；成功后仅更新当前用户已有收藏，不新增收藏，切换用户后的迟到更新不写入新用户。已知收藏／列表详情／再入札携带类型，后端抓取按类型固定域名、解析及独立缓存，首次无类型输入不变；返回的类型也同步修正输入框。用户端已知商品展示和链接不再受Z前缀／旧URL覆盖。

验证：完整`npm run regression`，新增`node yahoo-plugin/productTypeRouting.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/proxy.storedType.test.js`；P购买HTTP测试补入商品表反向类型、恢复排除、Google行URL及提交／快照保留类型；原插件完整、P购买／扫描／收货、多账号、拍卖记录、Google查重、收藏单测及390／1200浏览器验证。部署更新API、shared、用户端dist与插件background.js并逐账号reload；无数据库迁移，不需改写历史任务、订单或Google已有行。未部署或操作真实Yahoo／Google。

### 0ae. 用户端类型全称标签配色统一

ProductTypeTag全称模式复用简称模式的文字、底色和边框颜色，首页抓取卡及搜索列表保持普通绿／商城红／P紫；全称文字、间距和字号不变。仅更新用户端dist，无API／插件／数据库变更，未部署生产。

验证：`node src/client/src/pages/Submit.display.test.mjs`、`node src/client/src/components/ProductSearchPopup.display.test.mjs`、`npm run build --prefix src/client`、`node scripts/encoding-guard.js`、`git diff --check`。

### 0ad. 仅管理端按商品表类型生成链接

新增管理端专用shared/adminProductUrl.cjs，normal／store生成拍卖链接、fleamarket生成フリマ链接；忽略ID前缀及已有URL。后台订单与查询接口增加原始link_product_type，避免原结算／展示税类型回退被用于链接，其他财务逻辑保留。下一任务、队列、两类诊断报表补回商品表类型；idle-flags按涉及商品批量查询类型，仅补充返回数据，不重写已存提醒／任务。管理端列表、报表、两类CSV、下一任务和顶部提醒统一使用专用函数。缺失／非法类型显示无链接，批量刷新返回“商品类型缺失或无效，未更新”。

管理端刷新先读商品表类型，通过fetchProduct第二参数adminProductType固定实际抓取域名及解析分支，使用独立admin缓存键，快照URL沿该类型构造。未传参数的用户抓取路径、共享旧productUrl.cjs、Google实际写表／插件／交易动作／商品快照类型归一化保持原规则；不改schema或真实数据。

验证：`node scripts/run-isolated-regression.cjs src/server/services/adminProductLinks.test.js`覆盖反向ID／URL、缺类型、两类CSV、真实报表SQL、下一任务类型、提醒只读补充及实际抓取服务HTTP地址；原admin.orders、adminTaskQueue、proxy、fleamarket与CSV／展示专项、后台build、`node scripts/admin-product-type-links.browser.test.cjs`（390／1200，管理端各列表／两类报表／下一任务／顶部提醒，含Z普通与非Z的P反例）、原admin-table-mobile浏览器检查、编码／diff检查通过。部署更新API与管理端专用shared文件，重启API，更新后台dist；用户端及插件不需更新，未部署生产。

### 0ac. P 商品链接统一生成

新增共享productUrl.cjs：P商品强制规范为https://paypayfleamarket.yahoo.co.jp/item/{id}，兼容缺失与历史错误拍卖URL；普通商品保留已有URL及原拍卖兜底，普通p前缀不视为P。覆盖后台查询订单／报表／任务表与下一任务／订单／两类CSV、用户端成交列表／再入札／统计及统计API；后台刷新运费与商品类型修正抓取与快照写入URL，同时允许既有fleamarket类型。未批量修改历史快照，显示时纠正，后续正常刷新写正确链接。购买／付款／扫描／收货动作不改。

验证：`node src/shared/productUrl.test.cjs`（含CSV与再入札真实调用，旧／缺／正确URL及普通p反例）、`node scripts/run-isolated-regression.cjs src/server/routes/admin.orders.test.js`（刷新服务及products写入参数）、原task接口与两类CSV／相关展示测试、两端build、`node scripts/fleamarket-browser.test.cjs`、`node scripts/admin-table-mobile.browser.test.cjs`、编码／diff检查。部署更新API admin.js／task.js及shared/productUrl.cjs，重启API，更新两端dist；无schema／插件更新，未部署生产或写真实Google／Yahoo。

### 0ab. P 商品列表购入文案

P商品成交列表条目按既有类型判断统一使用“购入成功／购入价／购入时间”，普通／商城仍显示“落札成功／落札价／落札时间”。共用导航及页面标题不变，不修改订单状态或金额。验证：`node src/client/src/pages/WonItems.display.test.mjs`、`npm run build --prefix src/client`、`node scripts/fleamarket-browser.test.cjs`（390／1200，覆盖三类商品文案）、编码／diff检查。部署更新用户端dist，未部署生产。

### 0aa. P 商品购买按钮缺失与已结束只读卡

P解析在原availability缺货判断外新增主购买按钮检查：剔除script／style／原description后，精确匹配a／button的“購入手続きへ”，须为item_buy_button或同商品secure /item/{id}/order链接；忽略disabled／hidden／内联隐藏控件、其他商品入口及纯文字。按钮缺失即ended，不依靠P并不存在的截止时间。普通／商城解析不改。

Submit仅P在读取成功时把auctionStatus=ended合入endedAtRead，复用现有ProductCard的已结束角标与整段product&&!productEnded表单隐藏，商品信息和详情仍保留。读取时固定、无新增计时器或聚焦检查，普通截止时间规则保持。API原submitAuctionTask对P会重新抓取并在写商品／任务／账号分配前拒绝ended，新增按钮判断沿此校验生效，无需新增任务状态或schema。

验证：隔离fleamarket与proxy解析回归、task.endedSubmit、Submit.display、用户端构建、fleamarket浏览器和submit-ended浏览器、编码／语法／diff检查。fixture补充真实平台item_buy_button结构；覆盖InStock但缺按钮、仅文字／脚本／说明／其他商品／隐藏禁用按钮仍结束、匹配同商品购买链接仍开放、缺按钮商品不能创建任务。390／1200验证无截止时间的P结束图片角标位置、最高价／策略／提交隐藏、成色及详情仍可查看，切换正常商品恢复原表单，普通截止时固定显示及重抓判断回归保留。未运行全项目回归或提交真实购买。

部署API routes/proxy.js（含0z成色提取）并重启、更新用户端dist；无数据库结构／插件／后台更新，未部署生产。

### 0z. P 商品信息表成色读取

用户提供z705858626 HTML：JSON-LD只有UsedCondition，商品信息表明确“商品の状態／やや傷や汚れあり”。原parseFleamarketProductHtml仅支持NewCondition→新品，其余空；现P专用extractFleamarketConditionName在去除脚本／样式／原description后读取table的th／td（允许嵌套span），匹配同表商品ID后返回具体成色。页面表值优先于通用JSON-LD新品；无目标表／无成色不读取其他商品表，仍只保留原新品回退，Unknown Used不自行改为新品或猜等级。普通／商城共用condition提取器不变，成色与auctionStatus独立，最新出售状态由availability及0aa购买按钮判断。

验证：隔离`src/server/routes/fleamarket.test.js`以用户JSON-LD＋商品信息表摘录fixture验证やや傷や汚れあり／未使用／目立った傷や汚れなし／傷や汚れあり、嵌套标签、商品ID隔离、可见成色优先、无表回退、价格300与已结束状态保持，以及service/cache输出字段。原proxy解析专项通过。`node scripts/fleamarket-browser.test.cjs`在390／1200用对应商品接口数据验证抓取后详情显示成色，并继续原P／普通商城搜索／收藏／提交展示检查；API与页面两层分别验证，不操作真实商品。编码／语法／diff检查通过，未运行全项目回归。

部署仅更新API routes/proxy.js并重启，用户重新获取／打开详情后读取新成色；用户端已有conditionName展示支持，无需更新前端／插件／数据库，也不修改历史任务／订单。未部署生产。

### 0y. P Google 写表校验／查重与提醒链接

只读生产确认z705858626订单2339：order_status=pending_receipt、shipping_company=お問い合わせ、tracking_number=646960564235、google_sheet_appended_at为空。报错“Google Sheets append requires a valid matching product ID for every row”在服务端appendRowsChecked的C列商品ID校验触发，不是Google网络／权限失败。原productIdsFromSheetCell仅读取裸ID及拍卖URL；现补齐paypayfleamarket.yahoo.co.jp/item/z...官方链接，保留完整ID边界和所有原普通／商城规则，识别纯链接、大小写／查询参数、HYPERLINK公式、hyperlink和富文本URL。写入校验与已有行查重使用同一函数；读取失败不追加、响应丢失不盲目重试、格式失败只是警告、已有数据跳过并标记完成均保持。

后台新增utils/productUrl.ts复用共享P识别，AdminLayout的Google写表提醒／未发货提醒／错误文本商品链接使用正确商品域名，普通／商城仍原拍卖URL。无商品类型、订单状态或表格金额改变。自动写表与原待收货补表格共用appendPendingReceiptOrderToGoogleSheet，部署后原失败单可通过原补表格入口处理；不需重新购买或确认收货。

验证通过：`node src/server/services/googleSheets.test.js` 覆盖P URL完整ID与域名／路径边界、五种链接表达，以及P混普通的已有行跳过／部分追加／读取失败／未知响应／格式失败／并发串行；四种P已有链接仅追加缺失一行，再次补写无重复。`node scripts/run-isolated-regression.cjs src/server/routes/fleamarketPurchase.test.js` 不再把appendRows整个函数替换为成功，改为调用真实服务且只模拟Google读取／追加／格式请求，证明P扫描→真实商品链接校验→追加→appended_at标记的完整本地链路。原admin.orders／plugin API、AdminLayout展示、后台构建及360／390／1200浏览器（P和普通错误提醒href及原表格布局）通过，编码／语法／diff检查通过。未运行全项目回归，未部署或对生产表格补写。

部署更新API services/googleSheets.js并重启，同时发布后台dist（含新商品链接工具）。无schema／插件／用户端更新。历史失败提醒在原补表格成功或确认已有行后由原机制清理；不可因为本地修复就宣称生产已补写。

### 0x. P 确认收货中间结果弹窗

按用户截图，P在提交“受取評価をして取引を完了する”后可能先显示“受取評価と取引が完了しました”与OK，必须确认后才能出现最终标题。fleamarketReceiptStep在同商品secure trade/buyer URL内识别可见role=dialog／aria-modal／原ReactModal容器，严格匹配该提示且仅定位容器内唯一OK，不点页面其他OK、未知弹窗、隐藏提示或卖家消息。弹窗识别优先于背后完成标题，确认后仍须实际可见heading“すべての取引が完了しました”才能回写，不把中间提示本身当作成功。

P执行器新增notice-ok单次动作；已提交后不会再勾选或提交评价，打开时已停在该结果弹窗也先关OK再只读等待最终标题，回写already_completed。导航上下文丢失只等待不重放OK／提交；弹窗关闭后未出现最终标题按原失败处理，不写completed。沿原30秒等待／工作领取／状态API／本次tab清理，普通／商城收货主体不变，无新状态。

验证通过：`node yahoo-plugin/fleamarketTrade.test.js` 按截图提示制作模拟DOM，覆盖唯一弹窗OK、外部OK不点、背后完成标题仍先确认、disabled／隐藏／未知／卖家消息／错误URL不点；执行器覆盖提交→弹窗→OK→最终标题、初始结果弹窗不重新评价、OK导航丢上下文、提示停留超时无成功及单次点击。原P扫描／收货／人工完成专项、background、多账号、P购买、隔离HTTP订单／收货接口、编码／语法／diff检查通过；未运行全项目回归或真实Yahoo收货。

部署只更新插件background.js并在对应Chrome profile重新加载，无API／schema／用户端／后台更新。本轮未操作生产购买、扫描、收货或订单数据。

### 0w. P 确认收货与人工完成同步、批量红色提示

仅在原isFleamarketManualImportItem分派的P确认收货工作中调用新增专用DOM步骤，仍由原getConfirmReceiptJobs按待收货、任务成功及Google表格指定颜色匹配发放；不改变普通／商城、原调度／工作领取／Google资格／状态API。P为本次任务新开同商品secure trade/buyer，匹配真实label内checkbox和#rating内精确按钮文字；先勾选，等checked且按钮非disabled才单次提交，默认评价和评论不改。每次动作重新验证同商品URL及控件，已勾选不取消，导航短暂上下文丢失仅等待，不重放提交。

可见heading精确“すべての取引が完了しました”才回写success；首次打开已是这个完成页时回写already_completed，不需要checkbox／按钮也不点击。两者都沿原confirm-receipt/status及领取凭证把pending_receipt改completed（界面完了），不新增状态。到期未见完成标题／按钮一直不可用报原收货失败提醒，未知页面或非confirm_receipt／非待收货P工作仅归还领取；只关闭本次新tab。脚本和卖家普通消息、隐藏标题或其他商品页不作完成证据。真实附件里h1仍为到货等待但已出现收货控件，故就绪按真实唯一控件判断，不强制用截图另一版收货h1；成功标题仍严格核对。

用户端BatchSubmitPopup把“フリマ商品将跳过，其他商品照常提交。”从中间说明移到“批量商品和最高价”标题正上方，单独整行使用主题红色；仅提示位置／颜色，批量跳过和正常商品入队行为保持。

验证：`node yahoo-plugin/fleamarketTrade.test.js` 新增用户HTML摘录receipt fixture（不保存账号／地址／消息），覆盖初始禁用、勾选后启用、已勾选不取消、真实#rating按钮单次点击、评价／评论保持、完成／人工已完成／隐藏／脚本／消息／错误URL，执行器模拟正常／已勾选／人工完成／导航丢上下文／无完成超时／按钮禁用／陌生页面，成功前无回写；原P发货／重扫和普通p前缀分派保持。隔离`src/server/routes/fleamarketPurchase.test.js` 用原领取接口验证success与already_completed均把P待收货改completed，原扫描物流／Google行／原价入库仍通过。另运行原background、multiAccount、P购买、plugin API、用户端构建和`node scripts/fleamarket-browser.test.cjs`（390／1200提示颜色／位置及普通商城回归）、编码／语法／diff检查；未运行全项目回归或真实Yahoo收货。

部署更新插件background.js并在各对应Chrome profile重新加载，以及用户端dist；API／后台／数据库结构均无需变化。含0v已发货适配一起提交；本轮未执行生产扫描、收货、订单改写或外部Google表格写入。

### 0v. P 已发货识别与物流提取

根据用户提供实际HTML，在同商品 `https://paypayfleamarket-sec.yahoo.co.jp/item/{id}/trade/buyer` 页用可见标题“商品の到着をお待ちください”识别已发货，不用进度条或卖家消息中的相同文字。仅读取#deliverystatus内可见链接的数字单号（示例646960564235），保留前导0，规范化空白／连字符；未显示单号、不相关链接或多单号冲突则shipmentDetailsRendered=false，等待原渲染时间，仍不完整则诊断并归还工作，不推进订单／写空物流。物流公司按用户纠正固定为“お問い合わせ”，不读取或推断承运商、不打开物流外链。

提取完成后输出原shipped／shippingCompany／trackingNumber，原buildScanStatusPayload和updateScanStatus沿用，订单进入pending_receipt，自动Google表格追加／查重流程不变；原物流重新扫描同样可使用P提取结果。执行器补齐已发货且单号完成的退出条件，不再等到超时才上报。未发货、普通／商城商品沿原流程；P确认收货的专用控件与完成页已按0w适配，收货资格与状态API保持原规则。

验证通过：`node yahoo-plugin/fleamarketTrade.test.js` 使用用户HTML去除个人资料后的fixtures/fleamarket-shipped.html，覆盖发货标题／默认公司／单号、错误URL、隐藏或卖家消息、无单号／冲突／无关数字、单号延迟渲染、正常及重扫payload、只关闭本次页和确认收货保持暂缓。另以用户完整原HTML在本地浏览器只读验证结果。隔离 `src/server/routes/fleamarketPurchase.test.js` 证明原scan接口把お問い合わせ和646960564235写入订单及模拟Google行，并进入pending_receipt。原background、多账号、P购买、插件／项目编码、语法及diff检查通过；未运行全项目回归或实际生产扫描／外部写表／收货。

部署仅更新插件background.js并在对应Chrome profile重新加载；API接口／schema／两端静态文件不变。测试fixture只含发货标题和物流块，不保存个人地址／电话。

### 0u. 后台订单 P 类型标识

Orders和MessageRead原商品ID后已有普通／商城Tag，新增fleamarket分支显示紫色P，订单管理原“-”占位和查询订单原误归普通由此修正。不改商品类型数据、状态、按钮、查询条件或其他业务；任务报表原本无普通／商城标签，本轮不新增另一套显示。

验证：`node src/admin/src/Orders.display.test.js`、`node src/admin/src/MessageRead.display.test.js`、`npm run build --prefix src/admin`、`node scripts/admin-table-mobile.browser.test.cjs`、编码与diff检查。浏览器360／390／1200在同一订单表核对普通／商城／P标签与原横向滚动和单行布局。仅需部署后台dist，未部署生产。

### 0t. P 商品原价核对与成交金额

用户最新规则取代此前优惠券／积分禁用及实付金额等价校验。最终确认弹窗内仅读取含商品图片的唯一商品摘要li，在其中定位“送料無料”文字并向上找与右侧商品价组成的完整价格行；不取支付方式、支付合计或弹窗外商品价格。金额读取失败／原价不等于任务提交价仍在begin与最终OK之前拒绝；优惠券、积分、支付合计缺失或实付0元均不影响购买，程序不修改Yahoo现有付款／抵扣选择。

API begin新增接收itemPrice，与任务max_price一致且为正整数后，才沿原事务保存execution_unknown购买意图。complete仍严格核对原账号／实例／领取和同商品done URL＋实际渲染“購入が完了しました”，不读取或校验paidAmount／discountApplied；final_price直接用任务max_price这个已确认原价。任务直接success、订单pending_shipment，保留幂等、事务回滚、只读恢复和禁止重复购买。例：商品11700、优惠820、实付10880，入库成交价11700；实付0或缺失也存同一商品原价。原读取合计标题导致null的缺陷随本次删除支付合计解析一并消除。

验证已通过：`node yahoo-plugin/fleamarketPurchase.test.js` 覆盖用户HTML摘要结构、a#confirm_ok单次点击、11700原价／10880实付、优惠券／积分／0元／缺失支付合计可购买、商品原价缺失／变化仍拒绝且不借用背景价格／支付合计、多商品不误认、成功页双标识和executor原领取／确认意图丢失／导航／只读恢复保护。`node scripts/run-isolated-regression.cjs src/server/routes/fleamarketPurchase.test.js` 覆盖begin价校验失败无意图、原价一致才允许、paidAmount10880／0／null／缺失且discountApplied=true均存11700，保留领取／事务／幂等／扫描／写表／原付款队列排除及只读恢复。另检查原插件background、多账号、P扫描、API plugin与fleamarket路由、编码、语法和diff；未运行全项目回归或真实Yahoo购买。

部署须同时更新API的routes/plugin.js、services/fleamarketPurchase.js并重启API，以及插件background.js并在对应Chrome profile重新加载。新API begin要求确认商品原价，新插件不再发送实付价，须配套更新。无数据库结构／用户端／后台静态更新；不改已有订单金额，不自动重试生产失败任务。

### 0s. 单件名称搜索回填商品链接

Submit 的单结果分支由回填auctionId改为完整链接，沿用多结果选择相同的URL规则：普通／商城优先standardUrl，缺失时回退拍卖URL；P强制正确/item/URL，不沿用旧拍卖域名。详情请求与lastFetchedUrl同样使用该链接，避免回填与抓取缓存键不一致。无价格、策略、提交或多结果弹层变化。

验证命令：`node src/client/src/pages/Submit.display.test.mjs`、`node src/client/src/utils/api.product-info.test.mjs`、`npm run build --prefix src/client`、`node scripts/fleamarket-browser.test.cjs`、编码及diff检查。浏览器390／1200覆盖单件普通、缺少URL的商城、带错误旧域名的P三种回填与实际详情请求，并继续原多结果、收藏和购买展示检查。仅需发布用户端dist，未部署生产。

### 0r. P 抓取卡、再入札对齐及按日期完整清理

首页 ProductCard 按共享 P 类型识别隐藏整行拍卖次数及图标，普通／商城仍显示原次数。入札中再入札按钮仍在左侧图片／最高价下面，按钮容器按包含边框的图片宽度右对齐，左栏仍可随长价格展开，不改跳转或出价行为。

按日期强制清理原来遗漏 yahoo_product_assignments 等关联表且逐条异步删除，中途失败可能部分删除。现在复用 deleteProductData，清理快照、全部账号归属、任务／订单和对应关联记录；dryRun 与实际删除共用条件，预览新增账号归属和其他关联记录数量。整批使用同步 IMMEDIATE 事务，一件失败全部回滚；按商品ID稳定顺序取得提交／删除共用锁，等待在途提交结束，并在获得锁后重查旧订单资格，避免把已删除又新建的商品误删。日期仍按原 won_at 截止当日选择商品，包含 P；同商品其他用户／账号甚至日期后的订单仍按原整商品范围一起清理，其他商品及 won_at 缺失／无效的未命中商品保留。界面警示与原二次确认说明完整范围。不会清理外部 Google 表格。

验证：真实 SQLite `node src/server/services/forceDateCleanup.test.js` 覆盖日期边界、P与普通、孤立／旧关联订单、全部账号、只读预览与实际计数一致、第二件故障导致整批回滚、其他商品保留、等待提交锁后重判资格；原商品删除 HTTP 专项继续通过。`node scripts/fleamarket-browser.test.cjs` 在390／1200验证P首页无拍卖次数、普通商品保留、按钮与图片右边缘误差小于1像素且在最高价下面，并核对截图。两端生产构建、编码和diff检查通过。完整 `npm run regression` 中API／插件等检查通过，后台多账号灯点收起步骤首次浏览器等待超时；独立复跑该360／390／1200检查通过，随后单独完成原回归余下的用户端构建、P浏览器、已结束展示及登录检查。未改动灯点业务或该检查脚本。

部署更新API（含forceDateCleanup和0q的共享清理／锁／提交保护文件）并重启，以及用户端与后台dist；无schema／插件变更，未执行生产清理。

### 0q. 商品显式删除、快照和多账号归属释放

生产只读诊断：z705858626 任务／订单／入札均为0，但有300日元商品快照；截图拦截来自商品账号分配。旧deleteProductDataByProductId没有删除yahoo_product_assignments，任务删除触发SET NULL保留归属行。商品提交在账号分配前写快照，分配失败仍可能留下／更新快照。原调试接口未返回归属行，具体旧用户归属未直接读取；隔离测试按同样SET NULL与原selectAccount逻辑完整复现。

修正：显式后台删除按规范化商品ID调用deleteProductData服务，取消账号作用域限制，按商品清理全部账号的归属、快照、任务、出价／入札、订单、状态日志、交易消息、诊断、账号转交、相应订单工作领取和旧批量／手动导入明细；不改用户、Yahoo账号、其他商品或不相关领取。同商品仅剩归属／快照也可成功清理，无任务关联的orders按product_id同样删除。单商品使用SQLite同步IMMEDIATE事务，一处失败全部回滚；批量逐商品记录失败，不误报成功或只删除一半。正常提交的多账号分配与失败归属保护不变，只有显式商品删除释放归属。

原提交锁提取为productSubmissionLock服务供单条／批量提交及删除共同使用，删除等待先前同商品提交完成后再清理；旧持久批量行同时移除，持有已删除行但尚未进入提交的旧准备工作，在原strictBatch路径中再次核对该行processing资格，不允许删除后重建。正常新用户新提交可重建新的商品快照并分配已释放账号，其他商品并发不受影响。插件对已删任务的迟到回写仍走原领取失效保护。无需schema、插件、前台或后台静态文件变化。

验证已通过：`node scripts/run-isolated-regression.cjs src/server/routes/admin.productDelete.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/admin.orders.test.js`、完整`npm run regression`（原API／插件／多账号／交易付款／P购买与扫描／两端构建及手机PC浏览器）、`node scripts/encoding-guard.js`、`git diff --check`。专项真实SQLite＋HTTP覆盖原生产残留模式、大小写P ID、两账号全清、跨用户重新提交、其他商品保留、只剩归属、孤立订单、事务故障回滚、相同数值不同类型领取保留、旧插件回写拒绝、提交／删除竞争和旧批量行不重建；原两项SQL模拟删除检查改为内存SQLite校验真实结果。

部署需同步更新API `routes/admin.js`、`routes/task.js`、`services/deleteProductData.js`、`services/productSubmissionLock.js`并重启API，随后后台对z705858626再执行一次“删除商品数据”清理已存在的残留。未部署、未替用户执行生产删除，也未操作Yahoo或外部Google表格。

### 0p. P功能整体审查与购买结果只读恢复

已检查搜索与直接URL／Z ID、三类标识／详情／收藏、单条即决／批量跳过、后台导入排除、独立购买／直接建单、扫描及写表／收货衔接、拍卖记录排除。修正如下：

- begin已明确返回4xx时，最终OK尚未点击，本次按明确拒绝处理，不额外写未知标记；网络响应丢失等不确定情况继续保守处理。
- 补齐只读购买结果恢复：`GET /api/plugin/fleamarket/recovery/jobs` 仅领取本绑定账号下buyout＋direct、execution_unknown=1、failed或过期processing、至少2分钟未更新且尚无订单的P任务，保留原任务账号／用户并轮换实例领取凭证。正常购买进行中不会抢占，普通p前缀及其他账号不领取；遵守原并发上限。插件按空余槽位处理恢复任务，最多30秒只读访问 `/order/done`，只有同商品URL＋「購入が完了しました」＋有效金额才能原子补单。完成页未确认时保持未知，2分钟后才能再核对；始终不点击任何按钮、不重买，不进入普通pending重试。恢复用标签本轮结束关闭，避免积累。
- P提交提前拒绝同商品待执行／结果未知／已有成交订单，重试相同client_request_id仍沿原幂等返回；普通多用户／多账号提交规则不变。P完整快照以本次抓取为准，不让旧截止时间误拦提交或旧标题／图片／运费／价格覆盖新快照。
- 交易开始／付款任务查询排除P；付款在SQL分页前排除，避免异常P记录占用普通付款名额。不改订单财务结算字段、历史订单状态或实际支付。
- 成功文字仅读页面实际渲染的innerText，避免空页面的textContent把脚本中预置的「購入が完了しました」误当成购买成功；同商品done URL仍为必需条件，脚本文字专项已覆盖。

P金额规则以0t为准：核对最终确认弹窗商品原价与任务提交价，允许Yahoo自动优惠券／积分，订单按商品原价记账。P从processing确认成功后直接success＋pending_shipment，无bidding中间状态；API拒绝P bidding回写，未到双标识成功页保持失败或未知。

待补充的实际页面：已发货后的物流公司／单号、确认收货按钮／完成标识；另外フリマ登录／验证码／明确支付失败页尚未专门适配，当前保持不确定状态，不能声称已通过真实端到端验收。继续遵守0o的未知页不猜测、不点击规则。

验证已通过：`npm run regression` 本轮完整通过（API／插件／原交易付款／多账号／两端构建及手机PC浏览器）；最后收紧可见成功文字和恢复查询筛选后，两项购买专项再次通过，编码／diff检查通过。命令沿0n／0o，新增用例覆盖新实例只读恢复、旧凭证失效、并发与重复领取、2分钟退避、其他账号隔离、普通p不误领、恢复时begin拒绝、未确认不产生任何购买点击、明确拒绝与网络未知区分、重复提交前零详情抓取、陈旧快照字段不覆盖、P误入普通交易／付款状态也不会发放此类任务、脚本预置文字不误判。需同步更新API task.js／plugin.js／fleamarketPurchase.js、插件background.js并reload；无schema／前台／后台更新。未部署或操作生产数据。

### 0o. P 交易页扫描、物流／收货衔接与历史采集排除

P pending_shipment 重新参与原扫描队列，原账号／工作领取凭证、扫描轮询、超期提醒、状态API、写表及去重机制均保留。插件仅为P新开 `https://paypayfleamarket-sec.yahoo.co.jp/item/{id}/trade/buyer`，独立只读提取并核对同商品URL；现识别未发货文字及0v所述真实已发货标题和物流块，不把常驻进度条的配送中／受取評価误判为已发货或收货。只关闭本次创建的标签，不注入普通拍卖content解析。未知／未补齐页面不修改状态、不写空物流、不点击按钮，释放原工作领取；P确认收货现按0w使用其专用控件与完成标题，不套普通页面DOM或商城直接成功规则。

P实际发货页提取器已于0v补齐，输出原shipped＋shippingCompany＋trackingNumber并复用updateScanStatus→pending_receipt→Google追加／已有行查重，无新增状态或表格逻辑。Google商品URL缺失时P回退为/item/{id}。收货点击已按0w适配；生产端到端发货／写表／收货尚未执行。

auctionHistory 新入队、旧队列领取与结果写回均检查P类型／Z ID并跳过，原html＋data同时为空及成交时间／结束时间规则保留；旧队列中已有任一历史字段的商品也不重复读取。P旧领取迟到回写不写过期标记／空记录，不产生重试或P失败提醒；插件端再兜底跳过，普通p开头拍卖ID继续采集。无schema或真实历史数据清理。

验证：P交易页浏览器／执行器、隔离HTTP购买到扫描／模拟Google写表／原收货任务查询、拍卖记录服务／插件、原background专项通过。`npm run regression` 的API／插件及后台构建／表格浏览器等通过，在无改动的后台账号灯收起按钮处出现一次超时；单独重跑 `node scripts/yahoo-multi-account-browser.test.cjs` 通过，随后用户端生产构建、フリマ浏览器、已结束展示、隔离登录检查逐项续跑通过。最后P各扫描状态分派／普通p前缀及原多账号插件专项、编码／diff检查通过。主要命令：`node yahoo-plugin/fleamarketTrade.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/fleamarketPurchase.test.js`、`node src/server/services/auctionHistory.test.js`、`node yahoo-plugin/auctionHistory.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/multiAccount.test.js`。部署更新API `routes/plugin.js`、`services/fleamarketPurchase.js`／`auctionHistory.js`并重启，插件 `background.js` 更新后reload，无用户端／后台／schema变化。未部署生产、未写真实Google表格、未操作真实购买／收货。

### 0n. P 商品独立购买与直接建单

插件在 executeBidTask 分派入口隔离 P 商品，普通／商城沿原执行路径。仅支持 buyout＋direct，打开对应 `/item/z...`，复用任务领取、受管标签与心跳；只接管本次新建并由任务标签打开的同商品 checkout 子标签，已有无关标签不操作。页面按钮精确匹配，区分置き配提示 OK 与购买确认 OK；不修改付款方式／优惠券／地址。仅核对弹窗商品摘要“送料無料”旁原价等于任务提交价，允许优惠券／积分且不读取支付总额；成交价按任务原价（见0t）。确认提交后仅等待处理中与成功页，不再次点击确认，也不使用原拍卖的自动重试。成功条件严格为同商品 done URL 加「購入が完了しました」。

API 独立 begin／complete 接口要求原账号、实例与领取凭证。begin 在最终 OK 前写 execution_unknown，重复 begin 或已有订单／同商品未知购买均拒绝；超时 processing 的此类任务改失败并保留未知标记，普通任务继续原60秒恢复。complete 核对成功证据和金额，事务内同时写任务 success、buyout_auto_paid、订单 pending_shipment、成交账号／实际金额／成交时间／交易链接及状态审计。重复 complete 仅确认原订单，不覆盖后续状态；结果未知但原凭证仍有效的迟到成功可完成入库。普通状态接口不能绕过直接建单。未修改数据库结构；未知结果保留页面供核对，不自动跨账号／重新购买。P扫描原暂缓规则已由0o替代，自动落札同步跳过P，后台手动导入P的原跳过规则保留。

验证已通过：`node scripts/run-isolated-regression.cjs src/server/routes/fleamarketPurchase.test.js`、`node yahoo-plugin/fleamarketPurchase.test.js`、`npm run regression`、`node scripts/encoding-guard.js`、`git diff --check`；完整回归覆盖原交易／付款／多账号／验证码、两端构建及浏览器检查。最终小范围收紧弹窗识别和恢复账号范围后，重新运行两项专项通过；另恢复用户端生产构建通过。专项覆盖真实浏览器模拟DOM的两个弹窗／按钮／金额／处理中／成功URL和新文字、已有无关tab不接管、新子tab、导航上下文销毁、begin与complete响应丢失、最终确认仅一次、领取失效、超时不重买、原p前缀普通商品恢复、原子回滚／重复订单／后续状态不回退。均为隔离数据库和模拟页面，不等于真实Yahoo购买验收。

部署需同步更新 API `routes/plugin.js`、`services/fleamarketPurchase.js` 并重启 API，更新插件 `background.js` 并 reload；无前端／schema更新。本轮未部署，未购买示例商品，真实页面选择器及支付结果待服务器更新后验收。

### 0m. 批量跳过P与成交商品列表展示

最终验证：2026-10-17 完整 `npm run regression` 已全部通过，包括后台／用户端构建、原API与插件业务回归及浏览器检查；补充WonItems／ProductSearchPopup展示检查、priceRules与productRepository测试也通过。随后重新生成生产模式用户端dist，并通过最终编码／diff检查。本次统一提交0j～0m及旧收藏URL修正，无生产部署。

2026-10-17 批量添加包含P时逐项跳过，指定文案为「不支持フリマ商品！」（替代原请用单商品入口提示）；前端入队成功后立即提示跳过数／全批跳过，其余行照原队列提交。共享逐行解析把P记录为原有行级失败结果，不阻断其后商品、不中断批次；持久化结果仍可查看行号和指定原因，不另加任务或订单状态。服务端严格批量入口及补抓后识别P均使用同一提示；P不进入详情抓取或任务创建。原仅即决普通商品的提示不改；单条P即决提交与后台导入跳过P继续沿0l／0k。

用户端导航按钮、成交列表标题及该页通用加载／空列表文案统一「成交商品」。P类型条目把落札成功／落札价／落札时间改为成交成功／成交价／成交时间，图片下保留原备注旗子及编辑能力，隐藏暂停和拍卖记录图标，隐藏时间下面的BidPriceTimeline；普通／商城条目仍用落札文案并保留原图标／小图表。仅按共享类型识别进行展示，不改金额、时间、状态、订单恢复权限、备注保存或API列表路由。

验证：`node src/shared/batchBid.test.cjs`、`node src/client/src/utils/batchSubmit.test.mjs`、原WonItems／ActiveBidding／ProductSearchPopup展示检查、`node scripts/run-isolated-regression.cjs src/server/services/batchTaskQueue.test.js`、原task.batch.test.js／fleamarket.test.js隔离回归、`npm run build --prefix src/client`、`node scripts/fleamarket-browser.test.cjs`、编码／语法／diff检查通过。内存队列覆盖P ID、P URL混普通与p前缀普通商品：仅正常行调用提交，两个P无抓取／无任务，逐行结果为指定文案；全P批次也无任务。390／1200浏览器验证混合／全P提示、成交导航与标题、P三项成交文案／仅备注旗子／无图表、备注旗子可打开编辑，以及普通商城原文案／两图标／小图表完整；单条P即决、收藏与详情展示原验证继续通过。未运行完整项目回归或操作真实购买／生产订单。

部署：更新API routes/task.js、shared/fleamarket.cjs及batchBid.cjs，更新用户端dist并重启API；无数据库迁移、插件或后台更新。随本次提交同步GitHub，未部署生产。

### 0l. P商品单条即决提交与首页标题恢复

2026-10-17 用户最新要求覆盖0h的全面禁购边界：P商品恢复单条提交，只支持即决一口价，去掉红色禁购提示与表单隐藏。前端复用原仅即决表单锁定价格、勾选和direct策略；API统一规范为フリマURL，强制buyout＋direct，提交前读取最新商品，ID、有效正价格和出售状态必须通过，缓存兜底／失败／已售出／价格变化均不创建任务。即决金额与用户提交一致后才创建，不带定时字段或后续加价。保存product_type=fleamarket；普通／商城原提交与权限流程保持。批量原本只提供竞价即时拍，P仍拒绝并提示「该商品仅支持即决购买，请使用单商品入口」，不是全面禁购。0k后台手动导入跳过P继续保留，收藏正确URL也保留。

首页抓取商品卡只移除标题前的小普／商／P标识，保留原全称标签（含紫色フリマ 商品）及全部原信息；详情标题、搜索和入札／落札列表标识不在本次删除范围。本次没有接入插件フリマ实际购买／支付流程，不能据任务入队推断真实购物已支持，尚需后续独立设计与验收。

验证：`node scripts/run-isolated-regression.cjs src/server/routes/fleamarket.test.js`、原task.test.js／task.batch.test.js／yahooMultiAccount.test.js隔离回归、`node scripts/run-isolated-regression.cjs src/server/routes/manualOrderImport.fleamarket.test.js`、`node src/shared/batchBid.test.cjs`、Submit／ProductSearchPopup原展示检查、`npm run build --prefix src/client`、`node scripts/fleamarket-browser.test.cjs`、`node scripts/submit-ended-browser.test.cjs`、语法／编码／diff检查通过。内存库覆盖URL／大小写Z／旧拍卖Z链接＋bid/buyout请求均保存为buyout＋direct／正确金额与URL／fleamarket类型、幂等、禁定时跟随、价格与状态失败不写入；批量仍拒绝P。390／1200浏览器验证旧收藏正确链接、P勾选锁定和真实submit payload、禁购提示消失、首页标题无小标识、普通商品表单及详情标识保留。后台导入跳过P专项和原截止时间展示测试通过。未运行完整项目回归或真实Yahoo购买，未部署。

部署：更新API routes/task.js、shared/fleamarket.cjs／batchBid.cjs和用户端dist，重启API；本项无额外schema／插件购买流程变更。随本次提交同步GitHub，未部署生产。

### 0k. 手动导入订单跳过 P 商品

2026-10-17 用户明确后台导入订单不考虑P（フリマ）类型。插件 executeManualOrderImportJob 在列表行进入日期判断与详情抓取前过滤フリマ类型、既有标记、Z/z ID与フリマURL；补抓快照才识别的P同样不入候选。忽略旧日期P行也不会提前终止普通订单的分页扫描。API updateManualOrderImportStatus 接收旧插件结果时直接跳过，计数只统计支持的行；确认旧批次时先将 pending_user 的P记录标记 skipped_unsupported，忽略其用户分配，且在创建商品／任务／订单前保留兜底。后台仅增加「不支持跳过」状态标签。普通与商城资格、金额、归属、去重及原导入状态流程保持；小写p开头的普通拍卖ID不属于P类型，不拦截。没有修改历史已导入订单、自动落札同步、付款或交易流程。

验证：`node yahoo-plugin/background.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/manualOrderImport.fleamarket.test.js`、原 admin.orders.test.js／plugin.test.js 隔离回归、`node yahoo-plugin/multiAccount.test.js`、`node yahoo-plugin/encoding.test.js`、`npm run build --prefix src/admin`、语法／编码／diff检查通过。新API专项纳入regression入口；模拟混合P／普通p前缀／商城，断言插件P零详情tab／零快照、仅上报普通商城，API仅两条候选，旧P确认跳过且无商品／任务／订单写入。旧P的无效用户分配也直接忽略，不阻断支持商品。未运行完整项目回归或真实Yahoo导入，未操作生产数据库。

部署：更新 yahoo-plugin/background.js 并在各profile重载；更新 API routes/admin.js、routes/plugin.js与shared/fleamarket.cjs并重启API；更新后台dist用于跳过状态展示。无数据库迁移。本轮改动随本次提交同步GitHub，未部署生产。

### 0j. 独立フリマ类型、三类标识与入口布局

2026-10-17 补充修复旧收藏跳转 URL：收藏原只保存 ID／展示字段，不带 standardUrl，handleSearchBid 的兜底此前统一拼拍卖 URL；现按既有フリマ识别先构造 `https://paypayfleamarket.yahoo.co.jp/item/{小写ID}`，普通／商城仍用原 URL。现有收藏不需重存或清理，禁购保持。仅新增用户端静态文件更新需求，无额外 API／插件／schema 改动。`node scripts/fleamarket-browser.test.cjs` 在390／1200模拟旧格式收藏，验证点击后输入框 URL 与实际详情请求均正确、普通收藏仍走拍卖URL且收藏不丢失，フリマ无提交；原收藏工具／提交展示检查、用户端构建及编码／diff检查通过。

2026-10-17 按用户五项要求：新增 `PRODUCT_TYPE_FLEAMARKET = fleamarket`，共享 normalizeProductType 接受第三类型，フリマ识别兼容类型字段／既有标记／Z ID／URL；详情及搜索返回 productType、缓存与 normalizeProductSnapshot 均保留 fleamarket，使用原 product_type 字段即可，无新增列或历史回填。普通／商城判定及价格换算维持原规则。搜索摘要类型读取实际 seller.isStore／taxFlag，旧列表兼容原店铺 class 标记，且仅加入类型字段，不改变商品顺序、分页或价格。

显示：共用 ProductTypeTag 支持全称与普／商／P 简写；首页原普通／商城全称标签和商品信息保留，フリマ全称改「フリマ 商品」并用紫色底，标题前加 P；各商品详情标题前加对应普／商／P。搜索普通／商城商品标题下加全称标签，フリマ原站 logo 保留。入札中原 direct 可再入札按钮移至左侧图片的最高价下面，multi_bid／失败分析资格及原跳转不变。フリマ搜索右侧按钮改「購入」，可行动详情页底部改「去購入」（原只读详情关闭按钮不改），仅フリマ详情隐藏拍卖次数与截止时间；普通／商城仍显示两项和「入札／去竞拍」。点击フリマ购买入口仍沿原商品展示页显示暂不可购买提示，无任务或实际购买；API及批量对新类型字段也继续拒绝。

验证：`node scripts/run-isolated-regression.cjs src/server/routes/proxy.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/fleamarket.test.js`、原 task.test.js／task.batch.test.js／yahooMultiAccount.test.js 隔离回归、`node src/shared/priceRules.test.cjs`、`node src/server/services/productRepository.test.js`、原 ActiveBidding／WonItems／ProductSearchPopup 展示检查、bidPrice 检查、`npm run build --prefix src/client`、`node scripts/fleamarket-browser.test.cjs`、语法／编码／diff 检查通过。390／1200浏览器覆盖三类搜索标签／详情标题、普通商城拍卖信息保留、フリマ信息隐藏、購入和去購入两入口仍无提交、URL／Z输入；独立临时浏览器检查再入札位于左图最高价下方、direct唯一按钮、原跳转不变。只读实时「ワンフェス」搜索解析53件，普通52／商城1，源数据 seller／taxFlag 与类型相符。截图已检查。本轮未运行完整项目回归、未改生产数据或操作真实购买。

部署：API更新 proxy.js、task.js、services/productRepository.js，共享更新 domainConstants.cjs／priceRules.cjs／fleamarket.cjs，更新用户端 dist 并重启 API。无数据库迁移、插件或后台更新；随本次提交同步GitHub，未部署生产。后续フリマ购买流程仍待另行设计。

### 0i. 用户端普通／商城标识

2026-10-17 本地新增共用 ProductTypeTag：首页商品卡标题前、入札中／失败分析／落札列表的商品 ID 后显示后台同款绿色「普」或红色「商」。按用户纠正，首页仅追加标题前标识，原独立类型标签和商品信息保持；撤销此前删除原类型标签的额外改动。显式商品类型优先，缺失才按税类型回退，フリマ隐藏此二分类标识。失败分析只读查询补回既有 product_type（采用其他列表的同款 COALESCE 回退），避免只按税类型展示导致与后台不一致；无数据库写入或业务规则改变。

验证：`node src/client/src/pages/ActiveBidding.display.test.mjs`、`node src/client/src/pages/WonItems.display.test.mjs`、`node src/client/src/components/ProductSearchPopup.display.test.mjs`、`node src/server/services/failureAnalysis.test.js`、`npm run build --prefix src/client`、`node scripts/fleamarket-browser.test.cjs`、编码／diff 检查通过。临时浏览器脚本在390／1200覆盖入札、失败分析、落札两类标识及首页标题前标识，并用显式类型与税类型相反的样本确认类型优先；截图已检查。原フリマ搜索详情及禁购浏览器检查通过。本轮未运行完整项目回归。部署更新 `src/server/services/failureAnalysis.js` 并重启 API，以及用户端 dist；无插件／schema／后台更新，未部署。

### 0h. Yahoo!フリマ只读商品信息与购买禁用

2026-10-17 按用户最新边界，フリマ与普通／商城商品的购物流程不同，当前只支持搜索、查看商品信息，购买功能待业务明确后另行设计；上轮 buyout＋direct 提交已撤销。关键词搜索结果使用正确 `/item/` URL，标题下仅在搜索列表显示原站图标；直接输入フリマ URL 或大写／小写 Z 商品 ID 均走フリマ详情抓取。详情使用与目标 ID 匹配的主商品 JSON-LD，显示标题、价格、全部图片、说明、运费与出售状态；没有截止时间不虚构。

只读边界：商品信息下显示「Yahoo!フリマ 暂时无法购买，请联系管理员！」，隐藏即决／最高价／策略／提交按钮；前端 handleSubmit 保留兜底。共享 fleamarket.cjs 按フリマ标志、Z/z ID 或 paypayfleamarket 商品 URL 识别，单条 API／严格批量提交／批量文本解析均使用同一提示拒绝。拦截在抓取／商品写入／任务创建／账号分配之前，不允许通过 buyout、普通竞拍或旧拍卖域名的 z 链接绕过。普通拍卖／商城及其原价格策略不变。未修改插件、任务状态、真实历史数据或数据库结构。

验证：`node scripts/run-isolated-regression.cjs src/server/routes/fleamarket.test.js`、原 `task.test.js`／`task.batch.test.js`、`node src/shared/batchBid.test.cjs`、用户端 `ProductSearchPopup.display.test.mjs`／`Submit.display.test.mjs`、`npm run build --prefix src/client`、`node scripts/fleamarket-browser.test.cjs`、语法／编码／diff 检查通过。新增测试已纳入 regression 入口，本轮未运行完整项目回归。390／1200 浏览器验证搜索标识、详情及返回、URL／大写 Z 输入、禁止购买提示及表单隐藏、无提交请求，以及普通拍卖切换后仍显示原表单；内存库验证各输入与竞拍／即决／批量组合均返回400和指定提示，商品／任务表零写入，且未调用抓取。上轮只读实时核对3件商品：z650807476为21500円、z650805568为26200円、z650804548为29700円，各2张图片及送料無料，本轮未重复联网。

部署：更新 `src/server/routes/proxy.js`、`src/server/routes/task.js`、`src/shared/fleamarket.cjs`、`src/shared/batchBid.cjs`，重新构建并更新用户端 dist（含 yahoo-assets/fleamarket-icon.svg），重启 API。未部署生产。后续须先明确フリマ完整业务，再单独接入与验收购物／支付流程；当前不允许提交任务。

### 0g. 新版商品名称搜索兼容与部署验收

2026-10-14 已本地完成，仅修改搜索结果读取和下一页识别，原旧页面解析及单结果读取流程兼容保留，不改详情抓取、出价／价格／运费业务、任务或订单状态。新版 JSON 商品摘要转为原搜索接口字段；渲染 HTML 的 searchItems 内商品按原页面顺序去重，未渲染页面仅取 listing，排除其他推荐区域。保持原 URL、分页参数、HTTP／浏览器获取顺序和前端流程。

验证：`node scripts/run-isolated-regression.cjs src/server/routes/proxy.test.js`、`node src/client/src/components/ProductSearchPopup.display.test.mjs`、`node src/client/src/utils/api.product-info.test.mjs`、`node src/client/src/pages/Submit.display.test.mjs`、`node --check src/server/routes/proxy.js`、`node scripts/encoding-guard.js`、`git diff --check` 均通过。新增新旧结构、JSON 两种路径、重复商品／推荐排除、价格／即决／运费／入札／结束时间映射、空与损坏 JSON、第一页／第二页／末页及单次列表请求验证。只读内存验证用户整页 HTML：53 个主列表唯一商品，首件 r1247829073 的 13001 円／送料750円／入札10 与截图吻合；实时 GAMEBOY 与 GAMEBOY ADVANCE 第一／第二页各50件，页面不同且 hasMore／nextPage 正常。未运行全项目回归或真实用户浏览器端到端操作。部署仅更新 API 文件并重启 API，随后用户端确认名称搜索、加载更多、选中详情；未部署生产。

### 0f. Yahoo 多账号本地实现与生产验收

2026-10-16 修复邮箱验证成功直达 PIN 时仍提示 gmail验证码填入错误：原转换仅认可 /ncaptcha，现保留该判断，并在邮箱页已消失、标签 complete 时复用原 detectManualPinPage 返回原 PIN 流程；本次新开且沿 opener 归属的 PIN 子标签纳入原查找，已有无关标签仍排除。原标签超时后已到 PIN 时，下一次人工继续直接关闭邮箱 challenge 并交接。邮箱代码不复用为 PIN；不改邮件选择、单次刷新／提交、超时、PIN 输入、账号、交易／支付／任务逻辑。仅插件 background.js 更新后 reload，无 API／前端／schema 更新。

验证：`node yahoo-plugin/emailVerification.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/multiAccount.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/background.js`、`node scripts/encoding-guard.js`、`git diff --check`。邮箱专项覆盖同 URL 直接 PIN、第29秒进入 PIN、本次新子标签、旧错误继续时已到 PIN 无 Gmail／刷新、外层 email→关闭邮箱→原 PIN 提示且未输入 PIN；原文字验证码、真正邮件拒绝、超时、一次执行、重载恢复与邮件读取专项保留通过。仅本地模拟，未运行完整项目回归或服务器 Gmail／Yahoo 端到端验收，未部署生产。

2026-10-13 付款流程兼容新版已发货文字：仅 buildPaymentPageStateFromSnapshot 的 alreadyPaid 文案识别补入「商品が発送されました」且符合原确认收货 paidOrShipped 的到货提示，复用现有识别。待结算任务读取该页面后沿原已付款成功回写到 pending_shipment（待发货），不点击支付／确认收货按钮；其他付款资格、状态回写、金额／运费及失败中断均不改。只需更新插件 background.js 并 reload，无 API／前端／schema 更新，未修改真实 x1247287408 或操作 Yahoo。

验证：`node yahoo-plugin/background.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/plugin.test.js`、`node yahoo-plugin/multiAccount.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/background.js`、`node scripts/encoding-guard.js`、`git diff --check`。新增截图文字与到货等待文字识别、仅有发货字样／未付款／处理中不误判、主交易状态优先于其他正文；运行付款任务真实解析截图文字，断言无任何付款点击注入、只回写一次成功且无错误，沿原 API pending_settlement→pending_shipment 更新。原付款／取消／金额／运费及多账号专项通过。本地模拟验证，未部署生产。


2026-10-13 交易开始／付款边界修复（替代 2026-10-12 全局购买入口兼容）：只读核对 43.165.177.49 最近 40 单，其中 8 件普通商品在北京时间 10月12日22:49:31～22:52:41 的 transaction_start 诊断停在 /buyer/payment/complete，并报 bundle confirm next page did not appear；7 件后续后台仍待支付，1 件另有付款成功回写。日志证明交易开始误入付款完成页，不据此推断真实扣款金额或重复扣款。6c31c0b 将购买手续按钮全局当作交易开始，加上旧的非整段「確定する」匹配，扩大了原业务路径。本次限定新文案只用于截图对应 /trade/top 且非直达付款的入口；旧 buyer 购买入口恢复不点。确认只匹配完整「確定する」，两种实际点击路径拒绝 buyer/payment 页面，支付仍由原付款线执行。无 API、schema、前端或历史订单修改，不修改自动重试、运费、状态回写或付款规则。

按用户指定，以昨天11点前最后提交 c0dcb3b（2026-10-12 10:16:57 +08:00）为验收基线。完整函数对照 background.js 326 个中仅按钮模式和 MAIN 点击 2 个不同，content 190 个中仅入口辅助／动作点击／页面动作识别 3 个不同，plugin.js 110 个函数全一致。交易开始及支付领取、执行、状态回写、页面等待、运费／金额／鉴定／商城确认、取消／已付款及失败中断均与该基线一致。直接运行 c0dcb3b 未改的12个交易／付款测试通过。另对更早 9d22b23 核对：startNormalSingleTransaction、completeBidderPaysShippingTransaction、completeFixedShippingTransactionInfo、completeNormalBundleRequest、executePaymentJob、isDirectCashOnDeliveryPaymentEntry 函数除换行外逐字一致；executeTransactionStartJob 仅既有多账号跳过时归还领取，runPaymentJobs 仅既有多账号批次领取包装，与本次修复前相同。直接读取旧版 background.test.js 的未改测试，12 个交易／付款场景通过，包含旧购买入口不点、拒绝后旧单品流程、固定运费、落札者负担、着払い、取消、正常付款、已付款及未知页面。恢复旧购买入口免费运费测试，新增 content 与实际 MAIN 注入函数测试，覆盖付款页确认／最终购买不点、新旧入口、直达付款链接及正常交易确认。

验证命令：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/multiAccount.test.js`、`node yahoo-plugin/encoding.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/content.js`、`node scripts/encoding-guard.js`、`git diff --check`。上述插件专项通过；`npm run regression` 在未改的 task.won-stats.test.js:68（ended_product_count 预期4、实际0）停止，当时完整入口未通过。已只读确认统计测试将当天 UTC 00:00（北京时间08:00）写成结束／落札时间，08:00前却固定预期4件已结束；内存模拟07:00复现0，09:00通过，当前原测试也通过。属于测试依赖真实运行时间，不修改统计代码或测试。本次最终完整 `npm run regression` 已全部通过，包含原交易／付款／插件／API、两端构建和浏览器检查，90天统计原测试也通过。新增同捆拒绝后新版免费运费及无拒绝单品场景，仅完成原交易信息步骤到 pending_payment，不执行支付；落札者负担沿原 waiting_shipping 分支。编码／语法／diff 检查通过。仅本地模拟验证，真实新版交易信息后续页面仍需更新插件后验收；没有重新处理或修正生产订单。


2026-10-13 提交页角标改为读取时固定状态（替代下条持续判断实现）：fetchAndSetProduct 成功读取商品时记录 endedAtRead，商品卡角标和表单显隐仅使用该结果。取消截止时间定时器、focus／visibilitychange 监听以及点击提交时重新计算并改变角标的分支。读取时未结束的商品即使后来超过截止时间或切回页面，也不加角标／不隐藏表单；重新获取已过期信息才出现角标并隐藏。仅提交页启用角标，其他图片不加；商品详情、原价格／策略和 API 实际提交时的过期保护保持。仅更新用户端静态文件，不需重启 API 或更新插件。验证：`node src/client/src/pages/Submit.display.test.mjs`、`npm run build --prefix src/client`、`node scripts/submit-ended-browser.test.cjs`、`node scripts/encoding-guard.js`、`git diff --check`。390／1200 浏览器覆盖获取已结束、获取未结束、跨过截止时间及 focus／visibilitychange 后仍保持、重新读取后变已结束与表单隐藏；未操作真实 Yahoo 或数据库。

2026-10-12 用户明确新增已结束商品禁止提交：提交页抓取后的有效 endTime 严格小于现在才判结束，图片左上角显示红色「已结束」，仅隐藏商品卡下的即决／最高价／汇率／策略／加价额度及提交按钮，商品卡／详情／输入与批量入口／原任务列表保留。用截止时间定时器及窗口 focus 更新，防止开着页面跨过截止时间仍保留表单；handleSubmit 再次即时核对。ProductCard 新增可选 ended 属性，其他使用默认显示不变。共享 auctionDeadline.cjs 统一显式时区与无时区 Yahoo 日本时间，严格小于（相等不判）、无效／缺失不猜测。提交 API 在原补全流程确定 endTime 后、新任务和账号名额写入前拒绝「商品已结束，不能提交任务」，复用原幂等提交返回／价格／策略／账号校验顺序；原批量最新页面校验仍保留，其他出价和插件执行规则不改。需更新 API routes/task.js、共享工具、用户端静态文件并重启 API，无 schema／后台／插件更新，未写实际商品／任务或操作 Yahoo。

验证：`node src/shared/auctionDeadline.test.cjs`、`node scripts/run-isolated-regression.cjs src/server/routes/task.endedSubmit.test.js`、`node src/client/src/pages/Submit.display.test.mjs`、`npm run build --prefix src/client`、`node scripts/submit-ended-browser.test.cjs`、`npm run regression`、`node scripts/check-product-read-paths.js`、`node scripts/encoding-guard.js`、`git diff --check`。时间边界／日本旧时间与时区专项，隔离实际 schema 验证提交过期参数／获取过期商品均无商品／任务／名额写入、正常最高价／策略保留；390／1200 模拟商品页验证角标位置、表单完全隐藏、不发送提交、正常商品显示及实时跨截止时间更新。新专项已加入完整回归。

上述专项通过；完整回归的业务／插件／API／后台构建及浏览器通过至红绿灯检查，首次「收起其他账号状态」等待超时，红绿灯单独重跑 360／390／1200 通过。随后单独完成最新用户端构建、结束商品浏览器专项及真实登录／配置／轮询／刷新检查，读路径／编码／diff 检查通过。角标代码仅 Submit 商品卡启用，其他图片不加；定时器在重新聚焦和可见状态切换时重新核对，API 也拒绝最新补全结果已结束而旧参数仍在未来的情况。未部署生产。

2026-10-12 商品已结束显示修复：只读查询 43.165.177.49 的 n1247281943（任务 12549／12553）与 k1247037995（12551），诊断明确为 Auction ended according to product page snapshot，但 failed 快照先结束任务且未保存 error_msg，随后同状态回写被去重，用户端空错误落入「系统原因」。快照接口仅 status=failed＋本次有效结束时间已到＋原错误为空时，同一次 UPDATE 保存原共享分类识别的结束原文；不改状态判断、最高价、策略、重复／失效凭证／落札保护。已有失败空原因的用户任务列表／详情及后台任务列表，通过 endedTaskReason 只读匹配诊断的精确任务ID（分隔符边界）、商品、账号、类型及原文，匹配才返回结束原因，已有其他错误及无证据失败保持。真实数据库未补写，debug 原字段不改；更新 API 后原截图三条有证据记录可正确显示。后台 Tasks 共用列为用户名开启 ellipsis，保留 100px；状态列加至 190px、scroll 总宽 1304，主表和队列同步，其他列／菜单和横向滑动保持。需更新 API 路由／共享服务与后台静态文件并重启 API，不需更新用户端或插件。

验证：`node scripts/run-isolated-regression.cjs src/server/routes/plugin.endedSnapshot.test.js`、`node src/admin/src/Tasks.display.test.js`、`npm run build --prefix src/admin`、`node scripts/admin-table-mobile.browser.test.cjs`、`npm run regression`、`node scripts/check-product-read-paths.js`、`node scripts/encoding-guard.js`、`git diff --check`。隔离 HTTP 覆盖快照→重复失败回写的完整顺序、正确结束标签、未来／无效／缺失时间、其他已有错误、pending／processing 调度、旧凭证及落札保护、价格策略不变；历史展示精确匹配与其他任务／商品／账号不误判，并验证数据库空字段不被改写。360／390／1200 浏览器覆盖主表及队列长用户名省略、长失败状态完整且不越过时间列边界、单行及原横向滑动；专项均加入完整回归。未改服务器数据或操作真实 Yahoo。

本次验证结果：完整回归的业务／插件／API／新专项／后台构建及新列布局、删除用户浏览器均通过；原红绿灯检查首次在「收起其他账号状态」等待超时，`node scripts/yahoo-multi-account-browser.test.cjs` 单独重跑 360／390／1200 通过，保留完整入口未一次通过的记录。之后单独完成用户端构建和隔离登录／轮询／刷新专项；读路径、语法、编码、diff 检查通过。

2026-10-12 用户账号删除规则（用户此次明确授权）：role=user 且 user_level<3 均可删除；用户端管理员等级及 role=admin 禁止，前端禁用且 API 再校验。有任意历史订单／任务时首次 DELETE 返回 409＋requiresConfirmation＋数量，后台二次提示「该用户还有订单、任务未清空，需要一起删除吗？」；取消不写入，确认以 confirm=1 再请求。无订单／任务时不追加确认，即使有个人配置／会话／导入／商品账号归属也直接清理。deleteUser 服务在单个 SQLite immediate 事务中重新核对并删除用户任务／订单、出价／状态日志、交易消息、账号转交／请求去重／订单工作领取、本人批量提交／导入记录、个人配置／会话及 JSON 队列／提醒，释放本人商品账号名额；taskless 导入订单按明确商品账号归属或导入关联计入确认。只删除无其他任务／订单／归属／导入／批量行／入札引用的商品，保留其他用户同商品数据、跨账号入札和同捆其他订单；代理下级仅清空 parent_user_id，代理为其他用户提交的批次保留并将 login_user_id 改为其原所属用户。清空被删除商品的历史队列租约，迟到任务回写和订单领取检查沿原账号保护拒绝。鉴权增加实际用户存在检查，旧 JWT 不能再次提交或恢复会话。异常捕获返回中文并完整回滚，不再退出 API。保留共享业务配置、Yahoo 账号及其他用户数据，不操作真实 Yahoo；已在 Yahoo 完成的操作不会撤销。需更新 API 服务／鉴权／路由及后台静态文件并重启 API，无 schema 或插件变更，未直接删除实际 test_user。

本次验证：`node src/server/services/deleteUser.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/admin.users.delete.test.js`、`npm run build --prefix src/admin`、`node scripts/user-delete-browser.test.cjs`、`npm run regression`、`node scripts/encoding-guard.js`、`git diff --check`。专项覆盖确认／取消零写入、管理员保护、无任务其他数据直删、taskless 订单确认、共享商品／同账号剩余任务／跨账号入札／其他用户金额和订单不变、其他用户批次及数字相同的导入领取不误删、队列／提醒／会话清理、异常事务回滚与 API 存活、旧 JWT／插件迟到回写拒绝。浏览器覆盖 390／1200 二次确认、取消、直接删除及管理员禁用；新专项已加入完整回归，所有测试使用内存或独立临时数据库／模拟 API。

上述专项及完整 `npm run regression` 已通过，包含原订单／插件／任务业务、两端构建、红绿灯与验证码操作、真实登录和配置检查。实际本地数据库只读序列化到内存副本，test_user 正确提示 1 条任务／1 条订单，确认删除成功；其他任务／订单完整保留、外键检查正常，原数据库及真实用户保持不变。读路径、语法、编码及 diff 检查通过，尚未部署。

2026-10-12 手机表格修正并替代此前 88px 标题方案：任务表因账号 ellipsis 自动启用固定布局、主表缺少横向 scroll，导致其他列被挤压逐字换行。任务／队列共用列显式保留用户名 100、商品ID 150、金额各 100、策略 90、状态 100、时间各 170 像素；横向 scroll 1214 与列总宽一致，标题／数据 nowrap，超出容器左右滑动。订单其他列保持原宽，仅标题 nowrap。两处账号列改「YH」、64px、原长账号省略显示，底部菜单继续原单行横向滚动，不更改菜单结构。仅后台静态文件，无 API／插件／schema 改动。验证：`node src/admin/src/Tasks.display.test.js`、`node src/admin/src/Orders.display.test.js`、`npm run build --prefix src/admin`、`node scripts/admin-table-mobile.browser.test.cjs`、`node scripts/encoding-guard.js`、`git diff --check`。新增 360／390／1200 浏览器回归使用真实长度样例，验证 YH 列宽、所有标题与数据行高度、表格可横向滚动、页面无横向溢出及菜单单行；此前只查账号列宽的验证未覆盖其他列挤压，此次补齐。未部署生产。

2026-10-12 按用户要求删除顶部冗余账号状态区：AdminLayout 移除主账号名称与「插件在线／以下提醒对应本账号」说明，备用 YahooAccountAlerts 移除名称及在线／登录 Tag，仅有实际提醒时渲染容器。主账号原独立提醒、备用账号登录异常／验证码／PIN／邮箱／付款／确认收货／超期发货／表格失败提醒及操作仍保留，红绿灯组件不变。仅更新后台静态文件。验证：`node src/admin/src/AdminLayout.display.test.js`、`node src/admin/src/MessageRead.display.test.js`、`npm run build --prefix src/admin`、`node scripts/yahoo-multi-account-browser.test.cjs`、390／1200 模拟无提醒页面检查、`node scripts/encoding-guard.js`、`git diff --check`；未部署或操作实际账号。

2026-10-12 后台账号列紧凑显示：任务报表「执行 Yahoo」改「执行Yh」，订单管理「成交 Yahoo」改「成交Yh」，两列宽度 140→88 并开启 ellipsis，保留原 Yahoo ID／账号名称取值、账号隔离及订单操作。仅需更新后台静态文件，API／插件／schema 无改动。验证：`node src/admin/src/Tasks.display.test.js`、`node src/admin/src/Orders.display.test.js`、`npm run build --prefix src/admin`、390／1200 像素模拟 API 浏览器列宽／省略检查、`node scripts/encoding-guard.js`、`git diff --check`；未部署生产。

2026-10-12 新版同捆拒绝后单品开始按钮兼容：截图现场已被扫描识别为拒绝并拆组，但关闭弹框后新版「購入手続きをする」未匹配旧「取引をはじめる」，落札者负担分支在未进入信息页时寻找决定按钮，产生 bundle decide button not found。单品开始的状态检测、MAIN world 与 content 点击均增加新版有／无「を」的完整按钮文案，保留严格整段匹配、旧入口及原后续决定／确认、运费和付款规则；不把购买最终确认或同捆入口当单品开始。仅更新 yahoo-plugin/background.js、content.js 并在各 profile reload；API／schema／前端无需变更，未直接改真实订单或执行 Yahoo 交易。验证：`node yahoo-plugin/content.test.js`、`node yahoo-plugin/background.test.js`、`node yahoo-plugin/multiAccount.test.js`、`node --check yahoo-plugin/background.js`、`node --check yahoo-plugin/content.js`、`node scripts/encoding-guard.js`、`git diff --check`。模拟覆盖旧入口、新入口两种文案、拒绝关闭后单品信息决定／确认到等待运费、无拒绝的单品入口及错误文案不匹配；真实新版后续信息页待更新后核对，不宣称已验证真实交易完成。

2026-10-11 按用户要求隐藏用户端 Yahoo 执行／成交账号：任务列表、入札中及失败分析、落札商品均移除“执行 Yahoo／成交 Yahoo”展示。仅调整用户端显示，API 返回、后台账号展示、账号分配和订单业务不变。验证：TaskList／ActiveBidding／WonItems 原展示检查、用户端构建、编码及 diff 检查。仅需更新用户端静态文件并刷新页面，不需重启 API 或 reload 插件。

2026-10-11 同捆手动修复后续数据库错误：现场 order_status_change_logs 表存在，但外键仍指向不存在的历史 orders_default_fix_1780496607153 临时表。去掉同一用户检查后进入状态更新／日志写入，日志外键报错使同捆事务回滚；该限制删除未改表结构，具体历史重建操作未能从当前代码确定。新增 orderAuditSchema 启动修复，仅处理不存在的 orders_default_fix_数字 引用：先 VACUUM INTO 完整数据库备份，再事务重建日志表、引用改回 orders，保留原字段／全部历史（含既有孤立记录）／索引／触发器／自增序列，失败回滚并恢复 pragma；订单、任务、账号及财务数据不改。正常库和再次启动不重建或重复备份。更新 API 后重启自动执行，备份在原数据库旁 *.db.order-audit-fk-backup-时间戳.db，启动日志打印路径；重启后再使用原“普通商品同捆修复”。当前数据库仅只读打开并在内存副本验证：复现原错误、修复结构后两笔同账号不同用户订单成功进入待同捆并产生两条日志，其他订单／全部任务及归属／金额保留。验证：`node src/server/services/orderAuditSchema.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/admin.orders.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.regressions.test.js`、语法／编码／diff 检查；schema 专项已加入完整回归。

2026-10-11 按用户要求调整后台“普通商品同捆修复”：去掉同一内部用户限制，仍要求所有输入订单来自同一个 Yahoo 成交账号。修复仅沿原流程写入待同捆、统一同捆组并清除交易开始错误，各订单用户归属、成交账号和金额保持；普通商品、已结算／已付款等状态检查及原组完整性检查保留。需更新并重启 API，无前端、插件或数据库迁移。隔离数据库测试覆盖不同用户同账号修复成功、跨账号拒绝且无写入、原用户／账号／金额保留；验证：`node scripts/run-isolated-regression.cjs src/server/routes/admin.orders.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.regressions.test.js`、`node --check src/server/routes/admin.js`、`node scripts/encoding-guard.js`、`git diff --check`。未直接修复实际订单。

2026-10-11 按用户要求撤回本次“已申请同捆自动恢复”修复：现场新版 Yahoo 页面仍无法读到完整同捆清单，状态未能回写。已移除新增清单解析、查看同捆链接读取、自动恢复分组／状态分支及对应专项测试，恢复此次修复前的插件同捆处理；其他多账号、出价重试及同步改动保留。仅更新 background.js、content.js 并分别 reload 插件即可生效，不修改实际订单状态、分组或历史错误。验证：插件内容／后台测试、隔离 HTTP 回归、语法、编码及 diff 检查。


2026-10-11 用户明确新增例外：提交任务执行中出现后台标记为“Yahoo页面错误”的失败，也在原账号、原任务上重试一次。匹配原共享提示类别（Yahoo bid failed／Yahoo system error page／Yahoo error page／Yahoo access failure）；关闭原执行页面，轮换本次领取凭证，再按原最高价、策略与任务内容重开执行，保留原出价池槽位。连续同类错误只重试一次；重试后按实际结果处理。价格不足、被超过、登录失败、黑名单均不因此新增重试或改价；原标签页异常、超时重试规则保留。此项是用户此次授权的业务增补，不能据此扩大其他旧规则。只需更新 yahoo-plugin/background.js 并分别 reload 插件，无新增 API、数据库或前端改动。

验证：node yahoo-plugin/multiAccount.test.js 覆盖两种真实错误、成功恢复、连续失败仅两次执行、原价格／策略／账号保留、其他失败不新增重试及失效领取停止；原 background 与 syncRecovery 专项、隔离 HTTP 任务安全专项一并验证。未对真实任务重拍或操作 Yahoo。

2026-10-11 修复自动入札／落札同步的过早超时：创建 about:blank 后导航时，Chrome 可能暂时仍返回旧页面 complete；原同步读取因此跳过等待，3 秒后看到 loading 就误判超时。同步专用等待现在排除空白页及尚未提交的 pendingUrl，真正等待目标文档加载；3 秒缓冲期间又开始加载时，继续使用本次剩余的 30 秒等待时间。每页原 30 秒、一次重开及整轮入札 5 分钟上限保留，错误页仍失败、不上传不完整或伪空列表。只修改 yahoo-plugin/background.js 的只读同步等待，不修改共用出价／付款等待函数、价格或订单业务判断。仅需更新该文件后分别 reload 两个 profile 的插件；无需 API 或数据库变更。

验证：node yahoo-plugin/syncRecovery.test.js 覆盖空白页完成状态、pendingUrl、延迟加载、29 秒慢加载、真实 30 秒超时、总超时取消、分页完整性、错误页及双账号隔离；node yahoo-plugin/background.test.js 与 node yahoo-plugin/multiAccount.test.js 通过。未连接真实 Yahoo、未自动重载插件；实际运行待用户更新后验收。

2026-10-11 按旧版业务基线恢复多账号适配：页面异常／出价超时仍按原条件各重试一次，重试只更新执行凭证，不改变价格、策略或账号；processing 超过原 60 秒阈值恢复 pending 并作废旧凭证，首次迁移也保留原任务状态。订单批次结束释放本次领取，新实例认证接管后恢复旧实例遗留领取，移除多账号新增的“核对后释放”入口；付款失败中断、关闭付款 flag 和原“继续”保持不变。PIN 恢复系统键盘失败后 debugger／DOM 的原回退顺序，复用当前账号的窗口锁。无主订单可按原规则分配用户，成交 Yahoo 不变，既有竞拍分配不作为导入用户限制。此次需同步更新 API、后台及插件并重启／reload，无 schema 变更，未操作真实 Yahoo 或真实数据库。

验证结果：完整 npm run regression 通过，包含原业务、隔离 HTTP、插件、两端构建及手机／PC 浏览器。覆盖重试凭证轮换、旧回写拒绝、60 秒恢复、重载后订单领取及无主导入。收尾恢复迁移状态后账号服务专项另行通过；补充断网释放恢复、失败扫描释放领取测试后插件专项另行通过。读路径、编码、diff 检查通过，未操作真实 Yahoo 或真实数据库。命令沿用本节专项。

用户确认的总边界（2026-10-11）：以原单账号程序的业务逻辑为基准，提交任务、价格校验、最高价、出价策略、失败判定，以及交易开始、付款、扫描、确认收货等全部订单处置流程都不因多账号改造而改变。多账号仅增加账号分配、隔离与已明确授权的转交行为；出现 bug 时修正新增实现，不自行增加人工判断、自动提价、自动重试或其他业务规则；原已有重试完整保留，旧版即使存在小 bug 也不在本次顺手修复。

2026-10-11 按用户最新要求取消出价任务人工核对：普通失败和结果不明确均不阻止同用户在原 Yahoo 账号后续提交或既有队列领取，已有 execution_unknown 记录也无需人工解除。移除任务页“结果核对”列及 resolve-unknown 接口。失败任务保持失败，不自动重放；execution_unknown 仅作为防止不确定入札跨账号转交的内部依据。领取仍校验归属、同账号同商品互斥、并发和原多次出价条件；最高价仍是该任务的出价上限，不自动提价或生成重试任务；用户再次主动提交仍经过原价格与策略校验。价格、策略、被超过处理、取消归属及订单付款规则不改。API 与后台静态文件需一起更新并重启 API，无数据库迁移，本次不需更新插件。

验证：扩展 yahooMultiAccount.taskSafety.test.js 和 yahooMultiAccount.test.js，使用隔离 SQLite 与真实 HTTP 覆盖主号／备用普通失败、缺失结果标志、明确未知、既有队列、新提交、失联超时、原价格保留、失败任务不重放、同商品互斥、账号隔离和旧回调拒绝。验证命令沿用本节专项及 npm run regression；不连接真实 Yahoo 或生产数据库。

此前取消人工核对的验证记录：多账号隔离 HTTP、任务安全及账号服务专项通过。该次完整 npm run regression 的业务测试、插件测试和后台构建通过，账号红绿灯浏览器检查首次收起按钮等待超时；该项单独在 360/390/1200 重跑通过，随后单独完成用户端构建和 390/1200 真实登录／轮询／刷新检查，均通过。读路径、语法、编码及 diff 检查通过。未部署、未修改真实数据库、未操作真实 Yahoo；保留首次完整回归未一次通过的记录。

2026-10-11 自动同步错误页恢复：仅入札中／落札只读同步在浏览器错误页或加载超时时，对当前失败页最多重新打开一次；完整加载并检查主文档后才注入，不再忽略加载超时。持续失败按原间隔下轮再试，单条最终错误带账号 ID、实例、入札／落札、页码、阶段、请求／实际地址及可取得的 net::ERR 错误码。新增 webNavigation 权限用于导航诊断；日志去除非分页查询参数。自动同步专用标签先登记再打开 Yahoo，页面自行上报及关闭后的迟到上报被阻止，由完整读取结果统一上传；手动页面原上报保留。原五分钟入札同步上限保留，并阻止超时后继续打开页面、重试或上传。无需 API／数据库修改，更新 yahoo-plugin/background.js 和 manifest.json 后，两个 profile 分别 reload。故障现场根因仍待重载后日志验证，不把此次恢复处理当作已证明多账号冲突根因。

验证：新增 `node yahoo-plugin/syncRecovery.test.js`，覆盖错误页／超时恢复、两次失败停止、第二页恢复与不完整列表保护、落札失败不影响已完成入札读取、账号诊断与 URL 脱敏、迟到页面消息、超时取消、单账号与两个模拟 profile 并行隔离、手动页面原上报及非同步注入错误保留；专项加入完整回归。沿用原 background、multiAccount、content、encoding 与语法／diff 检查。测试为模拟 Chrome 与 API，未自动重载真实插件或进行真实出价、付款。

用户端登录恢复验收：新增用户鉴权 /api/task/bid-config，提交页不再访问插件绑定接口。复用原 getMultiBidConfig 的三项值和默认值，不改变多次出价校验或执行规则。`node scripts/run-isolated-regression.cjs scripts/client-login.test.cjs` 使用独立临时 SQLite、真实密码登录和浏览器，覆盖默认／自定义／配置更新、缺失或无效用户 token 被拒绝、有效用户 token 仍不能访问插件配置／领取、390/1200 登录＋轮询＋刷新不掉登录。此专项已加入完整回归（用户端构建后单独创建测试库）；原 task 专项、Submit 展示、API 工具测试、用户端构建及读路径／语法／编码／diff检查通过。此次需更新 API 和用户端并重启 API，插件无需更新。

重载提示修复已覆盖实际认证函数＋内存 SQLite＋插件消息轮询：旧实例 45 秒内保留、无任务领取或红色错误，过期后新实例接管，主账号独立；绑定无效、普通 409、服务器异常、失败回写、超过启动等待及已认证后的冲突仍返回错误。最新后台浏览器检查覆盖 360/390/1200 红绿灯：无可见文字／编号、主号首位、四灯同排、七账号展开／收起、点击查账号、正常绿灯与失败／未知／离线红灯、状态刷新和窄屏无溢出；保留原验证操作与导入账号选择。验证命令增加 `node yahoo-plugin/background.test.js`、`node src/admin/src/AdminLayout.display.test.js`、`node src/admin/src/MessageRead.display.test.js` 和 `npm run build --prefix src/admin`，其余沿用下方多账号插件与浏览器专项。此次不改变任务和付款规则，无 API／数据库更新，也未部署生产。

审查边界：以开发前提交 `9d22b23` 为业务基线，仅检查多账号计划的实现、账号隔离和新增实现缺陷。付款失败中断后续、人工继续、原扫描判断、用户改价与订单改用户等规则不得在多账号修复中自行更改；原规则或历史行为不能仅凭不符合新建议就列为本次 bug。

四处补充修复验收：`yahooMultiAccount.taskSafety.test.js` 使用临时 SQLite 与真实 HTTP，覆盖多条待执行任务 A→B→C、原 A 名额供其他用户使用、残留错误归属拒绝领取、耗尽收尾、策略／价格／定时保留、失败或未知结果后继续队列／重新提交、账号隔离及迟到回写拒绝、落札后旧 touch／snapshot 拒绝且商品不变、定时退回及重新领取旧凭证拒绝。插件专项覆盖交易开始四处资格检查跳过，确认不执行单件／同捆交易、不改暂停状态、准确归还原领取；原付款失败中断和人工继续专项继续保留。此专项已加入完整回归入口。

上述四处修复的专项及完整 `npm run regression` 已通过（含原业务、后台 390/1200 浏览器和两端构建）；完整回归运行期间增加的“同账号其他商品不受未知结果影响”与原暂停／恢复接口下交易领取重新获取场景已单独复测通过。商品读路径、语法、编码及 diff 检查通过。没有部署生产或操作真实 Yahoo／数据库。

三处检查问题已增加专项回归：付款首笔失败后后续任务可再次领取、跳过交易批次归还、扫描暂无物流正常收尾、批次结束释放领取、旧回写/过期释放/跨账号释放拒绝、订单改用户后落札强制同步、跨账号历史一并转移、保留其他账号已有名额。付款失败仍中断本轮并关闭付款 flag；归还未执行领取不会自动付款，必须沿用原人工继续入口。原实例失效后的遗留领取由新实例自动接管，旧凭证不能回写或清除新领取，不增加人工释放步骤。本次无新增数据库迁移。

本次修复的隔离 HTTP 与插件专项、完整 `npm run regression`（含原业务、后台浏览器和两端构建）、商品读路径、编码与 diff 检查通过。新增未知付款回写失败及跨账号释放场景在完整回归后另行复测通过；没有部署或操作生产数据。

需求、操作与分阶段上线见 [Yahoo 多账号需求与开发计划 3.0](yahoo-multi-account-plan.html)。账号列表不限固定两个，主账号优先、备用有序；每个商品账号只归一个用户，不同商品不互相占位；同用户加价与 followup 复用归属。新分配跳过离线、PIN不阻止提交，无在线名额直接失败。明确卖家黑名单且无有效或未知入札时转交同一任务到后续未占用账号，耗尽终止，不循环；未知出价错误按失败结束，后续提交仍用原账号，不要求人工核对，也不据此自动转交。

执行上下文由 X-Yahoo-Account／Token／Instance 绑定，SQL 账号视图与写入触发器隔离 tasks、orders、bidding_items、消息和导入。运行 config 键按账号命名，业务配置保持共用；任务领取原子执行并有请求去重、claim token、实例和迟到回写保护。入札表主键改为账号＋商品；实际落札按成交账号的商品归属匹配用户，取消不丢失归属。订单领取只隔离执行，恢复后仍按原页面判断、错误中断与继续规则处理；付款、交易、扫描、确认收货、消息与导入跟随来源／成交账号，同捆禁止混账号。公共历史仍一份队列，落札成交账号读取、未落札选择参与商品的在线账号。

后台账号管理、逐账号 flag、在线／登录状态与验证码、邮箱／PIN提醒已接入；任务、入札、失败分析、落札明细附执行／成交 Yahoo。各插件独立执行同一个出价并发配置，2×3可并发6件，未添加服务器总上限。前台截图／PIN使用全机锁，系统键盘持续检查账号窗口与标题标记；插件运行中不能更换绑定。配置 Yahoo ID/profile 去重，但真实登录身份仍需管理员在对应 profile 人工核对，不能把绑定校验称为自动识别真实 Yahoo ID。

上线先关闭旧插件及正在执行页面并核对 Yahoo 结果，停 API备份；API、共享模块、后台、用户端与完整插件一起更新，重启 API并reload。第一轮只配置 A，首次迁移空 account_id 与旧运行状态归 A；已有非空账号不覆盖。存量任务存在时额外 VACUUM INTO 备份；升级前 processing 状态保留，沿用原 60 秒超时恢复，不新增失败或人工核对判定。多个账号须分别在扩展选项填写后台账号 ID／绑定码；一个账号未绑定可自动初始化。插件重载后最多45秒等待旧实例心跳过期。已有真实多账号业务后不可直接用旧单账号程序／旧数据库覆盖回退。

完整回归、两端构建、读路径／编码／diff检查及新增专项通过；收尾改动后的路由和后台390/1200浏览器复测通过。本地验收使用临时数据库、真实 Express HTTP 和模拟插件／Yahoo数据；未连接真实 Yahoo出价、Gmail、付款或生产数据库。专项覆盖迁移、账号名额、离线/PIN、转交、有效/未知入札、重复领取、旧回写、订单账号、导入、消息、公共历史及前台锁；后台390/1200像素模拟API浏览器覆盖新增账号、独立提醒、关闭、flag与导入账号。生产剩余按 HTML五阶段核对A基线、实际profile/Yahoo身份、真实验证与完整订单闭环。

验证命令：

```powershell
npm run regression
node src/server/services/yahooAccounts.test.js
node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.test.js
node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.regressions.test.js
node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.taskSafety.test.js
node yahoo-plugin/multiAccount.test.js
node yahoo-plugin/syncRecovery.test.js
node scripts/yahoo-multi-account-browser.test.cjs
node scripts/run-isolated-regression.cjs scripts/client-login.test.cjs
node scripts/run-isolated-regression.cjs src/server/routes/task.test.js
node src/client/src/pages/Submit.display.test.mjs
node src/client/src/utils/api.product-info.test.mjs
npm run build --prefix src/client
node src/client/src/pages/TaskList.display.test.mjs
node src/client/src/pages/ActiveBidding.display.test.mjs
node src/client/src/pages/WonItems.display.test.mjs
node scripts/check-product-read-paths.js
node scripts/encoding-guard.js
git diff --check
```

完整回归入口现在自动使用临时 SQLite，含原业务测试、新账号测试、浏览器检查与两端构建；涉及 models 的单独专项也应使用 run-isolated-regression.cjs，避免加载项目实际数据库。

### 0e. 插件拍卖记录采集生产验证

2026-10-12 最新同分钟记录选取修正：在全部分页的有效价格记录中，仅最新分钟超过 2 条且第一条价格 <= 第二条时，数组首条使用第二条用户名和价格，不取整个分钟的最高价；开始行不计入出价数量。其他分钟仍取第一条，第一页 HTML 保留全部原始行。`finish()` 先保存 `normalizeRows()` 数组，再在同一事务内使用该数组首条修正商品结束时间／当前价，无另一路原始行取值；仍仅非落札且历史时间严格晚于原结束时间时同时更新，不增加同分钟单独改价。仅更新 `src/server/services/auctionHistory.js` 并重启 API；旧记录不自动覆盖，需要时通过原后台拍卖采集清空指定商品的两个历史字段，再手动／定时采集。未修改实际数据库或操作 Yahoo。验证：`node src/server/services/auctionHistory.test.js`、`node yahoo-plugin/auctionHistory.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/plugin.test.js`、`node --check src/server/services/auctionHistory.js`、`node scripts/encoding-guard.js`、`git diff --check`。内存专项覆盖两张截图的小于／等于、第一条更高、1／2 条边界、只取第二条、旧分钟不变、开始行排除、HTML 原行保留，以及数组与商品改价一致、已落札／同分钟保护。

2026-10-11 多账号商品结束时间统一：同一商品在任一 Yahoo 账号已有落札订单时，失败分析及拍卖记录采集统一使用该商品的实际落札时间；没有落札订单才沿用商品结束时间。失败用户不必等原结束时间，列表及拍卖图表终点显示“落札时间”；保留各用户自己的任务、出价历史、状态、原仍在入札中排除及成功排除规则，不向失败用户返回其他用户的订单或账号信息。通过 `productAuctionTime.js` 共用只读时间表达式，兼容导入和旧订单关联；已有落札但时间缺失/无效不回退猜测。此次需更新 API、共享服务文件及用户端静态文件并重启 API；插件无需更新，未部署或修改生产数据。专项：`node scripts/run-isolated-regression.cjs src/server/services/failureAnalysis.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/task.test.js`、`node src/server/services/auctionHistory.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.test.js`、`node scripts/auction-history-browser.test.cjs`、`npm run build --prefix src/client` 及编码/读路径/diff 检查。浏览器验证覆盖 390/1200 像素下其他账号落札后的失败列表时间和图表终点，原未落札及自己落札图表继续覆盖。

2026-10-11 拍卖记录入队时间条件修正：非落札商品沿用 `products.end_time`；已有落札订单（含人工导入及旧 `orders.task_id` 关联）改用 `orders.won_at`，只在有效时间已到且两个记录字段均为空时入队。已落札但落札时间缺失、无效或仍在未来时不以商品结束时间代替。修复人工导入 `r1232702461` 的结束时间为空及提前落札商品结束时间仍在未来时不能入队的问题。不改账号领取、采集重试/过期、队列顺序、出价、结算、付款或订单状态规则；不直接修改已有商品/订单数据。仅需更新 API 的 `src/server/services/auctionHistory.js` 并重启 API；flag 为 0 后通过原后台手动采集入口重新入队，或等待下次定时采集；现有批次不自动重建。未部署或触发生产采集。

本次验证：内存 SQLite 覆盖提前落札、无结束时间的导入订单、无时区/UTC/带偏移时间、旧订单关联、未来/缺失/无效落札时间、已有/过期记录不覆盖及时间边界；实际多账号 HTTP 专项验证导入订单按成交账号领取、其他账号不能回写。命令：`node src/server/services/auctionHistory.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/yahooMultiAccount.test.js`、`node scripts/run-isolated-regression.cjs src/server/routes/plugin.test.js`、`node yahoo-plugin/auctionHistory.test.js`、`node --check src/server/services/auctionHistory.js`、`node scripts/encoding-guard.js`、`git diff --check`。

2026-10-09 落札图表终点时区修正：生产 g1245757348 的 Yahoo won_time_text 为 9/30 22:40，而历史 won_at 为 2026-09-30T14:40Z，原保存函数按服务器本地时区解释 Yahoo 文本，图表再转换日本时间导致多一小时。图表现优先采用有效 won_time_text 的日本当地月日时分，won_at 仅用于恢复最接近的年份；文本缺失/无效时保留原 won_at，非落札仍用 products.end_time。只修正图表展示，不批量改订单数据库或改动交易/付款日期逻辑。仅需更新用户端静态文件。验证：真实商品时间样例、已正确 UTC 不重复偏移、跨年与非法日期回退、图表计算、落札展示、用户端构建、编码及 diff 检查。

2026-10-09 开始行括号金额兼容：插件与 API 原始文本校验同步支持半角/全角括号，有括号时取 `で` 后最后一个括号内的金额，无括号沿用原金额；无法识别仍失败，不猜测价格。同时支持“入札して落札。”出价行，避免该行与括号开始行均被跳过产生 history rows missing。覆盖截图的 7,000 (7,500) 与 1 (1,111) (111,111) (100)、千位分隔、全角括号、异常金额和插件解析到 API 归一化。仅影响新采集，不修改旧记录；需更新并重启 API、更新插件 auctionHistory.js 后 reload。验证：插件与服务拍卖记录专项、图表计算、编码及 diff 检查。

2026-10-09 补齐 Yahoo 删除页面识别：在拍卖历史页出现“指定されたドキュメントは存在しません。”时返回明确过期结果，插件回写后两个历史字段均保存“数据已过期”，不按普通失败重试。该明确删除提示出现在后续分页时同样终止并写过期；原有其他后续分页异常仍按失败重试。登录页/登录提示继续优先处理，避免误判。只需更新插件 auctionHistory.js、background.js 并 reload；API 已支持原过期回写，无数据库迁移或直接生产修复。验证：实际解析器贯穿插件执行及内存数据库回写，确认两字段、flag 归零及无失败提醒；服务、插件专项、语法/编码及 diff 检查。

2026-10-09 采集容错调整：无法解析的普通事件行（例如入札撤销）跳过数组，第一页 HTML 仍保留原行，其他有效价格记录继续采集；开始记录缺失或无法形成有效价格历史仍按失败处理，不伪造价格。失败结果回写后记录次数与最后错误，商品保留在固定队列末尾，每轮最多 10 个不同商品，下一轮再重试；第 3 次失败后移出。队列全部完成时将三次失败商品 ID、次数、原因保存为批次提醒，后台顶部显示并可消除；重试成功清除该商品失败记录，过期仍写“数据已过期”。本轮开始时检查人工验证，开始后不再逐件检查其他工作优先级，完成最多 10 件后交回原调度；队列/回写通信失败仍保留领取并停止，防止未知结果并发领取。API、后台和插件需同步部署并 reload；无生产操作。验证：服务重试/去重/三次上限/汇总与消除、插件混合行和批次不中断、后台展示、两端构建及完整回归通过；390/1200 像素浏览器验证包含真实 DOM 混合有效/撤销记录，保留 HTML 原行并正确生成价格数组。尚未部署生产。

2026-10-08 商品详情拍卖次数数字改为左对齐，按钮字体继承元信息行，与下方截止时间/商品 ID 保持相同字号，颜色固定为蓝色 #2563eb；点击历史入口不变。所有共用详情弹层同步生效。仅需更新用户端静态文件；验证沿用商品详情展示检查、用户端构建、编码和 diff 检查。

2026-10-08 采集效率调整：每轮上限由 5 件增至 10 件；单件读取失败并成功回写失败结果后，跳过该商品继续下一件，不再结束本轮。2026-10-09 已调整为批次开始时检查人工验证、批次结束后检查其他优先级；队列接口或结果回写失败时仍中止，以免结果未知时错误领取后续任务。失败商品字段保持为空，2026-10-09 起留在当前队列最多重试 3 次。此前仅修改插件 background.js，更新后 reload 扩展即可；无需 API/前端更新。专项覆盖首件失败、连续失败仍跑满 10 件、不领取第 11 件、高优先级/验证中断、空队列及回写失败中止。

2026-10-08 后台数据批处理新增“拍卖采集”页：支持多行商品 ID，复用批处理 ID 归一化和去重，管理员接口 POST /api/admin/auction-history/clear 仅清空指定 products 的 auction_history_html / auction_history_data，返回逐商品结果；不存在的商品显示失败，已空或过期记录也可清空。清空不自动入队，之后按现有定时或系统配置手动入队规则重新采集。正在采集且租约有效的商品拒绝清空，过期领取作废，防止迟到回写覆盖清空结果；其他商品继续处理。API 与后台需一起部署，未操作生产商品。验证：拍卖记录服务专项（字段边界、过期/不存在、采集互斥及迟到回调）、后台构建、编码及 diff 检查。

2026-10-08 起始价格修正：仅修正新采集记录。插件解析“オークション開始”行 `で` 后的真实金额，API 入库保留该价格，并用原始行文字兼容旧插件仍传 1 的情况；无法识别金额时失败重试，不伪造为 1。绘图沿用数组实际价格，新增 1/900/1000/3619 与等价水平线验证。按用户最新要求移除旧数据修复、备份及重新入队逻辑，已有历史字段不修改。更新 API 后重启、更新插件后 reload 即可；用户端绘图逻辑无需修改。拍卖记录服务/插件专项、图表计算、plugin 路由、完整回归（含两端构建）、编码及 diff 检查通过；本轮移除迁移逻辑后重新执行相关专项与检查。未修改生产数据库。

2026-10-08 图表终点时间区分：落札商品页显式传入落札模式，使用列表已有 orders.won_at 作为终点时间并标注“落札时间”；失败分析继续使用图表接口返回的 products.end_time，标注“商品结束时间”。用户、价格、起点颜色和水平尾段规则不变，终点只用于展示。落札时间缺失时不以商品结束时间或任务更新时间冒充落札时间。仅需更新用户端静态文件，无 API、数据库或插件改动。验证：图表计算、落札展示检查、390/1200 浏览器（两种终点及标签）、用户端构建、编码与 diff 检查。

2026-10-08 拍卖图表状态展示调整：图表接口额外返回 products.end_time，打开时读取商品最新结束时间；在最后出价后追加仅用于展示的结束点，用户和价格沿用最后出价，形成水平线。线段与渐变改用起点用户颜色，开始到首次出价为灰色，最后用户到结束点为该用户颜色。结束点悬停显示“商品结束时间”和秒，按 Yahoo 日本时间显示，保留原历史数组。结束时间缺失、无效或早于最后出价时不倒画；相同时间保留重合结束点。需部署 API 和用户端并重启 API。验证：图表计算（水平尾线、颜色、秒/时区/跨年、无效时间）、390/1200 浏览器、task 路由、用户端构建、编码及 diff 检查。

2026-10-08 用户端新增拍卖记录折线图：失败分析图片下方、落札页暂停图标右侧显示分时图 SVG 图标，字段2为空时灰色禁用，非空时彩色可点击（“数据已过期”弹出对应提示）。两列表只返回 has_auction_history 标记；点击后通过已登录的只读历史接口 `format=chart` 获取原数组，不触发插件读取。共用 AuctionHistoryChart div 弹层，按数组从最早开始，以真实时间间隔绘图、价格为纵轴；每段线及其下方到横轴的渐变区域使用前一记录用户颜色，左侧固定显示用户及颜色，开始点使用原始开始记录的实际金额。保留 Yahoo 日本时间显示，跨年恢复年份，手机/PC 根据容器宽度调整坐标轴和日期刻度。支持关闭、Esc 和账号切换关闭，旧请求可取消。明确过期、空数组、未采集及数据异常有独立提示。本地 390/1200 像素模拟 API 验证实际失败分析/落札页面入口、暂停右侧位置、禁用、绘图颜色和渐变、完整窄屏布局及过期关闭；没有操作真实 Yahoo 或订单。需更新 API 与用户端并重启 API，不需改插件或数据库 schema。验证增加 `node src/client/src/utils/auctionHistoryChart.test.mjs`，其余沿用本节浏览器、失败分析、task 路由、列表展示、用户端构建、读路径/编码/diff 检查。


2026-10-08 补充：正常历史字段首次写入时，在同一事务内核对非落札商品的 products.end_time 与 JSON 数组首条时间。若原结束时间严格更早，同步将 end_time 更新为首条分钟（秒为 00），current_price 更新为首条价格；保留原分隔符、小数秒位数及原时区，Yahoo 历史时间按日本时间比较，无时区旧值按日本时间处理。历史时间无年份，以原结束时间附近的年份推断并覆盖跨年。存在落札订单（兼容旧 orders.task_id 关联）或 success 任务均不修正；已保存、错误、过期、空数组或无法识别的时间不修正。不修改 orders/tasks 的成交价或状态。专项内存数据库覆盖示例、ISO/UTC/北京时间格式、跨年、原时间较晚/同分钟以及各类落札保护。此次补充仅需更新并重启 API，无额外 schema/前端/插件改动。

部署前备份数据库，再部署 API（启动时新增 `products.auction_history_html` / `auction_history_data` 两列）、后台、用户端和完整 `yahoo-plugin`，并重启 API、reload 扩展；插件必须包含新文件 `auctionHistory.js`。不修改原出价、订单状态、付款执行或既有刷新频率/扫描次数配置。

采集仅包含已关联 tasks 或 orders、products.end_time 有效且已过期、两个历史字段均为空的商品；仅查询商品不纳入。按商品去重，HTML 保留第一页全部行，数组遍历全部分页并按 Yahoo 原顺序保留每个分钟的第一条；仅最新分钟有效出价超过 2 条且第一条价格不大于第二条时改取第二条；开始记录始终追加在末尾，用户名“开始”、价格取该行 `で` 后的实际金额。时间使用 Yahoo 原时间 `M-D HH:mm`，不转换时区。第一页 HTML 由原始行文字生成独立表格并进行 HTML 转义，不存脚本、分页操作和外链；正常数组保存 JSON，价格为数值。明确无入札记录保存 HTML 提示和 `[]`；明确历史无法显示时两字段均写入文本“数据已过期”。登录、网络、验证码、缺少开始记录或解析异常保留空字段，下次定时/手动入队重试。

每天北京时间默认 01:20 到时入队（配置到分钟），离线恢复后补执行；手动按钮将 flag 置 1，重复入队不覆盖运行队列。config 保存本轮商品列表、批次 token、领取标识及 10 分钟租约，API/插件重启可恢复；每件最多读取 8 分钟，过期回调不能覆盖新领取。两个字段同事务写入，成功记录不再读取。失败商品保留空字段并排至队尾，同一轮不重复领取，下轮重试，累计 3 次失败后移出；队列全部处理后 flag 归零并汇总最终失败提醒，读取日志只记录商品 ID 与错误类型。

调度顺序为交易开始优先，其次到期/手动扫描；其他空闲轮按付款、确认收货、导入、拍卖记录。导入和拍卖记录完成均推进扫描计数，独立消息不占扫描计数。一次历史动作最多处理 10 个不同商品，批次开始后不逐件检查其他工作优先级，批次结束交回原调度。订单管理在确认收货 flag 后显示拍卖记录 flag。

用户端共用 ProductSearchPopup，各详情拍卖次数可点击展示历史 HTML，顶部可返回原详情；未采集与过期分别提示。重新抓取旧商品详情失败时仍提供已保存历史入口。接口只返回已保存 HTML，不触发实时抓取。

本地内存数据库、插件模拟分页和 390/1200 像素浏览器验证通过；浏览器使用独立组件构建与模拟 API，没有连接真实 Yahoo。尚无用户提供的参考 HTML，生产需核对真实页面行结构、分页链接、明确过期提示和无入札页面；无法识别时安全失败，不能将一般错误判定为过期。先用少量已结束且多分页商品手动入队，核对第一页全部行、数组跨页去重和开始记录、flag 收尾，再验证每天定时、重启恢复及过期商品只采一次。

验证命令：

```powershell
node src/server/services/auctionHistory.test.js
node yahoo-plugin/auctionHistory.test.js
node src/server/routes/plugin.test.js
node scripts/auction-history-browser.test.cjs
node src/client/src/components/ProductSearchPopup.display.test.mjs
node src/client/src/pages/ActiveBidding.display.test.mjs
node src/client/src/pages/WonItems.display.test.mjs
node scripts/check-product-read-paths.js
node scripts/encoding-guard.js
git diff --check
npm run regression
```

### 0d. 用户端失败分析生产验证

小图表历史查询在 SQL 中排除 cancelled，包括自动 followup 回查；最终出价直接取相同历史的最大值。三角悬停使用 formatBeijingDateTime 格式化完整北京时间，外部标签仍显示月-日 时:分，两者时区一致。

2026-10-08 小图表历史提交排除 status=cancelled（已终止）任务，失败分析和落札页共用规则；三角、首尾时间及线段最大值只使用保留的任务。仅有已终止任务的商品保留在失败分析列表，但图表没有提交标记；“最终出价”与小图表统一使用非终止任务的历史最高价，仅有终止任务时为 0。需更新并重启 API。

入札页失败分析的小图表上方显示“商品结束时间”，只读 products.end_time，按北京时间展示完整日期与时分秒；接口返回 end_time，不使用任务提交时间代替。失败分析图片下方不再显示拍卖图标、箭头和最高价；正常入札中列表保持原展示。

落札列表在落札时间下方复用紧凑价格图，以原落札价展示函数计算的成交价作为基准，超过成交价的提交最高价仍延伸显示。/api/task/won 仅为当前分页商品追加同账号历史提交信息，失败分析与落札共用历史查询，保持自动 followup 合并规则与账号隔离。部署 API 和用户端，不修改订单/出价状态。

首个与最后一个提交三角上方直接显示北京时间（月-日 时:分），只提交一次时显示一个时间。两段时间靠近时上下错开，避免手机端文字重叠。图表采用浅色圆角底、细线和小三角，宽度最多 380px，时间和价格使用固定 10px 字号，不随电脑端列表宽度放大；常见两次提交高度约 60–80px。

部署 API 和用户端静态文件并重启 API。点击入札中列表标题切换失败分析，再点击返回。列表按当前 actingUser 和商品去重，只包含商品结束时间已到、没有同账号 success 任务且不在 bidding_items 的 highest/outbid 列表中的商品；结束时间缺失或无效暂不纳入，不按 failed 状态限制任务来源。

最终出价为用户历次任务提交最高价的最大值，落札价暂用 products.current_price，含税商品沿用现有含税展示。保留图片、标题、商品 ID 和策略，隐藏运费、合计、剩余时间和更新时间。线段每次提交一个三角，使用该次任务设定的最高价，执行中的多次加价不计入；相同最高价的多次提交分层显示。低价分步自动生成的 followup 任务不作为新提交，原任务从待续价或关联 followup 恢复原提交最高价。最高价超过当前价时延伸线段到最高价并单独标出当前价，例如当前 2000円、提交 9000円，三角位于 9000円。

新增只读 GET /api/task/bidding-analysis，分页与账号隔离沿用原逻辑，切换/刷新/账号变更通过请求序号拦截旧响应。没有 schema、任务状态或插件变更，没有新的 Yahoo 抓取。内存数据库测试覆盖到期/仍在入札/已落札/账号隔离、历史重复提交、自动 followup、分页与路由；独立模拟 API 浏览器验证切换、简化行、三角数量、分页、旧响应拦截、账号切换和移动布局。生产需核对一件多次提交和一件 multi_bid 商品的最高价，不以执行次数增加三角。

验证命令：

```powershell
node src/server/services/failureAnalysis.test.js
node src/client/src/utils/bidPriceTimeline.test.mjs
node src/server/routes/task.test.js
node src/client/src/pages/ActiveBidding.display.test.mjs
npm run build --prefix src/client
node scripts/check-product-read-paths.js
node scripts/encoding-guard.js
git diff --check
```

### 0c. 用户端近 90 天统计生产验证

2026-10-09 收获指数分母修正为当日到期下架商品数，沿用当前账号的已提交商品范围，跨日期提交或重复任务均按商品去重，不计仅查询商品。非落札商品使用 products.end_time，已落札使用 orders.won_at（空值沿用原落札统计的任务更新时间回退），覆盖即时拍提前结束。只统计实际时间已经到达的商品，缺失/无效时间和未来商品排除；产品旧无时区时间按 Yahoo 日本时间处理，再沿用统计服务器 localtime 分日。API 每日新增 ended_product_count，harvest_rate=当日 item_count / ended_product_count；分母为 0 时显示 0%，活跃任务数、落札金额、CSV 和其他汇总保持原规则。图表详情及说明同步更新。需一起部署 API 和用户端并重启 API，未修改生产数据。验证：内存库路由覆盖跨日提交、提前落札、重复商品、账号隔离、仅查询/未来/无效时间、旧时间时区和零分母；统计图计算、用户端构建、编码及 diff 检查。

2026-10-08 更新：活跃/收获折线图加载后与柱图一致，横向滚动默认最右侧；仅在数据重新加载时定位，点击日期不会强制跳回。原中标率、有效出价比、最高价商品三段说明合为独立卡片，位于三张图下方。2026-10-09 收获指数分母改为当日到期下架商品数量，按已提交商品去重并按实际结束/落札时间归属日期；活跃指数的任务总次数保持原逻辑。API 每日行新增 bid_product_count，收获详情显示“到期下架商品 X 件”，无到期下架商品日显示 0% 并连续连线，真实超过 100% 仍保留溢出标记。

部署 API 和用户端静态文件并重启 API。统计页及 `/api/task/won-stats` 默认范围由 30 天改为 90 天（包含今天）；显式传入原有 days 范围仍支持，最大 90 天。落札金额/数量、CSV 和汇总说明沿用原口径，范围同步扩展到 90 天。柱体最大宽度 8px，三张图日期均显示最早/最晚，中间每隔 5 天显示，窄屏可在图表内横向滚动。

新增日任务数查询按 tasks.created_at 的本地日期分组，按当前 actingUser 隔离，不过滤任务状态，活跃指数不按商品去重：成功、失败、终止、待执行和执行中都计入。每日落札数继续按现有 orders.won_at（回退 tasks.updated_at）及原 success 口径分组，两者沿用原统计的服务器 localtime。接口为每日行增加 task_count、bid_product_count 和 harvest_rate，连续补齐 90 天。收获指数 = 当天落札件数 / 当天到期下架商品数，纵轴固定 0–100%；无到期下架商品日比例为 0，折线经过 0% 连续连接；跨日落札可能使比例超过 100%，API 保留真实比值，图顶用三角标记并可点击查看实际比例，不能强行将数据改成 100%。

只增加只读查询、折线展示与计算；没有数据库 schema、插件或任务状态变化。统计请求按账号隔离去重，并用请求序号和当前账号核对阻止旧响应覆盖新账号。本地内存数据库专项覆盖 90 天首尾、所有状态、重复商品、多账号、提交日与落札日不同、无任务、真实超 100% 比例以及 CSV 范围。独立模拟 API 的 390/1200 像素浏览器验证三张图、90 日/19 个日期刻度、柱宽不超过 8px、百分比轴、无任务和超范围读数、交互及页面无横向溢出。生产需检查当前账号 90 天总数、任意一天任务数和落札数，并核对 API/静态页面同步部署。

验证命令：

```powershell
node src/server/routes/task.test.js
node src/server/routes/task.won-stats.test.js
node src/client/src/utils/statisticsChart.test.mjs
node src/client/src/utils/wonStats.test.mjs
npm run build --prefix src/client
node scripts/check-product-read-paths.js
node scripts/encoding-guard.js
git diff --check
```

### 0b. 用户端批量即时拍生产验证

部署 API、共享模块、后台及用户端静态文件。API 启动自动创建 `batch_task_submissions` / `batch_task_submission_items` 两张队列表，schema 同步维护在 `src/server/services/batchTaskQueue.sql` 和 `src/db/init.sql`。新增表保存批次、输入行、任务关联和结果，不改变 products/tasks/orders 的业务职责或插件执行线。

商品标题行右侧“批量添加”打开多行输入弹层，每行商品 ID / 链接与税前日元最高价，每批最多 50 件。支持空格、Tab、中英文逗号、分号、竖线、冒号和顿号等分隔，以及价格千位逗号；同批重复 ID 的所有行均返回错误，不自动选价。链接支持 Yahoo 及原有 Gougou / FromJapan 商品链接。仅 `direct + bid`，不自动切换即决；有税商品另计税，税 0 商城和 Yahoo 低价两步出价沿用原规则。

`POST /api/task/batch-submit` 只解析和持久化入队，不等待商品抓取或插件出价；响应成功立即关闭输入弹窗。API 后台按批次、行号顺序逐条调用公共提交函数补全商品并创建标准任务。一个批次在后台处理时仍接受新批次和单商品提交，没有全局用户提交锁；同商品的既有权限、归属、待执行任务及生效策略边界仍保留。每件商品抓取等待上限 75 秒，超时后的迟到抓取不会继续入库。 入队提交与后台执行完全分开，逐件串行不会延长入队响应；POST 响应不等待商品抓取或 Yahoo 出价。API 的 `[Batch preparation]` 日志记录每件后台准备耗时，不能将该耗时当成用户提交接口耗时。

每批和每行均有稳定请求标识。入队重试使用批次标识去重；API 重启恢复 processing 行时先按既有 `tasks.client_request_id` 核对已创建任务，再处理其余行，不重复建任务。执行时重读登录用户及目标用户的当前权限；已入队批次始终属于原用户，切换账号、导航、刷新或关页不停止后台工作。

每件商品完成补全和校验后，立即创建 `tasks.status=pending` 的标准出价任务，插件可立即领取；后台同时继续补全下一件，不等待整批补全或前一件出价完成。后台“队列中”合计等待补全和等待出价，“执行中”合计正在补全和正在出价，分别展示明细数量；补全/出价分项放在原统计卡片右侧两行，标题与总数保留在左侧，卡片不因增加分项而增高。新增批量商品准备进度表，只显示等待补全/正在补全商品的批次、行号、商品及价格。每行处理完成即退出准备表，全部结束自动隐藏，不依赖用户端是否关闭提交失败提示；后台不显示准备错误或累计准备失败数量。已建商品仍进入原任务列表。

批量结果仅表示提交是否成功，不等待插件出价。整批商品均已提交或准备失败后标记完成；全部提交成功不弹窗，有提交失败时仅列出失败行与原因，并显示整批提交成功/失败数量。出价失败、后续落札等状态不触发批量提交弹窗。旧批次按准备行状态过滤，避免历史出价失败再次显示。

登录用户端每 5 秒静默查询所属账号的未关闭提交失败结果；结果弹窗在各用户页面均可显示，包含关闭按钮，输入新批次时暂不覆盖输入弹窗。关闭立即生效并向 API 确认；网络失败保留当前会话的待确认标识并重试，不反复打扰。账号切换和旧查询响应均有隔离保护；退出或关页后，下次登录同账号仍能看到未关闭的提交失败。任务列表继续按原规则刷新。

后台“队列中”非零数字点击展开“队列任务详情”，再次点击收起，零值不可点击。详情复用原任务表的用户、商品、当前价、最高价、策略、状态及三个时间列；等待补全商品尚无当前价和出价时间时显示 `-`。新增只读管理员接口 `GET /api/admin/tasks/queue`，按 `tasks.status=pending` 和批量行 `status=pending` 分页查询，包含尚未到时的定时任务，排除执行中、已提交批量行和失败行；不使用“下一条待执行”的可领取筛选。展开时每 5 秒刷新，收起后停止查询，翻页和收起时取消旧查询，当前页因队列减少而为空时返回最后有效页，队列清空自动收起。需部署 API 并重建后台静态文件。

只读对比确认原单商品抓取同一商品也耗时约 54.6 秒，等待主要发生在本地 HTTP 连接及浏览器备用抓取阶段。按用户要求保留原抓取逻辑，未应用本次尝试的网络提速改动。

验证命令：

```powershell
node src/shared/batchBid.test.cjs
node src/server/routes/task.batch.test.js
node src/server/services/batchTaskQueue.test.js
node src/server/services/actingUser.test.js
node src/server/routes/admin.orders.test.js
node src/server/services/adminTaskQueue.test.js
node src/admin/src/Tasks.display.test.js
node src/server/routes/task.test.js
node src/server/routes/proxy.test.js
node src/client/src/utils/batchSubmit.test.mjs
node src/client/src/utils/api.product-info.test.mjs
node src/client/src/utils/bidPrice.test.mjs
node src/client/src/pages/Submit.display.test.mjs
npm run build --prefix src/client
npm run build --prefix src/admin
node scripts/check-product-read-paths.js
node scripts/encoding-guard.js
git diff --check
npm run regression
```

本地专项、完整回归、两端构建、商品读路径及编码检查通过。浏览器使用独立模拟 API 与内存数据库，验证了后台准备仍阻塞时入队已关窗、继续入队新批次、导航/刷新不停止工作、逐件补全后进入原出价队列及仅提交失败提示、结果关闭后不重弹及多行结果关闭按钮可见。浏览器另验证了全部提交成功不弹窗、有提交失败仅显示失败行、关闭后不重弹，以及后台准备/出价合并统计。单商品原提交代码与当前公共提交函数的 14 类场景对比中，响应和入库内容一致，覆盖普通/含税/税 0 商城、即决、定时、多次出价、低价分步和价格校验。测试未操作真实 Yahoo 任务。

生产验收用少量商品确认入队立即关窗、商品静默补全、后台进行时继续提交、新批次排队、全部提交成功不弹窗、提交失败仅显示失败行，以及结果关闭、页面刷新与 API 重启恢复。含税商品单独核对实际税前出价与含税展示。本地测试使用模拟接口或内存数据库，不替代真实 Yahoo 验收。

2026-10-05 实测出现 `提交失败：getClientUser is not a function`：队列读取用户上下文调用了 actingUser.js 中未导出的函数，在商品抓取、创建竞拍任务之前失败。已本地补齐导出，并让队列测试使用实际模块的用户/权限读取路径，覆盖管理员代提交与普通用户不能跨账号提交。需更新 API 并重启进程；旧失败批次保留结果，修复后由用户重新提交，没有自动重放失败批次。

### 0a. PIN 前邮箱验证码生产验证

2026-10-08 补充修复：邮件行与标题子元素统一归并，列表不再必须提供 `data-legacy-last-message-id` 才能打开；没有会话 ID 时仍可按行定位候选。列表缺少邮件 ID 且时间不能明确排除旧邮件时，Yahoo 刷新前先打开详情记录已有邮件 ID，保留同一分钟旧验证码过滤。刷新后按候选会话读取最新邮件，核对发件人、收件人、详情时间和验证码；已检查会话在本轮 Gmail 刷新前不反复点开。搜索结果缓存未更新时刷新本轮 Gmail tab，不依赖工具栏按钮文字，不额外刷新 Yahoo。超时日志只记录候选/打开/读取及缺字段计数，不记录邮件正文、邮箱地址或验证码。此补丁只改插件，不需重新部署 API 或后台；在服务器更新 `yahoo-plugin/background.js` 并 reload 后验证。

专项测试新增实际页面读取脚本贯穿至 Yahoo 输入的模拟路径，覆盖列表缺少最新邮件 ID、标题子元素标识、会话 ID 缺失、同一分钟旧邮件拒绝和 Gmail 缓存刷新；保持 Yahoo 一次刷新、验证码一次提交、60 秒收信与独立 30 秒跳转。验证使用下方邮箱/插件测试、语法与编码检查及 diff 检查。服务器浏览器连接失败，未读取真实 Gmail DOM或执行真实验证码登录，仍需现场验收。

部署 API、后台静态文件和完整 `yahoo-plugin`（包含新增 Gmail host permission），在服务器 Chrome reload 扩展并确认允许访问 `mail.google.com`。Gmail 使用同一 Chrome 默认账号 `/mail/u/0/`，需要已登录且与 Yahoo 页面展示的邮箱匹配；不接入 Gmail API 或新增邮箱凭据。

邮箱验证页按 DOM 提示区分，不再仅凭 `/config/login?src=auc` 当作 PIN。后台显示“需要邮箱验证码。”及“继续”；每轮先读取 Gmail 当前 Yahoo 邮件标识，防止同一分钟的旧邮件被误取，再仅刷新 Yahoo 一次。读取只接受本轮新增、Yahoo 登录发件人、收件邮箱匹配且时间有效的最新邮件；Gmail 准备上限 15 秒，Yahoo 刷新起最多等邮件 60 秒，不点击 Yahoo 再发送链接。

邮箱码只填入、提交一次，不使用 PIN 键盘 fallback。30 秒只从邮箱码实际点击登录后计时，用于等待本次 Yahoo tab 或其新增子 tab 进入 `/ncaptcha` 文字验证码页，不限制人工文字验证码或后续 PIN 的等待。进入文字验证码页后复用截图、人工提交和原 PIN 流程。原有小窗口白图问题仍按第 3 项处理，本次没有修改截图方式。

60 秒无新验证码时显示“60秒未收到验证码，请重试”；填入/提交失败、Yahoo 报错或提交后 30 秒未进入文字验证码页时显示“gmail验证码填入错误，请重试”。两种错误后都保留“继续”，新一轮必须再次点击，不自动刷新或重新提交。重复点击和并发领取由条件更新保护；插件重启遇到已领取的邮箱验证也转为错误等待再次点击，不重放结果未知的操作。验证码直接从 Gmail 填入 Yahoo，不写入后台、数据库或日志；标签页清理只处理本轮 Gmail tab，随后恢复 Yahoo 焦点。

本地模拟已覆盖单次刷新/提交、60 秒及独立 30 秒超时、提交拒绝、失败等待新点击、并发处理共享、旧邮件/错误账号/错误发件人过滤、Gmail 会话最新邮件、迟到 tab 清理及插件恢复。真实 Gmail DOM、邮件正文格式和 Yahoo 提交仍须部署实测；页面结构不匹配时失败退出，不盲目提交或自动尝试多种方式。

验证：

```powershell
node src/server/services/manualCaptcha.test.js
node src/server/routes/plugin.test.js
node src/server/routes/admin.orders.test.js
node src/admin/src/manualVerificationState.test.js
node yahoo-plugin/emailVerification.test.js
node yahoo-plugin/background.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 0. 普通商品暂停功能生产验证

消息提速验证：更新 API、重新构建后台并 reload 扩展。在扫描批次正在运行时点击“消息更新”，确认消息在插件下次轮询领取，不等待整轮扫描；消息与扫描各自完成并清理自己的标签页。已打开的后台需刷新到新静态版本，确认消息完成后约 2 秒内刷新时间和聊天内容。队列仍逐条执行，同一订单的读取和发送保持互斥。PIN/验证码期间仍需先完成验证。

消息单次执行保留 45 秒上限，消息 API 请求限制 8 秒；插件退出或状态回传丢失时，下一次消息领取会把超过 3 分钟的 processing 标为失败，解除对同一订单另一种消息任务的阻挡。发送结果不明不得自动重发，先在 Yahoo 核对。领取时间作为回写标识，过期回调不能覆盖新任务；无需新增数据库列。

消息专项验证：

```powershell
node src/server/routes/yahooMessages.test.js
node src/server/routes/plugin.test.js
node src/server/routes/admin.orders.test.js
node yahoo-plugin/background.test.js
node src/admin/src/MessageRead.display.test.js
node src/admin/src/MessageRead.polling.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

先部署 API（启动时为 `orders` 增加 `paused_at`）、后台、用户端及 Chrome 扩展，并在服务器 Chrome 中 reload 扩展。用普通商品验证后台暂停、用户端恢复、消息发送状态及暂停未满 24 小时不执行交易开始；到期恢复需在下一次交易开始领取时验证。商城商品与其他非空状态不能暂停。消息发送修复后，先在 Yahoo 对应订单的消息页确认失败那次没有送达，再发一次，避免重复发送。

验证：

```powershell
node src/server/services/orderPause.test.js
node src/shared/orderStatus.test.cjs
node src/server/routes/plugin.test.js
node src/server/routes/admin.orders.test.js
node src/server/routes/task.test.js
node yahoo-plugin/background.test.js
node src/admin/src/Orders.display.test.js
node src/client/src/pages/WonItems.display.test.mjs
npm run build --prefix src/admin
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 1. 三表模型收尾和冗余字段删除

目标：让 `products` 成为商品快照唯一权威来源，`tasks` / `orders` 不再承担商品快照字段职责。

执行顺序：

1. 字段依赖审计
   - 增强并运行 `scripts/check-product-read-paths.js`。
   - 覆盖插件 payload、后台订单页、Google Sheet、debug API、报表、批处理。
   - 确认没有新代码直接依赖 `tasks.current_price`、`tasks.tax_type`、`tasks.end_time` 等旧字段。

2. 插件 payload 边界硬化
   - API 返回明确的商品字段名，例如 `product_current_price`、`product_tax_type`、`product_end_time`、`product_shipping_fee_text`。
   - `yahoo-plugin/background.js` 内部逐步改用明确字段，不再把 `task.current_price` 这类名字当商品快照来源。
   - 短期可以保留兼容 fallback，但新增逻辑必须使用 `product_*` 字段。

3. 迁移脚本准备
   - 写生产迁移脚本或明确 SQLite table rebuild 步骤。
   - 迁移前必须停止服务并备份数据库。
   - 迁移脚本要先 dry-run 输出将删除字段、现有表结构、数据行数和回滚说明。

4. 最终删除冗余字段
   - 删除前再次运行健康检查和读路径检查。
   - 删除后跑完整回归。
   - 更新 `src/db/init.sql`、`src/server/models/index.js` 和相关测试，确保旧字段不会被重新创建。

验收命令：

```powershell
node scripts/check-product-read-paths.js
node scripts/check-product-health.js
node scripts/check-product-parity.js
node scripts/encoding-guard.js
npm run regression
```

### 2. 用户本地商品缓存提速

目标：用户提交商品时，重复查询同一 Yahoo 商品能更快展示商品信息；缓存只做用户体验加速，不替代服务器 `products` 权威数据。

建议方案：

1. 抽象用户端商品信息入口
   - 在客户端集中封装 `getProductInfo(url)` 或等价方法。
   - 提交页只调用这个入口，不直接散落调用 `/api/proxy/fetch`。

2. 增加本地缓存
   - 缓存 key 使用标准化 auction id。
   - value 保存商品快照、抓取时间、来源和版本。
   - 先用 `localStorage` 即可；数据量变大后再考虑 IndexedDB。

3. TTL 策略
   - 进行中商品短缓存，例如 1-5 分钟。
   - 临近结束商品更短或强制刷新。
   - 已结束/已落札商品可长缓存。
   - 用户提交任务前仍以后端/插件实际页面为准，不能只信缓存。

4. 查询优先级
   - 先读本地缓存，命中且未过期就立即展示。
   - 同时后台刷新服务器抓取结果。
   - 刷新成功后更新页面和缓存。
   - 刷新失败时，如果缓存仍可用，提示使用缓存展示；提交时让服务端继续校验。

验收重点：

- 第二次打开同一商品明显更快显示。
- 缓存不会让过期价格绕过提交校验。
- 店铺含税、普通个人、即决商品、多次出价校验保持不变。

建议验证：

```powershell
node src/client/src/utils/bidPrice.test.mjs
node src/server/routes/task.test.js
npm run build --prefix src/client
node scripts/encoding-guard.js
```

### 3. Windows Chrome 小窗口下 PIN/文字验证码截图稳定性

目标：服务器 Windows Chrome 即使窗口被缩小、视口较小或验证码区域不在当前可视范围内，后台也能稳定显示 Yahoo 文字验证码，并保证后续 PIN 的 Win32 真实键盘输入仍落在正确窗口。

已确认现象和边界：

- 生产后台收到的 `imageDataUrl` 可能是尺寸、格式均有效但内容全白的 PNG；不是后台跨域、Base64 截断或 `<img>` 渲染失败。
- 当前 `captureManualCaptchaImage()` 只在激活窗口后固定等待 `500ms`，随后优先调用 `Page.captureScreenshot`，且使用 `captureBeyondViewport: false`。
- Chrome 窗口缩小后，验证码可能处于可视视口之外，或 Windows 合成器尚未完成绘制；CDP 仍会返回非空截图数据，现有逻辑会直接把白图当成功结果上报。
- 现有测试只覆盖“存在 PNG/Base64 数据”，尚未覆盖全白/低对比度截图、较小视口和窗口状态恢复。
- PIN 的 Win32 `SendKeys` 依赖 Chrome 窗口可见、置前并聚焦；验证码截图修复不能在 PIN 输入前过早恢复或最小化窗口。

后续建议方案：

1. 进入人工验证码流程时记录 Chrome 原窗口状态和 bounds，临时置前并最大化。
2. 将验证码元素 `scrollIntoView({ block: 'center' })`，等待页面完成绘制后再截图。
3. CDP 截图启用 `captureBeyondViewport: true`，同时保留页面图片/canvas 直接提取作为优先或备用路径。
4. 对截图做全白/低对比度检测；检测失败时等待后自动重试 2-3 次，不能仅凭非空 Base64 判定成功。
5. 验证码和紧随其后的 PIN 流程全部结束后，再恢复原窗口状态和 bounds。
6. 增加小视口、首次白图后重试成功、连续白图降级、PIN 输入前保持窗口可见，以及流程结束恢复窗口状态的回归测试。

本项当前只记录方案，尚未修改 `yahoo-plugin/background.js` 或生产插件。

建议验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 4. 普通商品同捆“决定”后 30 秒等待的生产验证

2026-08-31 已完成本地插件修复，生产更新并 reload 后需观察下一次同捆。此前按件数动态延长的建议改为所有普通同捆统一使用 30 秒，普通单件交易及其他步骤不变。

已知证据：

- 2026-07-19 主商品 `e1236939416`（6 件）及 2026-08-30 22:22:16 北京时间主商品 `n1242168450`（订单 1357，用户反馈 6 件）均报 `bundle decide next page did not appear`。
- 错误后的诊断读取已显示交易 tab 为 `complete`、页面 `complete: true`，且 `canDecide / canConfirm` 均为 false，支持结果确认超时/假失败。日志未记录点击到完成的实际耗时，不能据此确认商品数量是唯一原因。

当前实现与边界：

- 仅 `completeNormalBundleRequest()` 的 `decide` 启用 30 秒等待；识别到下一确认页或完成状态即继续，不固定等满。
- 到达超时边界时，最后再检查原 tab 和本次新增的交易 tab，完成则按成功继续。
- 首次 MAIN world 点击失败时保留 content script 备用点击；点击返回成功后不因等待超时重复点击，也不再叠加第二轮 30 秒。页面/API 调用本身的耗时仍可能略超出轮询窗口。
- 不改出价池、普通单件交易、付款或扫描规则，不修改生产订单。30 秒仍未确认时继续使用原错误上报；整组冻结/结果未知状态机制尚未实施。
- 后续如仍复现，保留件数、点击和完成耗时、URL、tab 状态及完成状态，再评估整组二次核实方案。

人工处理仍须先在 Yahoo 核实同捆是否成功；已成功则不要重复申请，使用现有“普通商品同捆修复”恢复整组关系后再扫描。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 5. 后台静态部署与剩余间歇性 HTTP 502 收敛

2026-08-31 已完成本地后台静态化，以 `scripts/serve-client-dist.js` 提供 `src/admin/dist` 到原8000端口，继续把 `/api` 转发到3034。2026-09-28 起 `start.bat` 通过 `scripts/build-if-needed.js` 分别检查后台和用户端，仅输入或产物变化、首次无构建记录时执行构建。脚本支持 `STATIC_DIST_DIR` / `STATIC_PORT`，用户端仍为3035，后台 hash 路由 `/#/...` 地址不变。

本次部署需同步 `start.bat`、`scripts/build-if-needed.js`、`scripts/wait-for-services.js`。首次启动各构建一次，在各自 dist 中写入 `.startup-build.json`，后续相同输入与产物直接复用。用内容摘要检查前端源码、共享源码、配置、依赖清单/锁文件、npm 安装锁记录及常见构建环境变量；不遍历 node_modules，不以文件时间作为变化依据。编译失败不写成功记录，下次启动重试。源码、配置或依赖变更只重建受影响前端，共享输入变更会重建两端。

就绪检查同时请求3034 `/health`、3035与8000首页，每轮检查后全部正常就立即继续；最多20秒，超时列出未就绪服务及日志位置。该20秒是故障等待上限，不再固定等待。部署验证连续启动两次：第二次应显示 `Build unchanged`，就绪检查按实际耗时返回。需要强制构建时执行 `node scripts/build-if-needed.js client --force` 或 `node scripts/build-if-needed.js admin --force`。

启动专项验证：

```powershell
node scripts/startup.test.js
node scripts/build-if-needed.js client
node scripts/build-if-needed.js client
node scripts/build-if-needed.js admin
node scripts/build-if-needed.js admin
node scripts/encoding-guard.js
git diff --check
```

用户提供的 Nginx 配置未包含8000后台 upstream；直接访问 `43.165.177.49:8000` 不经过 Nginx。因此生产更新后 Nginx 无需改动，只需重新运行 `start.bat`；切换时后台会短暂中断，已打开页面应 Ctrl+F5。未构建成功时脚本保留已有 `src/admin/dist` 作为临时回退；构建输出直接显示在启动窗口，不能把失败构建当成成功发布。

已确认现象：

- 生产后台“任务报表”会间歇显示“队列统计加载失败，请求失败（HTTP 502）”。
- 通常每隔几分钟出现一次，持续约 1-2 秒后自行消失。
- 页面每 5 秒请求一次 `/api/admin/tasks/stats`；下一次请求成功后会清除错误提示。
- `/api/admin/tasks/stats` 本身没有主动返回 502 的业务分支。后台 Umi 开发服务器将 `/api` 代理到 `http://localhost:3034`，代理连接失败时会产生 502。
- 既有后台日志出现过 `[HPM] ... /api/admin/tasks/stats ... [ECONNREFUSED]`，说明历史上确实发生过后台代理瞬时连接不到 API。
- 2026-08-04 远程采样期间，直连 `3034/health` 和 `8000 -> 3034` 后台代理正常，但用户提供的公网 `:303` 入口多次超时或返回 502；因此公网端口转发/反向代理也是需要同时检查的一层。

当前结论边界：

- `ChunkLoadError` 的直接原因是生产8000端口此前运行 `umi dev`，热更新编译时旧页面请求已失效的 HMR chunk；本地静态化已消除这条链路。
- `/api/admin/tasks/stats` 的短暂502仍属于 API 或代理链路瞬时不可达，不是队列统计 SQL 的稳定业务错误；静态后台会移除 Umi 开发代理这一层，但不替代对3034/API watcher的健康检查。
- 生产尚未更新，需在下次执行 `start.bat` 后观察后台静态页面与3034可用性。

后台二次改版时优先处理：

1. 生产更新后确认8000返回静态后台页面，不含 `webpack-hmr`、MFSU 或开发错误覆盖层。
2. 明确并收敛公网 `:303 -> 后台静态服务 -> :3034 API` 的代理拓扑，给每一层增加访问日志、上游错误日志和健康检查。
3. 检查 `server-start.err.log` 中 API 周期性退出原因；保留 watcher，但不能把反复重启当成正常运行方式。
4. 后台轮询增加请求串行化或请求序号保护，避免旧请求晚于新请求返回时短暂覆盖最新成功状态。
5. 对单次瞬时网络错误做克制提示：短重试后仍失败再展示警告，同时不能掩盖持续不可用。

后续验收：

- 连续监控至少 30 分钟，公网入口、后台静态服务和 API 健康检查均无瞬断。
- 人工停止 API 时，后台能稳定显示故障；API 恢复后自动恢复，且不会出现请求竞态造成的闪烁。
- 生产后台源码或普通数据变化不触发开发服务器重新编译。
- 代理日志能直接区分公网入口失败、后台到 API 连接失败，以及 API 接口自身 5xx。

---

## 核心业务规则

### 任务状态

`tasks.status` 常用值：

- `pending`: 等待插件领取。
- `processing`: 已被插件领取执行中。
- `bidding`: 已出价或等待后续同步确认。
- `success`: 已落札成功。
- `failed`: 出价或流程失败。
- `cancelled`: 取消或不可继续。

### 出价策略

`tasks.strategy` 常用值：

- `direct`: 即时拍。
- `multi_bid`: 多次出价。
- `1min` / `2min` / `5min` / `10min`: 结束前出价。
- `manual_import`: 手动导入，用户侧显示为 `导入`。

### 价格与税

- Yahoo 商城商品页面价格通常按税前价处理，含税展示和校验由系统计算。
- `tax_type=tax_included` 表示商城含税商品。
- `tax_type=tax_zero` 表示个人商品或税 0 商品。
- `product_type=store` 表示走 Yahoo ストア订单/付款流程；`product_type=normal` 表示走普通取引ナビ流程。
- `product_type` 和 `tax_type` 不要互相强推。存在 `product_type=store` 且 `tax_type=tax_zero` 的“ストア但税 0/不含税表现”商品；只有 `tax_type=tax_included` 才能触发 1.1 含税换算。
- 提交给插件和任务的最高价仍以日元为准。
- 人民币只用于页面换算和展示，不进入插件出价逻辑。

### 多次出价

- 多次出价有最低最高价配置，默认 `5000円`。
- 加价阶梯按 Yahoo 规则校验：
  - `< 1000`: `10円`
  - `< 5000`: `100円`
  - `< 10000`: `250円`
  - `< 50000`: `500円`
  - `>= 50000`: `1000円`

### 订单状态

`orders.order_status` 常用值：

- `pending_payment`: 待付款。
- `paused`: 普通商品交易开始前暂停；`orders.paused_at` 单独记录暂停时间，交易开始领取时满 24 小时恢复为空。
- `waiting_shipping`: 等待卖家给运费。
- `pending_bundle`: 同捆流程中。
- `bundle_completed`: 同捆完成。
- `pending_settlement`: 待结算。
- `pending_shipment`: 待发货。
- `pending_receipt`: 待收货。
- `completed`: 完成。
- `cancelled`: 取消。

### 落札同步事实来源

Yahoo `/my/won` 落札页是落札事实来源。只要落札页出现某商品，就说明 Yahoo 侧已经拍到；插件前面的出价/即决流程即使因为消息通道、tab、timeout 或系统错误把任务标成 `failed`，落札同步也必须能把该商品对应任务纠正为 `success` 并生成/更新订单。

实现边界：

- `/api/plugin/orders/sync` 匹配对应 `tasks.product_id` 时，不应只限制 `bidding/success`。
- 允许从 `failed/processing/bidding/success` 纠正为 `success`。
- `cancelled` 仍作为人工/业务取消边界，默认不自动复活。
- 最终成交价、成交时间和交易 URL 以 `/my/won` 当前行解析结果为准。

### 插件调度

当前插件有四条执行线：

- 出价并行池：通过 `/api/plugin/tasks?limit=N` 批量领取任务，默认并发数 2。
- A/B 监控同步：同步 `/my/bidding` 和 `/my/won`。
- Yahoo 消息：独立于 `workflowRunning`，每轮插件轮询检查，一次领取一条并立即执行；消息执行线内部串行，同一订单读/发仍由 API 防止并发。
- C/D/E/F/G 订单工作流：手动导入、交易开始、扫描、付款、确认收货。

工作流优先级：

```text
G manual_order_import -> C transaction_start -> D scan -> E payment -> F confirm_receipt -> none
```

PIN/验证码暂停只影响订单工作流，不应阻塞出价并行池和 A/B 监控。

---

## 生产注意事项

- 生产 Chrome 扩展更新后，需要在服务器 Chrome 中手动 reload。
- 用户端生产服务不要用 Vite dev server 对公网提供访问。生产启动应使用 `start.bat` 构建 `src/client/dist` 后由 `scripts/serve-client-dist.js` 服务静态文件，并继续将 `/api` 代理到 `http://localhost:3034`。
- `Failed to fetch` 通常表示插件访问不到 `http://127.0.0.1:3034` 或 `http://localhost:3034`，优先检查 API watcher/server 是否运行。
- Chrome MV3 的 `No SW` 是 service worker 生命周期噪声，现已做精确抑制，不应和业务失败混淆。
- 不要用宽泛 tab cleanup 关闭 `auctions.yahoo.co.jp/jp/auction/...` 商品页，否则可能误关并行出价 tab。
- 交易/扫描/付款真实输入 fallback 使用 `chrome.debugger` 时，应记录 `plugin_diagnostics`，方便后台 Reports 查询。
- 生产删字段或重建 SQLite 表前，必须停服务、备份数据库并准备回滚。

---

## 诊断与报表

插件诊断接口：

```text
GET /api/plugin/diagnostics?productId=...
GET /api/plugin/diagnostics?type=trusted_input
```

后台 Reports 当前包括：

- `chrome.debugger` trusted-input 使用统计。
- 出价失败 diagnostics，包括 timeout、系统错误和执行阶段。
- 近 5 天按用户统计的响应超时/系统原因失败。

常见诊断类型：

- `trusted_input`: 真实输入 fallback。
- `bid_failure`: 出价失败、超时或页面异常。
- `scan`: 扫描卡住或无法推进。
- `payment`: 付款失败。

---

## 最近重要变更摘要

### 2026-10-26 API补齐代理互斥并发保护，保留本人续拍例外

前端预检与API最终校验共用组／冲突SQL；默认互斥在SQLite立即事务中判断再分配／建任务，同组首次并发仅一人成功；本人已有任务的多人仍各自沿原规则续拍。confirm／allow、不同代理组及自动执行保持，发布和验证见0at。

### 2026-10-26 手机任务列表长标题及文字缩放适配

任务列表内容允许收缩并对长英文换行，页面文字自动缩放固定100%且保留手动缩放；不改字号及业务，仅发布用户端dist。独立／内嵌列表320／393／1200浏览器与构建通过，真实iPhone待验收，详见0as。

### 2026-10-26 用户成功提交后清空旧拍卖记录并按新一轮采集

只处理普通／商城实际成功新建任务，含用户批量；清空两历史字段与任务／归属创建同事务，旧采集回调作废，自动续拍／快照／失败／重复请求不触发。旧订单边界存原config，避免按旧落札时间提前采集；原任务历史和蓝三角保持。部署与验证见0ar。

### 2026-10-26 本人已有任务时继续提交不受组内互斥影响

只读冲突查询逐商品排除本人已有任务，同组两人都已参与时均可继续加价；第三个新用户仍遵守组策略。所有状态均算本人已有，跨Yahoo账号一致；原提交与分配保持。仅发布agentProductPolicy.js并重启API，验证见0aq。

### 2026-10-26 用户端管理员可修改当前选中代理的组策略

管理员选代理显示齿轮并操作该代理原config配置，选普通用户隐藏且禁止保存。服务器复用原切换权限并核对实际登录等级，代理自己的设置目标保持本人；切换时隔离旧请求返回。发布及验证见0aq。

### 2026-10-26 代理组同商品策略仅用户端提交前执行

代理退出后齿轮设置三选一，服务器按组保存默认互斥；本人及下属提交前实时查询，其他用户任何状态任务均算占用，跨组独立、同用户沿原规则。通过策略后走原多账号分配，单条与批量入口均覆盖；任务API／后台／插件不加代理策略拦截。发布及验证见0aq。

### 2026-10-25 主备用验证组件统一及パスキー前置

共用主号原普通输入与反馈，新前置只点其他登录方式／パスキー，中途日文与PIN沿原流程并持续锁定单个验证标签，接管后清理原页及本轮重复子页；允许两轮回跳，第三次报错停住。部署及验证见0ap。

### 2026-10-25 普通即时拍已有最高上限达标返回成功

复用原定时成功分支，仅普通即时竞价在官方最高提示及已有上限达到任务目标时直接成功，不再次操作；其余出价及税额校验保持。仅插件content.js更新并reload，验证与范围见0ao。

### 2026-10-25 邮箱回跳限制与原PIN连续验证

邮箱／PIN单登录标签；第二次邮箱不刷新，第三次停止并后台报错，主／备用隐藏继续且API拒绝继续。邮箱交接不作为整个流程完成，保留原PIN；部署与验证见0an。

- 2026-10-21：P消息订单读取／发送复用原消息队列与两端展示，插件增加同商品trade/buyer定位、消息列表提取及等待按钮可用后单次发送核验；用户端无需改动，仅插件更新reload，真实有消息页待验收，见0al。

- 2026-10-21：新增旧P订单时间只读预览／备份修复脚本和双击入口，仅读取产品类型为fleamarket且旧值证据一致的订单，仅修正won_at。生产截图两件订单已通过debug只读核验，用户已反馈API更新重启；旧数据尚未执行修复，见0ak。

- 2026-10-21：P成交时间保存复用普通／商城既有解析函数，成交列表共用原读取、倒序和显示；日本时间文字保留，历史订单不重写。仅API更新并重启，验证与边界见0aj。

- 2026-10-19：用户端长用户名单行省略、退出与风格控件保持同排；重开登录页自动复用已有登录状态，补齐浏览器账号密码自动填充语义。仅更新用户端dist，原7天有效期保持，验证见0ai。

- 2026-10-19：批量订单状态更新支持取消，API校验与结果文案同步，复用原审计；部署更新API和后台dist。

### 2026-10-18 P商品快速提交

P信息齐全时复用用户端已读取快照，取消提交必经的Yahoo重抓；插件领取后沿原购买入口及最终金额校验执行。重复任务、订单、结果未知保护保持，仅更新API并重启，验证见0ag。

### 2026-10-17 首页商品类型标签配色

全称标签取消统一蓝色覆盖，沿用成交页普通绿色、商城红色及P紫色。仅用户端静态展示；验证和部署见0ae。

### 2026-10-16 邮箱验证直达 PIN 的流程交接

补齐邮箱验证后直接进入 PIN 的成功返回，沿用原 PIN 提示与输入；原文字验证码、单次刷新／提交、超时保持。只更新插件 background.js 并 reload，专项及原插件／多账号回归通过，真实服务器待验收，详见 0f。

### 2026-10-14 商品名称搜索兼容新版页面

搜索页由旧类名改为新版 __NEXT_DATA__ 商品数据；仅增加兼容读取与无分页链接时的下一页识别，保留原 URL 和前端分页流程。隔离原 proxy 回归、搜索展示、真实 HTML 与 Yahoo 两词两页读取通过。仅 API 更新并重启，验收与命令见 0g。

### 2026-10-13 角标仅在读取商品时判断

移除提交页持续检查，角标／表单状态固定到下一次重新获取商品信息，API 提交保护保留；仅用户端静态文件，详见 0f。

### 2026-10-12 已结束商品只展示、禁止提交

提交页图片显示红色「已结束」且隐藏出价表单，截止时自动更新，API 同步拒绝过期提交；仅 API＋用户端＋共享工具，详见 0f。

### 2026-10-12 商品结束失败提示及任务列溢出

结束失败原因和状态原子保存，旧空原因仅凭精确诊断只读恢复显示；其他失败规则不变。主表／队列长用户名省略，状态列扩至 190，详见 0f。

### 2026-10-12 用户删除支持二次确认与完整关联清理

仅非管理员可删；有订单／任务才追加二次确认，无订单／任务直接清理本人全部关联数据。事务回滚、异常捕获、共享商品／其他用户保护及旧登录 token 失效已接入，需 API＋后台更新，详见 0f。

### 2026-10-12 手机表格恢复单行与横向滚动

任务表明确各字段可读宽度并开启左右滑动，避免逐字竖排；订单其他列不缩短。账号列统一「YH」、64px，详见 0f。

### 2026-10-12 删除顶部账号状态文字

主／备用账号在线和登录文字不再重复显示，无实际提醒不占空白；红绿灯及原账号操作提醒保留，仅后台静态文件，详见 0f。

### 2026-10-12 后台执行／成交账号列缩短

标题改为「执行Yh／成交Yh」，两列缩至 88，长账号省略显示，改善手机首屏空间；仅后台静态文件，详见 0f。

### 2026-10-12 新版同捆拒绝后的单品入口兼容

新版「購入手続きをする／購入手続きする」增加到单品开始识别和两种点击路径；关闭拒绝弹框后继续原信息填写／运费流程。仅更新插件两个文件并 reload，真实新版后续页待验收，详见 0f。

### 2026-10-12 拍卖记录最新同分钟优先第二条的条件

最新同分钟有效出价超过 2 条且第一条价格不大于第二条时，数组改存第二条用户名／价格；其他记录及原商品更新条件保持。仅更新并重启 API，旧记录需原入口清空后重采，详见 0e。

### 2026-10-11 用户端隐藏 Yahoo 账号

任务列表、入札中／失败分析和落札商品隐藏执行／成交 Yahoo 文案，仅改用户端展示。后台和业务逻辑不变，详见 0f。

### 2026-10-11 修复订单状态日志的历史外键引用

日志表没有丢失；历史临时订单表的外键残留导致手动同捆修复写日志失败并回滚。API 启动先备份，再只修正该日志表结构并保留记录。当前数据库副本验证实际两笔订单可修复，真实数据库未写入，更新并重启 API 后再点击确认修复，详见 0f。

### 2026-10-11 普通商品同捆修复允许不同用户

按用户要求移除同一内部用户限制，保留同一 Yahoo 成交账号要求及原其他检查；隔离数据库验证同账号不同用户成功、跨账号无写入，各订单用户和金额保持。仅需更新并重启 API，详见 0f。

### 2026-10-11 撤回本次同捆自动恢复

新版 Yahoo 页面现场仍未读取到同捆清单；按用户要求撤回刚新增的自动恢复及测试，恢复修复前的处理。其他改动保留，实际订单数据未修改，详见 0f。

### 2026-10-11 取消出价任务人工核对门槛

2026-10-11 按用户最新要求取消出价任务人工核对：普通失败和结果不明确均不阻止同用户在原 Yahoo 账号后续提交或既有队列领取，已有 execution_unknown 记录也无需人工解除。移除任务页“结果核对”列及 resolve-unknown 接口。失败任务保持失败，不自动重放；execution_unknown 仅作为防止不确定入札跨账号转交的内部依据。领取仍校验归属、同账号同商品互斥、并发和原多次出价条件；最高价仍是该任务的出价上限，不自动提价或生成重试任务；用户再次主动提交仍经过原价格与策略校验。价格、策略、被超过处理、取消归属及订单付款规则不改。API 与后台静态文件需一起更新并重启 API，无数据库迁移，本次不需更新插件。

### 2026-10-11 入札／落札自动同步错误页恢复与诊断

同步页面加载失败限重试一次，最终错误补齐账号、页面、页码、阶段及浏览器导航原因；失败或超时不上传不完整数据，自动同步页自行上报统一由读取流程接管，手动页面保留。只需更新插件 background.js、manifest.json 并在各 profile 重载，实际故障原因等待新日志确认，详见 0f。

### 2026-10-11 用户端登录闪回修复

用户端配置请求改用用户登录鉴权接口，避免把插件绑定 401 当作用户登录失效；只返回原三项多次出价设置，插件绑定保护保持。真实登录与 390/1200 页面轮询／刷新专项及相关回归通过；专项纳入完整回归并强制使用独立测试库。API 与用户端一起更新、重启 API；无数据库迁移，详见 0f。

### 2026-10-10 插件重载静默等待与账号红绿灯

启动期明确旧实例冲突不再作为消息轮询错误记录，45 秒防重复保护保持；其他错误及持续实例冲突保留真实原因。账号状态展示已按最新要求改为红绿灯：主号第一，无文字／编号，PC 与手机每行最多 4 个，余下由下箭头展开，点击／悬停可核对账号。隔离认证＋插件专项、原插件回归及后台构建通过，最新后台浏览器验收覆盖 360/390/1200；红绿灯只需更新后台静态文件，详见 0f。

### 2026-10-10 多账号排队归属与四处保护补齐

明确黑名单转交同步原账号同用户同商品的待执行任务及尝试顺序；耗尽后待执行任务结束，已执行历史保留。领取核对归属，失败结果不再阻断后续队列（2026-10-11 更新），时间／快照写回保护落札事实；交易开始明确跳过归还领取。原出价设置、定时、暂停、付款中断及人工恢复规则不改。专项加入回归，验证与部署边界见 0f。

### 2026-10-10 多账号领取收尾、旧页面回写和订单用户修复

归还未执行的批次任务及完成的无变化读取时，严格匹配账号、实例、对象和原 token，不释放新一轮或未知执行。出价回调携带本次凭证并核对活动 tab，任务执行固定自身凭证。已按原规则恢复订单改用户的全部历史范围，撤销新增拒绝条件；已有成交订单优先同步，不因历史分配名额与当前订单用户不同而跳过或改回用户。新增隔离数据库 HTTP 与插件模拟回归并加入完整回归入口；详见 0f。

### 2026-10-10 Yahoo 多账号执行与防重复保护

已实现账号列表／绑定／独立执行状态、同商品多人分配、逐级明确黑名单转交和成交账号订单闭环；新增领取 token、响应丢失请求去重、SQL账号隔离、独立验证与PIN前台锁；出价任务人工核对入口已于 2026-10-11 取消，订单工作核对仍保留。首次迁移备份并保护升级前处理中任务，取消后保留商品归属；原业务配置共用且每插件并发独立。文档更新至3.0，本地测试与生产分阶段验收见0f，尚未部署或操作真实Yahoo。

### 2026-10-08 最高价数据统一、时间提示与连续折线

取消任务在历史查询阶段排除，最终出价与三角不再使用已终止最高价；三角悬停从 UTC 原始值改为完整北京时间。收获无数据日 API 返回 0，前端缺失值也按 0 补齐为连续折线，公式和超 100% 展示保持不变。验证覆盖高价终止任务、仅终止记录、无数据日连续 90 个点和悬停时间；部署 API 与用户端。

### 2026-10-08 小图表排除已终止任务

失败分析和落札页的小图表不再显示已终止任务的三角及提交时间，失败/已出价/成功等其他状态保留。首尾时间从过滤后的提交历史中选取，最终出价文字与商品列表范围保持原口径。内存数据库专项覆盖混合状态、重复提交、仅终止任务、共享查询及账号隔离，验证命令见 0d；只需部署 API 并重启。

### 2026-10-08 统计页滚动、汇总卡片与收获口径

两张折线图默认滚动到最新日期，三段汇总说明移至三张图下方的独立卡片。收获指数于 2026-10-09 改为每日落札数 / 当日到期下架商品数计算，活跃任务总次数不变。内存数据库验证重复商品、多账号、无分母与跨日超范围比值；390/1200 像素模拟页面验证右侧初始位置、卡片顺序、详情与页面无溢出。验证命令及同步部署要求见 0c。

### 2026-10-08 Gmail 搜索后无法点开验证码邮件修复

移除以列表最新邮件 ID 为必需条件的定位方式，兼容标识位于标题子元素以及列表 ID 缺失；先记录旧邮件详情 ID，再打开候选邮件核对新验证码，保留旧邮件和账号过滤。Gmail 搜索缓存未更新时仅刷新本轮 Gmail tab。新增页面脚本贯穿读取到填码的回归；此次仅插件及文档/测试变更，未部署生产。现场需更新扩展并 reload 后确认新邮件能被打开和填入；原单次执行及 60/30 秒边界保持不变，详见当前主计划 0a。

### 2026-10-07 入札中失败分析

落札页同样显示提交最高价图，位于落札时间下方并使用成交价为基准；历史查询与失败分析共用，仅加载当前分页商品的同账号提交。已验证取消订单也可展示，成交价保持原值。

列表标题可切换到已到期未落札商品分析，排除仍在入札中的商品；显示历史提交最高价与记录的当前价，以及每次用户提交最高价对应的三角，不计任务内部多次加价。最高价超过当前价时扩展线段并保留当前价刻度，自动低价续拍合并回原提交。只读 API 与客户端变更，验证和部署见当前主计划 0d。

### 2026-10-07 用户端近 90 天统计

落札统计扩展至 90 天并缩细柱体，日期保留首尾/每 5 天刻度；新增活跃指数和收获指数折线图。任务总数包含全部状态和每次提交，落札沿用原统计日期口径；无分母和超 100% 比值分别按缺失值/溢出标记展示。只读 API 和客户端变更，验证与部署边界见当前主计划 0c。

### 2026-10-05 后台队列详情展开

“队列中”非零数字可点击展开/收起详细任务表，保持统计卡片高度。只读查询合并待补全与待出价状态，与卡片数量口径一致；定时任务即使尚不可领取也可查看，已创建任务的批量行不重复计数。详情分页并定时刷新，零值禁用，队列清空自动隐藏。复用原任务表格列、价格展示和执行时间计算，不调整任务状态或执行调度。专项内存数据库测试覆盖 50 条以上补全行、定时任务、分页、数量一致、管理员权限和无写入；本地浏览器使用独立模拟 API 验证展开/收起、分页、刷新及错误恢复、隐藏后停止查询、清空自动收起和 1440/1200/390 像素卡片等高。验证命令见当前主计划 0b，尚未部署生产。

### 2026-10-05 用户端批量即时拍

用户商品标题行右侧提供批量入口，按税前日元最高价提交。批次持久化入 API 队列后立即关闭输入弹窗，后台逐条补全商品和建任务，用户可继续提交更多单件或批次。每件商品补全后即进入原出价队列，不等待整批补全或前一件出价；仅提交失败时通过独立弹窗显示失败行及原因，全部成功和出价失败均不弹窗。后台统计合并商品准备与出价队列并显示分项和准备明细，准备表仅展示待补全/补全中商品，完成后自动隐藏且不展示错误，不受用户端结果关闭状态影响；统计分项调整到卡片右侧两行，保持六张卡片原有高度与排版；1440/1200/390 像素视口验证六张卡片等高且分项未溢出，支持关闭、关页后恢复、API 重启恢复与入队去重。复用公共提交函数及既有价格/策略规则，插件执行线保持原调度。实测发现用户上下文函数未导出，已补齐导出并改用真实用户权限路径进行队列测试；失败发生在建任务之前，需更新并重启 API 后重新提交。专项验证见当前主计划 0b。

### 2026-10-02 PIN 前邮箱验证码按次执行

新增邮箱验证类型及后台“继续”入口，邮箱码与 PIN 分离识别和输入。继续请求和插件领取分成两个一次性步骤，重复请求不重放 Yahoo 操作；失败发布新验证标识，必须由用户再次点击。每轮仅一次 Yahoo 刷新和一次邮箱码提交，刷新起等邮件 60 秒、提交登录后等文字验证码页 30 秒，之后沿用人工文字验证码及 PIN 流程。验证状态仍存现有 config，无新增数据库列；状态回写采用条件更新，过期回调不能覆盖新验证。Gmail 新权限及真实页面验收见当前主计划 0a。本地修改尚未部署生产或读取真实邮箱。

### 2026-09-28 启动按需构建与即时就绪检查

`start.bat` 的两端构建改为内容摘要缓存：首次构建成功后记录输入及 dist 摘要，未变化时直接启动静态服务；产物缺失或被修改会重新构建，失败或构建期间源码变化不会留下成功记录。排除 Umi 生成目录、日志和 node_modules，显式纳入 npm 安装锁记录与共享源码。原固定等待20秒和仅检查端口监听，改为并行 HTTP 探测，全部就绪立刻返回，达到20秒上限报告未就绪项目。未就绪时不再统一输出“服务已运行”。

本地专项测试覆盖跳过构建、源码/共享文件/配置/依赖/环境变化、缺失产物、失败后重试及立即就绪、延迟就绪、错误响应和请求挂起。验证命令见第5项，已加入 `npm run regression`。只涉及启动流程；未执行完整启动脚本或重启现有服务，生产需更新后验证。

### 2026-09-28 消息独立执行与结果刷新

消息从订单工作流拆出，扫描/交易/付款批次执行中也能领取。消息 tab 用独立归属表记录根页面与 opener 后代；消息切页只跟随自己的页面，扫描、交易、付款的跨 tab 查找和清理跳过消息页面。消息创建时先标记空白页，再导航到 Yahoo，避免创建和登记之间被扫描清理。页面文档或内嵌数据可读后即继续，不额外等待全部资源；需要 PIN/验证码时保留验证页交给原人工流程。后台等待期间每 2 秒静默刷新，带请求序号与取消保护，避免旧查询覆盖新筛选，聊天弹窗同步更新。

仅商城消息发送的 debugger 鼠标备用操作因需切换焦点，执行该段前等待并短暂占用订单工作流锁，避免干扰 Win32 PIN 输入；普通读取和 DOM 发送不占用此锁。等待仍受消息单任务 45 秒上限约束。

保留消息内部串行和同订单读/发互斥；领取每次只取一条，避免尚未开始的任务被批量标记 processing。消息 API 请求上限 8 秒，单任务 45 秒，超时清理只处理自己的 tab 并阻止迟到步骤继续导航/发送。API 在领取时处理超过 3 分钟的 processing，发送失败标注结果待核对且不自动重发；领取时间回写保护防止旧回调覆盖新结果，重复点击读取不重置仍在执行的任务。旧插件的工作流消息入口仍兼容，新插件通过 separateMessages 参数跳过该入口。

本地回归覆盖扫描与消息独立调度、标签页父子归属/互相清理保护、超时后延迟创建 tab、文档先于全部资源可读、同订单互斥、过期 processing 解锁与迟到回调。尚未部署生产或操作真实 Yahoo 消息，生产消息耗时需更新 API、后台和扩展后实测。验证命令见第 0 项。

### 2026-09-27 普通商品落札订单暂停

后台订单状态列双击：商城商品仍打开原同捆补录；普通商品仅空状态/暂停状态打开暂停与消息窗口。暂停后 `orders.order_status='paused'` 并写 `paused_at`；后台或用户端恢复时同时清空状态和时间，记录状态日志。窗口默认消息保留 `お世話になります。明日入札予定です。取り置きお願い致します。`，发送复用 Yahoo 消息队列，显示提交中、成功或失败，阻止同一订单的待发消息被下一条覆盖。用户端落札商品图片下方旗子右侧显示暂停图标：仅暂停时为红色且可点击恢复，其他状态为灰色不可点。

每次交易开始领取订单时，API 先恢复 `paused_at` 已满 24 小时的暂停订单，再沿用原“只领取空状态”规则；不新增排程。插件每件操作前复核订单状态，普通同捆操作前还检查组内是否有暂停订单。此功能不改变出价池、扫描、付款或已处于其他状态的订单。当前仅本地代码，未部署生产；真实 Yahoo 消息与订单执行效果待部署验证。

同日修复后台暂停弹窗发送消息时报 `No tab with id` 的标签页竞争：消息任务原先在清理时误传标签页 ID 数组且没有传入任务开始前的标签页集合，可能关闭其他已打开的 Yahoo 交易页；消息领取又在工作流互斥区外，允许两轮工作流交错。现按任务开始前快照只清理本轮标签页，消息领取也纳入工作流互斥，API 领取消息任务时以条件更新的 `rowCount` 确认唯一领取，并跳过正在处理的消息行。附件中的新版普通商品消息页仍使用现有 `textarea[placeholder="入力してください"]` 和“送信”按钮路径；输入文字后若 React 尚未启用发送按钮，短轮询等待按钮启用。本地模拟覆盖发送完成后的标签页清理、并发领取、工作流互斥及按钮延迟启用。真实 Yahoo 页面发送仍需在扩展 reload 后验证，不根据失败标记盲目重发。

验证命令见“当前主计划”第 0 项。

### 2026-09-19 用户端入札中显示即时拍最高出价

即时拍商品在图片下方显示“榔头图标 → 最高价金额”，复用商品详情拍卖次数的榔头图标；箭头使用固定 14px、禁止 flex 压缩的 SVG 图标，避免文字箭头过细或字体差异造成显示不完整的观感，金额标签也禁止压缩。金额使用与顶部状态相同的标签样式，未被超过为蓝底白字，被超过为红底白字，商品 ID 下方不再重复显示。状态沿用入札中页面的 `outbid` 判定。沿用入札中接口按当前用户和商品选取最新任务的规则，金额与任务列表一致，优先显示 `user_max_price`，旧数据回退 `max_price`，以日元展示；其他策略不显示该行。仅修改用户端展示，API、数据库和插件无需更新。当前为本地修改，部署时重新构建并发布用户端静态文件。

验证：

```powershell
node src/client/src/pages/ActiveBidding.display.test.mjs
node src/server/routes/task.test.js
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-09-18 待收货补表格按商品 ID 查重

Google Sheets 追加成功后，格式设置失败或响应丢失可能使数据库 `google_sheet_appended_at` 仍为空，旧补表格只检查该标记而重复追加。现在自动追加和后台“待收货补表格”共用按 C 列商品 ID / Yahoo 商品链接查重的路径，支持纯 ID、数字 ID、HYPERLINK 公式和富文本链接，按完整 ID 匹配，不用标题或其他列的包含匹配。

每组处理重新读取 C 列，不跨组缓存；读取失败不追加也不写完成标记。同捆逐件检查、只追加缺失商品，全部已有则返回成功并在后台显示“已有数据”。确认已有或追加成功后，标记本组订单并清除对应失败提醒，不改订单状态或结算金额。追加 POST 不盲目重试；响应不明留待下次查重。追加成功后的格式失败作为警告返回，不再因格式失败丢失写表完成标记。每个表格的追加在单个 API 进程内串行化，不能保证跨进程或外部人工并发写入的原子性，也不自动删除历史重复行或修复已有行格式。

本地模拟覆盖已有/部分已有、读取失败、响应丢失后再补、格式失败、并发补写、完整 ID 匹配、数据库标记失败和失败提醒清理。未读写生产 Google 表格或生产数据库。部署更新 API 并重启，同时重新构建发布后台以显示“已有数据”和新说明；无需更新 Chrome 插件或数据库结构。生产需验证一次失败订单的补表操作，确认已有行未重复追加、完成标记已保存。

验证：

```powershell
node src/server/services/googleSheets.test.js
node src/server/routes/plugin.test.js
node src/server/routes/admin.orders.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-09-14 商品到付运费 ARRIVAL 识别修复

商品 r1243992660、l1244119177 的 Yahoo 数据同时包含 `shippingInput: ARRIVAL`、`shippingUlt.shippingInputCode: arrival` 和 `chargeForShipping: winner`。首屏运费文字尚未渲染时，旧解析遗漏到付编码，返回“落札者負担”；后台批处理“运费更新”复用该解析，因此也会写入错误标签。CSV 导出没有回写数据库，与本问题无关。

服务端商品解析、插件页面解析和插件 HTTP 商品抓取补上两个字段的到付识别（忽略大小写和首尾空格），仅明确 ARRIVAL 编码且非 seller 承担时优先于买家承担和数字运费。服务端 HTTP / 浏览器备用抓取仅在该结构条件成立时跳过运费报价查询，避免后续数字报价覆盖到付含义。原有日文文字、数字金额和免费运费的优先级不变，商品描述排除规则继续保留；不改 CSV、结算计算或订单状态流转。

同日复核已收窄初版过宽的日文关键词优先级：运费区域“送料600円 着払い不可”和 seller 承担下的否定提示不能因本次修复覆盖数字/免费结果。新增普通固定运费、0円、免费、待卖家报价、描述干扰、seller 与 ARRIVAL 冲突以及个人/商城报价接口在 HTTP 和浏览器备用路径中的回归；未扩大修改既有非 ARRIVAL 文案解析。

当前为本地修复，未部署生产或修改生产数据库。更新 `src/server/routes/proxy.js` 并重启 API 后，批处理“运费更新”可重新识别这两件商品；插件同时更新 `yahoo-plugin/background.js`、`yahoo-plugin/content.js` 并在 Chrome 扩展页 reload。已有数据库记录不会仅因更新代码自动改变。真实 Yahoo HTML 的只读解析验证已返回“着払い”；生产批处理和 Chrome 实际执行仍待用户更新后验证。

验证：

```powershell
node src/server/routes/proxy.test.js
node src/server/routes/admin.orders.test.js
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
node src/admin/src/ordersCsv.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-09-12 缓存结束时间到期后由插件核实

生产商品 m1243535717 的首个任务被 API 根据 products.end_time 标记为“插件执行前已结束”，后续任务的诊断却显示结束时间持续延长。首次判定使用的历史快照未保留，不能精确还原旧时间。现在移除服务端仅凭缓存结束时间将 pending 任务批量判失败的逻辑，缓存到期任务仍可被领取，由插件读取当前商品页后处理。即时拍继续出价，定时拍延长到策略窗口之外则更新快照并返回 pending；多次出价原有间隔和已提交上限限制保留。

插件仅在当前页面读到已到期时间时报告“商品已结束”。缓存到期而当前页时间缺失/无效时，报告读取当前结束时间失败，不使用旧时间判结束。历史 failed/cancelled 任务不自动恢复。本地模拟回归覆盖过期缓存任务领取、即时拍/定时拍/多次出价的延时处理、当前页实际到期和时间读取失败；未操作生产出价或修改历史任务。

部署需更新 src/server/routes/plugin.js、src/server/index.js 并重启 API，同时更新 yahoo-plugin/background.js 并在 Chrome 扩展页 reload。API 和插件两侧必须一起更新，实际 Yahoo 页面效果待部署验证。

验证：

```powershell
node src/server/routes/plugin.test.js
node yahoo-plugin/background.test.js
node --check src/server/routes/plugin.js
node --check src/server/index.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```


### 2026-09-07 确认收货 Google 表格读取合并

确认收货领取任务时改为每轮只读取一次表格 C 列的商品 ID 和背景色，在内存中匹配全部待收货商品，下一轮重新读取，不跨轮缓存颜色。无待收货商品时不读取表格；待付款/待结算的补查保持原行为。移除逐商品查询和外层叠加重试。

该批量读取遇到 Google Sheets 429 时立即停止本轮，并对同一表格读取设置 60 秒冷却；冷却期间再次请求直接返回限流错误，不再访问 Google。到期后的新请求才重新读取，不自动重启确认收货。其他读写请求的既有重试规则不变。表格读取失败不返回部分任务，颜色未匹配不确认收货。生产商品 g1242685108 的报错发生在表格查询阶段，排查时仍待收货，未执行修复性确认或修改表格。

本次只修改 API 服务和测试，未部署生产。部署需更新 src/server/routes/plugin.js、src/server/services/googleSheets.js 并重启 API，无需更新 Chrome 插件或数据库。

验证：

```powershell
node src/server/services/googleSheets.test.js
node src/server/routes/plugin.test.js
node --check src/server/services/googleSheets.js
node --check src/server/routes/plugin.js
node scripts/encoding-guard.js
git diff --check
```


### 2026-09-06 同捆扫描状态优先于运费

同捆扫描先识别当前可见的拒绝提示，再识别同捆子商品，最后才读取运费。拒绝提示与单件运费同时存在时仍拆组；子商品提示与运费同时存在时不把子商品当主商品推进整组付款。提示优先从可见状态区域、弹窗及旧版关闭按钮所在容器读取；隐藏模板、隐藏父容器和交易消息中的旧提示不覆盖当前状态。主商品现有运费识别、拆组和付款规则不变。

新增回归覆盖拒绝/子商品与数字运费、0円、無料共存，正常主商品运费，隐藏元素/父容器/CSS/aria-hidden/零尺寸提示，交易历史和无 dialog role 的旧版弹窗。更新 yahoo-plugin/content.js 后需手动 reload Chrome 扩展；未部署生产或修改订单。卖家同意后直接进入可付款页面的等待条件缺口尚未在本次修改中处理。

验证命令沿用下条插件检查，重点运行 node yahoo-plugin/content.test.js 和 node scripts/encoding-guard.js。

### 2026-09-06 同捆拒绝后复用普通商品流程

生产商品 c1242486851 已正确识别同捆拒绝并解除同捆，但旧拒绝分支强制查找「取引をはじめる」，使显示「購入手続きする」的普通商品报错。现在拒绝分支只关闭提示并跳过再次申请同捆，之后与普通商品共用单件交易、运费和付款流程。旧版「取引をはじめる」步骤移到共用单件路径；「購入手続きする」继续由既有付款流程识别和点击，不在交易开始阶段提前执行。

回归覆盖普通商品与拒绝同捆商品共用旧版单件入口、免费运费购买入口在交易开始阶段不提前点击且进入待付款、拒绝后忽略残留同捆信息，以及单件入口不匹配购买入口或相似同捆文案。本次仅修改本地插件和测试，未修改生产订单或重试交易。生产更新 yahoo-plugin/background.js 后手动 reload 扩展，API 无需重启，实际 Yahoo 页面效果待部署验证。若已部署上一版临时文案补丁，同时更新 yahoo-plugin/content.js 撤回该补丁。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.test.js
node --check yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
node yahoo-plugin/content.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-09-05 用户端浏览器本地商品收藏

搜索列表、带返回和无返回的两种商品详情页新增灰色空心 / 黄色实心五角星。收藏按当前代看用户名（无代看时为登录用户名）写入 localStorage，仅保存商品 ID、标题、图片和截止时间，不写服务器数据库。添加成功提示“已加入收藏，更换设备或浏览器会清空收藏”；存储失败提示失败，不显示成功状态。刷新后保留，切换用户和跨标签页存储变化时同步收藏状态。

当前用户有收藏时，首页商品输入标题右侧显示“+”。收藏弹窗复用搜索列表布局，按实际截止时间从早到晚排序（未知时间排最后），只展示图片、标题、商品 ID 和到期天数；剩余时间向上取整，已过期为 0 天，缺失截止时间显示未知。点击图片或标题关闭弹窗并沿用原“入札”回填和详情抓取流程；取消收藏立即移除，取消最后一条后保留可关闭的空态并隐藏首页入口。收藏快照不替代出价前抓取和校验。

本次仅修改客户端及测试。已通过本地 Chrome 桌面 / 手机尺寸的模拟 API 交互验证，包括两种详情模式、刷新持久化、星标同步、收藏回填重新抓取和最后一条删除；未更新生产。部署时重新构建并发布用户端静态文件，无需更新 API、数据库或插件。

验证：

```powershell
node src/client/src/utils/productFavorites.test.mjs
node src/client/src/components/ProductSearchPopup.display.test.mjs
node src/client/src/pages/Submit.display.test.mjs
node src/client/src/utils/api.product-info.test.mjs
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-09-04 Yahoo 普通出价完成页误判修复

普通出价点击最终确认后，Yahoo 跳转到 `/jp/auction/{id}/bid/done` 时可能使原 content-script 消息通道进入 back/forward cache 并断开。旧后台会重新注入并再次执行完整出价；完成页中残留的通用“系统错误”或“再入札が必要です”文字可能先被读取，导致已成为最高价者的任务误报“Yahoo页面错误”或“出价后被超过”。

现在普通出价消息断开后先只读当前 tab：仅当 URL 是同一商品的 `/bid/done`，且可见正文明确显示“あなたが最高額入札者です”或无冲突的正式完成文案时，按已出价处理并交给 `/my/won` 后续同步，不再执行第二次出价。商品 ID 不匹配、明确“最高額入札者ではありません”、真实系统错误或单独“再入札が必要です”不会被当作成功。content script 自身也在完成页优先识别当前账号最高价者；同一次最终点击后的页面若出现可见最高价状态，则不会被页面其他残留文字覆盖。直接出价在普通商品页降低既有自动出价上限的原行为不变，真实系统错误、被超过、卖家黑名单、即决和多次出价流程不变。

本次只修改 Chrome 扩展代码和测试，不修改数据库、任务历史或 API。生产更新 `yahoo-plugin/background.js`、`yahoo-plugin/content.js` 后需要在 Chrome 扩展页手动 reload，API 无需重启。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
node yahoo-plugin/background.test.js
node yahoo-plugin/content.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-09-03 用户端商品名称多结果弹层

用户端按商品名称搜索时，不再因为 Yahoo 返回多个商品而直接报错。服务端新增搜索列表接口，每页只抓取一次 Yahoo 原生搜索页，解析商品 ID、图片、标题、当前价、即决价、运费、入札数和剩余时间；第一页固定使用 Yahoo 的 50 条分页参数，后续在弹层接近底部时再请求下一页，并按商品 ID 去重。

搜索弹层在 PC 使用双列卡片、手机使用单列紧凑卡片，图片懒加载；每条右侧提供“入札”按钮。点击后立即关闭弹层，把标准 Yahoo 商品完整 URL 写入首页输入框，并复用既有“再入札”的单商品详情抓取流程。搜索列表数据只用于选择，税类型、商城类型和最终出价字段仍由选中后的详情页抓取确认，不直接用列表摘要提交任务。

列表中的商品图片和标题可在同一弹层内打开详情视图；打开时重新抓取 Yahoo 商品页，解析全部商品图片、标题、Yahoo 页面实际显示价格、即决价、运费、拍卖次数、截止时间、商品成色状态和完整详细说明。这里的“商品状态”取 Yahoo `conditionName`（例如“やや傷や汚れあり”“未使用”），不是拍卖生命周期 `open/closed`。图片支持手机左右滑动，并提供 PC 左右按钮、计数和缩略图选择；顶部返回后恢复原列表滚动位置。商城详情价格使用 `taxinPrice` / `taxinBidorbuy` 等含税展示字段，但原 `currentPrice` 等任务字段保持不变。卖家说明保留 Yahoo 原 HTML 排版和说明图片，在无脚本的隔离 iframe 中展示；服务端移除脚本、事件、表单和嵌套页面，避免第三方 HTML 注入主页面。搜索详情底部保留红色“去竞拍”按钮，点击后与列表“入札”一致：关闭弹层、填入标准 Yahoo 商品完整 URL，并按既有流程抓取首页商品信息。

首页单商品抓取完成后的商品卡片，其图片和标题也可打开同一详情弹层并重新抓取详情。该只读模式没有返回按钮和“去竞拍”等竞拍动作，顶部及底部均只能关闭弹层，不修改首页商品、出价配置或任务状态。

用户端“落札商品”标题右侧新增商品 ID / 商品标题搜索框，输入后短延迟自动查询。筛选在服务端作用于该用户的全部落札记录和分页总数，商品 ID 与标题均为包含匹配，滚动加载、刷新和代看用户隔离继续沿用原逻辑；旧搜索请求晚返回时不会覆盖新的搜索结果。

验证：

```powershell
node --check src/server/routes/proxy.js
node src/server/routes/proxy.test.js
node src/client/src/utils/api.product-info.test.mjs
node src/client/src/components/ProductSearchPopup.display.test.mjs
node src/client/src/pages/Submit.display.test.mjs
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-09-03 新版交易页已付款/已发货结构状态兼容

确认收货的补查任务会检查仍处于“待支付 / 待结算”的订单；此前该路径只读取新版页面已渲染的日文状态文字，未读取 `__NEXT_DATA__`。因此页面只提供 `buyerPayDoneYahoo`、`paidWaitShip`、`buyerPaid` 或 `sellerSendDone` 结构状态时，可能没有把订单修正为“待发货”。现在确认收货解析也读取这些结构字段：已付款或卖家已发货均回写既有的 `pending_shipment`，服务端仍只允许 `pending_payment` / `pending_settlement` 进入该状态，不会自动确认收货或改写其他订单状态。

同时兼容新版普通交易页“商品が発送されました。到着後、受け取り連絡をしてください。”的可见文案。原有取消识别、待收货的 Google Sheet 确认、付款和物流扫描流程不变。本次只改插件和回归测试，未修改订单、数据库或 API；生产更新 `yahoo-plugin/background.js` 后在 Chrome 手动 reload 扩展即可，API 无需重启。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-31 查询订单支持商品名称查询

后台“查询订单”在商品ID后新增“商品名称”输入框，按商品快照 `products.product_title` 进行包含匹配。商品名称可与用户名、商品ID、落札时间和订单状态组合筛选；列表和分页总数使用同一 SQL 条件，翻页不会丢失筛选值。空商品名称不改变原查询结果。

验证：

```powershell
node src/admin/src/MessageRead.display.test.js
node src/server/routes/admin.orders.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-31 后台改为静态构建服务

后台8000端口原先由 `npm start` 的 `umi dev` 提供，热更新重编译会让旧页面请求已经失效的 HMR chunk，出现开发模式专属的 `ChunkLoadError` 红色覆盖页。现在 `start.bat` 会先构建 `src/admin/dist`，再使用 `scripts/serve-client-dist.js` 提供静态后台文件到原8000端口并继续转发 `/api` 到3034。静态服务新增 `STATIC_DIST_DIR`、`STATIC_PORT` 和显示名称配置，用户端3035保持原目录和端口。

后台地址和 hash 路由保持 `http://host:8000/#/...`，用户提供的 Nginx 配置未代理8000，因此无需更新 Nginx。生产执行新版 `start.bat` 时后台会短暂重启，已打开页面需 Ctrl+F5；API、数据库、插件和订单工作流不改。构建失败时暂时服务原有后台构建产物并在启动窗口显示失败输出，不能把失败构建当成成功发布。启动窗口会显示后台构建阶段和每秒等待点，避免构建或20秒端口等待看起来无响应。

验证：

```powershell
npm run build --prefix src/admin
node scripts/serve-client-dist.test.js
node --check scripts/serve-client-dist.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-31 普通商品付款配送选项展开修复

商品 `b1242288280` 的付款页默认运费为580日元，展开后实际存在430日元选项，旧插件却报“未能选择匹配的运费选项”。代码中展开动作会连续触发子元素、父控件的多次点击，存在将选项再次收起的风险；备用真实点击又依赖页面前500字出现“変更する”，会被新闻、广告等前置内容影响。

现在展开配送选项只对定位到的控件点击一次，继续等待实际选项出现；仍无选项且停留在可确认的付款页时，执行一次 `chrome.debugger` 备用点击，不再依赖截断的页面文本。已显示的选项列表不重复展开，总额已匹配时不再执行备用点击。找不到目标运费或选择后总额仍不符，继续报错并停止付款，不接受默认较高运费。该例目标仍为 `2800 + 430 = 3230` 日元。

回归覆盖父子控件重复点击、页面前500字全为广告、备用点击后仍无选项、缺少目标选项、选择后金额未更新和金额已匹配；商城配送变更页既有回归保持通过。本次仅修改本地插件代码和测试，未重试生产付款、未修改订单或数据库。生产需更新 `yahoo-plugin/background.js` 并在 Chrome 手动 reload 扩展，API 无需重启；实际 Yahoo 页面效果待更新后验证。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-31 普通商品同捆决定后等待改为30秒

普通同捆点击“决定”后的状态等待由单轮5秒改为30秒，识别到确认页或完成页立即继续，到时额外做一次跨 tab 状态核实。点击成功后的超时不再触发重复点击和第二轮等待；初次点击失败的备用方式保留。普通单件和同捆其他步骤保持原等待时间，API 无需重启，生产插件需更新并手动 reload。回归覆盖20秒后成功、30秒边界新 tab 完成、30秒仍未完成、首次点击失败备用成功以及单件原超时策略；生产实际同捆仍待验证。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-30 订单 CSV 临时运费计入人民币应付款

订单管理导出 CSV 时，为“落札者負担 / 着払い”填写的临时运费现在按该订单已保存的 `jpy_to_cny_rate` 换算后，加到原 `payable_cny`，保留原固定手续费等结算费用。用户汇总和金额汇总同步使用调整后的应付款，人民币金额保留至分。例如原应付款 1790 元、临时运费 2000 日元、原汇率 0.0445，导出应付款为 1879 元。已知运费不重复加收；未结算应付款保持空白，缺少有效原汇率时保留原应付款，不猜测汇率。所有调整仅作用于 CSV，不写数据库、不修改原订单对象或实际结算金额，重复导出不会累加。

验证：

```powershell
node src/admin/src/ordersCsv.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-24 订单 CSV 用户汇总、账号组合查询和出价限制

后台订单管理导出 CSV 会先按用户名排序并连续排列同一用户订单，在每个用户订单末尾增加“用户汇总”行，分别汇总日元总价和已有的人民币应付款；文件末尾原“金额汇总”继续保留，人工补录的导出运费同时计入用户小计和最终总计。

账号管理列表恢复查询区，支持用户名模糊检索和“可用策略”组合筛选；用户名可以为空，可用策略默认全部，筛选由服务端作用于完整数据和分页总数。可用出价策略新增“出价限制”：受限用户前台不显示任何说明，也不隐藏或禁用商品抓取、价格、策略和提交控件；用户点击“提交任务”时提示“出价功能被一时限制，请联系管理员。”并停止提交。服务端对所有新用户提交使用相同文案和 403 状态兜底，管理员代看也不能绕过；现有已提交任务、插件后续任务和后台手动导入不受影响。

验证：

```powershell
node src/admin/src/ordersCsv.test.js
node src/admin/src/Users.display.test.js
node src/client/src/pages/Submit.display.test.mjs
node src/server/routes/task.test.js
node src/server/routes/admin.orders.test.js
npm run build --prefix src/admin
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-22 用户端三页改为滚动加载并新增落札商品备注

用户端提交页下方任务列表、入札中、落札商品三处移除“上一页/下一页”，默认读取 10 条，滚动到底部后继续按每次 10 条追加；追加结果按任务或商品稳定 ID 去重，加载失败保留已显示内容并支持底部重试。切换代看用户会清空并重新读取第一页；首页 10 秒状态刷新只合并第一页，不会把已追加列表缩回 10 条，入札和落札页从后台回到页面时会在接口上限内刷新已加载范围。

落札商品图片下方新增备注旗帜：无备注为灰色，有备注为红色；点击后可在弹层内保存、修改或删除备注，删除按钮不再二次确认，接口成功后直接清空备注并关闭弹层。用户备注使用 `orders.user_remark` / `user_remark_updated_at`，与后台 `order_remark` 及 Google Sheets 备注分离。用户端保存和删除接口按 `orders.task_id -> tasks.user_id` 校验当前代看用户归属，不能修改其他用户订单；备注统一裁剪首尾空白并限制 1000 字。

验证：

```powershell
node --check src/server/routes/task.js
node src/server/routes/task.test.js
node src/client/src/utils/pagedList.test.mjs
node src/client/src/pages/TaskList.display.test.mjs
node src/client/src/pages/ActiveBidding.display.test.mjs
node src/client/src/pages/WonItems.display.test.mjs
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-20 新版普通商品付款完成页不再超时误报失败

新版普通商品 `/buyer/payment/complete` 页面同时显示“購入が完了しました！”和独立状态“商品の発送連絡をお待ちください”。精确状态提取会优先返回等待发货标题，旧付款完成判断因此看不到整页中的购买完成文字，等待 60 秒后误报页面未跳转。现在保留精确状态用于取消和生命周期判断，只在当前 URL 确认为 `/buyer/payment/complete` 时，用整页“購入が完了しました”作为付款完成兜底；卖家消息和其他交易页不会触发。超时错误同时改为显示实际 60 秒，回归测试覆盖成功文字与等待发货状态同时存在的页面。

验证：

```powershell
node --check yahoo-plugin/background.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-20 新版普通商品已付款结构化状态兼容

新版普通商品付款成功后，交易页可能只在可见状态标题显示“商品の発送連絡をお待ちください”，付款完成事实位于 `__NEXT_DATA__` 的 `progressStatus=buyerPayDoneYahoo`、`progressStep.type=paidWaitShip` 和 `notice[].type=buyerPaid`。付款流程原先只组合旧版付款完成文案与等待发货标题，未读取这些结构化字段，因此会继续寻找付款入口并报“页面按钮未找到”，订单停在 `pending_settlement`。现在付款页状态提取会读取上述结构化字段；确认已付款后直接按既有成功路径回写 `pending_shipment`，不会再次点击付款按钮。旧版文字识别、付款金额校验和取消识别保持不变。

验证：

```powershell
node --check yahoo-plugin/background.js
node yahoo-plugin/background.test.js
node src/server/routes/plugin.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-20 后台启动检查恢复固定等待20秒

按当前运维选择，`start.bat` 撤销 2026-08-19 增加的 8000 端口最长90秒轮询，恢复为启动 `umi dev` 后固定等待20秒，再一次性检查 API、用户端和后台端口。本次不改后台运行方式，仍使用 `umi dev`；如果首次编译超过20秒，启动窗口仍可能显示 `Admin Report NOT running`，应结合稍后实际访问和 `admin-start.log` 判断。

验证：

```powershell
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-19 后台启动8000端口改为最长90秒轮询

`start.bat` 启动 `umi dev` 后原先固定等待20秒并只检查一次8000端口；Umi 首次编译稍慢时会显示 `Admin Report NOT running`，但稍后刷新实际可正常打开。现在改为每2秒检查8000端口，最长等待90秒；一旦监听立即显示成功和实际等待时间，只有90秒后仍未监听才报错。API和用户端端口在后台等待结束后再检查，避免提前判定。本次不改后台运行方式，仍使用 `umi dev`。

验证：

```powershell
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-19 商城商品运费不符时强制进入配送方法变更页

商城付款确认页的页面总额与系统按商品运费计算的应付总额不一致时，页面 DOM 可能残留隐藏的目标运费 radio；旧流程可能直接操作隐藏控件，绕过“配送方法 → 変更”，最终因页面金额没有更新而报付款金额不一致。现在只在商城且页面总额不符时，先置前窗口并激活付款 tab，用 MAIN world JS 点击配送方法的“変更”；必须确认已进入 `/order/change/pay-method` 才能选择目标运费。选择后再次读取页面确认 radio 已生效，点击“変更する”后必须返回付款确认页且总额已更新，才继续后续付款。金额本来一致的商城商品不进入该分支。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node src/server/routes/plugin.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-18 新版普通商品等待发货页不再被卖家说明误判取消

新版普通商品已付款页面以独立状态标题显示“商品の発送連絡をお待ちください”，旧状态选择器无法提取该标题时，确认收货取消核查会退回整页文本；卖家消息中如果包含“无法联系时可能落札者削除”的条件性说明，原后台取消规则仅凭“落札者削除”就会把待付款/待结算订单误改为取消。现在付款和确认收货页面状态提取会从新版页面的 `main p` 状态元素精确读取该等待发货标题，不读取整段消息来确认这一状态；取消识别同时收紧为实际“落札者削除されました/されたため”并伴随“出品者が落札を取り消しました”或“取引はできません”等已发生事实。回归测试覆盖等待发货页面同时带有卖家条件性删除说明时保持待发货。

验证：

```powershell
node --check yahoo-plugin/background.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-18 查询订单支持勾选导出 CSV

后台“查询订单”表格新增行复选框、跨分页选择和“导出CSV”按钮；重新搜索或重置筛选会清空旧选择。CSV 只导出当前已勾选订单，字段顺序固定为：用户名、商品url、商品名称、落札时间、追踪号，并带 UTF-8 BOM 以便 Excel 直接打开中文。查询接口同时从 `products.product_url` 返回商品 URL，旧数据缺少 URL 时前端按商品 ID 生成标准 Yahoo 拍卖链接作为兜底。

验证：

```powershell
node src/admin/src/messageReadCsv.test.js
node src/admin/src/MessageRead.display.test.js
node src/server/routes/admin.orders.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-18 新版普通商品お問い合わせ番号与单号重扫兼容

Yahoo 新版普通商品取引页的日本邮政物流单号不一定使用既有 `trackingNumber` / “追跡番号”，生产商品 `n1240182786` 的 `__NEXT_DATA__` 使用 `top.tradeInfo.sendInfo.trackingInfo.inquiryNumber=646715100662`，页面“お届け情報”表格则显示“お問い合わせ番号”。插件原先两处都未读取，因而遗漏真实单号并可能继续走消息或卖家氏名回退。现在新版解析器同时兼容 `trackingNumber` 与 `inquiryNumber`，DOM 备用解析同时兼容“追跡番号”与“お問い合わせ番号”；真实单号仍优先于消息和卖家氏名，“未登録（反映されるまでおまちください）”保护保持在所有回退之前。

后台批处理“单号重扫”会把已到待收货且标记重扫的订单作为临时 `pending_shipment` 扫描任务，和自动待发货扫描共用 `EXTRACT_PENDING_SHIPMENT_SCAN`。因此本次底层修复同时覆盖自动扫描和批处理重扫；回归测试确认重扫结果会携带 `trackingRescanRequested=true`、配送方式和新单号回写，服务端随后清除重扫标记并更新既有订单及 Google Sheet。

验证：

```powershell
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
node src/server/routes/plugin.test.js
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-18 普通商品同捆被拒绝后恢复逐件交易

普通商品同捆被卖家拒绝后，扫描已能识别“出品者が単品での取引を希望した”并清除整组同捆关系，但重新领取单件订单时，`落札者負担` 分支没有处理拒绝提示框和普通“取引をはじめる”入口，会直接尝试同捆共用的“决定”动作并报 `bundle decide button not found`。现在交易页状态会明确暴露同捆拒绝事实和普通单件入口；交易开始流程优先关闭拒绝提示框、点击 `/buyer/edit` 的“取引をはじめる”，再按原单件运费规则完成信息确认。拒绝事实优先于页面保留的历史“まとめて取引情報”，正常同捆、已等待运费、固定运费和到付快捷入口保持不变。

验证：

```powershell
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-17 等待运费订单取消识别

普通商品处于 `waiting_shipping` 时，Yahoo 页面若显示“落札者削除されたため、取引はできません”，原等待运费扫描只判断运费已确定或继续等待，没有复用现有取消事实识别，因此不会生成状态回写。现在等待运费提取会先在交易生命周期状态区域识别取消；插件仅为 `waiting_shipping` / `pending_shipment` 生成取消 payload，服务端也只允许这两个状态转为 `cancelled`，不会影响同捆、待付款、待收货或已完成订单。状态审计按来源记录为 `scan_waiting_shipping_cancelled` 或既有 `scan_pending_shipment_cancelled`。

验证：

```powershell
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
node src/server/routes/plugin.test.js
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node --check src/server/routes/plugin.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-17 新版普通商品付款入口按钮兼容

Yahoo 新版普通商品取引页将付款入口按钮由“購入手続きする”改为“購入手続きをする”，页面入口同时使用 `/trade/top`，但按钮仍是指向 `/buyer/payment/input?aid=...&oid=...` 的普通链接。插件现在在付款页面状态识别、直接付款链接提取和实际点击中同时兼容新老两种文案；`/buyer/payment/input` 链接校验、普通商品到付分类、金额校验和后续付款流程保持不变。

验证：

```powershell
node --check yahoo-plugin/background.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-16 新版普通商品追踪号未登记时保持待发货

Yahoo 新版普通商品取引页可能已经把 `progressStatus` 标记为 `sellerSendDone`，但“お届け情報”仍显示“追跡番号：未登録（反映されるまでおまちください）”。插件原先会据此进入新版已发货分支，并在真实追踪号为空时把出品者氏名当作追踪号回写。现在只在新版已发货分支增加现有“未登録/反映されるまで”文案保护：命中时继续返回 `pending_shipment`，不执行消息或氏名兜底；老版普通商品、商城和其他订单流程保持不变。

验证：

```powershell
node --check yahoo-plugin/content.js
node yahoo-plugin/content.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-14 Google 表格查询超时不再阻塞确认收货与扫描

生产侧曾出现确认收货 flag 为 1、扫描计数长期停在 `4 / 10`：`/api/plugin/confirm-receipt/jobs` 会为待收货订单逐个查询 Google Sheets 颜色，Google OAuth 或 Sheets API 请求没有超时，外部请求不返回时插件无法完成本轮工作流，也不会回写 `/api/plugin/idle-action/complete`，因此后续扫描计数无法推进。

现在 Google OAuth token 和 Sheets API 请求统一增加 8 秒硬超时，可通过 `GOOGLE_SHEETS_TIMEOUT_MS` 调整（限制为 1-60 秒）。超时错误不再重试，普通网络错误、429 和 5xx 保留原有短暂重试逻辑。确认收货查询遇到超时时立即返回带商品 ID 的 504；插件捕获后调用确认收货状态接口，清除 `confirm_receipt_requested` 并写入具体的 `confirm_receipt_alert_message`，随后正常完成本轮 idle action，使扫描计数继续推进。其他非超时的 Google 表格查询失败也会返回 502 并使用同一错误回写路径，不再静默跳过。

本改动已完成本地验证，尚未部署到生产；部署 API 后还需要 reload 服务器 Chrome 中的扩展。

验证：

```powershell
node src/server/services/googleSheets.test.js
node src/server/routes/plugin.test.js
node yahoo-plugin/background.test.js
node --check src/server/services/googleSheets.js
node --check src/server/routes/plugin.js
node --check yahoo-plugin/background.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-09 后台批处理新增撤销结算

数据批处理新增独立“撤销结算”页签，可按商品 ID 批量撤销尚未付款完成订单的结算。服务端只允许 `pending_payment` / `pending_settlement` 且确有结算数据的订单执行；待发货、待收货、完成或取消等状态会拒绝，避免把已付款订单退回。成功后清空汇率、应付款、结算时间、手续费、含税成交价和用户财务覆盖标记等结算派生字段，并把订单恢复为 `pending_payment`，同时写入 `admin_settlement_rollback` 状态审计日志。

如果当前全局付款失败提示正好属于本次撤销成功的商品，接口会清除该提示并重新开启付款任务，让其他 `pending_settlement` 订单继续执行；被撤销订单因为已恢复为待支付且结算字段为空，不会进入付款队列。后台操作带二次确认，并逐商品显示订单 ID、更新数量和失败原因。

验证：

```powershell
node --check src/server/routes/admin.js
node src/server/routes/admin.orders.test.js
node src/admin/src/SettlementRollback.display.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-06 店铺即决确认重复、并发清理误关 tab 与商品快照降级修复

店铺即决商品完成“ストアからの確認事項”后，Yahoo 返回购买确认页时仍会保留该区域；插件原先再次把它识别为未处理并重复进入修改流程，两轮后报 `buyout store confirmation repeated`。现在后台完成一次确认事项后会向后续 `EXECUTE_BID` 明确传递 `storeConfirmationHandled`，内容脚本据此跳过已完成区域并继续最终购买；如果确认页切换到新 tab，该 tab 也会登记为当前出价任务所有。任务会保存流程涉及的全部 tab，后续等待和错误诊断使用最新活动 tab，成功、失败、超时或重试时统一释放整组 tab，避免新确认页残留或从旧页面误判结果。

扫描和交易工作流的 tab 清理原先会关闭流程开始后出现的任意 Yahoo 购买/交易 tab，可能误关并行出价刚进入的 `buy.auctions.yahoo.co.jp/order/review`。现在两条清理路径都会跳过 `managedTaskTabs` 中的出价 tab，并在候选收集和实际关闭前各检查一次所有权。

插件执行前读取的页面快照只用于刷新动态当前价、标题、图片和结束时间，不再用页面中可能缺少税标记的 `tax_type` / `buyout_price` 覆盖服务器 `products` 权威值；服务端 `/api/plugin/task/:id/snapshot` 同步改为严格字段白名单，即使未 reload 的旧扩展继续发送税型、即决价、入札数、商品类型或运费也会忽略。商品归一化也不再把缺失的 `bid_count` 默认为 `0`，避免部分快照把已有入札数清零。对应服务端写入来源改为 `plugin`，不再误记为 HTTP `fetch`。生产案例 `h1239767133` 的 HTTP 权威结果为税前当前价 `3546円`、含税即决价 `3900円`、`tax_included`、运费 `330円`，确认页合计 `4230円`。

验证：

```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
node src/server/routes/plugin.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-04 商品说明中的“系统错误”不再误判为 Yahoo 错误页

商品 `x1239135207` 的店铺卖家说明包含“システムエラーにより、お取り引きの継続ができなくなります”，Yahoo 同时把该说明写入页面状态脚本的 `sellerMessage`。插件原先虽然排除了 `#description`，但使用克隆页面的 `textContent` 时仍会读取脚本内容，导致在 `execute-start-system-error` 阶段把正常商品页误判为 Yahoo 系统错误。现在出价状态文本会同时排除商品说明容器和 `script/style/noscript/template` 非页面状态内容；真实 Yahoo 错误页的可见错误文案仍照常识别。回归测试覆盖嵌入脚本的卖家说明含“システムエラー”时不报错。

验证：
```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/content.test.js
node yahoo-plugin/content.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-03 付款后取消弹窗识别

普通商品付款后被取消时，Yahoo 旧版取引页可能先显示“取引が中止されました。”弹窗，关闭后才露出“落札者削除されたため、取引はできません”的底层页面。插件现在优先检查可见弹窗：弹窗包含精确的“取引が中止されました。”且带有可见“閉じる”控件时，直接作为取消事实，不点击关闭按钮；“お支払い代金は、全額返金されます。”仅为退款说明，不作为取消判定的必要条件。待发货扫描、付款页和确认收货/取消检查状态均使用该判定，原有“落札者削除”和“キャンセルされました”规则保持不变。

验证：
```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-08-02 普通商品落札者负担到付支付入口兼容

普通商品原始商品快照仍保留 `shipping_fee_text=落札者負担`。交易开始页只有同时出现“落札おめでとうございます。購入手続きを行ってください。”、精确的 `購入手続きをする` 控件且链接指向 `/buyer/payment/input` 时，才认定为特殊到付入口：订单写入 `payment_shipping_mode=cash_on_delivery`、`payment_shipping_fee_jpy=0`，状态进入 `pending_payment`，后续沿用正常付款流程。生产商品 `1238377048` 的真实页面源码确认按钮是带 `/buyer/payment/input` 的标准链接；首次实现把“ございます”的 Unicode 误写成缺少“ご”的“ざいます”，测试数据又复制了同一错字，导致测试通过但生产永远无法命中，现已按真实文案修正测试和判断。其他普通商品的 `落札者負担` 继续进入 `waiting_shipping`，同捆判断优先级不变。有效运费规则对该订单返回 `0円`，但不改写商品原始运费文本。

验证：
```powershell
node src/shared/shippingRules.test.cjs
node src/server/routes/plugin.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-30 Yahoo 新版普通商品发货页兼容

Yahoo 新版普通商品取引页把旧版“出品者から商品発送の連絡がありました。到着したら、受け取り連絡をしてください。”改为“商品が発送されました。到着後、受け取り連絡をしてください。”，并把配送信息改为语义化表格。插件新增仅作用于新版的独立分支，旧版普通商品和商城判断保持不变。新版优先读取 `script#__NEXT_DATA__`：`top.progressStatus = sellerSendDone` 作为已发货事实，`top.tradeInfo.sendInfo.shipMethod.name` 和 `trackingInfo.trackingNumber` 作为物流、追踪号；同时兼容 `props.pageProps.initialState.top` 和 `props.initialState.top` 两条状态树。这样即使新版状态 DOM 的随机 class 改变或正文备用状态被顶部“取引情報”导航截断，仍会提交 `shipped: true` 并把订单从待发货推进到待收货。

新版 DOM 表格解析继续作为备用：按标题为 `お届け情報` 的表格读取 `配送方法` 和 `追跡番号`，不依赖随机 `gv-*` class。追踪号严格按“`お届け情報` / NextData 真实单号 → NextData 聊天正文中的单号 → `top.tradeInfo.sellerInfo.name` → 点击顶部 `情報` 后读取 `出品者情報` 的 `氏名`”顺序回退；聊天只读取 `top.message.messages[].dailyMessages[].body`，不把商品或其他页面文本作为候选。点击 `情報` 后会等待页面渲染，并严格限定标题为 `出品者情報` 的表格，不会误取同页 `お届け情報` 或 `落札者情報` 中的氏名。情報页最终仍未渲染出卖家氏名时不提交空单号，并记录扫描诊断。

新版消息读取也优先利用初始页 `__NEXT_DATA__` 中的 `top.message.messages`，无需为了读取历史消息先点击“メッセージ”；生成的消息 HTML 保留新版标记、发送人、时间、换行和本人消息标记，并对原文做 HTML 转义。只有初始状态没有可识别消息数据时，读取任务才沿用既有流程点击“メッセージ”并等待 DOM。消息发送仍必须点击“メッセージ”，因为输入框和发送按钮只在该标签渲染；发送后优先读取已渲染 DOM，以取得刚发送的最新内容而不是初始 NextData 的旧快照。

验证：

```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-29 普通商品新版同捆入口兼容

Yahoo 普通商品新版取引页取消了旧版“この商品は、まとめて取引ができます”弹窗，并把同捆汇总数量从 `2件（落札数量：2）` 改为 `2件（数量：2）`。插件保留旧版数量和弹窗流程，同时新增新版数量格式识别；交易开始流程会先检测旧版 `閉じる` 按钮，存在时照旧关闭，不存在时直接点击 `まとめて取引をはじめる`。新版入口仍使用 `/jp/auction/{商品ID}` 商品链接及 `/trade/bundle` 同捆链接，现有商品 ID 提取和开始按钮识别继续复用。

同捆申请成功后的新版页面仍显示 `まとめて取引を依頼中です。出品者からの連絡をお待ちください。`，现有完整文案判断可以直接识别，`<br>` 和随机 class 不参与判断。回归测试覆盖新版数量、无弹窗入口，以及旧版先关闭弹窗的原流程。

验证：

```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-29 后台订单管理同捆组扩展为五种淡色

后台订单管理原来只用淡蓝、淡橙两种行背景循环标识当前列表中的不同 `bundle_group_id`，同捆组较多且分散时容易把间隔较远的不同组看成同一组。现在调色板扩展为淡蓝、淡橙、淡绿、淡紫、淡粉五种低饱和背景色，按同捆组在当前列表首次出现的顺序循环分配；同一 `bundle_group_id` 仍始终使用同一颜色。五种颜色均配置了对应的 hover/选中加深色，保证表格交互状态可见。

验证：

```powershell
node src/admin/src/Orders.display.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-29 Yahoo 双向黑名单出价失败文案兼容

Yahoo 黑名单导致出价失败存在两种明确文案：旧版/既有规则“出品者のブラックリストに登録されているため、入札できません”表示买家被卖家加入黑名单；另一种“この出品者はあなたのブラックリストに登録されているため、入札できません”表示该卖家已在当前 Yahoo 账号自己的黑名单中。插件现已同时识别两种文案，旧规则保持不变；两者均稳定返回“失败：卖家黑名单”并关闭任务标签，不再让第二种情况降级为通用 `Yahoo bid access failed`。

验证：

```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/content.test.js
node yahoo-plugin/content.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-29 Yahoo 新版普通商品聊天结构兼容

Yahoo 普通商品交易后台部分页面的聊天区从旧版 `#messagelist` 改为新版标签页和消息卡片：初始只显示“取引”，必须点击顶部“メッセージ”后才渲染聊天；消息正文/发送人/时间使用 `sc-dc9a42c0-*` 组件结构，输入框改为 `textarea[placeholder="入力してください"]`，发送按钮为普通 `type="button"`。插件现已同时识别旧版和新版结构：消息更新和发送共用的页面准备流程会在聊天区尚未渲染时精确点击可用的“メッセージ”标签并等待内容出现，旧版 `#messagelist` 已存在时不会点击；消息页就绪判断支持新版卡片和输入区；读取时复制聊天卡片并移除输入框、按钮等发送控件，保存为带 `data-gdaipai-message-v2` 标记的消息 HTML；发送、trusted-input fallback 和发送后新消息可见性确认均优先限定在新版聊天 section 内，不再依赖全局第一个 textarea。服务端消息 HTML 归一化和后台消息展示同步识别新版标记，原有普通/商城聊天路径保持不变。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node src/server/routes/plugin.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-29 Yahoo 新版普通商品手工付款后待发货文案兼容

Yahoo 普通商品交易后台部分页面改版后，手工付款完成页可能只显示“商品の発送連絡をお待ちください”，不再同时显示旧版的“出品者に支払い完了の連絡をしました”。确认收货工作流中的 `cancel_check` 已新增对该单独状态文案的识别，原有已付款/已发货组合文案判断保持不变。命中新文案后仍沿用原有服务端边界，只允许把 `pending_payment` / `pending_settlement` 推进为 `pending_shipment`，后续继续由扫描流程处理。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-29 Yahoo 新版确认收货完成页文案兼容

Yahoo 交易后台处于新旧页面并行期间，部分普通商品确认收货完成页不再展示旧版的“すべての取引が完了しました / 出品者に受け取り連絡をしました”，而是展示“取引が完了しました！ / 評価がまだの場合は評価をお願いします。 / ご利用ありがとうございました。”三段文案。确认收货完成判定已新增对这组三段文案的识别，原有完成文案规则保持不变；为避免商品说明等区域单独出现“取引が完了しました”时形成误判，新增规则要求三段文案按顺序同时存在。识别成功后沿用现有 `already_completed` / `success` 回写，将普通订单或对应同捆组更新为 `completed`。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-27 运费占位页面不再把标题后的当前价误识别为运费

Yahoo 原始 HTTP 页面中的 `itemPostage` 可能只有骨架占位，浏览器执行脚本后才显示实际运费；该现象不只限于已结束商品。当商品标题含“送料無料 / 送料”时，旧的整页运费回退会从标题中的“送料”开始扫描，并可能把紧随标题后的商品当前价当成运费。例如 `g1238070462` 的旧正则实际命中“送料無料 任天堂 匿名配送 現在 52,000円”，尽管同页结构化数据已经明确为 `chargeForShipping: seller`，接口仍错误返回运费 `52000円`。

修复后，结构化数据明确表示卖家承担运费时直接返回 `無料`；只要页面已有 `itemPostage` 容器或结构化运费责任/输入字段，就不再启用整页回退。数字运费只允许从 `itemPostage` 或 Yahoo 运费接口读取，整页回退不能提供数字金额。确实需要兼容旧页面时，回退文本会排除 `<head>`、`itemTitle` 以及页面中重复出现的商品标题文本，防止标题、商品价进入运费候选。回归测试覆盖 seller 和 winner 两种运费责任、运费 DOM 只有骨架、标题附近当前价为 `52,000円`，以及商品标题在页面其他位置重复出现的边界。

验证：
```powershell
node src/server/routes/proxy.test.js
node scripts/encoding-guard.js
npm run regression
git diff --check
```

### 2026-07-23 Google 表格写入失败重试和后台提醒

Google Sheets 所有请求在遇到网络错误、HTTP 429 或 5xx 时会等待 1 秒后再重试 1 次；其他 4xx 配置或权限错误不自动重试。待收货订单写表最终仍失败时，服务端会在 `config.google_sheet_alerts` 中保存对应主订单的提醒；普通订单显示自身商品 ID，同捆订单只显示触发整组写表的主商品 ID，同一主订单重复失败只保留并更新一条提醒。

后台顶部每 5 秒随现有 idle flags 轮询显示 Google 表格写入失败提醒，内容包括商品 ID 和最终错误；“跳转批处理”会打开“数据批处理”并直接选中“待收货补表格”，其后的 X 图标会从服务端持久化提醒列表中删除该提醒。数据批处理页支持通过 `?tab=receiptSheetBackfill` 精确选择补表标签。

验证：
```powershell
node --check src/server/services/googleSheets.js
node --check src/server/routes/plugin.js
node --check src/server/routes/admin.js
node src/server/services/googleSheets.test.js
node src/server/routes/plugin.test.js
node src/admin/src/AdminLayout.display.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-22 后台消息读取改为查询订单并增加状态筛选

后台菜单和页面标题由“消息读取”改为“查询订单”，路由和原有消息抓取、查看、发送能力保持不变。查询区域在落札时间后新增订单状态下拉，默认查询全部，可按待支付、等待运费、待同捆、同捆完了、待结算、待发货、待收货、完了和取消九种现有状态筛选，并可与用户名、商品 ID、落札时间及分页组合使用。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node src/admin/src/MessageRead.display.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-19 商城即决完成页延迟稳定后关闭出价 Tab

商城即决商品跳转到 `buy.auctions.yahoo.co.jp/order/thank-you` 时，Chrome 可能因页面进入 back/forward cache 连续关闭两次扩展消息通道。第一次断线后的即时检查有时仍停留在购买确认页，原逻辑第二次断线后会直接进入失败处理；等失败诊断读取页面时，Yahoo 完成页其实已经稳定出现，导致任务被误标失败且完成页 tab 残留。

修复：出价异常最终落库前，如果异常属于消息通道关闭，且商城即决 tab 的最终 URL 或页面内容已经明确为购买完成，则按完成事实恢复任务为 `bidding`，关闭受管任务 tab，并跳过 `bid_failure` 假诊断。回归测试覆盖第一次检查仍在 review 页、第二次断线后最终检查才出现 thank-you 页的真实时序，同时把测试商品结束时间更新到未来，确保用例确实执行出价链路。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-18 消息读取列表显示订单追踪号

后台“消息读取”列表在“订单状态”后新增“追踪号”列，直接显示订单 `orders.tracking_number`；没有单号时显示 `-`。消息列表接口同步返回该字段，原有消息抓取、发送和筛选逻辑不变。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node src/admin/src/MessageRead.display.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-14 多次/定时出价达到最高价后停止并限定价格状态范围

商城多次出价商品 `d1237049950` 在 Yahoo 已显示“あなたが最高額入札者です / 自動入札上限 8,000円”，且任务税前最高价也是 `8,000円` 后，旧逻辑仍按“当前价 + 每次加价”计算下一轮，未先判断 Yahoo 自动出价上限已经达到任务上限，因而再次点击入札。修复后，多次出价在商品页检测到当前用户为最高额出价者、且自动出价上限大于等于任务税前最高价时，立即以 `multi-max-already-set` 成功结束本轮并关闭出价 tab，不再点击入札。服务端把“任务最高价已经成功提交/Yahoo 已确认”视为该任务的出价执行结束：只要该任务 `bid_logs` 中最高成功提交价达到 `tasks.max_price`，无论当前是否仍为最高额出价者，都直接从候选 SQL、调度二次检查和最终领取更新中排除，不再为了判断上限反复打开商品页；后台“下一条待执行”也使用同一排除条件，任务列表的“下次执行时间”显示为空，不再随刷新变化。`bidding` 状态继续保留给入札中/被超价/落札监控。作为额外边界，尚无最高价提交记录但当前仍为最高额出价者且商品当前价已达到任务最高价时，也停止派发。例如任务 `166` 当前价 `28,500円`、任务/已提交上限 `29,000円` 时，现在插件候选和后台待执行列表都会直接排除。

结束前 `1min / 2min / 5min / 10min` 策略增加同样的停止边界：执行时如果 Yahoo 已显示当前用户为最高额出价者，且自动出价上限大于等于该定时任务最高价，则以 `timed-max-already-set` 成功结束且不点击出价；如果现有自动上限仍低于任务最高价，则继续按定时任务提高上限。定时任务成功后状态进入 `bidding`，本来就不会像 `multi_bid` 一样被出价队列周期重领。即时拍保持现有显式行为：用户主动新建即时拍时允许再次提交以调整旧自动上限；低价规则创建的后续即时拍也必须能把初始上限提高到用户原最高价。即决流程不使用当前价/含税总额拦截，手动导入不进入出价队列。

多次出价/普通出价的“税込合計金額”读取同时取消整页正文 fallback。现在只允许从当前价格输入框所属的出价表单/确认弹窗、明确的出价 form，或精确“税込合計金額”标签附近的有限祖先区域读取；找不到结构化出价区域就返回 0，不再把推荐商品区的 `9,075円` 当成本商品含税总额。商品当前价仍使用本商品 `pageData`、服务器税前快照和商品主信息区域。“あなたが最高額入札者です / 自動入札上限”也不再从整页正文判断，只读取页面顶部明确状态区域或精确状态文案附近的有限祖先区域，卖家说明和推荐区不参与最高价停止判断。

验证：
```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/content.test.js
node yahoo-plugin/content.test.js
node src/server/routes/plugin.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-14 用户任务列表双击复用再入札

用户端提交任务页内嵌的任务列表支持双击任务中的商品 ID 再次入札。双击后会把该任务的 Yahoo 商品地址自动回填到“商品ID / 商品链接 / 商品名称”输入框，并直接复用提交页现有的商品信息抓取流程展示商品卡片；无需再手动复制商品 ID 或点击“获取商品信息”。标题、价格、状态和任务空白区域不触发此动作；界面不显示双击提示文字。独立任务列表页双击商品 ID 时会跳转到提交页并触发相同流程，“入札中”页原有“再入札”按钮也改为共用同一商品地址/提交地址辅助逻辑。

验证：
```powershell
node src/client/src/pages/TaskList.display.test.mjs
node src/client/src/pages/ActiveBidding.display.test.mjs
node src/client/src/pages/Submit.display.test.mjs
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-14 出价当前价校验限定本商品脚本数据

生产商品 `o1236247041` 的任务最高价为税前 `40,000円`、用户含税上限为 `44,000円`，Yahoo 页面当前价为税前 `38,000円` / 含税 `41,800円`。普通即时拍校验曾直接把页面脚本中的含税当前价 `41,800円` 与税前任务最高价 `40,000円` 比较，导致在点击出价前误报“低于当前价”。

初次修复改成优先读取宽泛可见价格节点后，又在普通商品 `b1193713249` 命中了“相关推荐”商品的 `3,200円`，把本商品实际当前价 `3,000円` 的三条任务错误拦截。最终修复：普通即时拍和定时出价只使用本商品 Yahoo `pageData.items.price` 与服务器税前商品快照做当前价校验，不再使用可能命中推荐卡片的宽泛可见价格选择器；脚本解析改为先遍历整页寻找本商品 `pageData`，找不到后才允许通用解析使用 JSON-LD，避免脚本顺序让商城含税展示价抢先返回。用户含税上限仍由后续含税总额校验独立保护，即决商品和多次出价逻辑不变。

商品信息解析同时按 Yahoo 新版商城/个人商品 DOM 收紧：稳定锚点使用 `#itemTitle`、主信息区域内精确的 `dt=現在/即決`、`#itemPostage`、`#itemStatus` 和 `#bidButtonGroup`，随机 class 不作为边界。服务端和插件都不再从整页正文、任意价格 class、任意 `data-price` 或推荐商品区兜底读取商品当前价/即决价；优先使用本商品 `pageData` / `__NEXT_DATA__`，DOM fallback 也只在从 `#itemTitle` 到状态/按钮的商品主区域内解析。多次出价仅在 Yahoo 已明确显示“需要重新出价”时允许读取出价交互区的价格节点，仍不扫描全文价格。附件中的商城和个人商品 HTML 已分别验证标题、当前价、即决价、税类型、入札数、运费和即决-only 判定。

验证：
```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/content.test.js
node yahoo-plugin/content.test.js
node src/server/routes/proxy.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-13 出价成功判定限定在 Yahoo 完成页

商品页上的商品说明、ストア通知或卖家介绍可能包含“入札しました”或“落札が完了しましたら”等说明性文字。插件不再根据商品详情页初始整页文字判定出价成功；普通出价进入 `/jp/auction/{商品ID}/bid/done` 完成页后，才允许直接根据成功文案或“最高額入札者”判定成功，商城即决仍以 `/order/thank-you` 作为完成事实。对少数不改变 URL 的 Yahoo 页面内更新流程，仅当插件已经点击本轮提交动作、且成功文字在点击前不存在而在点击后新出现时才允许判成功。这样可避免卖家说明中的条件句让插件在点击出价按钮前直接误报 `bidding`。

验证：
```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/content.test.js
node yahoo-plugin/content.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-12 入札页同步增加五分钟整轮超时

插件常规监控抓取 `/my/bidding` 时，除原有单页 30 秒加载等待外，整轮分页同步新增 5 分钟硬超时。网络卡顿或分页长时间无法完成并超过 5 分钟时，本轮入札同步会报错并自动关闭对应 tab；`syncMonitorYahooPages` 的 `finally` 会继续释放 `monitorRunning`，不阻塞下一轮监控重新运行。正常完成时仍按原逻辑抓取全部可见分页，落札页同步逻辑不变。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-12 普通商品同捆状态修复批处理

数据批处理新增“普通商品同捆修复”独立页，用于 Yahoo 端已经成功申请同捆、但系统因落札时间差导致同组订单分别停在 `pending_payment` / `pending_bundle` 的状态错位。管理员按顺序输入多个商品 ID，第一项作为主商品；服务端校验同一用户、普通商品、未结算、允许修复的早期状态和原组无遗漏后，在事务中为整组生成新的 `bundle_group_id`，统一改为 `pending_bundle`，清空旧同捆运费和交易开始错误，并写入 `admin_normal_bundle_repair` 状态审计。

自动交易开始回写也同步硬化：插件已经在 Yahoo 成功提交同捆并回传完整商品 ID 时，允许把同组内提前进入 `pending_payment` / `waiting_shipping` 的订单纠正为 `pending_bundle`，避免以后再次产生同类错位；其他交易开始状态回写仍只更新空状态订单。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node src/server/routes/plugin.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-10 个人商品发送后等待新消息渲染再抓取

个人商品发送消息原本在点击 Yahoo `送信` 后立即进入消息提取；Yahoo 消息列表异步更新较慢时，第二次发送后可能仍抓到发送前的旧列表，例如已显示 `111`，发送 `222` 后自动更新仍只有 `111`。调用顺序虽然是发送后抓取，但缺少发送完成后的页面可见性等待。

修复：个人商品与商城商品一样，发送点击后必须等待本次消息文本出现在 Yahoo 消息区域，确认可见后才执行聊天记录抓取和服务端覆盖。个人商品等待超时会把发送任务标记失败，并保留 pending 抓取任务供下一轮重试，不再用旧消息列表冒充本次自动更新结果。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的个人商品发送后等待回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-10 空订单状态支持消息抓取和发送

刚落札订单在后续订单工作流尚未推进前，`orders.order_status` 可能暂时为空。后台消息读取列表原本会显示这类订单和“消息更新”按钮，但消息抓取/发送共用的服务端校验使用 `NOT IN ('cancelled', 'bundle_completed')`，SQLite 会把空状态排除并返回 `order not found`。

修复：消息抓取和发送现在明确允许 `order_status IS NULL`，仍拒绝 `cancelled` 和 `bundle_completed`；新订单后续状态流转逻辑保持不变。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node --check src/server/routes/admin.js
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-10 消息读取兼容同捆提示页

后台消息读取/发送任务打开 Yahoo 交易页后，会先执行消息专用的安全导航，再提取或发送消息。普通商品遇到“可以同捆”“卖家同意同捆主商品”或“卖家要求单品交易”等同捆提示时，只点击提示区域内精确的 `閉じる`；商城商品遇到“まとめて購入手続き”提示时，先关闭提示，再点击 `単品で購入手続きする` 进入单品页面。导航完成的判定是普通/商城消息列表或商城消息发送区域出现，不会继续点击确认、付款或购买完成按钮。

同捆子商品不单独读取消息：后台继续隐藏 `bundle_completed` 子订单的消息更新入口，服务端也拒绝为这类子订单创建读取或发送任务；如果异常任务打开了带 `この商品を確認する` 的同捆子商品选择页，插件会停止并返回明确错误，不会点击 `まとめて取引を確認する`，也不会跳到主商品会话。消息抓取和消息发送共用相同的前置导航。因为新增了最多 12 秒的同捆导航等待，单个消息任务总超时从 30 秒调整为 45 秒。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node src/server/routes/admin.orders.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的普通同捆关闭、商城两步入口和同捆子商品停止回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-09 商城消息无记录也可打开聊天框

商城交易页消息读取逻辑与普通商品保持同一业务语义：普通商品按 `#messagelist`，商城商品按新版 `section / ul.sc-c46fd2ce-0 / dl / dd / time / textarea` 结构读取。只要 Yahoo 页面存在交易消息/发送区域，就应视为抓取成功，后台时间可点击，弹窗内可继续输入并发送消息；不能因为当前没有历史聊天 `dl` 就返回 `message list not found`。

修复：商城消息提取在未找到 `dl/dd/time` 消息列表时，会继续识别消息区的 `textarea` 和 `#msg button`，返回空消息占位并写入最新更新时间，后台弹窗仍显示发送输入框。提取边界必须限定在 Yahoo 页面 `メッセージ` 下方的聊天/发送区域，不能把上方 `取引情報`、`配送情報`、`購入日時`、`注文番号` 等交易信息容器当作消息内容保存。插件打开交易页后提取消息增加短轮询，最多等待 8 秒，避免商城消息区异步渲染慢时过早写入 `message list not found`。法律链接列表仍不会作为聊天内容保存。

发送边界：普通商品仍按原 `#messagelist`、`#textarea`、`#submitButton` 路径处理；商城商品检测到 `#msg button` 后，只在该按钮附近的消息表单内查找 `textarea`，把后台弹窗输入框内容填入 Yahoo 的 `メッセージを入力してください。` 输入框后点击同一消息表单的 `送信`，避免误填页面其他输入框。普通 JS 提交路径也必须先 `scrollIntoView` + focus textarea，再写入文本并触发 `input/change`，随后 `scrollIntoView` + focus `送信` 按钮再触发 pointer/mouse/click。商城消息区是异步渲染，发送也必须像抓取一样等待消息输入框/发送按钮渲染出来，当前最多轮询 8 秒；发送后不能只因为程序化 click 成功就判定成功，必须在 Yahoo 消息区看到刚发送的文本。若商城 React 页面未接受程序化 click，插件会用 `chrome.debugger` 聚焦 textarea、真实插入文本并真实鼠标点击 `送信` 作为 fallback。发送成功后继续等待消息区渲染并抓取最新聊天内容回写，仍遵守“本次结果覆盖旧消息、不保留旧消息”的规则。

后台显示规则：消息抓取只能由“消息更新”按钮或发送消息动作显式触发，消息列表查询本身不得创建 pending 任务。没有发起过消息抓取的订单，时间列保持 `-`，即使历史脏数据里残留 `fetch_status='failed'` 和 `fetch_error`，服务端也不再把 failed/error 返回给前端；只有存在 `fetch_requested_at`、`fetch_started_at`、消息更新时间或消息内容的真实抓取/消息记录，才显示抓取失败信息。

消息保存规则：每次显式抓取的结果都覆盖旧消息，不保留旧消息。若插件或旧版本误回写了只包含 `取引情報`、`配送情報`、`購入日時`、`注文番号` 等交易信息、但不包含 Yahoo 聊天结构的 HTML，服务端入库时改为空消息占位；后台弹窗渲染历史脏数据时也会隐藏这类交易信息，避免把订单信息当聊天记录展示。真正的商城聊天消息即使正文里包含订单号，只要带 `sc-c46fd2ce-0` / `sc-5ecc53ec` / `dl/dd/time` 等消息结构，仍正常保留。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node src/server/routes/admin.orders.test.js
node src/admin/src/MessageRead.display.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的商城消息空记录和异步渲染回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-09 消息重新抓取不再沿用旧记录

后台消息读取页点击“消息更新”后，线上 `/api/plugin/yahoo-messages/jobs` 和 `/api/plugin/idle-action/next` 均显示当前没有 pending 消息任务；结合代码确认，旧逻辑存在两个问题：一是提交抓取任务时要求 `tasks.status='success'`，但消息列表本身按订单展示，部分已有订单可能因任务状态不是 `success` 而无法排队；二是已有 `message_html` 的订单即使后续抓取失败，前端仍优先显示旧 `message_updated_at`，让用户看到旧时间并误以为没有执行。

修复：消息抓取请求现在只要求订单存在且订单未取消，不再依赖 `tasks.status='success'`。每次提交抓取任务时会清空旧 `message_html` 和 `updated_at`，确保后续只显示本次最新抓取结果；如果本次失败，消息读取页显示失败信息，不再显示旧聊天记录或旧更新时间。普通/商城消息的实际页面抓取逻辑不变，仍由插件领取 pending 任务后打开 Yahoo 交易页提取。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node src/admin/src/MessageRead.display.test.js
node --check src/server/routes/admin.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-09 订单结算和付款队列拆分

后台订单管理的“结算”和“支付”现在拆成两个明确步骤。点击“结算”只按当前公式写入汇率、手续费、含税成交价、应付款和 `settled_at`，不再修改 `orders.order_status`，因此不会因为批量结算就把订单自动送进插件付款队列。

点击“支付”时，只把本次勾选且已经结算、有应付款的 `pending_payment` 或既有 `pending_settlement` 订单改为 `pending_settlement`，并设置 `payment_requested=1`。`bundle_completed` 子商品和 `pending_shipment` 不会被重新提交付款；同捆子商品保持 `bundle_completed`，由插件付款 job 作为同组金额汇总的一部分计入主商品付款，避免生成重复付款任务。插件付款任务仍只读取 `pending_settlement + total_amount_cny` 的订单；因此 `pending_settlement` 现在表示“已明确提交到付款队列”。

前端边界：状态不变后，已结算的 `pending_payment`、`bundle_completed`、`pending_shipment`、`pending_settlement` 订单仍允许重新结算，方便汇率或费用输错后重算。结算成功后会同步刷新已选行缓存里的 `settled_at` 和 `payable_cny`，避免跨页自动选中的订单在马上点击“支付”时仍使用结算前缓存而误判未结算。

验证：
```powershell
node src/server/routes/admin.orders.test.js
node src/admin/src/Orders.display.test.js
node --check src/server/routes/admin.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-09 商城消息抓取跳过法律链接列表

商城新版交易页消息区使用 `ul.sc-c46fd2ce-0` 包裹 `dl/dt/dd/time` 消息节点。部分页面其他位置也可能出现相同 class 的链接列表，例如“特定商取引法の表示 / ストア出店について”，旧消息抓取只取第一个 `ul.sc-c46fd2ce-0`，可能把法律链接当作聊天记录入库。

修复：插件消息抓取不再只按 class 取第一个 `ul`，而是遍历候选 `ul.sc-c46fd2ce-0` 和 `section ul`，必须同时包含 `dl` 和 `dd`，并带 `time` 或消息语义文本，才作为商城消息列表。普通商品 `#messagelist` 逻辑保持不变。后续复查确认宽泛 fallback 中保留裸 `ul` 仍可能在商城消息未命中时把法律链接保存为消息，因此 fallback 已移除裸 `ul`，只保留旧兼容的 `.acMdMsgForm` / message class/id 容器。实测附件页面 `o1235669264` 和禁发消息页面 `m1236007410` 都只有有效商城消息候选，且包含 `dl/dd/time`，不会抓到法律链接。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的商城消息抓取回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-09 出价超时失败前只重试一次

商品任务出价偶发超时或出价确认阶段超时失败时，插件现在不会立刻把任务回写为 `failed`。首次命中 timeout 型出价失败时，会先关闭当前出价 tab，再重新打开商品页把同一个任务重新执行一次；重试时沿用已领取任务，不重新占用出价池槽位。第二次如果仍然超时，或出现其他非可重试问题，则继续按原逻辑记录 diagnostics 并回写 `failed`。

边界：只对 timeout 型出价失败触发一次重试；价格超过上限、已结束、普通业务失败等不扩大重试范围。已有 transient server tab error 的一次重试逻辑保持不变。

验证：
```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的两条出价超时重试回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-09 确认收货/交易开始/待发货扫描改用主状态区

生产商品 `q1235534082` 的 Yahoo 商城交易页主状态仍是 `落札おめでとうございます。購入手続きを行ってください。`，但卖家消息里包含“期限后会落札者削除/取引はできません”一类说明文字，确认收货 `cancel_check` 曾从 `pending_payment` 误推进到 `cancelled`。同类全文关键词风险也存在于交易开始状态判断和待发货扫描。

修复：这三条路径的生命周期状态改为优先读取 Yahoo 固定状态区。普通商品读 `.acMdStatusCmt .elAdvnc p.fntB`，商城商品读 `main header p.sc-5968173-0`，并兼容 `#pap` 购买按钮附近的主状态段。交易开始的 `cancelled`、待发货扫描的 `cancelled/shipped/pending_shipment`、确认收货 `cancel_check` 的 `cancelled/paidOrShipped/complete` 都基于主状态区判断；物流公司、单号等详情仍按原来的结构化配送/消息区域提取。

验证：
```powershell
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.test.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的状态区回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-09 付款页状态改为结构化节点判断

生产商品 `q1235534082` 在 Yahoo 商城购买状态页仍显示 `落札おめでとうございます。購入手続きを行ってください。`，但系统订单被写成 `cancelled`。生产 debug 确认订单 `512` 从 `pending_settlement` 变为 `cancelled`，来源为 `payment_cancelled_page`；页面卖家消息中包含“期限后会落札者削除/取引はできません”一类说明文字，原付款页状态判断扫全文，容易把消息内容误当订单状态。

修复：`yahoo-plugin/background.js` 的付款页状态优先读取主状态结构，不再用整页正文判断取消/已付款/完成。商城商品从 `main header p.sc-5968173-0` 或 `#pap` 购买按钮前的主状态段落读取，例如 `落札おめでとうございます。購入手続きを行ってください。`；普通商品从 `.acMdStatusCmt .elAdvnc p.fntB` 读取，例如 `出品者に支払い完了の連絡をしました。` + `商品の発送連絡をお待ちください。`。卖家消息、交易说明和帮助文案不再参与付款状态关键词判断；同时 `取引はできません` 不再作为单独全文取消关键词，必须依附真实取消状态文案。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增的结构化状态回归，后续仍停在既有 `testBuyoutMessageChannelClosedOnThankYouStaysBidding` 失败。

### 2026-07-08 用户端生产服务不再使用 Vite dev

生产用户端偶发黑色错误 overlay，页面显示 `URI malformed`，栈指向 `C:/www/g-daipai/src/client/node_modules/vite/.../viteTransformMiddleware`。复现确认生产 `http://43.165.177.49:3035` 对外运行的是 Vite dev server，访问 `/%`、`/%E0%A4%A`、`/foo%ZZbar` 这类非法百分号编码路径会触发 Vite 内部 `decodeURI(req.url)` 抛错，并把开发错误页/overlay 暴露给用户。

修复：新增 `scripts/serve-client-dist.js`，用于生产服务 `src/client/dist` 静态构建产物；该服务先识别 malformed URL，页面导航类 GET/HEAD 请求回退到 SPA 首页，静态资源/API 这类非页面请求才返回普通 400，不再触发 Vite overlay。服务继续把 `/api` 代理到 `http://localhost:3034`，并做 SPA fallback。`start.bat` 已改为启动时先 `npm run build --prefix src/client`，再用静态服务占用原 `3035` 端口，不再执行 `npm run dev -- --host 0.0.0.0`。生产更新后需要重新运行 `start.bat`，确认 `http://43.165.177.49:3035/` 返回的 HTML 不再包含 `/@vite/client` 或 React Refresh。

验证：

```powershell
node scripts/serve-client-dist.test.js
node --check scripts/serve-client-dist.js
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-07 普通商品物流公司限定在お届け情報表格

生产商品 `v1235406927` 扫描物流时单号已正确提取为 `193398193940`，订单也推进到 `pending_receipt`，但 `shipping_company` 被写成了 `お荷物検索URL：`。这类值不是配送公司，而是 Yahoo 页面中的物流查询 URL 标签，不能写入系统和 Google Sheet。

修复：普通商品已发货扫描时，`shippingCompany` 只从 `.acMdPaymentInfo` 的 `お届け情報` 表格中读取 `配送方法`，不再从全文或页面其他区域提取配送方式，避免把 `お荷物検索URL` 等标签当作物流公司。该区域可能异步渲染；如果 `.acMdPaymentInfo` 的 `お届け情報` 尚未出现，content script 返回 `shipmentDetailsRendered=false`，background 不回写扫描结果并继续等待。商城商品的 `shippingCompany` 只从交易信息中的 `配送情報` section 读取 `配送業者`；商城单号 `trackingNumber` 仍保持原来的标签提取逻辑，不改成 section-only。服务端 `/api/plugin/scan/status` 仍保留入库前清洗，防止异常 payload 污染 `orders.shipping_company`；同时清掉异常 payload 里残留的 `配送方法` / `配送業者` 前缀，例如 `配送方法 ゆうパック` 入库为 `ゆうパック`。已有订单 `v1235406927` 的单号正确，但历史 `shipping_company` 需要重扫或手动修正才会更新。

验证：

```powershell
node yahoo-plugin/content.test.js
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node src/server/routes/plugin.test.js
node --check src/server/routes/plugin.js
```

### 2026-07-07 扫描单号避免出品者情报 fallback 误写

生产商品 `h1035084506` 已有 `お問い合わせ番号 646560590686`，但订单 `389` 在 `2026-07-06 17:18:19` 扫描时写入了出品者情报中的姓名作为 `tracking_number`，并推进到 `pending_receipt`。排查确认不是后台展示问题：`/api/debug/product/h1035084506` 的订单日志显示 `scan_pending_shipment_shipped` 写入了姓名形态的 trackingNumber；根因是 `content.js` 在未提取到真实单号时会返回 `trackingFallback=seller_info_name/seller_name/store_info_name`，而 `background.js` 的待发货扫描等待逻辑把任何 `type=shipped` 都当作渲染完成，导致页面异步渲染未完全出现单号区域时过早提交 fallback。

修复：待发货扫描结果新增 `shipmentDetailsRendered` 渲染完成信号。带 `trackingFallback` 且配送/消息区域尚未渲染完成的 `shipped` 结果不再视为完成，继续轮询等待真实单号；配送/消息区域已渲染完成后仍没有真实单号时，保留原逻辑允许使用出品者情报/店铺名 fallback。后续复查确认只出现 `配送方法` 不能代表单号区域完成，且 `h1035084506` 商品标题里的 `追跡番号有` 会污染全页文本判断；普通交易页 fallback 的渲染完成信号改为只看配送信息片段里的 `お届け情報`、`配送状況`、`伝票番号`、非标题语义的 `追跡番号`、`お問い合わせ番号` 或消息列表。同时 `お問い合わせ<br>番号` 这类换行标签在 text-only 路径中现在可识别。新增普通商品先读到未渲染 fallback、后读到真实单号，渲染完成后 fallback 可提交，只有配送方式不算完成，商品标题 `追跡番号有` 不算完成，以及换行 `お問い合わせ 番号` 标签提取的回归。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
```

注意：完整 `node yahoo-plugin/background.test.js` 本次新增扫描回归已在后续失败前执行通过；当前完整测试仍会在既有 `testBuyoutStoreConfirmationCompletesBeforeFinalPurchase` 失败。

### 2026-07-07 普通落札者负担交易确认页等待

生产商品 `f1235464179` 交易开始报 `bundle confirm next page did not appear`。排查确认商品本身是普通 `normal`、运费 `落札者負担`，不是同捆；错误文案中的 `bundle` 来自普通交易和同捆流程复用的按钮点击工具，不代表业务上进入了同捆。失败点在普通交易 `buyer/preview` 最后点击 `確定する` 后，Yahoo 页面仍处于异步渲染/处理中，原来最终 `confirm` 只等待 5 秒，可能过早判定下一状态没有出现。

修复：交易按钮工具的 `confirm` 动作等待窗口从 5 秒延长到 15 秒，与 `start` 的长等待一致；其他中间动作仍保持 5 秒，避免扩大普通步骤等待。新增普通 `落札者負担` 预览页渲染延迟回归。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 本次新增普通确认页等待回归已在后续失败前执行通过；当前完整测试仍会在既有 `testBuyoutStoreConfirmationCompletesBeforeFinalPurchase` 失败。

### 2026-07-06 确认收货完成文案兼容

生产商品 `t1235313146` 确认收货失败，后台提示 `receipt completion text not found`。排查确认订单仍是 `pending_receipt`，商品类型为普通 `normal`，交易 URL、物流单号和前序付款/扫描状态正常；失败点在插件点击 `受け取り連絡` 后只等待 `すべての取引が完了しました` 这一种完成文案。Yahoo 完成页还可能只展示 `出品者に受け取り連絡をしました。`、`受け取り連絡が完了しました` 等明确完成文案，原判定过窄会导致实际已完成但插件未识别。

修复：确认收货完成状态新增 `出品者に受け取り連絡をしました`、`受取連絡が完了しました`、`全ての取引が完了しました` 等明确完成文案识别；不会把待发货/待收货提示文案当完成。普通确认收货路径打开交易页后也改为先等待交易页主体或收货控件渲染完成，再检查取消/完成状态和执行勾选、点击，避免 tab `complete` 后页面内容仍在异步渲染时过早判断。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
```

注意：完整 `node yahoo-plugin/background.test.js` 已通过本次新增确认收货回归，后续仍停在既有 `testBuyoutStoreConfirmationCompletesBeforeFinalPurchase`。

### 2026-07-06 用户端前台汇率独立配置

用户端提交页人民币/日元换算汇率现在独立于后台订单结算汇率。前台汇率只用于用户端展示和人民币输入换算，最终提交给任务/插件的仍是日元；它不参与订单结算、应付款、财务费用或特殊用户结算汇率。

后台“特殊用户设置”菜单进入后以分页面展示“特殊用户设置”和“用户端汇率设置”。用户端汇率基准汇率按 `BOC 日元现钞卖出价 / 100 + 全局调节` 计算，默认全局调节保持原先 `+0.002`；可为单个用户再设置用户调节，最终用户端汇率为 `基准汇率 + 用户调节`。没有单独设置的用户使用基准汇率。服务端只缓存 BOC 原始汇率，最终汇率按当前代操作用户动态计算；前台 localStorage 汇率缓存也按 acting user 隔离。

验证：

```powershell
node src/server/routes/task.test.js
node src/admin/src/AdminLayout.display.test.js
node src/admin/src/SpecialUserSettings.display.test.js
node src/admin/src/ClientRateSettings.display.test.js
node --check src/server/services/websiteRate.js
node --check src/server/routes/task.js
node --check src/server/routes/admin.js
npm run build --prefix src/admin
npm run build --prefix src/client
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-05 确认收货 cancel_check 等待状态文案渲染

确认收货流程中，`pending_payment` / `pending_settlement` 订单会作为 `cancel_check` 打开 Yahoo 交易页，同时检查取消状态和已付款/已发货状态。Yahoo 新版交易页可能在 tab `complete` 后才异步渲染强状态文案，原逻辑只读一次正文，可能先读到普通占位/非状态文案后直接跳过，导致后面出现的正确状态不再判断。

修复：`cancel_check` 打开交易页后，最多等待 8 秒、每 500ms 重新读取页面正文；等待目标不是某几段状态文案本身，而是交易页业务区域已渲染，例如 `取引ナビ` 的 `購入 / お支払い / 発送連絡` 步骤和 `取引情報` 等主体内容已经出现。页面渲染完成后再判断取消文案或以下任一已付款/已发货文案：`ご購入ありがとうございます。` + `商品の発送連絡をお待ちください。`、`出品者に支払い完了の連絡をしました。` + `商品の発送連絡をお待ちください。`、`商品が発送されました。` + `到着までお待ちください。`、`出品者から商品発送の連絡がありました。` + `到着したら、受け取り連絡をしてください。`。命中已付款/已发货时仍只把 `pending_payment` / `pending_settlement` 推进到 `pending_shipment`；其他已渲染状态不更新状态，直接跳过本次 `cancel_check`。

验证：

```powershell
node src/server/routes/plugin.test.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 本次确认收货新增回归已在后续失败前执行通过；当前完整测试会停在既有/其他路径 `testBuyoutStoreConfirmationCompletesBeforeFinalPurchase`。

### 2026-07-05 商城即决确认事项复用付款流程

商城即决商品在 `buy.auctions.yahoo.co.jp/order/review` 页面出现 `ストアからの確認事項` 时，原即决出价流程没有处理确认事项，可能停在 review/change/store-options 页面直到任务响应超时。现在仅当任务同时满足 `bid_mode=buyout` 且 `product_type=store` 时，`content.js` 才会在即决路径识别 `#cartopt` 的 `ストアからの確認事項` + `変更` 并返回 `buyout-store-confirmation-required`；`background.js` 再次校验商城即决边界后，复用付款流程已有的 `completeStoreConfirmationItems()`，点击 `変更`、等待编辑页、JS 勾选所有确认框、点击 `変更する` 回到 review 页后，再继续原来的即决确认/购买完成判断。普通出价、普通即决和订单付款工作流不进入该新增分支。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/content.test.js
node scripts/encoding-guard.js
git diff --check
```

注意：完整 `node yahoo-plugin/background.test.js` 新增回归 `testBuyoutStoreConfirmationCompletesBeforeFinalPurchase` 已在既有失败前执行通过；当前完整测试仍会在既有 `testExecuteBidTaskRetriesTransientServerTabErrorOnce` 失败。

### 2026-07-04 订单管理备注与 Google 表格备注列

后台订单管理新增订单备注：双击商品名称可打开备注弹窗，保存后只更新系统数据库 `orders.order_remark`，不会立即同步 Google 表格。有备注的订单在商品 ID 的 `普/商` 标识后显示 `备`，备注内容不作为订单表格列展示。

Google 表格同步在原有“追加待收货订单”和“重扫/更新物流单号”流程中顺带写入备注。表格在 `J 单号` 后使用 `K 备注`；如果检测到现有 K 列已有人工 tag 数据，会先在 K 位置插入新列，把原 K 列右移到 L，再写入 `备注` 表头，避免覆盖现有 tag。备注保存本身不触发 Google 写入。

验证：

```powershell
node src/server/services/googleSheets.test.js
node src/server/routes/admin.orders.test.js
node src/server/routes/plugin.test.js
node src/admin/src/Orders.display.test.js
node --check src/server/routes/admin.js
node --check src/server/routes/plugin.js
node --check src/server/services/googleSheets.js
node --check src/server/models/index.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

### 2026-07-03 入札页全分页同步

入札中监控原先只抓取 `/my/bidding` 第一页。Yahoo 入札页分页使用 `次へ` 链接，例如 `/my/bidding?page=2`，当入札中商品超过第一页时，后续页商品不会进入 `/api/plugin/bidding/sync`，并可能因服务端先将旧 `bidding_items` 标记为 `stale` 而显示为过期。

修复：`content.js` 新增入札页下一页链接识别，支持 Yahoo pagination 的 `data-cl-params="_cl_vmodule:pagination;_cl_link:next;..."`、`rel=next` 和 `次へ/next` 文案；`background.js` 的入札监控在同一 tab 内最多翻 50 页，按商品 ID 去重汇总后一次性同步给服务端，避免分页同步时误 stale。

验证：

```powershell
node yahoo-plugin/content.test.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
node scripts/encoding-guard.js
```

注意：完整 `node yahoo-plugin/background.test.js` 仍会在既有 `testExecuteBidTaskRetriesTransientServerTabErrorOnce` 失败；本次新增入札翻页回归 `testMonitorSyncCollectsAllBiddingPagesBeforeSync` 在该既有失败前已执行通过。

### 2026-07-02 确认收货流程同步手动付款状态

部分普通/商城订单在 Yahoo 后台手动支付后，系统订单仍停留在 `pending_payment` 或 `pending_settlement`。确认收货流程的 `cancel_check` 现在除检查取消页外，还会识别交易页前两行强状态文案：`ご購入ありがとうございます。` + `商品の発送連絡をお待ちください。`、`出品者に支払い完了の連絡をしました。` + `商品の発送連絡をお待ちください。`、`商品が発送されました。` + `到着までお待ちください。`、`出品者から商品発送の連絡がありました。` + `到着したら、受け取り連絡をしてください。`。

修复：`pending_payment` / `pending_settlement` 的 `cancel_check` 命中上述已付款或已发货文案时，服务端只允许把订单推进到 `pending_shipment`，后续仍交给扫描流程推进到 `pending_receipt`。取消文案优先级仍高于已付款/已发货判断。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node --check src/server/routes/plugin.js
node --check src/server/routes/plugin.test.js
node src/server/routes/plugin.test.js
node scripts/encoding-guard.js
```

注意：完整 `node yahoo-plugin/background.test.js` 仍会在既有 `testExecuteBidTaskRetriesTransientServerTabErrorOnce` 失败；本次新增确认收货回归在该既有失败前已执行通过。

### 2026-07-02 ストア但税 0 商品落札同步

生产商品 `1234843296` 的落札页带 `ストア` 标识，但商品页/前台税判断表现为普通税 0 商品。系统原先按 `product_type=normal` 进入普通付款流程，打开 `buy.auctions.yahoo.co.jp/order/status?...` 后找不到普通付款入口按钮，报 `payment entry button not found`。

修复：`/my/won` 落札页同步现在识别行内 `ストア` 标识并透传 `productType=store`；服务端 `/api/plugin/orders/sync` 只把 `products.product_type` 补正为 `store`，不改 `tax_type`。手动“落札商品更新”批处理保留落札页 `store` 类型，但商品页快照缺少税类型时默认 `tax_zero`，避免把税 0 ストア误补成 `tax_included`。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
node --check src/server/routes/plugin.js
node yahoo-plugin/content.test.js
node src/server/routes/plugin.test.js
```

注意：完整 `node yahoo-plugin/background.test.js` 仍会在既有 `testExecuteBidTaskRetriesTransientServerTabErrorOnce` 失败；本次已通过语法检查，未把该既有失败作为本次变更阻塞。

### 2026-07-01 即决购买完成页消息断开兜底

生产商品 `x1235487667` 已进入 Yahoo `buy.auctions.yahoo.co.jp/order/thank-you?auctionId=...`，页面显示 `購入が完了しました`，但插件在 `execute-bid` 阶段收到 Chrome `back/forward cache` / message channel closed 错误，误把任务标为 `failed`。由于 `/api/plugin/orders/sync` 只匹配 `bidding/success` 任务，后续 `/my/won` 同步也跳过该商品，订单管理没有生成订单。

修复：即决 `buyout` 任务在 `EXECUTE_BID` 消息通道断开时，会先读取当前 tab；如果 URL 或正文已经是 Yahoo 购买完成页，则按 `buyout-final-pending-waiting-for-won-sync` 处理，任务保持 `bidding` 等待落札同步，不再写 `failed`。

验证：

```powershell
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node yahoo-plugin/background.test.js
node scripts/encoding-guard.js
```

注意：当前完整 `node yahoo-plugin/background.test.js` 会在既有 `testExecuteBidTaskRetriesTransientServerTabErrorOnce` 停住；本次新增回归已前置执行并通过，日志会显示任务 `907` 保持 `bidding`。

### 2026-06-24 付款配送変更优先 JS click

普通商品多配送方式付款页的 `変更する` 现在优先用页面内 JS click，只有 JS 找不到/点不到时才 fallback 到 `chrome.debugger` 鼠标事件，避免正常多运费展开先走真实输入。

验证：

```powershell
node yahoo-plugin/background.test.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/background.test.js
node scripts/encoding-guard.js
```

### 2026-06-24 用户侧只读购买页面

用户 `落札商品` 完成状态显示 `购买页面`，跳转到本地只读 Yahoo 风格 `取引ナビ` 页面。该页面只使用路由 state，不额外请求 API，不影响普通 `落札商品` 页面加载速度。

验证：

```powershell
node src/server/routes/task.test.js
node src/client/src/pages/WonItems.display.test.mjs
node src/client/src/pages/PurchasePage.display.test.mjs
npm run build --prefix src/client
node scripts/encoding-guard.js
```

### 2026-06-23 出价 tab complete race 与失败诊断

修复 `chrome.tabs.create()` 已返回 `status: complete` 时仍等待未来 `onUpdated` 事件导致任务超时的问题。出价失败现在记录阶段、URL、标题、正文片段等 diagnostics，后台 Reports 可查询出价失败聚合。

验证：

```powershell
node yahoo-plugin/background.test.js
node src/server/routes/plugin.test.js
node src/server/routes/admin.orders.test.js
node scripts/encoding-guard.js
```

### 2026-06-23 手动导入和付款/商城确认稳定性

- `manual_import` 用户侧显示为 `导入`。
- 手动导入独立为 `manual_order_import` idle action，不再伪装成 scan。
- 商城付款确认事项和普通付款配送 `変更する` 逻辑多次修正，当前原则是能 JS click 的优先 JS click，必要时才走真实输入 fallback；部分商城确认编辑页明确要求 JS click-only。

### 2026-06-22 三表模型删字段准备

fresh schema 已不再创建旧 `tasks` 商品快照字段，脚本也已改为检查 `products` 健康和关系完整性。但生产旧库还没有直接删字段，后续必须按“当前主计划”完成 payload 边界硬化和迁移验证。

验证：

```powershell
node scripts/check-product-parity.test.js
node scripts/check-product-health.test.js
node scripts/check-product-read-paths.test.js
node scripts/check-product-read-paths.js
node scripts/check-product-parity.js
node scripts/check-product-health.js
npm run regression
```

---

## 常用验证命令

共用验证界面与其他登录方式前置（0ap）：

```bash
node yahoo-plugin/alternativeLogin.test.js
node yahoo-plugin/emailVerification.test.js
node yahoo-plugin/background.test.js
node yahoo-plugin/multiAccount.test.js
node src/server/services/manualCaptcha.test.js
node src/admin/src/manualVerificationState.test.js
node src/admin/src/AdminLayout.display.test.js
node src/admin/src/MessageRead.display.test.js
npm run build --prefix src/admin
node scripts/yahoo-multi-account-browser.test.cjs
node --check yahoo-plugin/background.js
node yahoo-plugin/encoding.test.js
node scripts/encoding-guard.js
git diff --check
```

普通即时拍已有最高上限识别（0ao）：

```bash
node yahoo-plugin/content.test.js
node yahoo-plugin/background.test.js
node --check yahoo-plugin/content.js
node yahoo-plugin/encoding.test.js
node scripts/encoding-guard.js
git diff --check
```

邮箱回跳与连续PIN验证（0an）：

```bash
node yahoo-plugin/emailVerification.test.js
node yahoo-plugin/background.test.js
node yahoo-plugin/multiAccount.test.js
node src/server/services/manualCaptcha.test.js
node src/admin/src/manualVerificationState.test.js
node src/admin/src/AdminLayout.display.test.js
npm run build --prefix src/admin
node --check yahoo-plugin/background.js
node yahoo-plugin/encoding.test.js
node scripts/encoding-guard.js
git diff --check
```

P交易消息读取／发送：

```powershell
node yahoo-plugin/fleamarketMessages.test.js
node scripts/run-isolated-regression.cjs src/server/routes/yahooMessages.test.js
node yahoo-plugin/background.test.js
node yahoo-plugin/fleamarketTrade.test.js
node yahoo-plugin/multiAccount.test.js
node scripts/encoding-guard.js
git diff --check
```

批量订单状态更新：

```powershell
node scripts/run-isolated-regression.cjs src/server/routes/admin.orderStatusRefresh.test.js
node scripts/run-isolated-regression.cjs src/server/routes/admin.orders.test.js
npm run build --prefix src/admin
node scripts/encoding-guard.js
git diff --check
```

邮箱验证与原 PIN 流程交接：

```powershell
node yahoo-plugin/emailVerification.test.js
node yahoo-plugin/background.test.js
node yahoo-plugin/multiAccount.test.js
node yahoo-plugin/encoding.test.js
node --check yahoo-plugin/background.js
```

商品名称搜索（新版兼容专项及原详情／运费回归）：

```powershell
node scripts/run-isolated-regression.cjs src/server/routes/proxy.test.js
node src/client/src/components/ProductSearchPopup.display.test.mjs
node src/client/src/utils/api.product-info.test.mjs
node src/client/src/pages/Submit.display.test.mjs
node --check src/server/routes/proxy.js
node scripts/encoding-guard.js
git diff --check
```

插件：

```powershell
node yahoo-plugin/background.test.js
node yahoo-plugin/content.test.js
node yahoo-plugin/encoding.test.js
node --check yahoo-plugin/background.js
node --check yahoo-plugin/content.js
```

服务端：

```powershell
node src/server/routes/task.test.js
node src/server/routes/plugin.test.js
node src/server/routes/admin.orders.test.js
node src/server/routes/debug.test.js
node --check src/server/routes/task.js
node --check src/server/routes/plugin.js
node --check src/server/routes/admin.js
```

三表模型：

```powershell
node scripts/check-product-read-paths.js
node scripts/check-product-health.js
node scripts/check-product-parity.js
```

前端/后台：

```powershell
npm run build --prefix src/client
npm run build --prefix src/admin
```

全局：

```powershell
node scripts/encoding-guard.js
npm run regression
git diff --check
```

---

## 暂缓事项

- Android App 方案仅作为后续方向：WebView 加载现有客户端，Android 原生 Bridge 用用户手机网络抓 Yahoo 商品页，再回传给 Web。当前不列为主线。
- 维护性重构计划可后续推进，但不要插在三表删字段前制造额外读路径变化。
