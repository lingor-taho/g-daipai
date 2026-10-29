const assert=require('assert/strict');
if(!process.env.DATABASE_URL?.includes('gdaipai-regression-'))throw new Error('Use isolated regression runner');
const express=require('express');
const db=require('../models');
const scope=require('../services/yahooAccountContext');
const foreground=require('../services/yahooForeground');
const accounts=require('../services/yahooAccounts');
const native=require('../services/manualPasskey');
let calls=0;
native.selectGooglePasskey=async options=>{calls++;assert.ok(options.deadline<=Date.now()+8000);return {success:true,detected:true,clicked:true,dialogId:'test-dialog'};};
const plugin=require('./plugin');
(async()=>{
 foreground.ensure(db.raw);
 const a=accounts.list(db)[0].id;
 const b=accounts.save(db,{account_name:'Native passkey B',yahoo_id:'native-b',profile_dir:'native-b',priority:1}).id;
 const app=express();app.use(express.json());app.use('/api/plugin',plugin);
 const server=await new Promise(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
 const base='http://127.0.0.1:'+server.address().port+'/api/plugin';
 const headers=id=>({'Content-Type':'application/json','X-Yahoo-Account':String(id),'X-Yahoo-Token':accounts.list(db,Date.now(),true).find(row=>row.id===id).binding_token,'X-Yahoo-Instance':'native-passkey-instance-'+id});
 async function request(id,path,body){const response=await fetch(base+path,{method:'POST',headers:headers(id),body:JSON.stringify(body)});return {status:response.status,data:await response.json()};}
 try{
  const title='GDAIPAI-'+a+'-native-passkey-instance-'+a+'-PASSKEY';
  assert.equal((await request(a,'/manual-passkey/select',{windowTitle:title})).status,409);
  const lock=(await request(a,'/foreground/acquire',{})).data;
  assert.ok(lock.token);
  for(const wrong of ['Chrome','GDAIPAI-'+b+'-native-passkey-instance-'+b+'-PASSKEY','GDAIPAI-'+a+'-other-instance-PASSKEY']){
   assert.equal((await request(a,'/manual-passkey/select',{windowTitle:wrong,foreground_token:lock.token})).status,409);
  }
  assert.equal((await request(b,'/manual-passkey/select',{windowTitle:'GDAIPAI-'+b+'-native-passkey-instance-'+b+'-PASSKEY',foreground_token:lock.token})).status,409);
  assert.equal(calls,0);
  const result=await request(a,'/manual-passkey/select',{windowTitle:title,foreground_token:lock.token,deadline:Date.now()+100000});
  assert.equal(result.status,200);assert.equal(result.data.clicked,true);assert.equal(calls,1);
  assert.equal((await request(a,'/foreground/release',{token:lock.token})).status,200);
  assert.equal((await request(a,'/manual-passkey/select',{windowTitle:title,foreground_token:lock.token})).status,409);
  assert.equal(calls,1);
  console.log('Passkey HTTP: foreground token, exact account/instance window, cross-account rejection and deadline cap passed');
 }finally{server.closeAllConnections();await new Promise(resolve=>server.close(resolve));db.raw.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
