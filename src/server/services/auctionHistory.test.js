const assert = require('assert/strict');
const Database = require('better-sqlite3');
const history = require('./auctionHistory');
const db = new Database(':memory:');
db.exec(`CREATE TABLE config(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
CREATE TABLE products(product_id TEXT PRIMARY KEY,end_time TEXT,current_price INTEGER,auction_history_html TEXT,auction_history_data TEXT);
CREATE TABLE tasks(id INTEGER PRIMARY KEY,product_id TEXT,status TEXT); CREATE TABLE orders(product_id TEXT,task_id INTEGER);`);
const now = Date.parse('2026-10-08T01:20:00+08:00');
for (const [id,end,linked] of [['old','2026-10-01T20:00:00+09:00',true],['won','2026-10-02T20:00:00+09:00',false],['future','2026-10-09T20:00:00+09:00',true],['lookup','2026-10-01T20:00:00+09:00',false],['invalid','unknown',true]]) {
  db.prepare('INSERT INTO products(product_id,end_time) VALUES (?,?)').run(id,end);
  if (linked) db.prepare('INSERT INTO tasks(product_id) VALUES (?)').run(id);
}
db.prepare('INSERT INTO orders(product_id) VALUES (?)').run('won');
assert.deepEqual(history.eligible(db,now),['won','old']);
history.schedule(db, now-1);
assert.equal(history.get(db,'auction_history_requested'),'');
history.schedule(db, now);
assert.equal(history.get(db,'auction_history_requested'),'1');
const queue = history.get(db,'auction_history_queue');
history.request(db,now); assert.equal(history.get(db,'auction_history_queue'),queue);
let job = history.next(db,now);
assert.equal(job.productId,'won');
assert.equal(history.next(db,now+1),null);
const reclaimed = history.next(db,now+10*60*1000+1);
assert.equal(history.finish(db,{...job,expired:true}).stale,true);
history.finish(db,{...reclaimed,expired:true});
assert.deepEqual(db.prepare('SELECT auction_history_html,auction_history_data FROM products WHERE product_id=?').get('won'),{auction_history_html:history.EXPIRED,auction_history_data:history.EXPIRED});
job = history.next(db,now);
for (let attempt=1;attempt<=3;attempt++) {
  history.finish(db,{...job,error:'network timeout'});
  assert.equal(history.get(db,'auction_history_requested'),attempt<3?'1':'0');
  if (attempt<3) {
    assert.equal(history.next(db,now,['old']),null,'Retry must wait for the next batch');
    job=history.next(db,now);
  }
}
assert.equal(history.getAlerts(db)[0].items[0].attempts,3);
assert.equal(history.getAlerts(db)[0].items[0].productId,'old');
assert.equal(history.closeAlert(db,history.getAlerts(db)[0].id).closed,1);
assert.deepEqual(history.getAlerts(db),[]);
assert.equal(history.get(db,'auction_history_requested'),'0');
assert.equal(db.prepare('SELECT auction_history_html FROM products WHERE product_id=?').get('old').auction_history_html,null);
history.schedule(db,now+1000); assert.equal(history.get(db,'auction_history_requested'),'0');
history.request(db,now); job = history.next(db,now);
const row = {time:'10-4 21:46',rawTime:'10月 4日 21時 46分',text:'<script>evil</script> 自動入札。 81,000',username:'<script>evil</script>',price:81000};
const start = {...row,time:'10-4 21:46',price:1000,text:'オークション開始。 数量： 1 で 1,000',start:true};
assert.equal(history.finish(db,{...job,rows:[row],firstPageRows:[row]}).retry,true);
assert.equal(JSON.parse(history.get(db,'auction_history_queue')).failures.old.error,'auction start missing');
job=history.next(db,now);
history.finish(db,{...job,rows:[row,{...row,username:'other',price:80000},start],firstPageRows:[row,{...row,username:'other',price:80000},{rawTime:'10月 4日 21時 45分',text:'linkwood1989 入札の取り消し'},start]});
const saved = db.prepare('SELECT * FROM products WHERE product_id=?').get('old');
assert.equal(saved.auction_history_html.includes('<script>'),false);
assert.equal((saved.auction_history_html.match(/<tr>/g)||[]).length,4);
assert.ok(saved.auction_history_html.includes('入札の取り消し'));
assert.deepEqual(JSON.parse(saved.auction_history_data),[{time:'10-4 21:46',username:row.username,price:81000},{time:'10-4 21:46',username:'开始',price:1000}]);
assert.deepEqual(history.eligible(db,now),[]);
assert.equal(history.correctedEndTime('2026-10-08 21:02:15','10-8 21:46'),'2026-10-08 21:46:00');
assert.equal(history.correctedEndTime('2026-10-08T21:02:15+09:00','10-8 21:46'),'2026-10-08T21:46:00+09:00');
assert.equal(history.correctedEndTime('2026-10-08T12:02:15.123Z','10-8 21:46'),'2026-10-08T12:46:00.000Z');
assert.equal(history.correctedEndTime('2026-10-08 20:02:15+08:00','10-8 21:46'),'2026-10-08 20:46:00+08:00');
assert.equal(history.correctedEndTime('2026-12-31 23:59:15','1-1 00:04'),'2027-01-01 00:04:00');
assert.equal(history.correctedEndTime('2027-01-01 00:04:15','12-31 23:59'),null);
assert.equal(history.correctedEndTime('2026-10-08 21:46:15','10-8 21:46'),null);
assert.equal(history.correctedEndTime('2026-10-08 22:00:00','10-8 21:46'),null);
assert.equal(history.correctedEndTime('2026-10-08 22:00:00','2-30 21:46'),null);
assert.equal(history.correctedEndTime('unknown','10-8 21:46'),null);

function saveCase(id, endTime, {order=false,success=false,legacyOrder=false,empty=false,expired=false} = {}) {
  db.prepare('INSERT INTO products(product_id,end_time,current_price) VALUES (?,?,?)').run(id,endTime,200);
  const task = db.prepare('INSERT INTO tasks(product_id,status) VALUES (?,?)').run(id,success?'success':'failed');
  if (order || legacyOrder) db.prepare('INSERT INTO orders VALUES (?,?)').run(legacyOrder?null:id,task.lastInsertRowid);
  history.request(db,Date.parse('2026-10-09T12:00:00+09:00'));
  const job = history.next(db);
  assert.equal(job.productId,id);
  const first = {...row,time:'10-8 21:46',price:81000};
  history.finish(db,{...job,expired,rows:empty?[]:[first,{...start,time:'10-1 18:55'}],firstPageRows:empty?[]:[first]});
  return db.prepare('SELECT end_time,current_price FROM products WHERE product_id=?').get(id);
}
assert.deepEqual(saveCase('correct','2026-10-08 21:02:15'),{end_time:'2026-10-08 21:46:00',current_price:81000});
assert.deepEqual(saveCase('already-later','2026-10-08 22:00:00'),{end_time:'2026-10-08 22:00:00',current_price:200});
assert.deepEqual(saveCase('won-order','2026-10-08 21:02:15',{order:true}),{end_time:'2026-10-08 21:02:15',current_price:200});
assert.deepEqual(saveCase('won-task','2026-10-08 21:02:15',{success:true}),{end_time:'2026-10-08 21:02:15',current_price:200});
assert.deepEqual(saveCase('won-legacy','2026-10-08 21:02:15',{legacyOrder:true}),{end_time:'2026-10-08 21:02:15',current_price:200});
assert.deepEqual(saveCase('no-records','2026-10-08 21:02:15',{empty:true}),{end_time:'2026-10-08 21:02:15',current_price:200});
assert.deepEqual(saveCase('expired-records','2026-10-08 21:02:15',{expired:true}),{end_time:'2026-10-08 21:02:15',current_price:200});
// Old plugins still send price=1, but their original page text has the real price.
assert.equal(history.normalizeRows([{...start,price:1}])[0].price,1000);
assert.throws(()=>history.normalizeRows([{...start,text:'オークション開始。 数量： 1 で 不明'}]),/price missing/);
// Clearing touches only the two history fields and makes an ended product eligible again.
const beforeClear = db.prepare('SELECT end_time,current_price FROM products WHERE product_id=?').get('old');
history.set(db,'auction_history_requested','0');
const queueBefore = history.get(db,'auction_history_queue');
assert.equal(history.clearProductHistory(db,'old',now).success,true);
assert.deepEqual(db.prepare('SELECT end_time,current_price FROM products WHERE product_id=?').get('old'),beforeClear);
assert.deepEqual(db.prepare('SELECT auction_history_html,auction_history_data FROM products WHERE product_id=?').get('old'),{auction_history_html:null,auction_history_data:null});
assert.equal(history.get(db,'auction_history_queue'),queueBefore);
assert.equal(history.get(db,'auction_history_requested'),'0');
assert.ok(history.eligible(db,Date.parse('2026-10-10T00:00:00Z')).includes('old'));
assert.equal(history.clearProductHistory(db,'missing').success,false);
assert.equal(history.clearProductHistory(db,'won').success,true); // Expired records can also be reset.
history.set(db,'auction_history_requested','1');
history.set(db,'auction_history_queue',JSON.stringify({token:'busy',ids:['old'],claim:'claimed',leaseUntil:now+1000}));
db.prepare('UPDATE products SET auction_history_data=? WHERE product_id=?').run('saved','old');
assert.equal(history.clearProductHistory(db,'old',now).success,false);
assert.equal(db.prepare('SELECT auction_history_data FROM products WHERE product_id=?').get('old').auction_history_data,'saved');
assert.equal(history.clearProductHistory(db,'old',now+1001).success,true);
assert.equal(history.finish(db,{productId:'old',token:'busy',claim:'claimed',expired:true}).stale,true);
assert.deepEqual(JSON.parse(history.get(db,'auction_history_queue')),{token:'busy',ids:['old']});
// Failed products rotate behind untouched products; alerts wait for the whole fixed queue.
const retryDb = new Database(':memory:');
retryDb.exec(`CREATE TABLE config(key TEXT PRIMARY KEY,value TEXT,updated_at TEXT);
CREATE TABLE products(product_id TEXT PRIMARY KEY,auction_history_html TEXT,auction_history_data TEXT);`);
retryDb.prepare('INSERT INTO products(product_id) VALUES (?)').run('a');
retryDb.prepare('INSERT INTO products(product_id) VALUES (?)').run('b');
history.set(retryDb,'auction_history_requested','1');
history.set(retryDb,'auction_history_queue',JSON.stringify({token:'fixed',ids:['a','b']}));
let retryJob=history.next(retryDb,now);
history.finish(retryDb,{...retryJob,error:'login required'});
assert.deepEqual(JSON.parse(history.get(retryDb,'auction_history_queue')).ids,['b','a']);
retryJob=history.next(retryDb,now,['a']);
assert.equal(retryJob.productId,'b');
history.finish(retryDb,{...retryJob,error:'timeout'});
assert.equal(history.next(retryDb,now,['a','b']),null);
for(let attempt=2;attempt<=3;attempt++) {
 retryJob=history.next(retryDb,now);
 assert.equal(retryJob.productId,'a');
 history.finish(retryDb,{...retryJob,error:'login required'});
 assert.deepEqual(history.getAlerts(retryDb),[]);
 retryJob=history.next(retryDb,now,['a']);
 assert.equal(retryJob.productId,'b');
 history.finish(retryDb,{...retryJob,expired:true});
 if(attempt===2) break;
}
retryJob=history.next(retryDb,now);
history.finish(retryDb,{...retryJob,error:'login required'});
assert.equal(history.get(retryDb,'auction_history_requested'),'0');
assert.deepEqual(history.getAlerts(retryDb)[0].items,[{productId:'a',attempts:3,error:'login required'}]);
assert.equal(history.getAlerts(retryDb)[0].items.some(item=>item.productId==='b'),false,'Successful retry must not remain in the failure summary');
retryDb.close();
db.close();
console.log('Auction history queue, atomic storage and non-won end-time/price correction tests passed');
