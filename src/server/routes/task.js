const express = require('express');
const router = express.Router();
const db = require('../models');
const authMiddleware = require('../middleware/auth');
const { productService } = require('./proxy');
router.use(authMiddleware);

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
  const { product_url, max_price, bid_mode } = body;
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
    bidMode: bid_mode === 'buyout' ? 'buyout' : 'bid'
  };
}

function normalizeTaxType(value) {
  return value === 'tax_included' ? 'tax_included' : 'tax_zero';
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

function validateMultiBidUserMaxPrice(strategy, userMaxPrice) {
  if (strategy !== 'multi_bid') return;
  if (Number(userMaxPrice || 0) < 5500) {
    const error = new Error('多次出价最高价不能低于5500円');
    error.statusCode = 400;
    throw error;
  }
}

function getMinMultiBidIncrement(userMaxPrice) {
  const value = Number(userMaxPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  return Math.floor(value / 20);
}

function getDefaultMultiBidIncrement(userMaxPrice) {
  return Math.max(500, getMinMultiBidIncrement(userMaxPrice));
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

function buildTaskListInput(user) {
  if (!user?.id) throw new Error('not logged in');
  return { userId: user.id };
}

// POST /api/task/submit - 提交竞拍任务
router.post('/submit', async (req, res) => {
  const { strategy, start_minutes_before, start_seconds_before, end_time, product_title, product_image_url, current_price, buyout_price, tax_type, multi_bid_increment } = req.body;
  try {
    const input = buildSubmitTaskInput(req.user, req.body);
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
    if (!end_time || !product_title || !product_image_url || !current_price || !tax_type) {
      try {
        const result = await productService.fetchProduct(input.standardUrl);
        productInfo = result.data || null;
      } catch (_) {}
    }
    const endTime = end_time || productInfo?.endTime || null;
    const resolvedTaxType = normalizeTaxType(tax_type || productInfo?.taxType);
    const fetchedBuyoutPrice = Number(productInfo?.buyoutPrice || 0) || 0;
    const submittedBuyoutPrice = Number(buyout_price || 0) || 0;
    const userMaxPrice = input.bidMode === 'buyout'
      ? getTaxIncludedPrice(fetchedBuyoutPrice || submittedBuyoutPrice || input.maxPrice, resolvedTaxType)
      : input.maxPrice;
    const bidMaxPrice = input.bidMode === 'buyout'
      ? (fetchedBuyoutPrice || submittedBuyoutPrice || input.maxPrice)
      : calculateBidMaxPrice(userMaxPrice, resolvedTaxType);
    validateMultiBidUserMaxPrice(strategy || 'direct', userMaxPrice);
    const multiBidIncrement = validateMultiBidIncrement(strategy || 'direct', userMaxPrice, multi_bid_increment);
    if (input.bidMode === 'buyout' && fetchedBuyoutPrice <= 0) {
      const error = new Error('出价失败：该商品没有即決价格');
      error.statusCode = 400;
      throw error;
    }
    const buyoutPrice = input.bidMode === 'buyout'
      ? fetchedBuyoutPrice
      : (submittedBuyoutPrice || fetchedBuyoutPrice || null);
    await db.query(
      `INSERT INTO tasks (user_id, product_id, product_url, product_title, product_image_url, current_price, buyout_price, tax_type, max_price, user_max_price, multi_bid_increment, strategy, bid_mode, start_minutes_before, start_seconds_before, status, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        input.userId,
        input.productId,
        input.standardUrl,
        product_title || productInfo?.title || null,
        product_image_url || productInfo?.imageUrl || null,
        current_price || productInfo?.currentPrice || null,
        buyoutPrice,
        resolvedTaxType,
        bidMaxPrice,
        userMaxPrice,
        multiBidIncrement,
        input.bidMode === 'buyout' ? 'direct' : (strategy || 'direct'),
        input.bidMode,
        start_minutes_before || null,
        start_seconds_before || null,
        endTime
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
    const input = buildTaskListInput(req.user);
    const limit = Math.min(Math.max(parseInt(req.query.limit || '10', 10) || 10, 1), 100);
    const tasks = await db.getAll(
      'SELECT id, product_id, product_url, product_title, current_price, buyout_price, tax_type, max_price, user_max_price, multi_bid_increment, strategy, bid_mode, status, end_time, is_highest_bidder FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
      [input.userId, limit]
    );
    res.json({ success: true, data: tasks });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// GET /api/task/:id - 任务详情
router.get('/:id', async (req, res) => {
  try {
    const task = await db.getOne('SELECT * FROM tasks WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
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
      [max_price, req.params.id, req.user.id]
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
      [req.params.id, req.user.id]
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
      [req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
module.exports.buildSubmitTaskInput = buildSubmitTaskInput;
module.exports.buildTaskListInput = buildTaskListInput;
module.exports.calculateBidMaxPrice = calculateBidMaxPrice;
module.exports.getTaxIncludedPrice = getTaxIncludedPrice;
module.exports.validateMultiBidUserMaxPrice = validateMultiBidUserMaxPrice;
module.exports.getMinMultiBidIncrement = getMinMultiBidIncrement;
module.exports.getDefaultMultiBidIncrement = getDefaultMultiBidIncrement;
module.exports.validateMultiBidIncrement = validateMultiBidIncrement;
module.exports.assertProductSubmissionOwner = assertProductSubmissionOwner;
module.exports.isAutomaticStrategy = isAutomaticStrategy;
module.exports.isActiveAutomaticStrategy = isActiveAutomaticStrategy;
module.exports.canCancelTask = canCancelTask;
module.exports.assertNoActiveAutomaticStrategy = assertNoActiveAutomaticStrategy;
