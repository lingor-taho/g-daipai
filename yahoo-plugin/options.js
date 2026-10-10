chrome.storage.local.get('yahooBinding').then(({yahooBinding})=>{
  if(yahooBinding) { document.getElementById('account').value=yahooBinding.accountId; document.getElementById('token').value=yahooBinding.token; }
});
document.getElementById('binding').addEventListener('submit',async event=>{
  event.preventDefault();
  const accountId=Number(document.getElementById('account').value);
  const token=document.getElementById('token').value.trim();
  if(!Number.isSafeInteger(accountId) || accountId<1 || !token) return;
  const state=await chrome.runtime.sendMessage({type:'YAHOO_BINDING_CAN_CHANGE'}).catch(()=>null);
  if(!state?.idle) {
    document.getElementById('status').textContent='当前插件仍在执行任务或验证，请完成后再更换绑定。';
    return;
  }
  await chrome.storage.local.set({yahooBinding:{accountId,token}});
  document.getElementById('status').textContent='绑定已保存。请重新加载扩展；后台在线状态更新后再提交任务。';
});
