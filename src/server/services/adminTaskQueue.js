// Read-only view of the same pending states counted by the admin queue card.
async function getAdminTaskQueue(database, { pageSize = 10, offset = 0 } = {}) {
  const items = await database.getAll(`
    SELECT * FROM (
      SELECT 'task:' || t.id AS queue_key, t.id, t.product_id, p.product_url,
        p.current_price, t.max_price, t.user_max_price, p.buyout_price,
        t.bid_mode, t.strategy, t.status, t.created_at, t.updated_at,
        t.last_bid_at, t.start_minutes_before, t.start_seconds_before,
        (SELECT MAX(bl.bid_price) FROM bid_logs bl
          WHERE bl.task_id = t.id AND bl.result = 'bidding') AS highest_submitted_bid_price,
        p.end_time, u.username, NULL AS batch_id, NULL AS line_number
      FROM tasks t
      LEFT JOIN products p ON p.product_id = t.product_id
      LEFT JOIN users u ON u.id = t.user_id
      WHERE t.status = 'pending'
      UNION ALL
      SELECT 'preparation:' || i.id, i.id, i.product_id, i.product_url,
        NULL, i.max_price, NULL, NULL, 'bid', 'direct', 'preparation_pending',
        b.created_at, NULL, NULL, NULL, NULL, NULL, NULL, u.username,
        i.batch_id, i.line_number
      FROM batch_task_submission_items i
      JOIN batch_task_submissions b ON b.id = i.batch_id
      LEFT JOIN users u ON u.id = b.user_id
      WHERE i.status = 'pending'
    )
    ORDER BY created_at ASC, batch_id ASC, line_number ASC, queue_key ASC
    LIMIT ? OFFSET ?`, [pageSize, offset]);
  const count = await database.getOne(`SELECT
    (SELECT COUNT(*) FROM tasks WHERE status = 'pending') +
    (SELECT COUNT(*) FROM batch_task_submission_items WHERE status = 'pending') AS total`);
  return { items, total: count?.total || 0 };
}

module.exports = { getAdminTaskQueue };
