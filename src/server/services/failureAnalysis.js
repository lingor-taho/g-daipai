const { getTaskSubmissionHistory } = require('./taskSubmissionHistory');
const { hasWinningOrderSql, auctionEndTimeSql } = require('./productAuctionTime');

const notWonFilter = `t.user_id = ? AND t.product_id IS NOT NULL
  AND datetime(${auctionEndTimeSql}) <= datetime('now')
  AND NOT EXISTS (SELECT 1 FROM bidding_items active WHERE active.product_id = t.product_id AND active.account_id = t.account_id
    AND active.status IN ('highest', 'outbid'))
  AND NOT EXISTS (SELECT 1 FROM tasks won WHERE won.user_id = t.user_id
    AND won.product_id = t.product_id AND won.status = 'success')`;

async function getFailureAnalysis(database, { userId, page = 1, limit = 10 }) {
  const totalRow = await database.getOne(`SELECT COUNT(DISTINCT t.product_id) AS total FROM tasks t
    INNER JOIN products p ON p.product_id = t.product_id WHERE ${notWonFilter}`, [userId]);
  const total = Number(totalRow?.total || 0);
  const items = await database.getAll(`SELECT t.id, t.account_id, t.product_id, t.max_price, t.user_max_price, t.strategy,
      t.status, t.created_at, p.product_url, p.product_title, p.product_image_url,
      CASE WHEN LENGTH(COALESCE(p.auction_history_data, '')) > 0 THEN 1 ELSE 0 END AS has_auction_history,
      p.current_price, ${auctionEndTimeSql} AS end_time,
      ${hasWinningOrderSql} AS ended_by_win, COALESCE(p.tax_type, 'tax_zero') AS tax_type,
      COALESCE(p.product_type, CASE WHEN COALESCE(p.tax_type, 'tax_zero') = 'tax_included' THEN 'store' ELSE 'normal' END) AS product_type,
      bi.status AS bidding_status
    FROM tasks t
    LEFT JOIN products p ON p.product_id = t.product_id
    LEFT JOIN bidding_items bi ON bi.product_id = t.product_id AND bi.account_id = t.account_id
    WHERE ${notWonFilter}
      AND t.id = (SELECT latest.id FROM tasks latest
        WHERE latest.user_id = t.user_id AND latest.product_id = t.product_id
        ORDER BY datetime(latest.created_at) DESC, latest.id DESC LIMIT 1)
    ORDER BY datetime(t.created_at) DESC, t.id DESC
    LIMIT ? OFFSET ?`, [userId, limit, (page - 1) * limit]);
  if (items.length === 0) return { success: true, data: [], total, page, limit };
  const productIds = items.map(item => item.product_id);
  const byProduct = await getTaskSubmissionHistory(database, userId, productIds);
  return {
    success: true,
    data: items.map(item => {
      const bid_history = byProduct.get(item.product_id) || [];
      return { ...item, bid_history, final_bid: Math.max(0, ...bid_history.map(bid => bid.amount)) };
    }),
    total, page, limit
  };
}

module.exports = { getFailureAnalysis };
