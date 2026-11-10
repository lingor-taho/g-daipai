const assert = require('assert/strict');
const {execFileSync} = require('child_process');
const {randomUUID} = require('crypto');
const {buildPasskeySelectionScript,selectGooglePasskey,typeGooglePasskeyPin} = require('./manualPasskey');
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
  assert.ok(script.includes('$typePin=$false'));
  const pinScript=buildPasskeySelectionScript({windowTitle:title,pin:'012345'});
  assert.ok(pinScript.includes('$typePin=$true'));
  const typingBranch=pinScript.slice(pinScript.indexOf('if($typePin){'),pinScript.indexOf('if($pinVisible)'));
  assert.match(typingBranch,/\$first\.SetFocus\(\)/);
  assert.match(typingBranch,/FocusedElement/);
  assert.match(typingBranch,/AccountHasFocus/);
  assert.doesNotMatch(typingBranch,/SetCursorPos|mouse_event|012345/);
  const typed=await typeGooglePasskeyPin({platform:'win32',windowTitle:title,pin:'012345',execFileImpl(f,a,o,done){
    assert.equal(o.env.GDAIPAI_NATIVE_PIN,'012345');
    assert.ok(!Buffer.from(a.at(-1),'base64').toString('utf16le').includes('012345'));
    done(null,JSON.stringify({success:true,digits:6}),'');
  }});
  assert.equal(typed.digits,6);
  await assert.rejects(typeGooglePasskeyPin({platform:'win32',windowTitle:title,pin:'012345',
    execFileImpl(f,a,o,done){done(new Error('focus lost'),'','012345');}}),
  error=>error.message.includes('焦点') && !error.message.includes('012345'));
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
    execFileSync('powershell.exe',['-NoProfile','-Command',parse],{input:pinScript,encoding:'utf8',windowsHide:true,timeout:10000});
    const absent=await selectGooglePasskey({windowTitle:'GDAIPAI-999999-'+randomUUID()+'-PASSKEY'});
    assert.equal(absent.detected,false,'An unmatched account marker must not click any window');
    const noPinWindow=await typeGooglePasskeyPin({windowTitle:'GDAIPAI-999999-'+randomUUID()+'-PASSKEY',pin:'012345'});
    assert.equal(noPinWindow.reason,'window_not_found');
    assert.equal(noPinWindow.digits,undefined);
  }
  console.log('Native passkey helper: exact window marker, focus-checked PIN without coordinate clicks, redacted errors and unmatched-window no-op passed');
})().catch(error=>{console.error(error);process.exitCode=1;});
