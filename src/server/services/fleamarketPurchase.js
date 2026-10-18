const { isStoredFleamarketProduct: isFleamarketProduct } = require('../../shared/fleamarket.cjs');
const { randomUUID } = require('crypto');

function fail(message) { const error = new Error(message); error.statusCode = 409; throw error; }

// Both endpoints run inside the plugin's account/instance/claim middleware.
function purchaseTask(raw, id, context, claim) {
  const task = raw.prepare('SELECT t.*,p.product_type FROM tasks t LEFT JOIN products p ON p.product_id=t.product_id WHERE t.id=? AND t.account_id=?').get(id, context.accountId);
  if (!task || !task.claim_token || task.claim_token !== claim || task.claim_instance !== context.instanceId ||
      !isFleamarketProduct(task) || task.bid_mode !== 'buyout' || task.strategy !== 'direct') fail('フリマ购买任务或领取已失效');
  return task;
}

function beginPurchase(raw, id, context, claim, evidence) {
  return raw.transaction(() => {
    const task = purchaseTask(raw, id, context, claim);
    if (task.status !== 'processing' || task.execution_unknown ||
        raw.prepare('SELECT 1 FROM tasks WHERE product_id=? AND execution_unknown=1 AND id<>?').get(task.product_id,id) ||
        raw.prepare('SELECT 1 FROM orders WHERE product_id=?').get(task.product_id)) fail('购买已确认或结果待核对，不可重复购买');
    const itemPrice = evidence?.itemPrice;
    if (!Number.isSafeInteger(itemPrice) || itemPrice <= 0 || itemPrice !== Number(task.max_price)) fail('フリマ确认商品价格必须等于任务提交价格');
    // Persist BEFORE the irreversible click. An interrupted worker must never buy again.
    raw.prepare('UPDATE tasks SET execution_unknown=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
    return { success: true };
  })();
}

// Reclaim ONLY uncertain purchases for read-only done-page verification. Never
// turn them back into ordinary pending tasks or authorize another purchase click.
function claimRecovery(raw, context, limit = 1, now = Date.now()) {
  return raw.transaction(() => {
    const concurrency = Math.max(1, Math.min(10, Number(raw.prepare("SELECT value FROM config WHERE key='bid_concurrency_limit'").get()?.value || 2)));
    const active = raw.prepare("SELECT COUNT(*) n FROM tasks WHERE account_id=? AND status='processing' AND datetime(updated_at)>datetime(?)").get(context.accountId,new Date(now-120000).toISOString()).n;
    const count = Math.min(Math.max(0,concurrency-active), Math.max(0,Math.min(10,Number(limit)||0)));
    if (!count) return [];
    const candidates = raw.prepare(`SELECT t.*,p.product_url,p.product_type FROM tasks t
      LEFT JOIN products p ON p.product_id=t.product_id
      WHERE t.account_id=? AND t.execution_unknown=1 AND t.status IN ('processing','failed')
      AND t.bid_mode='buyout' AND t.strategy='direct' AND datetime(t.updated_at)<=datetime(?)
      AND p.product_type='fleamarket'
      AND NOT EXISTS(SELECT 1 FROM orders o WHERE o.product_id=t.product_id OR o.task_id=t.id)
      ORDER BY t.updated_at,t.id`).all(context.accountId,new Date(now-120000).toISOString())
      .filter(isFleamarketProduct).slice(0,count);
    return candidates.map(task => {
      const token = randomUUID();
      raw.prepare("UPDATE tasks SET status='processing',claim_token=?,claim_instance=?,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(token,context.instanceId,task.id);
      return {...task,status:'processing',claim_token:token,claim_instance:context.instanceId,fleamarket_recovery_only:true};
    });
  })();
}

function completePurchase(raw, id, context, claim, evidence) {
  return raw.transaction(() => {
    const task = purchaseTask(raw, id, context, claim);
    const productId = String(task.product_id).toLowerCase();
    if (evidence?.doneUrl !== `https://paypayfleamarket-sec.yahoo.co.jp/item/${productId}/order/done` ||
        !/購入が完了しました/.test(String(evidence?.successText || '').replace(/\s+/g, ''))) fail('未确认同商品的購入完成页');
    const existing = raw.prepare('SELECT * FROM orders WHERE product_id=? OR task_id=?').all(task.product_id, id);
    if (existing.length) {
      if (existing.length === 1 && existing[0].task_id === Number(id) && existing[0].account_id === context.accountId && task.status === 'success') {
        return { success: true, duplicate: true, orderId: existing[0].id };
      }
      fail('该商品已有其他订单，拒绝覆盖');
    }
    if (!['processing', 'failed'].includes(task.status) || !task.execution_unknown) fail('购买任务状态已改变');
    // P orders settle at the submitted product price, already verified before
    // final confirmation. Coupons/points and the actual payment are irrelevant.
    const amount = Number(task.max_price);
    if (!Number.isSafeInteger(amount) || amount <= 0) fail('フリマ任务商品价格无效');
    const transactionUrl = `https://paypayfleamarket-sec.yahoo.co.jp/item/${productId}/trade/buyer`;
    const now = new Date();
    const japan = new Date(now.getTime() + 9 * 3600000);
    const pad = value => String(value).padStart(2, '0');
    const timeText = `${pad(japan.getUTCMonth() + 1)}/${pad(japan.getUTCDate())} ${pad(japan.getUTCHours())}:${pad(japan.getUTCMinutes())}`;
    const result = raw.prepare(`INSERT INTO orders
      (task_id,product_id,account_id,final_price,won_at,won_time_text,transaction_url,order_status)
      VALUES(?,?,?,?,?,?,?,'pending_shipment')`).run(id, task.product_id, context.accountId, amount, now.toISOString(), timeText, transactionUrl);
    raw.prepare("UPDATE tasks SET status='success',error_msg=NULL,execution_unknown=0,buyout_auto_paid=1,is_highest_bidder=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    raw.prepare(`INSERT INTO order_status_change_logs(order_id,product_id,new_status,source)
      VALUES(?,?,'pending_shipment','fleamarket_purchase')`).run(result.lastInsertRowid,task.product_id);
    return { success: true, orderId: Number(result.lastInsertRowid) };
  })();
}

module.exports = { beginPurchase, completePurchase, claimRecovery };
