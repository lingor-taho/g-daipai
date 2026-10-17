const assert = require('assert/strict');
const Database = require('better-sqlite3');
const { buildWonDateCleanupCutoff, previewWonDateCleanup, runWonDateCleanup } = require('./forceDateCleanup');
const { withProductSubmissionLock } = require('./productSubmissionLock');

function fixture() {
  const raw = new Database(':memory:');
  raw.exec(`CREATE TABLE products(product_id TEXT PRIMARY KEY);
    CREATE TABLE tasks(id INTEGER PRIMARY KEY, product_id TEXT, account_id INTEGER, user_id INTEGER);
    CREATE TABLE orders(id INTEGER PRIMARY KEY, product_id TEXT, task_id INTEGER, won_at TEXT);
    CREATE TABLE yahoo_product_assignments(product_id TEXT, account_id INTEGER, user_id INTEGER, task_id INTEGER);
    CREATE TABLE bidding_items(product_id TEXT);
    CREATE TABLE bid_logs(task_id INTEGER);
    CREATE TABLE order_status_change_logs(product_id TEXT,order_id INTEGER);
    CREATE TABLE yahoo_trade_messages(product_id TEXT,order_id INTEGER);
    CREATE TABLE plugin_diagnostics(product_id TEXT,order_id INTEGER);
    CREATE TABLE yahoo_work_claims(kind TEXT,object_id INTEGER);
    CREATE TABLE yahoo_account_transfers(task_id INTEGER);
    CREATE TABLE manual_order_import_items(product_id TEXT,task_id INTEGER,order_id INTEGER);
    CREATE TABLE batch_task_submission_items(product_id TEXT,task_id INTEGER);
    INSERT INTO products VALUES('a111111111'),('z222222222'),('c333333333'),('d444444444');
    INSERT INTO tasks VALUES(1,'a111111111',1,1),(2,'a111111111',2,2),(3,'z222222222',1,1),(4,'c333333333',1,1),(5,'d444444444',1,1);
    INSERT INTO orders VALUES(11,NULL,1,'2026-06-08 23:59:59'),(12,'a111111111',2,'2026-10-17'),
      (13,'z222222222',NULL,'2026-06-07'),(14,'c333333333',4,'2026-06-09 00:00:00'),(15,'d444444444',5,NULL);
    INSERT INTO yahoo_product_assignments VALUES('a111111111',1,1,1),('a111111111',2,2,NULL),('z222222222',1,1,3),('c333333333',1,1,4);
    INSERT INTO bidding_items VALUES('a111111111'),('z222222222'),('c333333333');
    INSERT INTO bid_logs VALUES(1),(2),(3),(4);
    INSERT INTO order_status_change_logs VALUES(NULL,11),('z222222222',13);
    INSERT INTO yahoo_trade_messages VALUES(NULL,12),('z222222222',13);
    INSERT INTO plugin_diagnostics VALUES('a111111111',11),('z222222222',13);
    INSERT INTO yahoo_work_claims VALUES('scan',11),('payment',12),('confirm-receipt',13),('manual-order-import',11);
    INSERT INTO yahoo_account_transfers VALUES(1),(3);
    INSERT INTO manual_order_import_items VALUES('a111111111',NULL,NULL),(NULL,NULL,13);
    INSERT INTO batch_task_submission_items VALUES('a111111111',NULL),(NULL,3);`);
  return {raw, getAll:async(sql,params=[])=>raw.prepare(sql).all(...params)};
}
function snapshot(db) {
  return db.raw.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name").all()
    .map(({name})=>[name,db.raw.prepare(`SELECT * FROM ${name}`).all()]);
}
(async()=>{
  assert.deepEqual(buildWonDateCleanupCutoff('2026-06-08'),{cutoffDate:'2026-06-08',cutoffExclusive:'2026-06-09 00:00:00'});
  assert.equal(buildWonDateCleanupCutoff('2024-02-29').cutoffExclusive,'2024-03-01 00:00:00');
  for(const date of ['2026-6-8','2026-02-29','invalid']) assert.throws(()=>buildWonDateCleanupCutoff(date),/valid cleanup date/);
  const db=fixture();
  try {
    const before=snapshot(db);
    const preview=await previewWonDateCleanup(db,'2026-06-08');
    assert.deepEqual(snapshot(db),before,'preview is read-only');
    assert.deepEqual(preview.productIds,['a111111111','z222222222']);
    assert.equal(preview.assignmentCount,3);assert.equal(preview.taskCount,3);assert.equal(preview.orderCount,3);
    assert.equal(preview.workClaimCount,3);assert.equal(preview.batchItemCount,2);
    assert.equal(preview.manualImportItemCount,2);
    db.raw.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON products WHEN OLD.product_id='z222222222' BEGIN SELECT RAISE(ABORT,'rollback whole date batch'); END");
    await assert.rejects(runWonDateCleanup(db,'2026-06-08'),/rollback whole date batch/);
    assert.deepEqual(snapshot(db),before,'failure on the second product restores the entire date batch');
    db.raw.exec('DROP TRIGGER reject_delete');
    const result=await runWonDateCleanup(db,'2026-06-08');
    assert.deepEqual({...result,dryRun:true},preview,'preview and actual counts match');
    assert.deepEqual(db.raw.prepare('SELECT product_id FROM products ORDER BY product_id').all(),[{product_id:'c333333333'},{product_id:'d444444444'}]);
    assert.equal(db.raw.prepare('SELECT count(*) n FROM tasks').get().n,2);
    assert.equal(db.raw.prepare('SELECT count(*) n FROM orders').get().n,2);
    assert.deepEqual(db.raw.prepare('SELECT * FROM yahoo_work_claims').all(),[{kind:'manual-order-import',object_id:11}]);
    assert.equal((await runWonDateCleanup(db,'2026-06-08')).totalCount,0);
  } finally {db.raw.close();}
  const waiting=fixture();
  try {
    let release,entered;
    const ready=new Promise(resolve=>{entered=resolve;});const gate=new Promise(resolve=>{release=resolve;});
    const hold=withProductSubmissionLock('a111111111',async()=>{entered();await gate;
      waiting.raw.exec("DELETE FROM orders WHERE id IN (11,12); DELETE FROM tasks WHERE product_id='a111111111'; INSERT INTO tasks VALUES(99,'a111111111',1,2)");
    });
    await ready;
    const deleting=runWonDateCleanup(waiting,'2026-06-08');
    await new Promise(resolve=>setImmediate(resolve));release();await hold;
    const result=await deleting;
    assert.deepEqual(result.productIds,['z222222222']);
    assert.equal(waiting.raw.prepare('SELECT user_id FROM tasks WHERE id=99').get().user_id,2,'new submission survives eligibility recheck');
    assert.ok(waiting.raw.prepare("SELECT 1 FROM products WHERE product_id='a111111111'").get());
  } finally {waiting.raw.close();}
  console.log('forceDateCleanup real SQLite tests passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
