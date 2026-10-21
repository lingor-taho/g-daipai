const assert = require('assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { spawnSync } = require('child_process');
const Database = require('better-sqlite3');
const { repairDatabase, classifyOrder } = require('./repair-fleamarket-order-time');

(async()=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'gdaipai-flea-time-'));
  const dbPath=path.join(dir,'test.db');
  let writer;
  try {
    writer=new Database(dbPath);
    writer.pragma('journal_mode = WAL');
    writer.exec(`CREATE TABLE products(product_id TEXT PRIMARY KEY,product_type TEXT);
      CREATE TABLE tasks(id INTEGER PRIMARY KEY,product_id TEXT,status TEXT);
      CREATE TABLE orders(id INTEGER PRIMARY KEY,task_id INTEGER,product_id TEXT,won_at TEXT,won_time_text TEXT,
        order_status TEXT,final_price INTEGER,account_id INTEGER,updated_at TEXT,tracking_number TEXT);
      CREATE TRIGGER account_guard BEFORE UPDATE ON orders WHEN current_yahoo_account()>0 BEGIN SELECT RAISE(ABORT,'guard'); END;`);
    writer.function('current_yahoo_account',()=>0);
    const seed=(id,type,at,text,{productId=`z${700000000+id}`,legacy=false}={})=>{
      writer.prepare('INSERT INTO products VALUES(?,?)').run(productId,type);
      writer.prepare("INSERT INTO tasks VALUES(?,?,'success')").run(id,productId);
      writer.prepare("INSERT INTO orders VALUES(?,?,?,?,?,'pending_receipt',2000,2,'unchanged','646960564235')")
        .run(id,id,legacy?null:productId,at,text);
    };
    seed(1,'normal','2026-10-20T14:52:00.000Z','10/20 22:52');
    seed(2,'store','2026-10-20T15:50:00.000Z','10/20 23:50');
    seed(3,'fleamarket','2026-10-20T14:45:23.838Z','10/20 23:45');
    const expected=new Date(2026,9,20,23,45).toISOString();
    seed(4,'fleamarket',expected,'10/20 23:45');
    seed(5,'fleamarket','2025-12-31T14:45:23.838Z','12/31 23:45',{productId:'a123456789',legacy:true});
    seed(6,'fleamarket','2026-10-20T14:40:23.838Z','10/20 23:45');
    seed(7,'fleamarket','2026-10-20T14:45:23.838Z',null);
    seed(8,'fleamarket','invalid','10/20 23:45');
    seed(9,null,'2026-10-20T14:45:23.838Z','10/20 23:45');
    seed(10,'normal','2026-10-20T14:45:23.838Z','10/20 23:45');
    const before=writer.prepare('SELECT * FROM orders ORDER BY id').all();
    const tasksBefore=writer.prepare('SELECT * FROM tasks').all();
    const productsBefore=writer.prepare('SELECT * FROM products').all();
    const preview=await repairDatabase(dbPath);
    assert.equal(preview.p_order_count,6);
    assert.deepEqual(preview.rows.filter(r=>r.next_won_at).map(r=>r.id),[3,5]);
    assert.deepEqual(writer.prepare('SELECT * FROM orders ORDER BY id').all(),before,'preview is read only');
    assert.equal(fs.readdirSync(dir).some(name=>name.includes('fleamarket-time-')),false,'preview creates no backup');
    const cli=spawnSync(process.execPath,[path.join(__dirname,'repair-fleamarket-order-time.js'),'--database',dbPath],{cwd:os.tmpdir(),encoding:'utf8'});
    assert.equal(cli.status,0,cli.stderr);
    assert.match(cli.stdout,/Preview only/);
    const applied=await repairDatabase(dbPath,{apply:true});
    assert.equal(applied.applied_count,2);
    assert.equal(writer.prepare('SELECT won_at FROM orders WHERE id=3').get().won_at,expected);
    assert.equal(writer.prepare('SELECT won_at FROM orders WHERE id=5').get().won_at,new Date(2025,11,31,23,45).toISOString(),'historical year comes from the original order');
    const backup=new Database(applied.backup,{readonly:true});
    assert.deepEqual(backup.prepare('SELECT * FROM orders ORDER BY id').all(),before,'online backup includes WAL records and exact original values');
    backup.close();
    assert.equal(JSON.parse(fs.readFileSync(`${applied.backup}.changes.json`)).repair_count,2);
    const after=writer.prepare('SELECT * FROM orders ORDER BY id').all();
    for (let i=0;i<before.length;i++) {
      assert.deepEqual({...after[i],won_at:before[i].won_at},before[i],'all fields other than won_at are preserved');
      if (![3,5].includes(before[i].id)) assert.deepEqual(after[i],before[i],'normal/shop, aligned and uncertain rows are untouched');
    }
    assert.deepEqual(writer.prepare('SELECT * FROM tasks').all(),tasksBefore);
    assert.deepEqual(writer.prepare('SELECT * FROM products').all(),productsBefore);
    const repeat=await repairDatabase(dbPath,{apply:true});
    assert.equal(repeat.applied_count,0,'repeated execution cannot add another hour');
    assert.equal(repeat.backup,undefined);
    writer.prepare('UPDATE orders SET won_at=? WHERE id=3').run(before[2].won_at);
    writer.prepare('UPDATE orders SET won_at=? WHERE id=5').run(before[4].won_at);
    const beforeFailure=writer.prepare('SELECT * FROM orders ORDER BY id').all();
    writer.exec("CREATE TRIGGER reject_second BEFORE UPDATE OF won_at ON orders WHEN OLD.id=5 BEGIN SELECT RAISE(ABORT,'test repair rollback'); END;");
    await assert.rejects(repairDatabase(dbPath,{apply:true}),/test repair rollback/);
    assert.deepEqual(writer.prepare('SELECT * FROM orders ORDER BY id').all(),beforeFailure,'any failed update rolls back the entire repair');
    const malformed=classifyOrder({won_at:'2026-02-28T14:45:00.000Z',won_time_text:'02/30 23:45'});
    assert.equal(malformed.next_won_at,undefined,'invalid dates are not guessed');
    console.log(`Legacy P time preview, backup, repair, idempotence, field isolation and rollback passed (${Intl.DateTimeFormat().resolvedOptions().timeZone})`);
  } finally {
    if(writer) writer.close();
    // dir is the exact temporary directory created above; never a computed workspace path.
    fs.rmSync(dir,{recursive:true,force:true});
  }
})().catch(error=>{console.error(error);process.exitCode=1;});
