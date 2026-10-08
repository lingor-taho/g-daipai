// One entry per user submission; automatic followups belong to the original submission.
async function getTaskSubmissionHistory(database, userId, productIds, { includeCancelled = false } = {}) {
  const byProduct = new Map();
  if (!productIds.length) return byProduct;
  const history = await database.getAll(`SELECT t.id AS task_id, t.product_id, t.created_at, t.status,
      COALESCE(NULLIF(t.pending_followup_max_price, 0),
        (SELECT COALESCE(NULLIF(followup.user_max_price, 0), followup.max_price)
          FROM tasks followup WHERE followup.user_id = t.user_id
            AND followup.product_id = t.product_id AND followup.client_request_id = 'followup-' || t.id LIMIT 1),
        NULLIF(t.user_max_price, 0), t.max_price, 0) AS amount
    FROM tasks t
    WHERE t.user_id = ? AND t.product_id IN (${productIds.map(() => '?').join(',')})
      AND (t.client_request_id IS NULL OR t.client_request_id NOT GLOB 'followup-[0-9]*')
    ORDER BY datetime(t.created_at) ASC, t.id ASC`, [userId, ...productIds]);

  for (const bid of history) {
    if (!includeCancelled && bid.status === 'cancelled') continue;
    if (!byProduct.has(bid.product_id)) byProduct.set(bid.product_id, []);
    byProduct.get(bid.product_id).push({ task_id: bid.task_id, amount: Number(bid.amount || 0), created_at: bid.created_at, status: bid.status });
  }
  return byProduct;
}

module.exports = { getTaskSubmissionHistory };
