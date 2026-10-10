const {randomUUID}=require('crypto');
const scope=require('./yahooAccountContext');
const {fail}=require('./yahooAccounts');
function ensure(raw){raw.exec('CREATE TABLE IF NOT EXISTS yahoo_foreground_lock(id INTEGER PRIMARY KEY CHECK(id=1),account_id INTEGER NOT NULL,instance_id TEXT NOT NULL,token TEXT NOT NULL,expires_at INTEGER NOT NULL)');}
function acquire(raw,now=Date.now()) {
  const ctx=scope.context();
  return raw.transaction(()=>{
    raw.prepare('DELETE FROM yahoo_foreground_lock WHERE expires_at<=?').run(now);
    if(raw.prepare('SELECT 1 FROM yahoo_foreground_lock').get()) throw fail('其他账号正在操作前台验证窗口，请稍后重试');
    const token=randomUUID();raw.prepare('INSERT INTO yahoo_foreground_lock VALUES(1,?,?,?,?)').run(ctx.accountId,ctx.instanceId,token,now+30000);
    return {success:true,token};
  })();
}
function check(raw,token,now=Date.now()) {
  const ctx=scope.context();
  const lock=raw.prepare('SELECT * FROM yahoo_foreground_lock WHERE id=1').get();
  if(!lock || lock.account_id!==ctx.accountId || lock.instance_id!==ctx.instanceId || lock.token!==token || lock.expires_at<=now) throw fail('前台验证窗口锁已失效');
}
function release(raw,token){check(raw,token);raw.prepare('DELETE FROM yahoo_foreground_lock WHERE token=?').run(token);return {success:true};}
module.exports={ensure,acquire,check,release};
