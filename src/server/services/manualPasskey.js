const { execFile } = require('child_process');
const quote = value => "'" + String(value || '').replace(/'/g, "''") + "'";
const SCRIPT = String.raw`
$ErrorActionPreference='Stop'
Add-Type -AssemblyName UIAutomationClient
Add-Type -AssemblyName UIAutomationTypes
Add-Type -TypeDefinition @'
using System; using System.Collections.Generic; using System.Runtime.InteropServices; using System.Text;
public static class GDaipaiPasskeyWindow {
 public delegate bool EnumCallback(IntPtr w,IntPtr d);
 [DllImport("user32.dll")] public static extern bool EnumWindows(EnumCallback cb,IntPtr d);
 [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr w);
 [DllImport("user32.dll",CharSet=CharSet.Unicode)] public static extern int GetWindowText(IntPtr w,StringBuilder t,int n);
 [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr w,out uint p);
 [DllImport("user32.dll")] public static extern IntPtr GetAncestor(IntPtr w,uint f);
 [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
 [DllImport("user32.dll")] public static extern void keybd_event(byte key,byte scan,uint flags,UIntPtr extra);
 [DllImport("user32.dll")] public static extern bool SetCursorPos(int x,int y);
 [DllImport("user32.dll")] public static extern void mouse_event(uint f,uint x,uint y,uint d,UIntPtr e);
 public static IntPtr[] Windows(){var a=new List<IntPtr>();EnumWindows((w,d)=>{if(IsWindowVisible(w))a.Add(w);return true;},IntPtr.Zero);return a.ToArray();}
 public static string Title(IntPtr w){var t=new StringBuilder(512);GetWindowText(w,t,512);return t.ToString();}
}
'@
$targetTitle=%%TARGET%%
$previousDialogId=%%PREVIOUS%%
$deadline=%%DEADLINE%%
$typePin=%%TYPE_PIN%%
$pin=$env:GDAIPAI_NATIVE_PIN
Remove-Item Env:GDAIPAI_NATIVE_PIN -ErrorAction SilentlyContinue
function Finish($r){$r|ConvertTo-Json -Compress -Depth 4;exit 0}
function Name($e){return ([string]$e.Current.Name -replace '\s+',' ').Trim()}
function Usable($e){return $e.Current.IsEnabled -and -not $e.Current.IsOffscreen}
function Key($e){return ($e.GetRuntimeId() -join '-')}
function Is-Document($e){return $e.Current.ControlType -eq [System.Windows.Automation.ControlType]::Document}
function Native($e){for($i=0;$e -and $i -lt 50;$i++){if(Is-Document $e){return $false};$e=$walker.GetParent($e)};return $true}
function AccountHasFocus {
 $active=[GDaipaiPasskeyWindow]::GetForegroundWindow()
 return ($active -eq $target -or [GDaipaiPasskeyWindow]::GetAncestor($active,3) -eq $target) -and [GDaipaiPasskeyWindow]::Title($target).Contains($targetTitle)
}
$windows=@([GDaipaiPasskeyWindow]::Windows())
$targets=@($windows|Where-Object {
 if(-not [GDaipaiPasskeyWindow]::Title($_).Contains($targetTitle)){return $false}
 [uint32]$processId=0;[GDaipaiPasskeyWindow]::GetWindowThreadProcessId($_,[ref]$processId)|Out-Null
 return (Get-Process -Id $processId -ErrorAction SilentlyContinue).ProcessName -eq 'chrome'
})
if($targets.Count -eq 0){Finish @{success=$true;detected=$false;reason='window_not_found'}}
if($targets.Count -ne 1){throw 'Account window is ambiguous; no passkey was selected'}
$target=$targets[0];$walker=[System.Windows.Automation.TreeWalker]::ControlViewWalker
$scope=[System.Windows.Automation.TreeScope]::Descendants;$all=[System.Windows.Automation.Condition]::TrueCondition
$choices=@{};$detected=$false;$pinVisible=$false;$pinDialogs=@{}
foreach($handle in $windows){
 if($handle -ne $target -and [GDaipaiPasskeyWindow]::GetAncestor($handle,3) -ne $target){continue}
 $root=[System.Windows.Automation.AutomationElement]::FromHandle($handle)
 foreach($heading in (@($root)+@($root.FindAll($scope,$all)))){
  if(-not (Usable $heading)){continue}
  $label=Name $heading
  if($label -match '^(PIN\s*を入力してください|Enter (your |the )?PIN)$'){
   if(-not (Native $heading)){continue}
   $pinVisible=$true
   $container=$walker.GetParent($heading)
   for($depth=0;$container -and $depth -lt 7;$depth++){
    if((Is-Document $container) -or ($handle -eq $target -and (Key $container) -eq (Key $root))){break}
    $nodes=@($container.FindAll($scope,$all)|Where-Object {(Usable $_) -and (Native $_)})
    $rp=$nodes|Where-Object {(Name $_) -match '^yahoo\.co\.jp\s*(が本人確認を求めています|is asking you to verify your identity\.?|wants to verify your identity\.?)$'}|Select-Object -First 1
    $cancel=$nodes|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and (Name $_) -match '^(キャンセル|Cancel|取消)$'}|Select-Object -First 1
    if($rp -and $cancel){
     $pinDialogs[(Key $container)]=@($nodes|Where-Object {$_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and $_.Current.IsKeyboardFocusable})
     break
    }
    $container=$walker.GetParent($container)
   }
   continue
  }
  if($typePin -or $label -notmatch '^(保存した\s*yahoo\.co\.jp\s*のパスキーを使用する|Use (a |your )?saved passkey for yahoo\.co\.jp)$'){continue}
  if(-not (Native $heading)){continue}
  $detected=$true
  $container=$heading
  for($depth=0;$container -and $depth -lt 7;$depth++){
   if(Is-Document $container){break}
   $nodes=@($container.FindAll($scope,$all))
   $cancel=@($nodes|Where-Object {(Usable $_) -and $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and (Name $_) -match '^(キャンセル|Cancel|取消)$'})
   if($cancel.Count -gt 0){
    $providers=@($nodes|Where-Object {(Usable $_) -and (Name $_) -match 'Google (パスワード マネージャー|Password Manager|密码管理工具|密碼管理工具)'})
    foreach($provider in $providers){
     $candidate=$provider
     for($level=0;$candidate -and $level -lt 5;$level++){
      if((Key $candidate) -eq (Key $container) -or (Is-Document $candidate)){break}
      $invoke=$null;$invokable=$candidate.TryGetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern,[ref]$invoke)
      if($invokable -or $candidate.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -or $candidate.Current.ControlType -eq [System.Windows.Automation.ControlType]::ListItem){
       if(Usable $candidate){$choices[(Key $candidate)]=@{element=$candidate;invoke=$invoke;dialogId=((Key $container)+':'+(Key $candidate))}}
       break
      }
      $candidate=$walker.GetParent($candidate)
     }
    }
    if($providers.Count -gt 0){$detected=$true;break}
   }
   $container=$walker.GetParent($container)
  }
 }
}
if($typePin){
 if($pinDialogs.Count -ne 1){throw 'Yahoo native PIN dialog is missing or ambiguous'}
 $fields=@($pinDialogs.Values)[0]
 if($fields.Count -eq 6 -and $pin.Length -eq 6){
  $fields=@($fields|Sort-Object {$_.Current.BoundingRectangle.Left})
  $firstRect=$fields[0].Current.BoundingRectangle
  $lastRight=$firstRect.Left
  foreach($field in $fields){
   $rect=$field.Current.BoundingRectangle
   if($rect.IsEmpty -or $rect.Left -lt $lastRight -or [Math]::Abs($rect.Top-$firstRect.Top) -gt 2){throw 'Native PIN fields are ambiguous'}
   $lastRight=$rect.Right
  }
 }elseif($fields.Count -ne 1){throw 'Native PIN input is missing or ambiguous'}
 if(-not (AccountHasFocus)){throw 'Account window lost focus before PIN input'}
 $first=$fields[0]
 $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
 if(-not $focused -or (Key $focused) -ne (Key $first)){
  $first.SetFocus()
  for($attempt=0;$attempt -lt 5;$attempt++){
   Start-Sleep -Milliseconds 60
   $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
   if($focused -and (Key $focused) -eq (Key $first)){break}
  }
 }
 if(-not $focused -or (Key $focused) -ne (Key $first)){throw 'Native PIN input could not be focused'}
 $allowed=@($fields|ForEach-Object {Key $_})
 foreach($char in $pin.ToCharArray()){
  $focused=[System.Windows.Automation.AutomationElement]::FocusedElement
  if(-not (AccountHasFocus) -or -not $focused -or (Key $focused) -notin $allowed -or
     [DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $deadline){throw 'Native PIN input lost focus or timed out'}
  $key=[byte][int][char]$char
  [GDaipaiPasskeyWindow]::keybd_event($key,0,0,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 40
  [GDaipaiPasskeyWindow]::keybd_event($key,0,2,[UIntPtr]::Zero)
  Start-Sleep -Milliseconds 120
 }
 Finish @{success=$true;digits=$pin.Length}
}
if($pinVisible){Finish @{success=$true;detected=$false;pinDetected=$true}}
if(-not $detected){Finish @{success=$true;detected=$false}}
if($choices.Count -ne 1){throw 'Google passkey provider is missing or ambiguous; please select it manually'}
$choice=@($choices.Values)[0]
if($choice.dialogId -eq $previousDialogId){Finish @{success=$true;detected=$true;clicked=$false;alreadyClicked=$true;dialogId=$choice.dialogId}}
$active=[GDaipaiPasskeyWindow]::GetForegroundWindow()
if($active -ne $target -and [GDaipaiPasskeyWindow]::GetAncestor($active,3) -ne $target){throw 'Account window lost focus; no passkey was selected'}
if(-not [GDaipaiPasskeyWindow]::Title($target).Contains($targetTitle) -or -not (Usable $choice.element)){throw 'Account window or passkey row changed; no passkey was selected'}
if([DateTimeOffset]::UtcNow.ToUnixTimeMilliseconds() -ge $deadline){throw 'Passkey selection deadline expired; no click was sent'}
if($choice.invoke){$choice.invoke.Invoke()}else{
 $point=$choice.element.GetClickablePoint()
 [GDaipaiPasskeyWindow]::SetCursorPos([int]$point.X,[int]$point.Y)|Out-Null
 [GDaipaiPasskeyWindow]::mouse_event(0x0002,0,0,0,[UIntPtr]::Zero)
 [GDaipaiPasskeyWindow]::mouse_event(0x0004,0,0,0,[UIntPtr]::Zero)
}
Finish @{success=$true;detected=$true;clicked=$true;dialogId=$choice.dialogId}
`;

function buildPasskeySelectionScript({windowTitle,previousDialogId='',deadline=Date.now()+8000,pin}) {
  return SCRIPT.replace('%%TARGET%%',quote(windowTitle)).replace('%%PREVIOUS%%',quote(previousDialogId)).replace('%%DEADLINE%%',String(Number.isFinite(Number(deadline)) ? Math.floor(Number(deadline)) : 0)).replace('%%TYPE_PIN%%', () => pin ? '$true' : '$false');
}

function selectGooglePasskey(options = {}) {
  return runNativePasskeyScript(options);
}

function typeGooglePasskeyPin(options = {}) {
  if (!/^\d{4,12}$/.test(options.pin || '')) return Promise.reject(new Error('Invalid native PIN format'));
  return runNativePasskeyScript(options);
}

function runNativePasskeyScript(options) {
  if ((options.platform || process.platform) !== 'win32') return Promise.reject(new Error('Google passkey selection requires Windows'));
  if (!/^GDAIPAI-\d+-[a-zA-Z0-9_-]+-PASSKEY$/.test(options.windowTitle || '')) return Promise.reject(new Error('Invalid account passkey window title'));
  const script = buildPasskeySelectionScript(options);
  const execOptions = {windowsHide:true,timeout:8000};
  if (options.pin) execOptions.env = {...process.env, GDAIPAI_NATIVE_PIN: options.pin};
  return new Promise((resolve,reject) => {
    (options.execFileImpl || execFile)('powershell.exe',['-NoProfile','-STA','-ExecutionPolicy','Bypass','-EncodedCommand',Buffer.from(script,'utf16le').toString('base64')],
      execOptions,(error,stdout,stderr)=>{
        if (error) return reject(new Error(options.pin ? '无法确认 Chrome 原生 PIN 输入框焦点，或输入已中断，请检查弹窗' : String(stderr || error.message).slice(0,500)));
        try { resolve(JSON.parse(String(stdout).trim())); }
        catch (_) { reject(new Error('Invalid Windows passkey selection result')); }
      });
  });
}

module.exports = { buildPasskeySelectionScript, selectGooglePasskey, typeGooglePasskeyPin };
