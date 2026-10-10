const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const accounts = require('./yahooAccounts');
const scope = require('./yahooAccountContext');

function fixture(legacy=false) {
  const raw = new Database(':memory:');
  raw.pragma('foreign_keys=ON');
  raw.exec(fs.readFileSync(path.join(__dirname, '../../db/init.sql'), 'utf8'));
  raw.exec("INSERT INTO users(id,username,password_hash) VALUES(1,'user1','test'),(2,'user2','test'),(3,'user3','test'),(4,'user4','test')");
  if(legacy) raw.pragma('foreign_keys=OFF');
  if(legacy) raw.exec(`DROP TABLE bidding_items;
    CREATE TABLE bidding_items(product_id TEXT PRIMARY KEY,status TEXT,current_price REAL,updated_at TEXT);
    INSERT INTO bidding_items VALUES('z123456789','highest',1234,'2026-10-01');
    INSERT INTO config(key,value) VALUES('payment_requested','1');
    INSERT INTO tasks(user_id,product_id,max_price,status) VALUES(1,'z123456789',2000,'cancelled'),(1,'migration123456789',2000,'processing');`);
  accounts.ensureSchema(raw);
  raw.pragma('foreign_keys=ON');
  const primary = accounts.list(raw)[0].id;
  const database = { raw };
  for (const [method, sqliteMethod] of [['getOne','get'],['getAll','all'],['query','run']]) database[method] = async (sql, params) => {
    const prepared = scope.prepareQuery(sql, params, primary);
    const value = raw.prepare(prepared.sql)[sqliteMethod](...(prepared.params || []));
    return method === 'query' ? {rowCount:value.changes} : method === 'getAll' ? value.map(prepared.restore) : prepared.restore(value);
  };
  return database;
}
function add(database, name, priority) {
  return Number(database.raw.prepare('INSERT INTO yahoo_accounts(account_name,email,priority,binding_token) VALUES (?,?,?,?)').run(name,'',priority,`${name}-token`).lastInsertRowid);
}
function online(database, id) {
  database.raw.prepare('UPDATE yahoo_accounts SET instance_id=?,heartbeat_at=? WHERE id=?').run(`instance-account-${id}`,Date.now(),id);
}
function submit(database, userId, productId='a123456789') {
  return accounts.createAssignedTask(database,{userId,productId},"INSERT INTO tasks(user_id,product_id,max_price) VALUES(?,?,1000) RETURNING id,product_id",[userId,productId]);
}

(async()=>{
  const single=fixture();const only=accounts.list(single)[0].id;online(single,only);
  assert.equal(submit(single,1).account_id,only);
  assert.throws(()=>submit(single,2),/暂无可用/,'only A uses the new protocol without admitting a second user');
  single.raw.close();
  const legacy=fixture(true);const legacyA=accounts.list(legacy)[0].id;
  assert.equal(legacy.raw.prepare('SELECT current_price,account_id FROM bidding_items').get().current_price,1234);
  assert.equal(legacy.raw.prepare('SELECT account_id FROM bidding_items').get().account_id,legacyA);
  assert.equal(legacy.raw.prepare("SELECT user_id FROM yahoo_product_assignments WHERE product_id='z123456789'").get().user_id,1,'legacy cancelled ownership retained');
  assert.equal(legacy.raw.prepare("SELECT execution_unknown FROM tasks WHERE product_id='migration123456789'").get().execution_unknown,1,'unfinished legacy task cannot be replayed after upgrade');
  assert.equal((await legacy.getOne("SELECT value FROM config WHERE key='payment_requested'")).value,'1');
  const legacyB=add(legacy,'B',1);
  legacy.raw.prepare('INSERT INTO bidding_items(account_id,product_id,status,current_price) VALUES(?,?,?,?)').run(legacyB,'z123456789','outbid',2345);
  assert.equal(legacy.raw.prepare('SELECT COUNT(*) n FROM bidding_items').get().n,2,'legacy composite key migration preserves data and permits second account');
  legacy.raw.prepare('UPDATE yahoo_accounts SET is_primary=0 WHERE id=?').run(legacyA);
  legacy.raw.prepare('UPDATE yahoo_accounts SET is_primary=1 WHERE id=?').run(legacyB);
  accounts.ensureSchema(legacy.raw);
  assert.equal(legacy.raw.prepare('SELECT value FROM config WHERE key=?').get(scope.configKey('payment_requested',legacyB)),undefined,'changing primary never recopy old flags');
  legacy.raw.close();
  const frozen=fixture();const fa=accounts.list(frozen)[0].id,fb=add(frozen,'B',1),fc=add(frozen,'C',2);
  for(const id of [fa,fb,fc]) online(frozen,id);
  const routed=submit(frozen,1,'route123456789');
  frozen.raw.prepare('UPDATE yahoo_accounts SET priority=0 WHERE id=?').run(fc);
  frozen.raw.prepare("UPDATE tasks SET status='processing',claim_token='frozen-claim' WHERE id=?").run(routed.id);
  assert.equal(accounts.transferTask(frozen,frozen.raw.prepare('SELECT * FROM tasks WHERE id=?').get(routed.id),'SELLER_BLACKLIST').accountId,fb,'reordering backups does not change accepted task route');
  frozen.raw.prepare('UPDATE yahoo_accounts SET heartbeat_at=0 WHERE id=?').run(fb);
  assert.throws(()=>submit(frozen,1,'route123456789'),/账号离线/,'existing ownership cannot create a new waiting task or take a second account');
  frozen.raw.close();
  const db=fixture(); const a=accounts.list(db)[0].id; const b=add(db,'B',1); const c=add(db,'C',2);
  for(const id of [a,b,c]) online(db,id);
  const t1=submit(db,1),t2=submit(db,2),t3=submit(db,3);
  assert.deepEqual([t1.account_id,t2.account_id,t3.account_id],[a,b,c]);
  assert.throws(()=>submit(db,4),/暂无可用/);
  assert.equal(submit(db,1).account_id,a,'same user keeps one account');
  assert.equal(submit(db,4,'b123456789').account_id,a,'another product does not consume A globally');
  db.raw.prepare('UPDATE yahoo_accounts SET heartbeat_at=0 WHERE id=?').run(b);
  submit(db,1,'c123456789');
  assert.equal(submit(db,2,'c123456789').account_id,c,'offline candidate skipped');
  db.raw.prepare('INSERT INTO config(key,value) VALUES(?,?)').run(scope.configKey('manual_captcha_challenge',c),JSON.stringify({type:'pin'}));
  submit(db,1,'d123456789');
  assert.equal(submit(db,3,'d123456789').account_id,c,'PIN is not an admission blocker');
  db.raw.prepare('UPDATE yahoo_accounts SET heartbeat_at=0 WHERE id=?').run(c);
  submit(db,1,'e123456789');
  assert.throws(()=>submit(db,2,'e123456789'),/暂无可用/);
  assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM tasks WHERE product_id='e123456789' AND user_id=2").get().n,0,'failed admission leaves no task or reservation');
  for(const id of [b,c]) online(db,id);
  const transfer=submit(db,1,'f123456789'); submit(db,2,'f123456789');
  db.raw.prepare("UPDATE tasks SET status='processing',claim_token='claim1',claim_instance='instance-a' WHERE id=?").run(transfer.id);
  const current=db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(transfer.id);
  assert.equal(accounts.transferTask(db,current,'SELLER_BLACKLIST').accountId,c,'occupied B is skipped only for same product');
  const moved=db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(transfer.id);
  assert.equal(moved.id,current.id);assert.equal(moved.user_id,current.user_id);assert.equal(moved.max_price,current.max_price);
  assert.equal(moved.claim_token,null);
  assert.throws(()=>accounts.transferTask(db,current,'SELLER_BLACKLIST'),/失效/,'late A cannot transfer again');
  db.raw.prepare("UPDATE tasks SET status='processing',claim_token='claim2' WHERE id=?").run(moved.id);
  const exhausted=accounts.transferTask(db,db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(moved.id),'SELLER_BLACKLIST');
  assert.equal(exhausted.exhausted,true,'last available account failure terminates');
  const other=submit(db,1,'g123456789');
  db.raw.prepare("UPDATE tasks SET status='processing',claim_token='claim3',execution_unknown=1 WHERE id=?").run(other.id);
  assert.equal(accounts.transferTask(db,db.raw.prepare('SELECT * FROM tasks WHERE id=?').get(other.id),'SELLER_BLACKLIST'),null,'unknown result never transfers');
  await scope.run({accountId:b,instanceId:'instance-account-b'},async()=>{
    const rows=await db.getAll('SELECT tasks.id FROM tasks ORDER BY id');assert(rows.every(r=>db.raw.prepare('SELECT account_id FROM tasks WHERE id=?').get(r.id).account_id===b));
    const result=await db.query("UPDATE tasks SET error_msg='B-only'");
    assert(result.rowCount>0);assert.equal(db.raw.prepare("SELECT COUNT(*) n FROM tasks WHERE account_id<>? AND error_msg='B-only'").get(b).n,0);
    await db.query("INSERT OR REPLACE INTO config(key,value) VALUES('payment_requested','1')");
    assert.equal((await db.getOne("SELECT key,value FROM config WHERE key='payment_requested'")).value,'1');
    assert.equal((await db.getOne("SELECT key,value FROM config WHERE key='payment_requested'")).key,'payment_requested');
    await db.query('INSERT OR REPLACE INTO config(key,value) VALUES(?,?)',['manual_captcha_challenge','B challenge']);
    assert((await db.getAll('SELECT "tasks".id FROM "tasks"')).length>0,'quoted table identifiers remain scoped');
    const aCount=db.raw.prepare('SELECT COUNT(*) n FROM tasks WHERE account_id=?').get(a).n;
    const disposable=db.raw.prepare("INSERT INTO tasks(user_id,product_id,max_price,account_id) VALUES(2,'delete123456789',1000,?) RETURNING id").get(b);
    assert.equal((await db.query('DELETE FROM tasks WHERE id=?',[t1.id])).rowCount,0);
    await db.query('DELETE FROM tasks WHERE id=?',[disposable.id]);
    assert.equal(db.raw.prepare('SELECT id FROM tasks WHERE id=?').get(disposable.id),undefined);
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM tasks WHERE account_id=?').get(a).n,aCount,'account-scoped DELETE cannot remove A');
  });
  assert.equal((await db.getOne("SELECT value FROM config WHERE key='payment_requested'"))?.value,undefined,'B flag does not overwrite A');
  const config=scope.prepareQuery("SELECT 'tasks.id' AS literal FROM tasks -- FROM orders",[],a);
  assert.match(config.sql,/'tasks.id'/);assert.match(config.sql,/-- FROM orders/);
  const before=db.raw.prepare('SELECT COUNT(*) n FROM tasks').get().n;
  accounts.ensureSchema(db.raw);assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM tasks').get().n,before,'migration is idempotent');
  const account=accounts.list(db,Date.now(),true)[0];
  assert.throws(()=>accounts.authenticate(db,{accountId:a,token:'bad',instanceId:'valid-instance-0001'}),/绑定无效/);
  assert.throws(()=>accounts.authenticate(db,{accountId:a,token:account.binding_token,instanceId:'different-instance-0001'}),/在线插件/);
  assert.equal(accounts.authenticate(db,{accountId:a,token:account.binding_token,instanceId:`instance-account-${a}`}).accountId,a);
  db.raw.close();console.log('Yahoo account migration, allocation, fallback and SQL isolation tests passed.');
})().catch(e=>{console.error(e);process.exitCode=1;});
