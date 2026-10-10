import { useEffect, useState } from 'react';
import { Alert, Button, Input, Popconfirm, Space, Tag, message } from 'antd';
import { fetchAdminJson } from './utils/auth';
export default function YahooAccountAlerts({account:a,workOnly=false}:{account:any,workOnly?:boolean}) {
  const [answer,setAnswer]=useState('');
  const [busy,setBusy]=useState(false);
  const c=a.captchaChallenge;
  useEffect(()=>setAnswer(''),[c?.id]);
  async function act(path:string,body:any={}) {setBusy(true);try{await fetchAdminJson(`/api/admin/${path}?account_id=${a.account_id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,account_id:a.account_id})});}catch(e:any){message.error(e.message);}finally{setBusy(false);}}
  const title=`${a.account_name}（${a.yahoo_id || `ID ${a.account_id}`}）`;
  const workAlerts=(a.workClaims||[]).filter((claim:any)=>!a.online || claim.instance_id!==a.instance_id || Date.now()-claim.created_at>10*60*1000).map((claim:any)=><Alert key={`${claim.kind}-${claim.object_id}`} type="warning" message={`${title}：${claim.kind} / ${claim.object_id} 执行结果待核对`} action={<Popconfirm title="已关闭原插件并核对 Yahoo，确认可以重新读取或操作？付款成功时请先同步实际订单状态。" onConfirm={()=>act(`accounts/${a.account_id}/work-claims/${claim.kind}/${claim.object_id}/release`,{confirmed:true})}><Button>核对后释放</Button></Popconfirm>}/>);
  if(workOnly) return <>{workAlerts}</>;
  return <div data-yahoo-account={a.account_id} style={{marginBottom:12}}><Space wrap><strong>{title}</strong><Tag color={a.online?'green':'red'}>{a.online?'插件在线':'插件离线'}</Tag><Tag color={a.yahooLogin?.status==='ok'?'green':'orange'}>{a.yahooLogin?.status==='ok'?'Yahoo 已登录':'Yahoo 登录待确认'}</Tag></Space>
    {a.yahooLogin?.message && a.yahooLogin.status!=='ok'?<Alert type="warning" message={`${title}：${a.yahooLogin.message}`}/>:null}
    {a.paymentAlertMessage?<Alert type="error" message={`${title}：${a.paymentAlertMessage}`} action={<Button disabled={busy} onClick={()=>act('payment/continue')}>继续</Button>}/>:null}
    {a.confirmReceiptAlertMessage?<Alert type="warning" message={`${title}：${a.confirmReceiptAlertMessage}`}/>:null}
    {c?<Alert type="warning" message={`${title}：${c.type==='email'?'需要邮箱验证码':c.type==='pin'?'需要 PIN 码':'需要文字验证码'}`} description={<Space direction="vertical">{c.imageDataUrl?<img src={c.imageDataUrl} style={{maxWidth:'100%',maxHeight:240}}/>:null}<span>{c.message}</span>{c.answeredAt?<span>处理中，请等待插件结果</span>:c.type==='email'?<Button loading={busy} onClick={()=>act('manual-captcha/continue',{id:c.id})}>继续</Button>:<Space wrap><Input.Password value={answer} onChange={e=>setAnswer(e.target.value)} placeholder={c.type==='pin'?'PIN 码':'验证码'}/><Button loading={busy} disabled={!answer.trim()} onClick={()=>act('manual-captcha/answer',{id:c.id,answer})}>提交</Button></Space>}<Button disabled={busy} onClick={()=>act('manual-captcha/close',{id:c.id})}>关闭提醒</Button></Space>}/>:null}
    {(a.shipmentAlerts||[]).map((alert:any)=><Alert key={alert.id} type="warning" message={`${title}：商品 ${alert.productId} 超过 ${alert.daysOverdue} 天未发货`} action={<Button onClick={()=>act(`shipment-alerts/${alert.id}/close`)}>消除</Button>}/>)}
    {(a.googleSheetAlerts||[]).map((alert:any)=><Alert key={alert.id} type="error" message={`${title}：Google 表格写入失败 ${alert.productId}：${alert.error}`} action={<Button onClick={async()=>{try{await fetchAdminJson(`/api/admin/google-sheet-alerts/${alert.id}?account_id=${a.account_id}`,{method:'DELETE'});}catch(e:any){message.error(e.message);}}}>消除</Button>}/>)}
    {workAlerts}
  </div>;
}
