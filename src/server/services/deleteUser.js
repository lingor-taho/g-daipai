const CONFIRM_MESSAGE = '该用户还有订单、任务未清空，需要一起删除吗？';
const { runtimeKeys } = require('./yahooAccountContext');
function fail(status, message) { const error = new Error(message); error.status = status; throw error; }

// Use one synchronous SQLite transaction: the preview and deletion cannot race a new task.
function deleteUser(database, userId, confirmed = false) {
  const raw = database.raw || database;
  const id = Number(userId);
  if (!Number.isSafeInteger(id) || id <= 0) fail(400, '用户 ID 无效');
  return raw.transaction(() => {
    const user = raw.prepare('SELECT * FROM users WHERE id=?').get(id);
    if (!user) fail(404, '用户不存在');
    if (user.role !== 'user' || Number(user.user_level || 1) >= 3) fail(403, '管理员账号不能删除');
    const tasks = raw.prepare('SELECT id,product_id,account_id FROM tasks WHERE user_id=?').all(id);
    const orders = raw.prepare(`SELECT o.id,COALESCE(o.product_id,t.product_id) AS product_id,o.account_id
      FROM orders o LEFT JOIN tasks t ON t.id=o.task_id WHERE t.user_id=?
      OR (t.id IS NULL AND (EXISTS(SELECT 1 FROM yahoo_product_assignments a
        WHERE a.user_id=? AND a.product_id=o.product_id AND a.account_id=o.account_id)
        OR EXISTS(SELECT 1 FROM manual_order_import_items i WHERE i.assigned_user_id=? AND i.order_id=o.id)))`).all(id,id,id);
    const counts = { taskCount: tasks.length, orderCount: orders.length };
    if ((tasks.length || orders.length) && !confirmed) return { requiresConfirmation: true, error: CONFIRM_MESSAGE, ...counts };
    const taskIds = new Set(tasks.map(t => t.id));
    const orderIds = new Set(orders.map(o => o.id));
    const assignments = raw.prepare('SELECT product_id,account_id FROM yahoo_product_assignments WHERE user_id=?').all(id);
    const imports = raw.prepare(`SELECT * FROM manual_order_import_items WHERE assigned_user_id=?
      OR task_id IN (SELECT id FROM tasks WHERE user_id=?)
      OR order_id IN (SELECT o.id FROM orders o JOIN tasks t ON t.id=o.task_id WHERE t.user_id=?)`).all(id,id,id);
    const products = new Set([...tasks,...orders,...assignments,...imports].map(r => r.product_id).filter(Boolean));
    const pairs = new Map([...tasks,...orders,...assignments].filter(r => r.product_id)
      .map(r => [`${r.account_id}:${r.product_id}`,r]));
    raw.exec(`CREATE TEMP TABLE user_delete_tasks(id INTEGER PRIMARY KEY);
      CREATE TEMP TABLE user_delete_orders(id INTEGER PRIMARY KEY);`);
    const insertTask = raw.prepare('INSERT INTO user_delete_tasks VALUES(?)');
    for (const taskId of taskIds) insertTask.run(taskId);
    const insertOrder = raw.prepare('INSERT INTO user_delete_orders VALUES(?)');
    for (const orderId of orderIds) insertOrder.run(orderId);
    // Order work kinds use order IDs; import work uses batch IDs and must remain separate.
    raw.exec(`DELETE FROM yahoo_work_claims WHERE kind IN ('transaction-start','scan','payment','confirm-receipt')
      AND object_id IN (SELECT id FROM user_delete_orders);
      DELETE FROM plugin_diagnostics WHERE order_id IN (SELECT id FROM user_delete_orders);
      DELETE FROM yahoo_trade_messages WHERE order_id IN (SELECT id FROM user_delete_orders);
      DELETE FROM order_status_change_logs WHERE order_id IN (SELECT id FROM user_delete_orders);
      DELETE FROM bid_logs WHERE task_id IN (SELECT id FROM user_delete_tasks);
      DELETE FROM yahoo_account_transfers WHERE task_id IN (SELECT id FROM user_delete_tasks);`);
    const batches = new Set();
    for (const item of imports) {
      // A stale import assignment must not remove another user's current order/task.
      const otherTask = item.task_id && !taskIds.has(item.task_id);
      const otherOrder = item.order_id && !orderIds.has(item.order_id);
      if (otherTask || otherOrder) {
        raw.prepare('UPDATE manual_order_import_items SET assigned_user_id=NULL WHERE id=? AND assigned_user_id=?').run(item.id,id);
      } else {
        raw.prepare('DELETE FROM manual_order_import_items WHERE id=?').run(item.id);
        batches.add(item.batch_id);
      }
    }
    for (const batchId of batches) {
      if (!raw.prepare('SELECT 1 FROM manual_order_import_items WHERE batch_id=?').get(batchId)) {
        raw.prepare("DELETE FROM yahoo_work_claims WHERE kind='manual-order-import' AND object_id=?").run(batchId);
        raw.prepare('DELETE FROM manual_order_import_batches WHERE id=?').run(batchId);
      }
    }
    // Preserve batches the deleted agent submitted for a different owner.
    raw.prepare('UPDATE batch_task_submissions SET login_user_id=user_id WHERE login_user_id=? AND user_id<>?').run(id,id);
    raw.prepare('DELETE FROM batch_task_submissions WHERE user_id=?').run(id);
    // Explicitly remove owned item history rather than leaving task_id=NULL.
    raw.exec('DELETE FROM batch_task_submission_items WHERE task_id IN (SELECT id FROM user_delete_tasks)');
    for (const request of raw.prepare('SELECT * FROM yahoo_task_requests').all()) {
      const previous = JSON.parse(request.task_ids);
      const remaining = previous.filter(taskId => !taskIds.has(Number(taskId)));
      if (remaining.length === previous.length) continue;
      if (remaining.length) raw.prepare('UPDATE yahoo_task_requests SET task_ids=? WHERE account_id=? AND instance_id=? AND request_id=?')
        .run(JSON.stringify(remaining),request.account_id,request.instance_id,request.request_id);
      else raw.prepare('DELETE FROM yahoo_task_requests WHERE account_id=? AND instance_id=? AND request_id=?')
        .run(request.account_id,request.instance_id,request.request_id);
    }
    raw.prepare('DELETE FROM yahoo_product_assignments WHERE user_id=?').run(id);
    raw.exec(`DELETE FROM orders WHERE id IN (SELECT id FROM user_delete_orders);
      DELETE FROM tasks WHERE id IN (SELECT id FROM user_delete_tasks);`);
    const unshared = new Set();
    const isShared = productId => !!raw.prepare(`SELECT 1 FROM tasks WHERE product_id=?
      UNION ALL SELECT 1 FROM orders WHERE product_id=?
      UNION ALL SELECT 1 FROM yahoo_product_assignments WHERE product_id=?
      UNION ALL SELECT 1 FROM manual_order_import_items WHERE product_id=?
      UNION ALL SELECT 1 FROM bidding_items WHERE product_id=?
      UNION ALL SELECT 1 FROM batch_task_submission_items WHERE product_id=? LIMIT 1`)
      .get(productId,productId,productId,productId,productId,productId);
    for (const [key,pair] of pairs) {
      const sharedPair = raw.prepare(`SELECT 1 FROM tasks WHERE product_id=? AND account_id=?
        UNION ALL SELECT 1 FROM orders WHERE product_id=? AND account_id=?
        UNION ALL SELECT 1 FROM yahoo_product_assignments WHERE product_id=? AND account_id=?
        UNION ALL SELECT 1 FROM manual_order_import_items WHERE product_id=? AND account_id=? LIMIT 1`)
        .get(pair.product_id,pair.account_id,pair.product_id,pair.account_id,pair.product_id,pair.account_id,pair.product_id,pair.account_id);
      if (sharedPair) pairs.delete(key);
      else {
        raw.prepare('DELETE FROM bidding_items WHERE product_id=? AND account_id=?').run(pair.product_id,pair.account_id);
        raw.prepare('DELETE FROM plugin_diagnostics WHERE product_id=? AND account_id=?').run(pair.product_id,pair.account_id);
      }
    }
    for (const productId of products) {
      if (isShared(productId)) continue;
      unshared.add(productId);
      raw.prepare('DELETE FROM bidding_items WHERE product_id=?').run(productId);
      raw.prepare('DELETE FROM plugin_diagnostics WHERE product_id=?').run(productId);
      raw.prepare('DELETE FROM order_status_change_logs WHERE product_id=?').run(productId);
      raw.prepare('DELETE FROM products WHERE product_id=?').run(productId);
    }
    // JSON runtime queues and reminders are not covered by foreign keys.
    const remove = Symbol('remove');
    function prune(value, accountId) {
      if (Array.isArray(value)) return value.map(v => prune(v,accountId)).filter(v => v !== remove);
      if (!value || typeof value !== 'object') return value;
      const userRef = Number(value.userId || value.user_id || value.assigned_user_id);
      const orderRef = Number(value.orderId || value.order_id);
      const taskRef = Number(value.taskId || value.task_id);
      if (userRef === id || orderIds.has(orderRef) || taskIds.has(taskRef) ||
          (!userRef && !orderRef && !taskRef && value.productId &&
            (unshared.has(value.productId) || pairs.has(`${accountId}:${value.productId}`)))) return remove;
      const result = {};
      for (const [key,v] of Object.entries(value)) {
        if (key === 'ids' && Array.isArray(v)) result[key] = v.filter(p => !unshared.has(p));
        else if (unshared.has(key)) continue;
        else { const next = prune(v,accountId); if (next !== remove) result[key] = next; }
      }
      return result;
    }
    const primaryId = raw.prepare('SELECT id FROM yahoo_accounts WHERE is_primary=1 LIMIT 1').get()?.id || 0;
    for (const row of raw.prepare('SELECT key,value FROM config').all()) {
      const accountId = Number(row.key.match(/^yahoo:(\d+):/)?.[1] || (runtimeKeys.has(row.key) ? primaryId : 0));
      if (/(?:^|:)(?:payment_alert_message|confirm_receipt_alert_message)$/.test(row.key)) {
        const productId = String(row.value || '').match(/商品ID\s+([A-Za-z0-9]+)/)?.[1];
        if (productId && (unshared.has(productId) || pairs.has(`${accountId}:${productId}`)))
          raw.prepare('UPDATE config SET value=? WHERE key=?').run('',row.key);
        continue;
      }
      if (!/^\s*[\[{]/.test(row.value || '')) continue;
      let data;
      try { data = JSON.parse(row.value); } catch { continue; }
      const next = prune(data, accountId);
      if (row.key === 'auction_history_queue' && next !== remove && data.ids?.[0] !== next.ids?.[0]) {
        delete next.claim; delete next.leaseUntil; delete next.accountId; delete next.instanceId;
      }
      const value = next === remove ? '' : JSON.stringify(next);
      if (value !== JSON.stringify(data)) raw.prepare('UPDATE config SET value=? WHERE key=?').run(value,row.key);
    }
    const queueRow = raw.prepare("SELECT value FROM config WHERE key='auction_history_queue'").get();
    if (queueRow?.value) {
      const queue = JSON.parse(queueRow.value);
      if (!queue.ids?.length) raw.prepare("UPDATE config SET value='0' WHERE key='auction_history_requested'").run();
    }
    raw.prepare("UPDATE users SET parent_user_id=NULL WHERE parent_user_id=?").run(id);
    raw.prepare('DELETE FROM users WHERE id=?').run(id);
    raw.exec('DROP TABLE user_delete_orders; DROP TABLE user_delete_tasks;');
    return { success: true, ...counts };
  }).immediate();
}

module.exports = { deleteUser, CONFIRM_MESSAGE };
