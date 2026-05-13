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
  const { product_url, max_price } = body;
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
    maxPrice: parseInt(max_price, 10)
  };
}

function buildTaskListInput(user) {
  if (!user?.id) throw new Error('not logged in');
  return { userId: user.id };
}

// POST /api/task/submit - 提交竞拍任务
router.post('/submit', async (req, res) => {
  const { strategy, start_minutes_before, start_seconds_before, end_time, product_title, product_image_url, current_price } = req.body;
  try {
    const input = buildSubmitTaskInput(req.user, req.body);
    let productInfo = null;
    if (!end_time || !product_title || !product_image_url || !current_price) {
      try {
        const result = await productService.fetchProduct(input.standardUrl);
        productInfo = result.data || null;
      } catch (_) {}
    }
    const endTime = end_time || productInfo?.endTime || null;
    await db.query(
      `INSERT INTO tasks (user_id, product_id, product_url, product_title, product_image_url, current_price, max_price, strategy, start_minutes_before, start_seconds_before, status, end_time)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      [
        input.userId,
        input.productId,
        input.standardUrl,
        product_title || productInfo?.title || null,
        product_image_url || productInfo?.imageUrl || null,
        current_price || productInfo?.currentPrice || null,
        input.maxPrice,
        strategy || 'direct',
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
      'SELECT id, product_id, product_url, product_title, current_price, max_price, strategy, status, end_time, is_highest_bidder FROM tasks WHERE user_id = ? ORDER BY created_at DESC LIMIT ?',
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

module.exports = router;
module.exports.buildSubmitTaskInput = buildSubmitTaskInput;
module.exports.buildTaskListInput = buildTaskListInput;

