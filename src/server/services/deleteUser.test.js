const assert = require('assert/strict');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { deleteUser, CONFIRM_MESSAGE } = require('./deleteUser');
function fixture() {
  const db = new Database(':memory:');
  db.pragma('foreign_keys=ON');
  db.exec(fs.readFileSync(path.join(__dirname,'../../db/init.sql'),'utf8'));
  db.exec(`INSERT INTO yahoo_accounts(id,account_name,email,is_primary) VALUES(1,'A','a@example.com',1),(2,'B','b@example.com',0);
    INSERT INTO users(id,username,password_hash,role,user_level,parent_user_id) VALUES
      (1,'target','test','user',2,NULL),(2,'other','test','user',1,NULL),(3,'child','test','user',1,1),
      (4,'client-admin','test','user',3,NULL),(5,'server-admin','test','admin',3,NULL),(6,'empty','test','user',1,NULL);
    INSERT INTO products(product_id,product_title) VALUES('p','shared'),('x','exclusive'),('s','same-account-shared'),('q','import-only'),('z','assignment-only');
    INSERT INTO tasks(id,user_id,account_id,product_id,max_price,status) VALUES
      (10,1,1,'p',100,'success'),(11,2,2,'p',500,'success'),(12,1,1,'x',200,'processing'),
      (13,3,1,'s',300,'failed'),(14,1,1,'s',400,'failed');
    INSERT INTO orders(id,task_id,account_id,product_id,final_price,bundle_group_id) VALUES
      (100,12,1,'x',100,'shared-bundle'),(101,11,2,'p',500,'shared-bundle'),(102,14,1,'s',200,NULL);
    INSERT INTO yahoo_product_assignments(product_id,account_id,user_id,task_id) VALUES('p',1,1,10),('p',2,2,11),('x',1,1,12),('s',1,3,13),('z',1,6,NULL);
    INSERT INTO bid_logs(task_id,bid_price) VALUES(10,100),(11,500),(12,200);
    INSERT INTO order_status_change_logs(order_id,product_id,source) VALUES(100,'x','test'),(101,'p','test');
    INSERT INTO yahoo_trade_messages(order_id,account_id,product_id) VALUES(100,1,'p'),(101,2,'p');
    INSERT INTO bidding_items(account_id,product_id,status) VALUES(1,'p','bidding'),(2,'p','bidding'),(1,'s','bidding'),(1,'x','bidding');
    INSERT INTO user_sessions(user_id,token_id,expires_at) VALUES(1,'owned','2099-01-01'),(2,'other','2099-01-01'),(6,'empty','2099-01-01');
    INSERT INTO user_client_rate_overrides(user_id) VALUES(1),(6);
    INSERT INTO user_finance_overrides(user_id) VALUES(1),(6);
    INSERT INTO manual_order_import_batches(id,account_id,start_date,end_date) VALUES(100,2,'2026-10-01','2026-10-12'),(200,1,'2026-10-01','2026-10-12');
    INSERT INTO manual_order_import_items(batch_id,account_id,product_id,assigned_user_id,task_id,order_id) VALUES(100,2,'p',2,11,101),(200,1,'q',1,NULL,NULL);
    INSERT INTO yahoo_work_claims(account_id,kind,object_id,instance_id,token,created_at) VALUES
      (1,'payment',100,'i','owned',1),(2,'payment',101,'i','other',1),(2,'manual-order-import',100,'i','import',1);
    INSERT INTO yahoo_account_transfers(task_id,from_account_id,reason) VALUES(10,1,'owned'),(11,2,'other');
    INSERT INTO batch_task_submissions(id,user_id,login_user_id,client_request_id,input_text) VALUES(1,1,1,'owned','x'),(2,2,1,'other','p');
    INSERT INTO batch_task_submission_items(batch_id,line_number,input_text,product_id,task_id) VALUES(1,1,'x','x',12),(2,1,'p','p',11);`);
  return db;
}
function config(db,key,value) { db.prepare('INSERT INTO config(key,value) VALUES(?,?)').run(key,JSON.stringify(value)); }
const db = fixture();
config(db,'auction_history_queue',{token:'queue',ids:['x','p','q'],claim:'owned',leaseUntil:9999999999999,accountId:1,instanceId:'i',failures:{x:{productId:'x'},p:{productId:'p'}}});
config(db,'auction_history_requested',1);
config(db,'google_sheet_alerts',[{orderId:100,productId:'p'},{orderId:101,productId:'p'}]);
config(db,'yahoo:1:manual_captcha_challenge',{id:'challenge',productId:'x'});
db.prepare('INSERT INTO config(key,value) VALUES(?,?)').run('yahoo:1:payment_alert_message','付款失败：商品ID x，原因：测试');
db.prepare('INSERT INTO yahoo_task_requests VALUES(?,?,?,?,?)').run(1,'i','mixed','[10,11]',1);
const before = db.serialize();
assert.deepEqual(deleteUser(db,1),{requiresConfirmation:true,error:CONFIRM_MESSAGE,taskCount:3,orderCount:2});
assert.deepEqual(db.serialize(),before,'Preview/cancel must write nothing');
for (const id of [4,5]) assert.throws(() => deleteUser(db,id,true),e => e.status === 403);
// Inject an error after child records were removed: every change must roll back.
db.exec("CREATE TRIGGER reject_delete BEFORE DELETE ON users WHEN OLD.id=1 BEGIN SELECT RAISE(ABORT,'rollback test'); END;");
const beforeFailure = db.serialize();
assert.throws(() => deleteUser(db,1,true),/rollback test/);
assert.deepEqual(db.serialize(),beforeFailure);
db.exec('DROP TRIGGER reject_delete');
const otherTasks = db.prepare('SELECT * FROM tasks WHERE user_id IN (2,3)').all();
const otherOrder = db.prepare('SELECT * FROM orders WHERE id=101').get();
assert.deepEqual(deleteUser(db,1,true),{success:true,taskCount:3,orderCount:2});
assert.deepEqual(db.prepare('SELECT * FROM tasks WHERE user_id IN (2,3)').all(),otherTasks);
assert.deepEqual(db.prepare('SELECT * FROM orders WHERE id=101').get(),otherOrder);
assert.equal(db.prepare('SELECT parent_user_id FROM users WHERE id=3').get().parent_user_id,null);
for (const table of ['tasks','yahoo_product_assignments','user_sessions','user_finance_overrides','user_client_rate_overrides'])
  assert.equal(db.prepare(`SELECT COUNT(*) AS n FROM ${table} WHERE user_id=1`).get().n,0,table);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM users WHERE id=1').get().n,0);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM orders').get().n,1);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM yahoo_trade_messages').get().n,1);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM order_status_change_logs').get().n,1);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM bid_logs').get().n,1);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM yahoo_account_transfers').get().n,1);
assert.equal(db.prepare('SELECT login_user_id FROM batch_task_submissions WHERE id=2').get().login_user_id,2);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM batch_task_submission_items').get().n,1);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM manual_order_import_items').get().n,1);
assert.equal(db.prepare('SELECT COUNT(*) AS n FROM yahoo_work_claims').get().n,2,'Other order and import claims survive even with overlapping numeric IDs');
assert.deepEqual(db.prepare('SELECT product_id FROM products ORDER BY product_id').all().map(r=>r.product_id),['p','s','z']);
assert.deepEqual(db.prepare('SELECT account_id,product_id FROM bidding_items ORDER BY product_id').all(),[{account_id:2,product_id:'p'},{account_id:1,product_id:'s'}]);
assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM config WHERE key='google_sheet_alerts'").get().value),[{orderId:101,productId:'p'}]);
assert.deepEqual(JSON.parse(db.prepare("SELECT value FROM config WHERE key='auction_history_queue'").get().value),{token:'queue',ids:['p'],failures:{p:{productId:'p'}}});
assert.equal(db.prepare("SELECT value FROM config WHERE key='yahoo:1:manual_captcha_challenge'").get().value,'');
assert.equal(db.prepare("SELECT value FROM config WHERE key='yahoo:1:payment_alert_message'").get().value,'');
assert.equal(db.prepare('SELECT task_ids FROM yahoo_task_requests').get().task_ids,'[11]');
assert.deepEqual(deleteUser(db,6),{success:true,taskCount:0,orderCount:0},'Other data alone does not require confirmation');
assert.equal(db.prepare("SELECT COUNT(*) AS n FROM products WHERE product_id='z'").get().n,0);
assert.deepEqual(db.prepare('PRAGMA foreign_key_check').all(),[]);
assert.throws(() => deleteUser(db,999),e => e.status === 404);
db.close();
// A taskless order can still belong to the user through its account/product assignment.
const legacy = fixture();
legacy.prepare('INSERT INTO orders(account_id,product_id,final_price) VALUES(1,?,100)').run('z');
assert.deepEqual(deleteUser(legacy,6),{requiresConfirmation:true,error:CONFIRM_MESSAGE,taskCount:0,orderCount:1});
assert.equal(deleteUser(legacy,6,true).success,true);
assert.deepEqual(legacy.prepare('PRAGMA foreign_key_check').all(),[]);
legacy.close();
console.log('User deletion confirmation, full cleanup, shared ownership, admin protection and transaction rollback passed');
