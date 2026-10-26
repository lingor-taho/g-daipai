const assert = require('assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Use isolated regression runner');
process.env.JWT_SECRET = 'agent-policy-isolated';
const express = require('express');
const jwt = require('jsonwebtoken');
const db = require('../models');
const auth = require('./auth');
const { checkProducts } = require('../services/agentProductPolicy');

(async () => {
  db.raw.exec(`INSERT INTO users(id,username,password_hash,role,user_level,parent_user_id) VALUES
    (8100,'agent-a','test','user',2,NULL),(8101,'a1','test','user',1,8100),
    (8102,'a2','test','user',1,8100),(8200,'agent-b','test','user',2,NULL),
    (8201,'b1','test','user',1,8200),(8300,'standalone','test','user',1,NULL),
    (8400,'client-admin-policy','test','user',3,NULL);`);
  const account = db.raw.prepare('SELECT id FROM yahoo_accounts LIMIT 1').get().id;
  for (const [user, product, status] of [[8101,'a1234567890','failed'],[8102,'b1234567890','cancelled'],[8100,'c1234567890','pending'],[8201,'d1234567890','success']]) {
    db.raw.prepare('INSERT INTO tasks(user_id,account_id,product_id,max_price,status) VALUES(?,?,?,100,?)').run(user, account, product, status);
  }
  const app = express(); app.use(express.json()); app.use('/api/auth', auth);
  const server = await new Promise(resolve => { const s = app.listen(0,'127.0.0.1',()=>resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}/api/auth/agent-product-policy`;
  async function request(user, method='GET', body, acting) {
    const response = await fetch(base + (method==='POST'?'/check':''), {method, headers: {
      Authorization: `Bearer ${jwt.sign({id:user,role:'user'},process.env.JWT_SECRET)}`,
      'Content-Type':'application/json', ...(acting ? {'X-Acting-User-Id':String(acting)} : {})
    }, ...(body ? {body:JSON.stringify(body)} : {})});
    return {status:response.status, data:await response.json()};
  }
  try {
    assert.equal((await request(8100)).data.policy,'exclusive');
    assert.equal((await request(8100)).data.canConfigure,true);
    assert.equal((await request(8101)).data.canConfigure,false);
    for (const user of [8101,8201,8300,8400]) assert.equal((await request(user,'PUT',{policy:'allow'})).status,403);
    assert.equal((await request(8100,'PUT',{policy:'invalid'})).status,400);
    const ids=['a1234567890','b1234567890','c1234567890','d1234567890'];
    const before = db.raw.prepare('SELECT * FROM tasks').all();
    assert.deepEqual(new Set((await request(8101,'POST',{productIds:ids})).data.conflicts),new Set(['b1234567890','c1234567890']));
    assert.deepEqual(new Set((await request(8100,'POST',{productIds:ids})).data.conflicts),new Set(['a1234567890','b1234567890']));
    assert.deepEqual((await request(8200,'POST',{productIds:ids})).data.conflicts,['d1234567890']);
    assert.equal((await request(8101,'POST',{productIds:ids},8102)).status,403);
    assert.equal((await request(8100,'POST',{productIds:ids},8201)).status,403);
    assert.equal((await request(8100,'POST',{productIds:ids},8102)).status,200);
    assert.equal((await request(8100,'PUT',{policy:'confirm'},8200)).status,200);
    assert.equal((await request(8101)).data.policy,'confirm');
    assert.equal((await request(8201)).data.policy,'exclusive');
    assert.equal((await request(8100,'PUT',{policy:'allow'})).status,200);
    assert.deepEqual((await request(8102,'POST',{productIds:ids})).data.conflicts,[]);
    assert.equal((await request(8300,'POST',{productIds:ids})).data.policy,'allow');
    assert.equal((await request(8100,'POST',{productIds:["' OR 1=1"]})).status,400);
    assert.equal((await request(8100,'POST',{productIds:Array(51).fill(ids[0])})).status,400);
    assert.deepEqual(db.raw.prepare('SELECT * FROM tasks').all(),before,'Queries/settings must never change tasks');
    assert.equal(db.raw.prepare('SELECT COUNT(*) n FROM yahoo_product_assignments').get().n,0);
    assert.equal((await checkProducts(db,8101,ids)).policy,'allow','Saved policy is read from server each time');
    assert.equal((await request(8400,'GET',null,8100)).data.canConfigure,true);
    assert.equal((await request(8400,'GET',null,8100)).data.agentId,8100);
    assert.equal((await request(8400,'PUT',{policy:'confirm'},8100)).status,200);
    assert.equal((await request(8100)).data.policy,'confirm','Admin edits the selected agent, visible on agent login');
    assert.equal((await request(8200)).data.policy,'exclusive','Other agent unchanged');
    assert.equal((await request(8400,'PUT',{policy:'allow'},8200)).status,200);
    assert.equal((await request(8201)).data.policy,'allow','Agent B subordinates use admin-edited policy');
    assert.equal((await request(8101)).data.policy,'confirm','Agent A remains isolated');
    for (const target of [8101,8201,8300]) {
      assert.equal((await request(8400,'GET',null,target)).data.canConfigure,false);
      assert.equal((await request(8400,'PUT',{policy:'exclusive'},target)).status,403);
    }
    assert.equal((await request(8400,'GET',null,999999)).status,403);
    assert.equal((await request(8400,'PUT',{policy:'allow'},999999)).status,403);
    assert.equal((await request(8101,'PUT',{policy:'allow'},8100)).status,403,'Ordinary users cannot impersonate an agent');
    console.log('Agent policy HTTP: permissions, defaults, group isolation, every task status, self exclusion, persistence, read-only checks passed');
  } finally { await new Promise(resolve=>server.close(resolve)); db.raw.close(); }
})().catch(error=>{console.error(error);process.exitCode=1;});
