const accountScope = require('./yahooAccountContext');

function deleteProductData(raw, productId, {dryRun = false} = {}) {
  // An admin explicitly deletes the whole product, across all Yahoo accounts.
  return accountScope.run(null, () => {
    const operation = raw.transaction(() => {
      const tables = new Set(raw.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
      const taskIds = raw.prepare('SELECT id FROM tasks WHERE product_id=? ORDER BY id').all(productId).map(row => row.id);
      const orders = raw.prepare(`SELECT id FROM orders WHERE product_id=? OR task_id IN
        (SELECT id FROM tasks WHERE product_id=?) ORDER BY id`).all(productId,productId);
      const orderIds = orders.map(row => row.id);
      const remove = (table, where, params) => !tables.has(table) ? 0 : dryRun
        ? raw.prepare(`SELECT COUNT(*) count FROM ${table} WHERE ${where}`).get(...params).count
        : raw.prepare(`DELETE FROM ${table} WHERE ${where}`).run(...params).changes;
      const byTask = 'task_id IN (SELECT id FROM tasks WHERE product_id=?)';
      const byOrder = `order_id IN (SELECT id FROM orders WHERE product_id=? OR ${byTask})`;
      const counts = {};
      counts.orderStatusLogCount = remove('order_status_change_logs',`product_id=? OR ${byOrder}`,[productId,productId,productId]);
      counts.messageCount = remove('yahoo_trade_messages',`product_id=? OR ${byOrder}`,[productId,productId,productId]);
      counts.diagnosticCount = remove('plugin_diagnostics',`product_id=? OR ${byOrder}`,[productId,productId,productId]);
      counts.workClaimCount = remove('yahoo_work_claims',`kind IN ('transaction-start','scan','payment','confirm-receipt') AND object_id IN
        (SELECT id FROM orders WHERE product_id=? OR ${byTask})`,[productId,productId]);
      counts.transferCount = remove('yahoo_account_transfers',byTask,[productId]);
      counts.manualImportItemCount = remove('manual_order_import_items',`product_id=? OR ${byTask} OR ${byOrder}`,[productId,productId,productId,productId]);
      counts.batchItemCount = remove('batch_task_submission_items',`product_id=? OR ${byTask}`,[productId,productId]);
      counts.assignmentCount = remove('yahoo_product_assignments','product_id=?',[productId]);
      counts.bidLogCount = remove('bid_logs',byTask,[productId]);
      counts.orderCount = remove('orders',`product_id=? OR ${byTask}`,[productId,productId]);
      counts.biddingItemCount = remove('bidding_items','product_id=?',[productId]);
      counts.taskCount = remove('tasks','product_id=?',[productId]);
      counts.productCount = remove('products','product_id=?',[productId]);
      const totalCount = Object.values(counts).reduce((sum,count) => sum+count,0);
      return {productId,success:totalCount>0,taskIds,orderIds,...counts,totalCount,
        error:totalCount>0?undefined:'系统中没有这个商品数据'};
    });
    return dryRun ? operation.deferred() : operation.immediate();
  });
}
module.exports = { deleteProductData };
