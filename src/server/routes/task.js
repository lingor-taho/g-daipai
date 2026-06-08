const express = require('express');
const router = express.Router();
const db = require('../models');
const authMiddleware = require('../middleware/auth');
const { productService } = require('./proxy');
const { actingUserMiddleware } = require('../services/actingUser');
const { getWebsiteRate } = require('../services/websiteRate');
const { DEFAULT_MULTI_BID_MIN_PRICE, shouldSplitDirectBidByYahooLowPriceRule, YAHOO_LOW_PRICE_INITIAL_BID } = require('./plugin');
const { getCaptchaChallenge } = require('../services/manualCaptcha');
router.use(authMiddleware);
router.use(actingUserMiddleware);

/**
 * 从任意 URL 中提取 Yahoo Auction ID
 * 格式: https://auctions.yahoo.co.jp/jp/auction/u1192398549
 * 商品 ID 正则: [a-zA-Z]?\d{8,10}
 */
function extractAuctionId(input) {
  const match = String(input || '').match(/[a-zA-Z]?\d{8,10}/);
  if (!match) throw new Error('无法从 URL 中提取商品 ID');
  return match[0].toLowerCase();
}

function buildSubmitTaskInput(user, body) {
  if (!user?.id) throw new Error('not logged in');
  const { product_url, max_price, bid_mode, buyout_only } = body;
  if (!product_url || !max_price) {
    const error = new Error('product_url, max_price are required');
    error.statusCode = 400;
    throw error;
  }

  const productId = extractAuctionId(product_url);
  return {
    userId: user.id,
    productId,
    standardUrl: `https://auctions.yahoo.co.jp/jp/auction/${productId}`,
    maxPrice: parseInt(max_price, 10),
    bidMode: bid_mode === 'buyout' || buyout_only === true || buyout_only === 'true' ? 'buyout' : 'bid'
  };
}

function normalizeTaxType(value) {
  return value === 'tax_included' ? 'tax_included' : 'tax_zero';
}

function normalizeProductType(value, taxType) {
  if (value === 'store' || value === 'normal') return value;
  return normalizeTaxType(taxType) === 'tax_included' ? 'store' : 'normal';
}

function calculateBidMaxPrice(userMaxPrice, taxType) {
  const value = Number(userMaxPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (normalizeTaxType(taxType) !== 'tax_included' || value < 10) return Math.floor(value);
  return Math.floor(((value / 1.1) + 1e-6) / 10) * 10;
}

function getTaxIncludedPrice(price, taxType) {
  const value = Number(price || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (normalizeTaxType(taxType) !== 'tax_included' || value < 10) return Math.floor(value);
  return Math.floor(value * 1.1);
}

function resolveBuyoutTaskPrices({ fetchedBuyoutPrice, submittedBuyoutPrice, inputMaxPrice, taxType }) {
  const resolvedTaxType = normalizeTaxType(taxType);
  const value = Number(fetchedBuyoutPrice || submittedBuyoutPrice || inputMaxPrice || 0);
  if (!Number.isFinite(value) || value <= 0) {
    return { buyoutPrice: 0, userMaxPrice: 0, bidMaxPrice: 0 };
  }
  const buyoutPrice = Math.floor(value);
  if (resolvedTaxType === 'tax_included') {
    return {
      buyoutPrice,
      userMaxPrice: buyoutPrice,
      bidMaxPrice: calculateBidMaxPrice(buyoutPrice, resolvedTaxType)
    };
  }
  return {
    buyoutPrice,
    userMaxPrice: buyoutPrice,
    bidMaxPrice: buyoutPrice
  };
}

async function getMultiBidMinPrice(database = db) {
  const row = await database.getOne("SELECT value FROM config WHERE key = 'multi_bid_min_price'");
  const value = Number(row?.value || DEFAULT_MULTI_BID_MIN_PRICE);
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : DEFAULT_MULTI_BID_MIN_PRICE;
}

function validateMultiBidUserMaxPrice(strategy, userMaxPrice, minPrice = DEFAULT_MULTI_BID_MIN_PRICE) {
  if (strategy !== 'multi_bid') return;
  const minimum = Number(minPrice || DEFAULT_MULTI_BID_MIN_PRICE);
  if (Number(userMaxPrice || 0) < minimum) {
    const error = new Error(`多次出价最高价不能低于${minimum}円`);
    error.statusCode = 400;
    throw error;
  }
}

function getMinMultiBidIncrement(userMaxPrice) {
  const value = Number(userMaxPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1000) return 10;
  if (value < 5000) return 100;
  if (value < 10000) return 250;
  if (value < 50000) return 500;
  return 1000;
}

function getRequiredBidMaxPrice(currentPrice, bidCount) {
  const current = Number(currentPrice || 0);
  if (!Number.isFinite(current) || current <= 0) return 0;
  const count = Number(bidCount || 0);
  const increment = Number.isFinite(count) && count > 0
    ? getMinMultiBidIncrement(current)
    : 0;
  return Math.floor(current + increment);
}

function validateSubmitMeetsMinimumBidPrice({ bidMode, bidMaxPrice, currentPrice, bidCount }) {
  if (bidMode === 'buyout') return;
  const required = getRequiredBidMaxPrice(currentPrice, bidCount);
  if (required <= 0) return;
  const submitted = Number(bidMaxPrice || 0);
  if (Number.isFinite(submitted) && submitted >= required) return;
  const increment = Number(bidCount || 0) > 0 ? getMinMultiBidIncrement(currentPrice) : 0;
  const error = new Error(increment > 0
    ? `最高出价不满足Yahoo最低加价规则：当前价${currentPrice}円，最低加价${increment}円，最低需出到${required}円`
    : `最高出价不能低于当前价格：最低需出到${required}円`);
  error.statusCode = 400;
  throw error;
}

function getDefaultMultiBidIncrement(userMaxPrice) {
  return getMinMultiBidIncrement(userMaxPrice);
}

function validateMultiBidIncrement(strategy, userMaxPrice, increment) {
  if (strategy !== 'multi_bid') return null;
  const minIncrement = getMinMultiBidIncrement(userMaxPrice);
  const value = Number(increment || 0);
  if (!Number.isFinite(value) || value < minIncrement) {
    const error = new Error(`多次出价每次加价额度不能低于${minIncrement}円`);
    error.statusCode = 400;
    throw error;
  }
  return Math.floor(value);
}

function isAutomaticStrategy(strategy) {
  return Boolean(strategy && strategy !== 'direct' && strategy !== 'buyout');
}

function normalizeBidStrategyScope(value) {
  return value === 'direct_only' ? 'direct_only' : 'all';
}

function isClientAdminUser(user) {
  return Number(user?.user_level || 1) >= 3;
}

function buildClientManualVerificationAlert(user, challenge) {
  if (!isClientAdminUser(user) || challenge?.type !== 'pin') {
    return { show: false, message: '', type: '' };
  }
  return { show: true, message: '后端有事情要处理！', type: 'pin' };
}

function assertBidStrategyAllowed(context, strategy) {
  const loginUser = context?.loginUser || null;
  const actingUser = context?.actingUser || context;
  if (isClientAdminUser(loginUser)) return;
  if (normalizeBidStrategyScope(actingUser?.bid_strategy_scope) !== 'direct_only') return;
  if ((strategy || 'direct') === 'direct') return;
  const error = new Error('该用户只能使用即时拍策略');
  error.statusCode = 403;
  throw error;
}

function isActiveAutomaticStrategy(task) {
  if (!task || !isAutomaticStrategy(task.strategy)) return false;
  if (task.status === 'pending' || task.status === 'processing') return true;
  return task.status === 'bidding' && task.strategy === 'multi_bid';
}

function canCancelTask(task) {
  if (!task || !isAutomaticStrategy(task.strategy)) return false;
  if (task.status === 'pending') return true;
  return task.status === 'bidding' && task.strategy === 'multi_bid';
}

function assertNoActiveAutomaticStrategy(existingTask) {
  if (!isActiveAutomaticStrategy(existingTask)) return;
  const error = new Error('该商品已有生效策略，请先终止后再提交新任务');
  error.statusCode = 409;
  throw error;
}

function assertProductSubmissionOwner(existingTask, userId) {
  if (!existingTask) return;
  if (Number(existingTask.user_id) === Number(userId)) return;
  const error = new Error('该商品已由其他用户提交，请联系管理员！');
  error.statusCode = 400;
  throw error;
}

async function findTaskByClientRequestId(database, userId, clientRequestId) {
  const value = String(clientRequestId || '').trim();
  if (!value) return null;
  return database.getOne(
    'SELECT id, product_id FROM tasks WHERE user_id = ? AND client_request_id = ? ORDER BY id DESC LIMIT 1',
    [userId, value]
  );
}

function normalizePagination(query = {}, defaultLimit = 10) {
  const limit = Math.min(Math.max(parseInt(query.limit || String(defaultLimit), 10) || defaultLimit, 1), 100);
  const page = Math.max(parseInt(query.page || '1', 10) || 1, 1);
  return { limit, page, offset: (page - 1) * limit };
}

function buildTaskListInput(user, query = {}) {
  if (!user?.id) throw new Error('not logged in');
  return { userId: user.id, ...normalizePagination(query, 10) };
}

function buildWonTaskListInput(user, query = {}) {
  if (!user?.id) throw new Error('not logged in');
  return { userId: user.id, ...normalizePagination(query, 10) };
}

function buildActiveBiddingTaskListInput(user, query = {}) {
  if (!user?.id) throw new Error('not logged in');
  return { userId: user.id, ...normalizePagination(query, 10) };
}

function buildWonStatsInput(user, query = {}) {
  if (!user?.id) throw new Error('not logged in');
  const days = Math.min(Math.max(parseInt(query.days || '30', 10) || 30, 1), 90);
  return { userId: user.id, days };
}

function buildWonStatsSummaryQuery(input) {
  return {
    sql: `SELECT
         date(COALESCE(o.won_at, t.updated_at), 'localtime') AS won_date,
         SUM(COALESCE(o.final_price, 0)) AS total_amount,
         COUNT(*) AS item_count
       FROM tasks t
       INNER JOIN orders o ON o.task_id = t.id
       WHERE t.user_id = ?
         AND t.status = 'success'
         AND date(COALESCE(o.won_at, t.updated_at), 'localtime') >= date('now', 'localtime', '-' || (? - 1) || ' days')
       GROUP BY won_date
       ORDER BY won_date ASC`,
    params: [input.userId, input.days]
  };
}

function buildWonStatsExportQuery(input) {
  return {
    sql: `SELECT
         t.product_id,
         COALESCE(o.product_title, t.product_title, '') AS product_title,
         o.final_price,
         t.shipping_fee_text,
         o.won_at,
         o.won_time_text,
         t.updated_at
       FROM tasks t
       INNER JOIN orders o ON o.task_id = t.id
       WHERE t.user_id = ?
         AND t.status = 'success'
         AND date(COALESCE(o.won_at, t.updated_at), 'localtime') >= date('now', 'localtime', '-' || (? - 1) || ' days')
       ORDER BY datetime(COALESCE(o.won_at, t.updated_at)) DESC, t.id DESC`,
    params: [input.userId, input.days]
  };
}

function formatLocalDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function buildRecentDateKeys(days, now = new Date()) {
  const keys = [];
  for (let offset = days - 1; offset >= 0; offset--) {
    const date = new Date(now);
    date.setHours(0, 0, 0, 0);
    date.setDate(date.getDate() - offset);
    keys.push(formatLocalDate(date));
  }
  return keys;
}

function buildActiveBiddingTaskListQuery(input) {
  return {
    sql: `SELECT
         t.id,
         bi.product_id,
         bi.product_url,
         t.product_title,
         bi.product_image_url,
         bi.current_price,
         t.buyout_price,
         COALESCE(t.tax_type, 'tax_zero') AS tax_type,
         COALESCE(t.product_type, CASE WHEN COALESCE(t.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type,
         t.shipping_fee_text,
         t.max_price,
         t.user_max_price,
         t.strategy,
         t.bid_mode,
         'bidding' AS status,
         bi.status AS bidding_status,
         t.end_time,
         CASE WHEN bi.status = 'highest' THEN 1 ELSE 0 END AS is_highest_bidder,
         t.last_bid_at,
         bi.synced_at AS updated_at
       FROM bidding_items bi
       INNER JOIN tasks t ON t.id = (
         SELECT t2.id
         FROM tasks t2
         WHERE t2.user_id = ?
           AND t2.product_id = bi.product_id
         ORDER BY datetime(t2.created_at) DESC, t2.id DESC
         LIMIT 1
       )
       WHERE t.user_id = ?
         AND bi.status IN ('highest', 'outbid')
       ORDER BY datetime(bi.synced_at) DESC, bi.product_id DESC
       LIMIT ? OFFSET ?`,
    params: [input.userId, input.userId, input.limit, input.offset || 0]
  };
}

// POST /api/task/submit - 提交竞拍任务
router.post('/submit', async (req, res) => {
  const { strategy, start_minutes_before, start_seconds_before, end_time, product_title, product_image_url, current_price, buyout_price, bid_count, tax_type, product_type, shipping_fee_text, multi_bid_increment, client_request_id, pending_followup_max_price } = req.body;
  try {
    const input = buildSubmitTaskInput(req.user, req.body);
    input.userId = req.actingUser.id;
    const clientRequestId = String(client_request_id || '').trim() || null;
    const existingRequest = await findTaskByClientRequestId(db, input.userId, clientRequestId);
    if (existingRequest) {
      return res.json({ success: true, task_id: existingRequest.id, product_id: existingRequest.product_id, duplicate: true });
    }
    const existingTask = await db.getOne(
      'SELECT id, user_id FROM tasks WHERE product_id = ? ORDER BY id DESC LIMIT 1',
      [input.productId]
    );
    assertProductSubmissionOwner(existingTask, input.userId);
    const activeAutomaticTask = await db.getOne(
      `SELECT id, strategy, status
       FROM tasks
       WHERE product_id = ?
         AND user_id = ?
         AND (
           (strategy != 'direct' AND status IN ('pending', 'processing'))
           OR (strategy = 'multi_bid' AND status = 'bidding')
         )
       ORDER BY id DESC
       LIMIT 1`,
      [input.productId, input.userId]
    );
    assertNoActiveAutomaticStrategy(activeAutomaticTask);

    let productInfo = null;
    if (!end_time || !product_title || !product_image_url || !current_price || !tax_type || !product_type || !shipping_fee_text) {
      try {
        const result = await productService.fetchProduct(input.standardUrl);
        productInfo = result.data || null;
      } catch (_) {}
    }
    const endTime = end_time || productInfo?.endTime || null;
    const resolvedTaxType = normalizeTaxType(tax_type || productInfo?.taxType);
    const resolvedProductType = normalizeProductType(product_type || productInfo?.productType, resolvedTaxType);
    const fetchedBuyoutPrice = Number(productInfo?.buyoutPrice || 0) || 0;
    const submittedBuyoutPrice = Number(buyout_price || 0) || 0;
    const buyoutPrices = resolveBuyoutTaskPrices({
      fetchedBuyoutPrice,
      submittedBuyoutPrice,
      inputMaxPrice: input.maxPrice,
      taxType: resolvedTaxType
    });
    const userMaxPrice = input.bidMode === 'buyout'
      ? buyoutPrices.userMaxPrice
      : input.maxPrice;
    const bidMaxPrice = input.bidMode === 'buyout'
      ? buyoutPrices.bidMaxPrice
      : calculateBidMaxPrice(userMaxPrice, resolvedTaxType);
    const incomingStrategy = input.bidMode === 'buyout' ? 'direct' : (strategy || 'direct');
    assertBidStrategyAllowed({ loginUser: req.user, actingUser: req.actingUser }, incomingStrategy);
    const multiBidMinPrice = await getMultiBidMinPrice();
    validateMultiBidUserMaxPrice(incomingStrategy, userMaxPrice, multiBidMinPrice);
    const multiBidIncrement = validateMultiBidIncrement(incomingStrategy, userMaxPrice, multi_bid_increment);
    if (input.bidMode === 'buyout' && buyoutPrices.buyoutPrice <= 0) {
      const error = new Error('出价失败：该商品没有即決价格');
      error.statusCode = 400;
      throw error;
    }
    const buyoutPrice = input.bidMode === 'buyout'
      ? buyoutPrices.buyoutPrice
      : (submittedBuyoutPrice || fetchedBuyoutPrice || null);
    const shippingFeeText = shipping_fee_text || productInfo?.shippingFeeText || null;
    const bidCountValue = Number(bid_count ?? productInfo?.bidCount ?? productInfo?.bid_count ?? 0);
    const bidCount = Number.isFinite(bidCountValue) && bidCountValue >= 0 ? Math.floor(bidCountValue) : 0;
    const followupMaxPriceRaw = Number(pending_followup_max_price || 0);
    let followupMaxPrice = Number.isFinite(followupMaxPriceRaw) && followupMaxPriceRaw > userMaxPrice
      ? Math.floor(followupMaxPriceRaw)
      : null;

    // 服务端兜底：旧客户端、API 直连等场景下，命中 Yahoo 低价规则时自动拆分。
    let finalUserMaxPrice = userMaxPrice;
    let finalBidMaxPrice = bidMaxPrice;
    const productCurrentPrice = Number(current_price || productInfo?.currentPrice || 0);
    validateSubmitMeetsMinimumBidPrice({
      bidMode: input.bidMode,
      bidMaxPrice,
      currentPrice: productCurrentPrice,
      bidCount
    });
    if (
      !followupMaxPrice &&
      shouldSplitDirectBidByYahooLowPriceRule({
        strategy: incomingStrategy,
        bidMode: input.bidMode,
        currentPrice: productCurrentPrice,
        submitMaxPrice: userMaxPrice,
        taxType: resolvedTaxType
      })
    ) {
      followupMaxPrice = userMaxPrice;
      // 想让 Yahoo 实际收到 9000，对含税商品要把 user_max_price 折成含税值（9000×1.1）。
      finalUserMaxPrice = resolvedTaxType === 'tax_included'
        ? Math.floor(YAHOO_LOW_PRICE_INITIAL_BID * 1.1)
        : YAHOO_LOW_PRICE_INITIAL_BID;
      finalBidMaxPrice = YAHOO_LOW_PRICE_INITIAL_BID;
    }

    await db.query(
      `INSERT INTO tasks (user_id, product_id, product_url, product_title, product_image_url, current_price, buyout_price, bid_count, tax_type, product_type, shipping_fee_text, max_price, user_max_price, multi_bid_increment, strategy, bid_mode, start_minutes_before, start_seconds_before, status, end_time, client_request_id, pending_followup_max_price)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?, ?, ?)`,
      [
        input.userId,
        input.productId,
        input.standardUrl,
        product_title || productInfo?.title || null,
        product_image_url || productInfo?.imageUrl || null,
        current_price || productInfo?.currentPrice || null,
        buyoutPrice,
        bidCount,
        resolvedTaxType,
        resolvedProductType,
        shippingFeeText,
        finalBidMaxPrice,
        finalUserMaxPrice,
        multiBidIncrement,
        incomingStrategy,
        input.bidMode,
        start_minutes_before || null,
        start_seconds_before || null,
        endTime,
        clientRequestId,
        followupMaxPrice
      ]
    );
    const inserted = await db.getOne('SELECT id, product_id FROM tasks WHERE id = last_insert_rowid()');
    res.json({ success: true, task_id: inserted.id, product_id: inserted.product_id });
  } catch (err) {
    res.status(err.statusCode || 500).json({ error: err.message });
  }
});

// GET /api/task/list - 用户任务列表
router.get('/list', async (req, res) => {
  try {
    const input = buildTaskListInput(req.user, req.query);
    input.userId = req.actingUser.id;
    const totalRow = await db.getOne('SELECT COUNT(*) AS total FROM tasks WHERE user_id = ?', [input.userId]);
    const tasks = await db.getAll(
      'SELECT id, product_id, product_url, product_title, current_price, buyout_price, bid_count, tax_type, product_type, shipping_fee_text, max_price, user_max_price, multi_bid_increment, strategy, bid_mode, status, error_msg, end_time, is_highest_bidder, created_at FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ? OFFSET ?',
      [input.userId, input.limit, input.offset]
    );
    res.json({ success: true, data: tasks, total: totalRow?.total || 0, page: input.page, limit: input.limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/stats', async (req, res) => {
  try {
    const rows = await db.getAll(
      'SELECT status, COUNT(*) AS count FROM tasks WHERE user_id = ? GROUP BY status',
      [req.actingUser.id]
    );
    const stats = {
      total: 0,
      pending: 0,
      processing: 0,
      bidding: 0,
      success: 0,
      failed: 0,
      cancelled: 0
    };
    for (const row of rows) {
      stats[row.status] = row.count;
      stats.total += row.count;
    }
    res.json(stats);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/manual-verification-alert', async (req, res) => {
  try {
    const challenge = await getCaptchaChallenge(db);
    res.json(buildClientManualVerificationAlert(req.user, challenge));
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/website-rate', async (req, res) => {
  try {
    const rate = await getWebsiteRate();
    res.json({
      success: true,
      rate: rate.rate,
      sourceRate: rate.sourceRate,
      sourceName: rate.sourceName,
      fetchedAt: rate.fetchedAt,
      expiresAt: rate.expiresAt,
      cacheHit: rate.cacheHit
    });
  } catch (err) {
    res.status(503).json({ error: err.message || 'failed to fetch website rate' });
  }
});

// GET /api/task/won-stats - 近 N 天落札统计和导出明细
router.get('/won-stats', async (req, res) => {
  try {
    const input = buildWonStatsInput(req.user, req.query);
    input.userId = req.actingUser.id;
    const summaryQuery = buildWonStatsSummaryQuery(input);
    const exportQuery = buildWonStatsExportQuery(input);
    const [summaryRows, exportRows] = await Promise.all([
      db.getAll(summaryQuery.sql, summaryQuery.params),
      db.getAll(exportQuery.sql, exportQuery.params)
    ]);

    const summaryByDate = new Map(summaryRows.map(row => [row.won_date, row]));
    const daily = buildRecentDateKeys(input.days).map(date => {
      const row = summaryByDate.get(date);
      return {
        date,
        total_amount: Number(row?.total_amount || 0),
        item_count: Number(row?.item_count || 0)
      };
    });

    res.json({ success: true, data: { days: input.days, daily, items: exportRows } });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/task/won - 用户落札商品列表
router.get('/won', async (req, res) => {
  try {
    const input = buildWonTaskListInput(req.user, req.query);
    input.userId = req.actingUser.id;
    const totalRow = await db.getOne(
      `SELECT COUNT(*) AS total
       FROM tasks
       WHERE user_id = ?
         AND status = 'success'`,
      [input.userId]
    );
    const tasks = await db.getAll(
      `SELECT
         t.id,
         won_task.product_id,
         t.product_url,
         COALESCE(t.product_title, won_task.product_title) AS product_title,
         COALESCE(t.product_image_url, won_task.product_image_url) AS product_image_url,
         t.current_price,
         t.buyout_price,
         t.tax_type,
         t.product_type,
         t.shipping_fee_text,
         t.max_price,
         t.user_max_price,
         t.strategy,
         t.bid_mode,
         t.status,
         t.end_time,
         t.updated_at,
         o.final_price,
         o.won_at,
         o.won_time_text,
         o.total_amount_cny,
         o.handling_fee,
         o.jpy_to_cny_rate,
         o.order_status,
         o.shipping_company,
         o.shipped_at,
         o.tracking_number
       FROM tasks won_task
       LEFT JOIN orders o ON o.task_id = won_task.id
       INNER JOIN tasks t ON t.id = (
         SELECT t2.id
         FROM tasks t2
         WHERE t2.user_id = ?
           AND t2.product_id = won_task.product_id
         ORDER BY datetime(t2.created_at) DESC, t2.id DESC
         LIMIT 1
       )
       WHERE won_task.user_id = ?
         AND won_task.status = 'success'
       ORDER BY datetime(COALESCE(o.won_at, won_task.updated_at)) DESC, won_task.id DESC
       LIMIT ? OFFSET ?`,
      [input.userId, input.userId, input.limit, input.offset]
    );
    res.json({ success: true, data: tasks, total: totalRow?.total || 0, page: input.page, limit: input.limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/task/bidding - 用户入札中商品列表
router.get('/bidding', async (req, res) => {
  try {
    const input = buildActiveBiddingTaskListInput(req.user, req.query);
    input.userId = req.actingUser.id;
    const totalRow = await db.getOne(
      `SELECT COUNT(DISTINCT bi.product_id) AS total
       FROM bidding_items bi
       INNER JOIN tasks t ON t.product_id = bi.product_id
       WHERE t.user_id = ?
         AND bi.status IN ('highest', 'outbid')`,
      [input.userId]
    );
    const query = buildActiveBiddingTaskListQuery(input);
    const tasks = await db.getAll(query.sql, query.params);
    res.json({ success: true, data: tasks, total: totalRow?.total || 0, page: input.page, limit: input.limit });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/task/:id - 任务详情
router.get('/:id', async (req, res) => {
  try {
    const task = await db.getOne('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.actingUser.id]);
    if (!task) return res.status(404).json({ error: 'task not found' });
    res.json({ success: true, data: task });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/task/:id/max_price - 修改最高价
router.patch('/:id/max_price', async (req, res) => {
  const { max_price } = req.body;
  try {
    await db.query(
      'UPDATE tasks SET max_price = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ? AND user_id = ?',
      [max_price, req.params.id, req.actingUser.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// PATCH /api/task/:id/cancel - 终止还未完成的自动策略
router.patch('/:id/cancel', async (req, res) => {
  try {
    const task = await db.getOne(
      'SELECT id, strategy, status FROM tasks WHERE id = ? AND user_id = ?',
      [req.params.id, req.actingUser.id]
    );
    if (!task) return res.status(404).json({ error: 'task not found' });
    if (!canCancelTask(task)) {
      return res.status(400).json({ error: '该任务当前状态不能终止' });
    }
    await db.query(
      `UPDATE tasks
       SET status = 'cancelled',
           error_msg = NULL,
           updated_at = CURRENT_TIMESTAMP
       WHERE id = ?
         AND user_id = ?
         AND (
           (strategy != 'direct' AND status = 'pending')
           OR (strategy = 'multi_bid' AND status = 'bidding')
         )`,
      [req.params.id, req.actingUser.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.buildSubmitTaskInput = buildSubmitTaskInput;
module.exports.buildTaskListInput = buildTaskListInput;
module.exports.buildActiveBiddingTaskListInput = buildActiveBiddingTaskListInput;
module.exports.buildActiveBiddingTaskListQuery = buildActiveBiddingTaskListQuery;
module.exports.buildWonTaskListInput = buildWonTaskListInput;
module.exports.buildWonStatsInput = buildWonStatsInput;
module.exports.buildWonStatsSummaryQuery = buildWonStatsSummaryQuery;
module.exports.buildWonStatsExportQuery = buildWonStatsExportQuery;
module.exports.buildRecentDateKeys = buildRecentDateKeys;
module.exports.normalizePagination = normalizePagination;
module.exports.calculateBidMaxPrice = calculateBidMaxPrice;
module.exports.normalizeProductType = normalizeProductType;
module.exports.getTaxIncludedPrice = getTaxIncludedPrice;
module.exports.resolveBuyoutTaskPrices = resolveBuyoutTaskPrices;
module.exports.getMultiBidMinPrice = getMultiBidMinPrice;
module.exports.validateMultiBidUserMaxPrice = validateMultiBidUserMaxPrice;
module.exports.getMinMultiBidIncrement = getMinMultiBidIncrement;
module.exports.getDefaultMultiBidIncrement = getDefaultMultiBidIncrement;
module.exports.validateMultiBidIncrement = validateMultiBidIncrement;
module.exports.getRequiredBidMaxPrice = getRequiredBidMaxPrice;
module.exports.validateSubmitMeetsMinimumBidPrice = validateSubmitMeetsMinimumBidPrice;
module.exports.assertProductSubmissionOwner = assertProductSubmissionOwner;
module.exports.isAutomaticStrategy = isAutomaticStrategy;
module.exports.isActiveAutomaticStrategy = isActiveAutomaticStrategy;
module.exports.canCancelTask = canCancelTask;
module.exports.assertNoActiveAutomaticStrategy = assertNoActiveAutomaticStrategy;
module.exports.findTaskByClientRequestId = findTaskByClientRequestId;
module.exports.normalizeBidStrategyScope = normalizeBidStrategyScope;
module.exports.assertBidStrategyAllowed = assertBidStrategyAllowed;
module.exports.buildClientManualVerificationAlert = buildClientManualVerificationAlert;
