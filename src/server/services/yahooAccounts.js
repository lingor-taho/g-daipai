const { randomUUID, randomBytes, timingSafeEqual } = require('crypto');
const scope = require('./yahooAccountContext');
const ONLINE_MS = 45000;
const fail = (message, statusCode = 409) => Object.assign(new Error(message), { statusCode });
const rawDb = database => database.raw || database.db || database;

function ensureSchema(raw) {
  const migrated=raw.prepare("SELECT 1 FROM config WHERE key='yahoo_account_state_migrated'").get();
  if(!migrated && raw.prepare('SELECT 1 FROM tasks LIMIT 1').get()) {
    const file=raw.pragma('database_list').find(d=>d.name==='main')?.file;
    if(file) {
      const backup=`${file}.before-yahoo-accounts-${Date.now()}.sqlite`;
      raw.exec(`VACUUM INTO '${backup.replace(/'/g,"''")}'`);
      console.info('[Yahoo accounts] Migration backup:',backup);
    }
  }
  const add = (table, column, definition) => {
    if (!raw.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === column)) raw.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  };
  raw.transaction(() => {
    for (const [column, definition] of Object.entries({
      is_primary: 'INTEGER NOT NULL DEFAULT 0', priority: 'INTEGER NOT NULL DEFAULT 100',
      enabled: 'INTEGER NOT NULL DEFAULT 1', yahoo_id: "TEXT NOT NULL DEFAULT ''",
      binding_token: "TEXT NOT NULL DEFAULT ''", instance_id: "TEXT NOT NULL DEFAULT ''",
      heartbeat_at: 'INTEGER', protocol_version: 'INTEGER NOT NULL DEFAULT 0'
    })) add('yahoo_accounts', column, definition);
    let primary = raw.prepare('SELECT * FROM yahoo_accounts WHERE is_primary=1 ORDER BY id LIMIT 1').get();
    if (!primary) {
      primary = raw.prepare('SELECT * FROM yahoo_accounts ORDER BY id LIMIT 1').get();
      if (!primary) {
        const id = raw.prepare("INSERT INTO yahoo_accounts(account_name,email,is_primary,priority) VALUES ('A 主账号','',1,0)").run().lastInsertRowid;
        primary = { id };
      } else raw.prepare('UPDATE yahoo_accounts SET is_primary=1,priority=0 WHERE id=?').run(primary.id);
    }
    for (const a of raw.prepare("SELECT id FROM yahoo_accounts WHERE binding_token='' ").all()) raw.prepare('UPDATE yahoo_accounts SET binding_token=? WHERE id=?').run(randomBytes(24).toString('hex'), a.id);
    raw.exec('CREATE UNIQUE INDEX IF NOT EXISTS yahoo_single_primary ON yahoo_accounts(is_primary) WHERE is_primary=1');
    for (const table of scope.scopedTables) {
      add(table, 'account_id', 'INTEGER NOT NULL DEFAULT 0');
      raw.prepare(`UPDATE ${table} SET account_id=? WHERE account_id IS NULL OR account_id=0`).run(primary.id);
      raw.exec(`CREATE INDEX IF NOT EXISTS idx_${table}_account ON ${table}(account_id)`);
    }
    for (const [column, definition] of Object.entries({ claim_token: 'TEXT', claim_instance: 'TEXT', account_attempts: "TEXT NOT NULL DEFAULT '[]'", account_route: "TEXT NOT NULL DEFAULT '[]'", execution_unknown: 'INTEGER NOT NULL DEFAULT 0' })) add('tasks', column, definition);
    add('manual_order_import_batches', 'claim_token', 'TEXT');
    require('./yahooForeground').ensure(raw);
    raw.exec(`CREATE TABLE IF NOT EXISTS yahoo_task_requests(account_id INTEGER NOT NULL,instance_id TEXT NOT NULL,
      request_id TEXT NOT NULL,task_ids TEXT NOT NULL,created_at INTEGER NOT NULL,
      PRIMARY KEY(account_id,instance_id,request_id));
      CREATE TABLE IF NOT EXISTS yahoo_work_claims(account_id INTEGER NOT NULL,kind TEXT NOT NULL,
      object_id INTEGER NOT NULL,instance_id TEXT NOT NULL,token TEXT NOT NULL,created_at INTEGER NOT NULL,
      PRIMARY KEY(account_id,kind,object_id));`);
    // Preserve every old snapshot while changing its key from product to account+product.
    const info = raw.prepare('PRAGMA table_info(bidding_items)').all();
    if (info.find(c => c.name === 'product_id')?.pk && !info.find(c => c.name === 'account_id')?.pk) {
      const columns = info.map(c => `"${c.name}"`).join(',');
      raw.exec(`CREATE TABLE bidding_items_account_migration (${info.map(c => `"${c.name}" ${c.type}${c.notnull ? ' NOT NULL' : ''}${c.dflt_value !== null ? ` DEFAULT ${c.dflt_value}` : ''}`).join(',')}, PRIMARY KEY(account_id,product_id));
        INSERT INTO bidding_items_account_migration(${columns}) SELECT ${columns} FROM bidding_items;
        DROP TABLE bidding_items;
        ALTER TABLE bidding_items_account_migration RENAME TO bidding_items;
        CREATE INDEX idx_bidding_items_account ON bidding_items(account_id);`);
    }
    raw.exec(`CREATE TABLE IF NOT EXISTS yahoo_product_assignments(
      product_id TEXT NOT NULL, account_id INTEGER NOT NULL REFERENCES yahoo_accounts(id),
      user_id INTEGER NOT NULL REFERENCES users(id), task_id INTEGER REFERENCES tasks(id) ON DELETE SET NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP, PRIMARY KEY(product_id,account_id), UNIQUE(product_id,user_id));`);
    raw.exec(`CREATE TABLE IF NOT EXISTS yahoo_account_transfers(id INTEGER PRIMARY KEY,task_id INTEGER NOT NULL,
      from_account_id INTEGER NOT NULL,to_account_id INTEGER,reason TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP)`);
    // Existing ownership is retained, including cancelled bids whose external result is unknown.
    raw.exec(`INSERT OR IGNORE INTO yahoo_product_assignments(product_id,account_id,user_id,task_id)
      SELECT product_id,account_id,user_id,id FROM tasks WHERE user_id IS NOT NULL ORDER BY id DESC;`);
    if(!raw.prepare("SELECT 1 FROM config WHERE key='yahoo_account_state_migrated'").get()) {
      // A pre-upgrade processing task has no fencing token. Never replay its unknown Yahoo result.
      raw.prepare("UPDATE tasks SET status='failed',execution_unknown=1,claim_token=NULL,claim_instance=NULL,error_msg='升级前任务仍在执行，结果未确认，请核对 Yahoo 后处理' WHERE status='processing'").run();
      for (const key of scope.runtimeKeys) raw.prepare(`INSERT OR IGNORE INTO config(key,value,updated_at)
        SELECT ?,value,updated_at FROM config WHERE key=?`).run(scope.configKey(key, primary.id), key);
      raw.prepare("INSERT INTO config(key,value) VALUES('yahoo_account_state_migrated','1')").run();
    }
  })();
  scope.installAccountIsolation(raw);
}

function list(database, now = Date.now(), includeToken = false) {
  return rawDb(database).prepare('SELECT * FROM yahoo_accounts ORDER BY is_primary DESC,priority,id').all().map(a => {
    const { binding_token, ...rest } = a;
    return { ...rest, online: !!a.instance_id && now - Number(a.heartbeat_at || 0) < ONLINE_MS,
      ...(includeToken ? { binding_token } : {}) };
  });
}

function authenticate(database, payload, now = Date.now()) {
  const raw = rawDb(database);
  const id = Number(payload.accountId);
  const a = raw.prepare('SELECT * FROM yahoo_accounts WHERE id=?').get(id || -1);
  const token = Buffer.from(String(payload.token || ''));
  const expected = Buffer.from(a?.binding_token || '');
  if (!a || token.length !== expected.length || !token.length || !timingSafeEqual(token, expected)) throw fail('插件账号绑定无效，请重新绑定', 401);
  const instance = String(payload.instanceId || '');
  if (!/^[a-zA-Z0-9-]{16,96}$/.test(instance)) throw fail('插件实例标识无效', 400);
  if (a.instance_id && a.instance_id !== instance && now - Number(a.heartbeat_at || 0) < ONLINE_MS) throw fail('该 Yahoo 账号已有在线插件，禁止重复执行');
  raw.prepare('UPDATE yahoo_accounts SET instance_id=?,heartbeat_at=?,protocol_version=1 WHERE id=?').run(instance, now, a.id);
  return { accountId: a.id, instanceId: instance, name: a.account_name };
}

function selectAccount(database, productId, userId, options = {}) {
  const raw = rawDb(database);
  const existing = raw.prepare('SELECT * FROM yahoo_product_assignments WHERE product_id=? AND user_id=?').get(productId, userId);
  if (existing && !options.transfer) {
    if(raw.prepare('SELECT 1 FROM tasks WHERE product_id=? AND account_id=? AND execution_unknown=1 LIMIT 1').get(productId,existing.account_id)) throw fail('该商品之前出价结果未确认，请先核对 Yahoo，不能重复出价');
    if(!list(raw,options.now || Date.now()).find(a=>a.id===existing.account_id)?.online) throw fail('该商品已有 Yahoo 账号归属，该账号离线，请恢复后再提交');
    return existing.account_id;
  }
  const accounts = list(raw, options.now || Date.now());
  const route=options.route?.length ? options.route : accounts.map(a=>a.id);
  const currentIndex = options.transfer ? route.indexOf(options.currentAccountId) : -1;
  const attempted = options.attempted || [];
  const candidates = route.slice(currentIndex+1).map(id=>accounts.find(a=>a.id===id)).filter(a=>a && a.enabled && a.online && !attempted.includes(a.id));
  const occupied = new Set(raw.prepare('SELECT account_id FROM yahoo_product_assignments WHERE product_id=? AND user_id<>?').all(productId, userId).map(r => r.account_id));
  const selected = candidates.find(a => !occupied.has(a.id));
  if (!selected) throw fail('该商品暂无可用 Yahoo 账号：账号名额已占满或剩余账号离线');
  return selected.id;
}

function createAssignedTask(database, input, sql, params) {
  const raw = rawDb(database);
  return raw.transaction(() => {
    const id = selectAccount(raw, input.productId, input.userId);
    const task = raw.prepare(sql).get(...params);
    raw.prepare('UPDATE tasks SET account_id=?,account_route=? WHERE id=?').run(id,JSON.stringify(list(raw).map(a=>a.id)),task.id);
    raw.prepare(`INSERT INTO yahoo_product_assignments(product_id,account_id,user_id,task_id) VALUES (?,?,?,?)
      ON CONFLICT(product_id,user_id) DO UPDATE SET task_id=excluded.task_id`).run(input.productId, id, input.userId, task.id);
    return { ...task, account_id: id };
  })();
}

function transferTask(database, task, errorCode) {
  if (errorCode !== 'SELLER_BLACKLIST') return null;
  const raw = rawDb(database);
  return scope.run(null, () => raw.transaction(() => {
    const current = raw.prepare('SELECT id,account_id,user_id,product_id,status,claim_token,account_attempts,account_route,execution_unknown FROM tasks WHERE id=?').get(task.id);
    if (!current || current.account_id !== task.account_id || current.claim_token !== task.claim_token || current.status !== 'processing') throw fail('任务领取已失效');
    const activeBid = raw.prepare("SELECT 1 FROM bid_logs WHERE task_id IN (SELECT id FROM tasks WHERE product_id=? AND account_id=?) AND result='bidding' LIMIT 1").get(current.product_id, current.account_id);
    const snapshot = raw.prepare("SELECT 1 FROM bidding_items WHERE product_id=? AND account_id=? AND status IN ('highest','outbid')").get(current.product_id, current.account_id);
    const unknown = raw.prepare('SELECT 1 FROM tasks WHERE product_id=? AND account_id=? AND execution_unknown=1 LIMIT 1').get(current.product_id, current.account_id);
    if (activeBid || snapshot || unknown) return null;
    const attempted = [...new Set([...JSON.parse(current.account_attempts || '[]'), current.account_id])];
    let target;
    try { target = selectAccount(raw, current.product_id, current.user_id, { transfer: true, currentAccountId: current.account_id, attempted,route:JSON.parse(current.account_route || '[]') }); }
    catch (e) {
      raw.prepare("UPDATE tasks SET status='failed',error_msg=?,account_attempts=?,claim_token=NULL,claim_instance=NULL,updated_at=CURRENT_TIMESTAMP WHERE id=?").run(`${e.message}；卖家黑名单`, JSON.stringify(attempted), current.id);
      raw.prepare("UPDATE tasks SET status='failed',error_msg=?,account_attempts=?,claim_token=NULL,claim_instance=NULL,updated_at=CURRENT_TIMESTAMP WHERE product_id=? AND user_id=? AND account_id=? AND status='pending' AND execution_unknown=0").run(`${e.message}；卖家黑名单`, JSON.stringify(attempted), current.product_id, current.user_id, current.account_id);
      raw.prepare('INSERT INTO yahoo_account_transfers(task_id,from_account_id,reason) VALUES(?,?,?)').run(current.id,current.account_id,'SELLER_BLACKLIST_EXHAUSTED');
      return { transferred: false, exhausted: true };
    }
    raw.prepare('UPDATE yahoo_product_assignments SET account_id=? WHERE product_id=? AND user_id=?').run(target, current.product_id, current.user_id);
    raw.prepare("UPDATE tasks SET account_id=?,status='pending',account_attempts=?,claim_token=NULL,claim_instance=NULL,error_msg='已转交后续 Yahoo 账号：卖家黑名单',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(target, JSON.stringify(attempted), current.id);
    // Pending submissions of this user must follow the same product allocation.
    // Historical/finished tasks keep their actual execution account.
    const queued = raw.prepare("SELECT id,account_attempts FROM tasks WHERE product_id=? AND user_id=? AND account_id=? AND status='pending' AND execution_unknown=0").all(current.product_id, current.user_id, current.account_id);
    for (const sibling of queued) {
      const siblingAttempts = [...new Set([...JSON.parse(sibling.account_attempts || '[]'), ...attempted])];
      raw.prepare("UPDATE tasks SET account_id=?,account_attempts=?,account_route=?,claim_token=NULL,claim_instance=NULL,error_msg='已跟随商品归属转交后续 Yahoo 账号：卖家黑名单',updated_at=CURRENT_TIMESTAMP WHERE id=?").run(target, JSON.stringify(siblingAttempts), current.account_route, sibling.id);
    }
    raw.prepare('INSERT INTO yahoo_account_transfers(task_id,from_account_id,to_account_id,reason) VALUES(?,?,?,?)').run(current.id,current.account_id,target,'SELLER_BLACKLIST');
    return { transferred: true, accountId: target };
  })());
}

module.exports = { ensureSchema, list, authenticate, selectAccount, createAssignedTask, transferTask, rawDb, ONLINE_MS, fail, randomUUID };

function save(database, payload, id) {
  const raw=rawDb(database);
  return raw.transaction(()=>{
    const old=id ? raw.prepare('SELECT * FROM yahoo_accounts WHERE id=?').get(Number(id)) : null;
    if(id && !old) throw fail('账号不存在',404);
    const a={...old,...payload};
    const name=String(a.account_name || '').trim();
    const yahooId=String(a.yahoo_id || '').trim();
    const profile=String(a.profile_dir || '').trim();
    if(!name || (!old && (!yahooId || !profile))) throw fail('请填写账号名称、Yahoo ID 和 Chrome profile',400);
    if(yahooId && raw.prepare('SELECT id FROM yahoo_accounts WHERE lower(yahoo_id)=lower(?) AND id<>?').get(yahooId,Number(id)||0)) throw fail('Yahoo ID 已绑定其他账号');
    if(profile && raw.prepare('SELECT id FROM yahoo_accounts WHERE lower(profile_dir)=lower(?) AND id<>?').get(profile,Number(id)||0)) throw fail('Chrome profile 已绑定其他账号');
    if(old?.instance_id && ((old.yahoo_id && yahooId!==old.yahoo_id) || (old.profile_dir && profile!==old.profile_dir))) throw fail('已绑定插件的身份不能直接更换，请新增独立账号');
    const priority=Number(a.priority ?? 100);
    if(!Number.isSafeInteger(priority) || priority<0 || priority>100000) throw fail('备用顺序必须为非负整数',400);
    const primary=a.is_primary ? 1 : 0;
    if(old?.is_primary && !primary && !raw.prepare('SELECT id FROM yahoo_accounts WHERE is_primary=1 AND id<>?').get(old.id)) throw fail('请先将其他账号设为主账号');
    if(primary && !a.enabled && a.enabled!==undefined) throw fail('主账号不能停用');
    if(primary) raw.prepare('UPDATE yahoo_accounts SET is_primary=0 WHERE is_primary=1').run();
    const values=[name,String(a.email||''),profile,yahooId,primary,priority,a.enabled===false || a.enabled===0 ? 0 : 1];
    if(old) raw.prepare('UPDATE yahoo_accounts SET account_name=?,email=?,profile_dir=?,yahoo_id=?,is_primary=?,priority=?,enabled=? WHERE id=?').run(...values,old.id);
    else id=raw.prepare('INSERT INTO yahoo_accounts(account_name,email,profile_dir,yahoo_id,is_primary,priority,enabled,binding_token) VALUES (?,?,?,?,?,?,?,?)').run(...values,randomBytes(24).toString('hex')).lastInsertRowid;
    return {success:true,id:Number(id)};
  })();
}
function remove(database,id) {
  const raw=rawDb(database);
  return raw.transaction(()=>{
    const a=raw.prepare('SELECT * FROM yahoo_accounts WHERE id=?').get(Number(id));
    if(!a) throw fail('账号不存在',404);
    if(a.is_primary) throw fail('主账号不能删除');
    if(list(raw).find(row=>row.id===a.id)?.online) throw fail('请先关闭该账号插件');
    for(const table of [...scope.scopedTables,'yahoo_product_assignments']) if(raw.prepare(`SELECT 1 FROM ${table} WHERE account_id=? LIMIT 1`).get(a.id)) throw fail('账号已有任务或订单记录，请停用而不是删除');
    raw.prepare('DELETE FROM yahoo_accounts WHERE id=?').run(a.id);
    return {success:true};
  })();
}
module.exports.save=save;
module.exports.remove=remove;
