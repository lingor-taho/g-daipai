const { isStoredFleamarketProduct: isFleamarketProduct } = require('../../shared/fleamarket.cjs');
const { randomUUID } = require('crypto');
const { normalizeYahooWonTimeText } = require('./yahooWonTime');
const PIN_LOCK_KEY = 'fleamarket_pin_lock';
const PIN_LOCK_MESSAGE = 'paypay商品暂时锁定，请联系管理员！';
const PIN_FAILURE = '因为pin失败';

function fail(message) { const error = new Error(message); error.statusCode = 409; throw error; }

// Both endpoints run inside the plugin's account/instance/claim middleware.
function purchaseTask(raw, id, context, claim) {
  const task = raw.prepare('SELECT t.*,p.product_type FROM tasks t LEFT JOIN products p ON p.product_id=t.product_id WHERE t.id=? AND t.account_id=?').get(id, context.accountId);
  if (!task || !task.claim_token || task.claim_token !== claim || task.claim_instance !== context.instanceId ||
      !isFleamarketProduct(task) || task.bid_mode !== 'buyout' || task.strategy !== 'direct') fail('フリマ购买任务或领取已失效');
  return task;
}

function getPinLock(raw) {
  const row = raw.prepare('SELECT value FROM config WHERE key=?').get(PIN_LOCK_KEY);
  return row ? JSON.parse(row.value) : null;
}

function assertPinUnlocked(raw) {
  if (getPinLock(raw)) fail(PIN_LOCK_MESSAGE);
}

function assertPurchaseSubmissionAllowed(raw, productId) {
  assertPinUnlocked(raw);
  if (raw.prepare('SELECT 1 FROM orders WHERE product_id=?').get(productId)) {
    fail('该フリマ商品已有成交订单，请勿重复提交');
  }
  if (raw.prepare("SELECT 1 FROM tasks WHERE product_id=? AND status IN ('pending','processing')").get(productId)) {
    fail('该フリマ商品已有待执行任务，请勿重复提交');
  }
}

function failForPin(raw, id, context, claim) {
  return raw.transaction(() => {
    const task = purchaseTask(raw, id, context, claim);
    if (task.status === 'failed' && task.error_msg === PIN_FAILURE) return { success: true, duplicate: true };
    if (task.status !== 'processing') fail('任务已结束本次执行，拒绝迟到回写');
    raw.prepare("UPDATE tasks SET status='failed',error_msg=?,is_highest_bidder=0,updated_at=CURRENT_TIMESTAMP WHERE id=?")
      .run(PIN_FAILURE, task.id);
    raw.prepare('INSERT OR IGNORE INTO config (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP)')
      .run(PIN_LOCK_KEY, JSON.stringify({ taskId: task.id, productId: task.product_id }));
    return { success: true };
  }).immediate();
}

function reopenAfterPin(raw, taskId) {
  return raw.transaction(() => {
    const lock = getPinLock(raw);
    if (!lock) return { success: true };
    if (lock.taskId !== taskId) fail('P商品锁定已变化，请刷新后再操作');
    raw.prepare('DELETE FROM config WHERE key=?').run(PIN_LOCK_KEY);
    return { success: true };
  }).immediate();
}

function beginPurchase(raw, id, context, claim, evidence) {
  return raw.transaction(() => {
    const task = purchaseTask(raw, id, context, claim);
    if (task.status !== 'processing' || task.execution_unknown ||
        raw.prepare("SELECT 1 FROM tasks WHERE product_id=? AND status='processing' AND execution_unknown=1 AND id<>?").get(task.product_id,id) ||
        raw.prepare('SELECT 1 FROM orders WHERE product_id=?').get(task.product_id)) fail('已有成交或正在确认购买，请勿重复购买');
    const itemPrice = evidence?.itemPrice;
    if (!Number.isSafeInteger(itemPrice) || itemPrice <= 0 || itemPrice !== Number(task.max_price)) fail('フリマ确认商品价格必须等于任务提交价格');
    // Persist BEFORE the irreversible click. An interrupted worker must never buy again.
    raw.prepare('UPDATE tasks SET execution_unknown=1,updated_at=CURRENT_TIMESTAMP WHERE id=?').run(id);
    return { success: true };
  })();
}

// Reclaim ONLY interrupted, still-processing purchases for read-only verification.
// Failed P tasks stay stopped, including failures of a previous recovery attempt.
// Never turn uncertain purchases into pending tasks or authorize another click.
function claimRecovery(raw, context, limit = 1, now = Date.now()) {
  return raw.transaction(() => {
    const concurrency = Math.max(1, Math.min(10, Number(raw.prepare("SELECT value FROM config WHERE key='bid_concurrency_limit'").get()?.value || 2)));
    const active = raw.prepare("SELECT COUNT(*) n FROM tasks WHERE account_id=? AND status='processing' AND datetime(updated_at)>datetime(?)").get(context.accountId,new Date(now-120000).toISOString()).n;
    const count = Math.min(Math.max(0,concurrency-active), Math.max(0,Math.min(10,Number(limit)||0)));
    if (!count) return [];
    const candidates = raw.prepare(`SELECT t.*,p.product_url,p.product_type FROM tasks t
      LEFT JOIN products p ON p.product_id=t.product_id
      WHERE t.account_id=? AND t.execution_unknown=1 AND t.status='processing'
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
      VALUES(?,?,?,?,?,?,?,'pending_shipment')`).run(id, task.product_id, context.accountId, amount, normalizeYahooWonTimeText(timeText, now.getTime()), timeText, transactionUrl);
    raw.prepare("UPDATE tasks SET status='success',error_msg=NULL,execution_unknown=0,buyout_auto_paid=1,is_highest_bidder=0,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(id);
    raw.prepare(`INSERT INTO order_status_change_logs(order_id,product_id,new_status,source)
      VALUES(?,?,'pending_shipment','fleamarket_purchase')`).run(result.lastInsertRowid,task.product_id);
    return { success: true, orderId: Number(result.lastInsertRowid) };
  })();
}

module.exports = { beginPurchase, completePurchase, claimRecovery, getPinLock, assertPinUnlocked, assertPurchaseSubmissionAllowed, failForPin, reopenAfterPin };
