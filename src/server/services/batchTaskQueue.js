const fs = require('fs');
const path = require('path');
const { parseBatchBidText } = require('../../shared/batchBid.cjs');

function ensureBatchTaskQueueSchema(raw) {
  raw.exec(fs.readFileSync(path.join(__dirname, 'batchTaskQueue.sql'), 'utf8'));
}

function queueError(message, statusCode = 400) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function getBatchPreparationStats(database) {
  const rows = await database.getAll(`SELECT status, COUNT(*) AS count FROM batch_task_submission_items
    WHERE status IN ('pending', 'processing', 'failed') GROUP BY status`);
  const stats = { pending: 0, processing: 0, failed: 0 };
  for (const row of rows) stats[row.status] = row.count;
  const items = await database.getAll(`SELECT i.id, i.batch_id, i.line_number, i.product_id, i.max_price,
      i.status, i.error_msg, b.created_at, u.username
    FROM batch_task_submission_items i
    JOIN batch_task_submissions b ON b.id = i.batch_id
    LEFT JOIN users u ON u.id = b.user_id
    WHERE i.status IN ('pending', 'processing') OR (i.status = 'failed' AND b.dismissed_at IS NULL)
    ORDER BY CASE i.status WHEN 'processing' THEN 0 WHEN 'pending' THEN 1 ELSE 2 END,
      CASE WHEN i.status = 'failed' THEN -i.batch_id ELSE i.batch_id END, i.line_number LIMIT 50`);
  return { ...stats, items };
}

function createBatchTaskQueue({ raw, submitTask, readContext, onItemProcessed = () => {} }) {
  let timer = null;
  let running = null;
  let stopped = false;

  function refreshCompletions() {
    raw.transaction(() => {
      const batches = raw.prepare("SELECT id FROM batch_task_submissions WHERE status != 'completed' ORDER BY id").all();
      for (const batch of batches) {
        const items = raw.prepare('SELECT * FROM batch_task_submission_items WHERE batch_id = ?').all(batch.id);
        if (items.some(item => ['pending', 'processing'].includes(item.status))) continue;
        const saveResult = raw.prepare('UPDATE batch_task_submission_items SET result_status = ?, result_error = ? WHERE id = ?');
        for (const item of items) {
          saveResult.run(item.status === 'failed' ? 'submit_failed' : 'submitted',
            item.status === 'failed' ? item.error_msg : null, item.id);
        }
        raw.prepare("UPDATE batch_task_submissions SET status = 'completed', completed_at = CURRENT_TIMESTAMP WHERE id = ?").run(batch.id);
      }
    })();
  }

  function enqueue(context, body) {
    const requestId = String(body.client_request_id || '').trim();
    if (!/^[a-zA-Z0-9_-]{1,128}$/.test(requestId)) throw queueError('缺少有效的批量提交标识');
    const text = String(body.text || '').trim();
    if (text.length > 100000) throw queueError('批量输入内容过长');
    let rows;
    try { rows = parseBatchBidText(text); } catch (error) { throw queueError(error.message); }
    const result = raw.transaction(() => {
      const existing = raw.prepare('SELECT id, input_text FROM batch_task_submissions WHERE user_id = ? AND client_request_id = ?').get(context.actingUser.id, requestId);
      if (existing) {
        if (existing.input_text !== text) throw queueError('该提交标识已用于其他批量内容', 409);
        return { success: true, batch_id: existing.id, count: rows.length, duplicate: true };
      }
      const inserted = raw.prepare(`INSERT INTO batch_task_submissions (user_id, login_user_id, client_request_id, input_text)
        VALUES (?, ?, ?, ?)`).run(context.actingUser.id, context.user.id, requestId, text);
      const batchId = Number(inserted.lastInsertRowid);
      const insertItem = raw.prepare(`INSERT INTO batch_task_submission_items
        (batch_id, line_number, input_text, product_id, product_url, max_price, status, error_msg)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of rows) insertItem.run(batchId, row.line, row.text, row.productId || null, row.standardUrl || null,
        row.maxPrice || null, row.error ? 'failed' : 'pending', row.error || null);
      return { success: true, batch_id: batchId, count: rows.length };
    })();
    // Parsing and durable enqueue are the only work performed by the request.
    if (timer) setImmediate(tick);
    return result;
  }

  function claimNext() {
    return raw.transaction(() => {
      const item = raw.prepare(`SELECT i.*, b.user_id, b.login_user_id FROM batch_task_submission_items i
        JOIN batch_task_submissions b ON b.id = i.batch_id
        WHERE i.status = 'pending' ORDER BY i.batch_id, i.line_number LIMIT 1`).get();
      if (!item) return null;
      raw.prepare("UPDATE batch_task_submission_items SET status = 'processing' WHERE id = ? AND status = 'pending'").run(item.id);
      raw.prepare("UPDATE batch_task_submissions SET status = 'processing' WHERE id = ?").run(item.batch_id);
      return item;
    })();
  }

  function processPending() {
    if (running) return running;
    running = (async () => {
      refreshCompletions();
      while (!stopped) {
        const item = claimNext();
        if (!item) break;
        const startedAt = Date.now();
        let outcome = 'submitted';
        const requestId = `batch-queue-${item.batch_id}-${item.line_number}`;
        try {
          // Recover an INSERT committed before a process restart or lost item-status update.
          const existing = raw.prepare('SELECT id, product_id FROM tasks WHERE user_id = ? AND client_request_id = ?').get(item.user_id, requestId);
          let result;
          if (existing) {
            if (existing.product_id !== item.product_id) throw queueError('批量任务标识与商品不匹配', 409);
            result = { task_id: existing.id };
          } else {
            const context = await readContext(item.login_user_id, item.user_id);
            result = await submitTask(context, { product_url: item.product_url, max_price: item.max_price, client_request_id: requestId });
          }
          raw.prepare("UPDATE batch_task_submission_items SET status = 'submitted', task_id = ? WHERE id = ? AND status = 'processing'").run(result.task_id, item.id);
        } catch (error) {
          outcome = 'failed';
          raw.prepare("UPDATE batch_task_submission_items SET status = 'failed', error_msg = ? WHERE id = ? AND status = 'processing'").run(error.message || '后台提交失败', item.id);
        }
        onItemProcessed({ batchId: item.batch_id, line: item.line_number, outcome, elapsedMs: Date.now() - startedAt });
        refreshCompletions();
      }
      refreshCompletions();
    })().finally(() => { running = null; });
    return running;
  }

  function reportError(error) { console.error('Batch task queue failed:', error.message); }

  function tick() {
    // Refresh finished bids even while another batch is waiting for a slow Yahoo page.
    if (running) {
      try { refreshCompletions(); } catch (error) { reportError(error); }
    } else processPending().catch(reportError);
  }

  function start() {
    if (timer) return;
    stopped = false;
    // Only called at API startup; deterministic per-row ids prevent recovered rows creating duplicates.
    raw.prepare("UPDATE batch_task_submission_items SET status = 'pending' WHERE status = 'processing'").run();
    timer = setInterval(tick, 2000);
    timer.unref?.();
    tick();
  }

  function stop() { stopped = true; clearInterval(timer); timer = null; }

  function listResults(userId) {
    refreshCompletions();
    const batches = raw.prepare(`SELECT b.id, b.created_at, b.completed_at FROM batch_task_submissions b
      WHERE b.user_id = ? AND b.status = 'completed' AND b.dismissed_at IS NULL
        AND EXISTS (SELECT 1 FROM batch_task_submission_items i WHERE i.batch_id = b.id AND i.status = 'failed')
      ORDER BY b.id LIMIT 20`).all(userId);
    return batches.map(batch => {
      const items = raw.prepare(`SELECT line_number AS line, input_text AS text, product_id, max_price,
        task_id, 'submit_failed' AS status, error_msg AS error FROM batch_task_submission_items
        WHERE batch_id = ? AND status = 'failed' ORDER BY line_number`).all(batch.id);
      const counts = raw.prepare(`SELECT COUNT(*) AS total,
        SUM(CASE WHEN status = 'submitted' THEN 1 ELSE 0 END) AS submit_success_count
        FROM batch_task_submission_items WHERE batch_id = ?`).get(batch.id);
      return { ...batch, ...counts, items, submit_failed_count: items.length };
    });
  }

  function dismiss(userId, batchId) {
    if (!Number.isSafeInteger(Number(batchId)) || Number(batchId) <= 0) throw queueError('无效的批量任务标识');
    const result = raw.prepare(`UPDATE batch_task_submissions SET dismissed_at = COALESCE(dismissed_at, CURRENT_TIMESTAMP)
      WHERE id = ? AND user_id = ? AND status = 'completed'`).run(batchId, userId);
    if (!result.changes) throw queueError('批量结果不存在或尚未完成', 404);
    return { success: true };
  }

  return { enqueue, start, stop, processPending, refreshCompletions, listResults, dismiss };
}

module.exports = { ensureBatchTaskQueueSchema, createBatchTaskQueue, getBatchPreparationStats };
