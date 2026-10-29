const assert = require('assert/strict');
const {execFileSync} = require('child_process');
const {randomUUID} = require('crypto');
const {buildPasskeySelectionScript,selectGooglePasskey} = require('./manualPasskey');
(async()=>{
  await assert.rejects(selectGooglePasskey({platform:'linux',windowTitle:'GDAIPAI-1-test-PASSKEY'}),/Windows/);
  await assert.rejects(selectGooglePasskey({platform:'win32',windowTitle:'Chrome'}),/Invalid account/);
  const title='GDAIPAI-1-test-PASSKEY';
  const script=buildPasskeySelectionScript({windowTitle:title,previousDialogId:"test'; Write-Host bad; '",deadline:12345});
  assert.ok(script.includes("$previousDialogId='test''; Write-Host bad; '''"));
  assert.ok(script.includes('$deadline=12345'));
  assert.ok(script.includes('Is-Document $container'));
  assert.ok(script.includes('Native $heading'),'Native dialog matching must reject all web-document descendants');
  assert.ok(script.includes('GetForegroundWindow'));
  assert.ok(script.includes('yahoo\\.co\\.jp'));
  assert.ok(!script.includes('SendKeys'),'Selection must never type a password or PIN');
  let calls=0;
  const selected=await selectGooglePasskey({platform:'win32',windowTitle:title,execFileImpl(file,args,options,done){
    calls++;assert.equal(file,'powershell.exe');assert.equal(options.windowsHide,true);assert.equal(options.timeout,8000);
    assert.ok(args.includes('-STA'));assert.ok(args.includes('-EncodedCommand'));
    const body=Buffer.from(args.at(-1),'base64').toString('utf16le');assert.ok(body.includes(title));
    done(null,JSON.stringify({success:true,detected:true,clicked:true,dialogId:'unique'}),'');
  }});
  assert.equal(selected.clicked,true);assert.equal(calls,1);
  await assert.rejects(selectGooglePasskey({platform:'win32',windowTitle:title,execFileImpl(f,a,o,done){done(new Error('timeout'),'','native timeout');}}),/native timeout/);
  await assert.rejects(selectGooglePasskey({platform:'win32',windowTitle:title,execFileImpl(f,a,o,done){done(null,'not JSON','');}}),/Invalid Windows/);
  if(process.platform==='win32'){
    const parse="[Console]::InputEncoding=[Text.Encoding]::UTF8;$source=[Console]::In.ReadToEnd();$tokens=$null;$errors=$null;[System.Management.Automation.Language.Parser]::ParseInput($source,[ref]$tokens,[ref]$errors)|Out-Null;if($errors.Count){$errors|ForEach-Object{Write-Output $_.Message};exit 1}";
    execFileSync('powershell.exe',['-NoProfile','-Command',parse],{input:script,encoding:'utf8',windowsHide:true,timeout:10000});
    const absent=await selectGooglePasskey({windowTitle:'GDAIPAI-999999-'+randomUUID()+'-PASSKEY'});
    assert.equal(absent.detected,false,'An unmatched account marker must not click any window');
  }
  console.log('Native passkey helper: encoded Unicode script, exact marker, no credential input, timeout/error handling, PowerShell parser and unmatched-window no-op passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
