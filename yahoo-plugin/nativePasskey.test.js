const assert = require('assert/strict');
const {loadBackgroundForTest}=require('./background.test');
const loginUrl='https://login.yahoo.co.jp/config/login?src=auc';
function fixture({start='provider',error=false,holdProvider=false,nativePin=false,pinError=false,pinAppearsOnAnswer=false}={}){
 let phase=start;let now=100000;let emailFills=0;const calls=[];const nativeClicks=[];const titles=[];const storage={};let challenge;let answerReceived=false;
 class Clock extends Date{static now(){return now;}}
 const tab=()=>({id:7,windowId:9,status:'complete',active:true,url:phase==='done'?'https://auctions.yahoo.co.jp/':nativePin && !pinAppearsOnAnswer?'https://login.yahoo.co.jp/config/login?cpt=test':loginUrl});
 const api=loadBackgroundForTest({disableAutoStart:true,Date:Clock,
  setTimeout(fn,ms){if(!String(fn).includes('reject(')){now+=ms;queueMicrotask(fn);}return 1;},
  localStorage:{async get(){return {yahooBinding:{accountId:2,token:'bound-test'}};},async set(){}},
  sessionStorage:{async get(){return storage;},async set(data){Object.assign(storage,structuredClone(data));},async remove(key){delete storage[key];}},
  windows:{async update(){return {id:9};}},
  tabs:{async get(){return tab();},async query(){return [tab()];},async update(){return tab();},async reload(){calls.push('reload');if(phase!=='email')phase='provider';},async create(props){assert.ok(props.url.startsWith('https://mail.google.com/'));return {id:90};},async remove(){}},
  scripting:{async executeScript(payload){
   const source=String(payload.func);
   if(source.includes('document.title=title')||source.includes('document.title = title'))titles.push(payload.args[0]);
   if(source.includes('loginAction')){
    if(phase==='methods')return [{result:{stage:'methods',alreadyClicked:true}}];
    return [{result:null}];
   }
   if(source.includes('const codeInput'))return [{result:phase==='email'?{email:true,maskedAddress:'do*******@g********',submitted:false}:null}];
   if(source.includes('settings.baseline'))return [{result:payload.args[0].baseline?{ready:true,rows:[]}:{messages:[{messageId:'fresh-code',sender:'login-master@mail.yahoo.co.jp',recipient:'donald@gmail.com',date:new Date(now).toISOString(),text:'確認コード：012345'}]}}];
   if(source.includes('emailCode')){assert.equal(payload.args[0],'012345');emailFills++;phase='provider';return [{result:{success:true,submittedAt:now}}];}
   return [{result:null}];
  }},
  fetch:async(url,request={})=>{
   const path=new URL(url).pathname;const body=request.body?JSON.parse(request.body):{};calls.push(path);
   const json=value=>({ok:true,async json(){return value;}});
   if(path.endsWith('/foreground/acquire'))return json({success:true,token:'owned-lock'});
   if(path.endsWith('/manual-passkey/select')){
    assert.equal(body.foreground_token,'owned-lock');assert.ok(body.windowTitle.startsWith('GDAIPAI-2-'));assert.ok(body.windowTitle.endsWith('-PASSKEY'));
    if(error)return json({success:false,error:'ambiguous provider'});
    if(['provider','methods'].includes(phase)){
     if(body.previousDialogId==='provider-1')return json({success:true,detected:true,clicked:false,alreadyClicked:true,dialogId:'provider-1'});
     nativeClicks.push(body);if(!holdProvider)phase='pin';return json({success:true,detected:true,clicked:true,dialogId:'provider-'+nativeClicks.length});
    }
    return json({success:true,detected:false,pinDetected:nativePin && phase==='pin' && (!pinAppearsOnAnswer || answerReceived)});
   }
   if(path.endsWith('/challenge'))challenge=body;
   if(path.endsWith('/email/claim'))return json({success:true,claimed:true});
   if(path.endsWith('/current'))return json(challenge?{found:true,...challenge}:{found:false});
   if(path.includes('/manual-captcha/answer/') && challenge?.type==='pin')answerReceived=true;
   if(path.endsWith('/manual-pin/type')){
    assert.equal(phase,'pin');assert.equal(body.pin,'123456');
    assert.equal(Boolean(body.nativePin),nativePin);
    assert.equal(body.foreground_token,'owned-lock');
    assert.ok(body.windowTitle.endsWith(nativePin?'-PASSKEY':'-PIN'));
    if(pinError)return json({success:false,error:'native PIN focus failed'});
    phase='done';return json({success:true,digits:6});
   }
   return json({success:true,answered:true,answer:'123456'});
  }
 });
 return {api,tab,calls,nativeClicks,titles,storage,phase:()=>phase,emailFills:()=>emailFills,challenge:()=>challenge};
}
(async()=>{
 const f=fixture();const first=await f.api.selectManualGooglePasskey(f.tab());assert.equal(first.clicked,true);
 assert.equal(f.storage.manualPasskeyProviderSession.dialogId,'provider-1');
 assert.equal((await f.api.selectManualGooglePasskey(f.tab(),{force:true})).detected,false);
 assert.equal(f.storage.manualPasskeyProviderSession,undefined);
 assert.equal(f.nativeClicks.length,1);
 assert.ok(f.titles[0].endsWith('-PASSKEY'));
 const flow=fixture();const result=await flow.api.handleManualVerificationIfPresent(flow.tab());
 assert.equal(result.tab.url,'https://auctions.yahoo.co.jp/');
 assert.equal(flow.nativeClicks.length,2,'Initial chooser and a new chooser reopened by original PIN refresh are each handled');
 const selectedAt=flow.calls.indexOf('/api/plugin/manual-passkey/select');const typedAt=flow.calls.indexOf('/api/plugin/manual-pin/type');assert.ok(selectedAt<typedAt);
 assert.equal(flow.calls.filter(p=>p==='/api/plugin/manual-pin/type').length,1);
 assert.equal(flow.calls.filter(p=>p==='reload').length,1,'ordinary PIN keeps its original refresh');
 for(const options of [{start:'provider'},{start:'pin'},{start:'pin',pinAppearsOnAnswer:true}]){
  const native=fixture({...options,nativePin:true});
  const result=await native.api.handleManualVerificationIfPresent(native.tab());
  assert.equal(result.tab.url,'https://auctions.yahoo.co.jp/');
  assert.equal(native.nativeClicks.length,options.start==='provider'?1:0);
  assert.equal(native.calls.includes('reload'),false);
  assert.equal(native.calls.filter(p=>p==='/api/plugin/manual-pin/type').length,1);
 }
 const noFocus=fixture({start:'pin',nativePin:true,pinError:true});
 await assert.rejects(noFocus.api.handleManualVerificationIfPresent(noFocus.tab()),/native PIN focus failed/);
 assert.equal(noFocus.calls.includes('reload'),false);
 assert.equal(noFocus.calls.filter(p=>p==='/api/plugin/manual-pin/type').length,1);
 assert.equal(noFocus.challenge().phase,'error');
 const held=fixture({holdProvider:true});await held.api.selectManualGooglePasskey(held.tab());
 assert.equal((await held.api.selectManualGooglePasskey(held.tab(),{force:true})).alreadyClicked,true);assert.equal(held.nativeClicks.length,1,'Do not click the same native dialog twice');
 const afterEmail=fixture({start:'email'});const emailResult=await afterEmail.api.handleManualVerificationIfPresent(afterEmail.tab());
 assert.equal(emailResult.tab.url,'https://auctions.yahoo.co.jp/');assert.equal(afterEmail.emailFills(),1);assert.equal(afterEmail.nativeClicks.length,2);
 assert.equal(afterEmail.calls.filter(p=>p==='/api/plugin/manual-pin/type').length,1);
 const failed=fixture({error:true});await assert.rejects(failed.api.handleManualVerificationIfPresent(failed.tab()),/ambiguous provider/);
 assert.equal(failed.calls.includes('/api/plugin/manual-pin/type'),false);
 console.log('Native passkey extension: account token/title scoping, click before PIN, refresh-created chooser, session dedupe and errors before credential input passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
