const { randomUUID } = require('crypto');
const EXPIRED = '数据已过期';
function raw(database) { return database.raw || database.db || database; }
function get(database, key, fallback = '') {
  return raw(database).prepare('SELECT value FROM config WHERE key = ?').get(key)?.value ?? fallback;
}
function set(database, key, value) {
  raw(database).prepare('INSERT INTO config (key,value,updated_at) VALUES (?,?,CURRENT_TIMESTAMP) ON CONFLICT(key) DO UPDATE SET value=excluded.value,updated_at=CURRENT_TIMESTAMP').run(key, String(value));
}
function eligible(database, now = Date.now()) {
  return raw(database).prepare(`SELECT p.product_id, p.end_time FROM products p
    WHERE COALESCE(p.auction_history_html,'')='' AND COALESCE(p.auction_history_data,'')=''
    AND (EXISTS(SELECT 1 FROM tasks t WHERE t.product_id=p.product_id)
      OR EXISTS(SELECT 1 FROM orders o WHERE o.product_id=p.product_id))
    ORDER BY p.end_time DESC,p.product_id`).all().filter(p => {
      const text = String(p.end_time || '');
      // Product snapshots use ISO timestamps; unqualified legacy values are Yahoo local time.
      const ms = Date.parse(/[zZ]|[+-]\d\d:\d\d$/.test(text) ? text : text.replace(' ', 'T') + '+09:00');
      return Number.isFinite(ms) && ms <= now;
    }).map(p => p.product_id);
}
function request(database, now = Date.now()) {
  return raw(database).transaction(() => {
    if (get(database, 'auction_history_requested') === '1') return { success: true, queued: true };
    set(database, 'auction_history_queue', JSON.stringify({ token: randomUUID(), ids: eligible(database, now) }));
    set(database, 'auction_history_requested', '1');
    return { success: true, queued: true };
  })();
}
function schedule(database, now = Date.now()) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', {timeZone:'Asia/Shanghai',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',hourCycle:'h23'}).formatToParts(now).map(p=>[p.type,p.value]));
  const day = `${parts.year}-${parts.month}-${parts.day}`;
  const time = get(database, 'auction_history_time', '01:20');
  if (`${parts.hour}:${parts.minute}` < time || get(database,'auction_history_last_date') === day) return;
  raw(database).transaction(() => { request(database, now); set(database,'auction_history_last_date',day); })();
}
function next(database, now = Date.now(), excluded = []) {
  return raw(database).transaction(() => {
    if (get(database,'auction_history_requested') !== '1') return null;
    const queue = JSON.parse(get(database,'auction_history_queue','{}'));
    if (!queue.ids?.length) { set(database,'auction_history_requested','0'); return null; }
    if (queue.leaseUntil > now) return null;
    const index = queue.ids.findIndex(id => !excluded.includes(id));
    if (index < 0) return null;
    if (index > 0) queue.ids.unshift(queue.ids.splice(index,1)[0]);
    queue.claim = randomUUID(); queue.leaseUntil = now + 10 * 60 * 1000;
    set(database,'auction_history_queue',JSON.stringify(queue));
    return { productId: queue.ids[0], token: queue.token, claim: queue.claim };
  })();
}
function escapeHtml(value) { return String(value ?? '').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c])); }
function buildHtml(rows) {
  return '<div class="auction-history"><h3>入札履歴</h3><p>すべての入札履歴（第一页）</p><table style="width:100%;border-collapse:collapse;font-size:12px">' + rows.map(r=>`<tr><td style="padding:8px;border-bottom:1px solid #ddd;white-space:nowrap">${escapeHtml(r.rawTime)}</td><td style="padding:8px;border-bottom:1px solid #ddd">👤 ${escapeHtml(r.text)}</td></tr>`).join('') + '</table>' + (rows.length ? '' : '<p>入札履歴はありません</p>') + '</div>';
}
function normalizeRows(rows) {
  if (!Array.isArray(rows) || rows.length > 100000) throw new Error('invalid history rows');
  const seen = new Set(); const result = []; let start;
  for (const row of rows) {
    if (!/^\d{1,2}-\d{1,2} \d{2}:\d{2}$/.test(row.time) || typeof row.username !== 'string' || row.username.length > 512 || !Number.isSafeInteger(row.price) || row.price < 0) throw new Error('invalid history record');
    const item = {time:row.time,username:row.username,price:row.price};
    if (row.start === true) {
      // Read the original text too, so an older plugin cannot store its hardcoded 1.
      const amount = String(row.text || '').match(/オークション開始。\s*数量\s*[:：]\s*\d+\s*で\s*([\d,]+)\s*(?:円)?((?:\s*[(（]\s*[\d,]+\s*(?:円)?\s*[)）])*)\s*$/);
      if (row.text && !amount) throw new Error('auction start price missing');
      const parentheses = amount ? [...amount[2].matchAll(/[(（]\s*([\d,]+)/g)] : [];
      const price = amount ? Number((parentheses.at(-1)?.[1] || amount[1]).replace(/,/g,'')) : item.price;
      if (!Number.isSafeInteger(price) || price < 0) throw new Error('invalid auction start price');
      start = {...item,username:'开始',price}; continue;
    }
    if (!seen.has(row.time)) { seen.add(row.time); result.push(item); }
  }
  if (rows.length && !start) throw new Error('auction start missing');
  if (start) result.push(start);
  return result;
}
function correctedEndTime(original, historyTime) {
  const format = String(original || '').match(/^(\d{4})-\d{2}-\d{2}([ T])\d{2}:\d{2}(?::(\d{2}))?(?:\.(\d{1,3}))?([zZ]|[+-]\d{2}:\d{2})?$/);
  const parts = String(historyTime || '').match(/^(\d{1,2})-(\d{1,2}) (\d{2}):(\d{2})$/);
  if (!format || !parts) return null;
  // History uses Yahoo/Japan time. A legacy timestamp without a zone uses the same clock.
  const oldMs = Date.parse(String(original).replace(' ', 'T') + (format[5] ? '' : '+09:00'));
  if (!Number.isFinite(oldMs)) return null;
  const [, monthText, dayText, hourText, minuteText] = parts;
  const [month, day, hour, minute] = [monthText, dayText, hourText, minuteText].map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;
  const japanYear = new Date(oldMs + 9 * 3600000).getUTCFullYear();
  // Auctions may cross New Year; use the occurrence nearest the existing end time.
  const candidates = [japanYear - 1, japanYear, japanYear + 1].map(year => {
    const localMs = Date.UTC(year, month - 1, day, hour, minute);
    const date = new Date(localMs);
    if (date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return localMs - 9 * 3600000;
  }).filter(ms => ms !== null).sort((a,b) => Math.abs(a-oldMs)-Math.abs(b-oldMs));
  const latestMs = candidates[0];
  if (latestMs === undefined || latestMs <= oldMs) return null;
  const zone = format[5] || '';
  const offset = !zone ? 540 : /^[zZ]$/.test(zone) ? 0 :
    (zone[0] === '-' ? -1 : 1) * (Number(zone.slice(1,3))*60 + Number(zone.slice(4,6)));
  const local = new Date(latestMs + offset * 60000).toISOString();
  return local.slice(0,10) + format[2] + local.slice(11,16) +
    (format[3] !== undefined ? ':00' : '') + (format[4] ? '.' + '0'.repeat(format[4].length) : '') + zone;
}
function finish(database, payload) {
  return raw(database).transaction(() => {
    const queue = JSON.parse(get(database,'auction_history_queue','{}'));
    if (queue.token !== payload.token || queue.claim !== payload.claim || queue.ids?.[0] !== payload.productId) return {success:false,stale:true};
    let failure = String(payload.error || '').slice(0,500);
    let data; let html;
    if (!payload.expired && !failure) {
      try {
        data = normalizeRows(payload.rows);
        if (!Array.isArray(payload.firstPageRows) || payload.firstPageRows.length > 100) throw new Error('invalid first page');
        html = buildHtml(payload.firstPageRows);
      } catch (error) { failure = error.message; }
    }
    if (payload.expired === true) {
      raw(database).prepare("UPDATE products SET auction_history_html=?,auction_history_data=? WHERE product_id=? AND COALESCE(auction_history_html,'')='' AND COALESCE(auction_history_data,'')=''").run(EXPIRED,EXPIRED,payload.productId);
    } else if (!failure) {
      const saved = raw(database).prepare("UPDATE products SET auction_history_html=?,auction_history_data=? WHERE product_id=? AND COALESCE(auction_history_html,'')='' AND COALESCE(auction_history_data,'')=''").run(html,JSON.stringify(data),payload.productId);
      if (saved.changes && data.length) {
        const product = raw(database).prepare(`SELECT p.end_time,
          EXISTS(SELECT 1 FROM orders o WHERE o.product_id=p.product_id
            OR EXISTS(SELECT 1 FROM tasks t WHERE t.id=o.task_id AND t.product_id=p.product_id))
          OR EXISTS(SELECT 1 FROM tasks t WHERE t.product_id=p.product_id AND t.status='success') AS won
          FROM products p WHERE p.product_id=?`).get(payload.productId);
        const endTime = product && !product.won ? correctedEndTime(product.end_time, data[0].time) : null;
        if (endTime) {
          raw(database).prepare('UPDATE products SET end_time=?,current_price=? WHERE product_id=?')
            .run(endTime,data[0].price,payload.productId);
        }
      }
    }
    queue.ids.shift(); delete queue.claim; delete queue.leaseUntil;
    if (failure) {
      queue.failures = queue.failures || {};
      const attempts = (queue.failures[payload.productId]?.attempts || 0) + 1;
      queue.failures[payload.productId] = {productId:payload.productId,attempts,error:failure};
      if (attempts < 3) queue.ids.push(payload.productId);
    } else if (queue.failures) { delete queue.failures[payload.productId]; }
    set(database,'auction_history_queue',JSON.stringify(queue));
    if (!queue.ids.length) {
      set(database,'auction_history_requested','0');
      const failed = Object.values(queue.failures || {}).filter(item=>item.attempts>=3);
      if (failed.length) {
        const alerts = getAlerts(database);
        alerts.push({id:queue.token,createdAt:new Date().toISOString(),items:failed});
        set(database,'auction_history_alerts',JSON.stringify(alerts));
      }
    }
    return {success:true,retry:!!failure && (queue.failures[payload.productId]?.attempts || 0)<3};
  })();
}
function clearProductHistory(database, productId, now = Date.now()) {
  return raw(database).transaction(() => {
    const queue = JSON.parse(get(database,'auction_history_queue','{}'));
    if (get(database,'auction_history_requested') === '1' && queue.ids?.[0] === productId && queue.claim && queue.leaseUntil > now) {
      return {productId,success:false,error:'该商品正在采集，请完成后再清空'};
    }
    const result = raw(database).prepare('UPDATE products SET auction_history_html=NULL,auction_history_data=NULL WHERE product_id=?').run(productId);
    if (result.changes && queue.ids?.[0] === productId && queue.claim) {
      delete queue.claim; delete queue.leaseUntil;
      set(database,'auction_history_queue',JSON.stringify(queue));
    }
    return {productId,success:result.changes > 0,error:result.changes ? undefined : '商品不存在'};
  })();
}
function getAlerts(database) { return JSON.parse(get(database,'auction_history_alerts','[]')); }
function closeAlert(database,id) {
  return raw(database).transaction(()=>{
    const alerts = getAlerts(database);
    const remaining = alerts.filter(alert=>alert.id!==id);
    set(database,'auction_history_alerts',JSON.stringify(remaining));
    return {success:true,closed:alerts.length-remaining.length};
  })();
}
module.exports = {EXPIRED,get,set,eligible,request,schedule,next,finish,normalizeRows,buildHtml,correctedEndTime,clearProductHistory,getAlerts,closeAlert};
