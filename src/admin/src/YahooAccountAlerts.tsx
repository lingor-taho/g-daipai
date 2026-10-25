import { useState } from 'react';
import { Alert, Button, message } from 'antd';
import { fetchAdminJson } from './utils/auth';
import ManualVerificationAlert from './ManualVerificationAlert';
export default function YahooAccountAlerts({account:a,workOnly=false}:{account:any,workOnly?:boolean}) {
  const [busy,setBusy]=useState(false);
  const c=a.captchaChallenge;
  async function act(path:string,body:any={}) {setBusy(true);try{await fetchAdminJson(`/api/admin/${path}?account_id=${a.account_id}`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({...body,account_id:a.account_id})});}catch(e:any){message.error(e.message);}finally{setBusy(false);}}
  const title=`${a.account_name}（${a.yahoo_id || `ID ${a.account_id}`}）`;
  if(workOnly) return null;
  const hasAlerts = (a.yahooLogin?.message && a.yahooLogin.status!=='ok') ||
    a.paymentAlertMessage || a.confirmReceiptAlertMessage || c ||
    a.shipmentAlerts?.length || a.googleSheetAlerts?.length;
  return <div data-yahoo-account={a.account_id} style={{marginBottom:hasAlerts?12:0}}>
    {a.yahooLogin?.message && a.yahooLogin.status!=='ok'?<Alert type="warning" message={`${title}：${a.yahooLogin.message}`}/>:null}
    {a.paymentAlertMessage?<Alert type="error" message={`${title}：${a.paymentAlertMessage}`} action={<Button disabled={busy} onClick={()=>act('payment/continue')}>继续</Button>}/>:null}
    {a.confirmReceiptAlertMessage?<Alert type="warning" message={`${title}：${a.confirmReceiptAlertMessage}`}/>:null}
    <ManualVerificationAlert accountId={a.account_id} accountTitle={title} challenge={c} />
    {(a.shipmentAlerts||[]).map((alert:any)=><Alert key={alert.id} type="warning" message={`${title}：商品 ${alert.productId} 超过 ${alert.daysOverdue} 天未发货`} action={<Button onClick={()=>act(`shipment-alerts/${alert.id}/close`)}>消除</Button>}/>)}
    {(a.googleSheetAlerts||[]).map((alert:any)=><Alert key={alert.id} type="error" message={`${title}：Google 表格写入失败 ${alert.productId}：${alert.error}`} action={<Button onClick={async()=>{try{await fetchAdminJson(`/api/admin/google-sheet-alerts/${alert.id}?account_id=${a.account_id}`,{method:'DELETE'});}catch(e:any){message.error(e.message);}}}>消除</Button>}/>)}
  </div>;
}
