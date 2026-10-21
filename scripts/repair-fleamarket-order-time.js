const fs = require('fs');
const path = require('path');
const { randomUUID } = require('crypto');
const Database = require('better-sqlite3');
const { normalizeYahooWonTimeText } = require('../src/server/services/yahooWonTime');

const projectRoot = path.resolve(__dirname, '..');

function japanTimeText(ms) {
  const date = new Date(ms + 9 * 3600000);
  const pad = value => String(value).padStart(2, '0');
  return `${pad(date.getUTCMonth()+1)}/${pad(date.getUTCDate())} ${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}`;
}

function classifyOrder(row) {
  const match = String(row.won_time_text || '').trim().match(/^(\d{1,2})\/(\d{1,2})\s+(\d{1,2}):(\d{2})$/);
  const original = String(row.won_at || '').trim();
  const oldMs = /T.*(?:Z|[+-]\d{2}:\d{2})$/i.test(original) ? Date.parse(original) : NaN;
  if (!match || !Number.isFinite(oldMs)) return { ...row, reason: 'missing_or_invalid_time' };
  const normalizedText = `${match[1].padStart(2,'0')}/${match[2].padStart(2,'0')} ${match[3].padStart(2,'0')}:${match[4]}`;
  // Infer the year from the original order, not from today's date. Never add
  // an hour blindly: new-format orders must remain unchanged on repeated runs.
  const nextWonAt = normalizeYahooWonTimeText(normalizedText, oldMs);
  const nextMs = Date.parse(nextWonAt);
  if (nextMs === oldMs) return { ...row, reason: 'already_aligned' };
  if (!Number.isFinite(nextMs) || Math.abs(nextMs-oldMs) > 24*3600000) {
    return { ...row, reason: 'ambiguous_year_or_offset' };
  }
  // Old P orders stored the actual UTC completion instant and generated their
  // Japan text from exactly that instant. Require that evidence before repair.
  if (japanTimeText(oldMs) !== normalizedText) return { ...row, reason: 'not_legacy_p_time' };
  return { ...row, next_won_at: nextWonAt, reason: 'repair_legacy_p_time' };
}

function buildPlan(db) {
  return db.prepare(`SELECT o.id, COALESCE(o.product_id,t.product_id) AS product_id, o.won_at, o.won_time_text
    FROM orders o LEFT JOIN tasks t ON t.id=o.task_id
    JOIN products p ON p.product_id=COALESCE(o.product_id,t.product_id)
    WHERE p.product_type='fleamarket' ORDER BY o.id`).all().map(classifyOrder);
}

async function repairDatabase(dbPath, { apply = false } = {}) {
  const resolved = path.resolve(dbPath);
  const db = new Database(resolved,{readonly:!apply,fileMustExist:true});
  db.pragma('busy_timeout = 5000');
  // Standalone administrative maintenance, with the same unscoped account
  // context as the authenticated admin API. Do not import models/migrations.
  db.function('current_yahoo_account',()=>0);
  try {
    const rows = buildPlan(db);
    const changes = rows.filter(row=>row.next_won_at);
    const result = { database:resolved, timezone:Intl.DateTimeFormat().resolvedOptions().timeZone,
      apply, p_order_count:rows.length, repair_count:changes.length, rows, applied_count:0 };
    if (!apply || !changes.length) return result;
    const backupPath = `${resolved}.fleamarket-time-${Date.now()}-${randomUUID()}.db`;
    // SQLite's online backup includes committed WAL content; copying just the
    // .db file while the API is running would not be a reliable backup.
    await db.backup(backupPath);
    const backup = new Database(backupPath,{readonly:true,fileMustExist:true});
    try {
      if (backup.pragma('quick_check',{simple:true}) !== 'ok') throw new Error('Backup validation failed; no orders changed');
    } finally { backup.close(); }
    result.backup = backupPath;
    fs.writeFileSync(`${backupPath}.changes.json`,JSON.stringify(result,null,2),{flag:'wx'});
    const applyPlan = db.transaction(()=>{
      const update = db.prepare(`UPDATE orders SET won_at=? WHERE id=? AND won_at=? AND won_time_text=?
        AND EXISTS(SELECT 1 FROM products p LEFT JOIN tasks t ON t.id=orders.task_id
          WHERE p.product_id=COALESCE(orders.product_id,t.product_id) AND p.product_type='fleamarket')`);
      for (const row of changes) {
        if (update.run(row.next_won_at,row.id,row.won_at,row.won_time_text).changes !== 1) {
          throw new Error(`Order ${row.id} changed after preview; entire repair rolled back. Run preview again.`);
        }
        const saved=db.prepare('SELECT won_at,won_time_text FROM orders WHERE id=?').get(row.id);
        if (saved.won_at !== row.next_won_at || saved.won_time_text !== row.won_time_text) {
          throw new Error(`Order ${row.id} verification failed; entire repair rolled back`);
        }
      }
    });
    applyPlan.immediate();
    result.applied_count=changes.length;
    return result;
  } finally { db.close(); }
}

async function main() {
  require('dotenv').config({path:path.join(projectRoot,'.env')});
  let apply=false;
  let databaseUrl=process.env.DATABASE_URL || 'sqlite:./data/gdaipai.db';
  for (let i=2;i<process.argv.length;i++) {
    const arg=process.argv[i];
    if (arg==='--apply') apply=true;
    else if (arg==='--database' && process.argv[i+1]) databaseUrl=process.argv[++i];
    else if (arg==='--help') {
      console.log('Preview: node scripts/repair-fleamarket-order-time.js [--database <sqlite-path>]');
      console.log('Repair with verified backup: add --apply');
      return;
    } else throw new Error(`Unknown or incomplete argument: ${arg}`);
  }
  if (/^[a-z]+:/i.test(databaseUrl) && !databaseUrl.startsWith('sqlite:') && !/^[a-z]:[\\/]/i.test(databaseUrl)) {
    throw new Error('Only a local SQLite database is supported');
  }
  const filename=databaseUrl.startsWith('sqlite:') ? databaseUrl.slice(7).replace(/^\/\//,'') : databaseUrl;
  const result=await repairDatabase(path.resolve(projectRoot,filename),{apply});
  console.log(JSON.stringify(result,null,2));
  console.log(apply ? `Repair finished: ${result.applied_count} P orders updated.` : 'Preview only. No changes made. Add --apply to repair.');
}

if (require.main===module) main().catch(error=>{console.error(error.message);process.exitCode=1;});
module.exports={classifyOrder,buildPlan,repairDatabase};
