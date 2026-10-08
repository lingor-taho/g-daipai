import { useEffect, useId, useRef, useState } from 'react';
import { api, getApiErrorMessage } from '../utils/api';
import { buildAuctionHistoryChart, buildChartGeometry } from '../utils/auctionHistoryChart';

export function AuctionHistoryChartButton({ item, onClick }) {
  const enabled = Boolean(Number(item.has_auction_history));
  return <button type="button" disabled={!enabled} onClick={onClick}
    aria-label={enabled ? '查看拍卖记录图表' : '拍卖记录尚未采集'} title={enabled ? '查看拍卖记录图表' : '拍卖记录尚未采集'}
    style={{border:0,background:'transparent',padding:'5px 4px 0',lineHeight:0,cursor:enabled?'pointer':'default'}}>
    <svg width="21" height="21" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M3 3v18h18" fill="none" stroke={enabled?'#64748b':'#a8b2c1'} strokeWidth="1.7" />
      <path d="M4 17l5-6 4 3 7-9v15H4z" fill={enabled?'#dcfce7':'#e5e7eb'} />
      <path d="M4 17l5-6 4 3 7-9" fill="none" stroke={enabled?'#16a34a':'#a8b2c1'} strokeWidth="2" />
    </svg>
  </button>;
}
function timeLabel(stamp) {
  const date = new Date(stamp);
  return `${date.getUTCMonth()+1}-${date.getUTCDate()} ${String(date.getUTCHours()).padStart(2,'0')}:${String(date.getUTCMinutes()).padStart(2,'0')}`;
}
export function AuctionHistoryPlot({ data, endTime }) {
  const prefix = useId().replace(/:/g,'');
  const chart = buildAuctionHistoryChart(data,endTime);
  const plotRef = useRef(null);
  const [width,setWidth] = useState(900);
  useEffect(()=>{
    const node = plotRef.current;
    if (!node) return;
    const measure = ()=>setWidth(Math.max(240,node.clientWidth));
    measure();
    const observer = new ResizeObserver(measure); observer.observe(node);
    return ()=>observer.disconnect();
  },[chart.message]);
  if (chart.message) return <div role="status" style={{padding:24}}>{chart.message}</div>;
  const geometry = buildChartGeometry(chart.points,width);
  const right = width-30; const tickCount = geometry.start===geometry.end ? 1 : width<520 ? 2 : 5;
  return <div style={{display:'flex',minHeight:320,background:'#fff',color:'#334155'}}>
    <aside aria-label="竞拍用户颜色列表" style={{width:'clamp(84px,20vw,150px)',flexShrink:0,padding:'12px 8px',borderRight:'1px solid #e2e8f0',overflowY:'auto',maxHeight:440}}>
      <div style={{fontWeight:600,fontSize:13,marginBottom:12}}>竞拍用户</div>
      {chart.users.map(user=><div key={user.username} style={{display:'flex',gap:6,alignItems:'flex-start',fontSize:12,marginBottom:12,overflowWrap:'anywhere'}}>
        <span style={{width:10,height:10,marginTop:3,borderRadius:3,flexShrink:0,background:user.color}} />{user.username}
      </div>)}
    </aside>
    <div ref={plotRef} style={{minWidth:0,flex:1,overflowX:'auto'}}>
      <svg role="img" aria-label="用户拍卖记录时间价格折线图" viewBox={`0 0 ${width} 400`} style={{display:'block',width:'100%',height:400}}>
        <defs>{geometry.segments.map((segment,index)=><linearGradient key={index} id={`${prefix}-${index}`} gradientUnits="userSpaceOnUse" x1="0" y1={Math.min(segment.from.y,segment.to.y)} x2="0" y2="330">
          <stop offset="0" stopColor={segment.color} stopOpacity=".4" /><stop offset="1" stopColor="#fff" />
        </linearGradient>)}</defs>
        {Array.from({length:5},(_,i)=>{
          const y=330-i*75;return <g key={i}><line x1="70" y1={y} x2={right} y2={y} stroke="#e2e8f0" />
            <text x="62" y={y+4} textAnchor="end" fontSize="11" fill="#64748b">{Math.round(geometry.maxPrice*i/4).toLocaleString('en-US')}</text></g>;
        })}
        {geometry.segments.map((segment,index)=><g key={index} data-segment-user={segment.from.username}>
          <path d={`M${segment.from.x},330 L${segment.from.x},${segment.from.y} L${segment.to.x},${segment.to.y} L${segment.to.x},330 Z`} fill={`url(#${prefix}-${index})`} />
          <line x1={segment.from.x} y1={segment.from.y} x2={segment.to.x} y2={segment.to.y} stroke={segment.color} strokeWidth="2" />
        </g>)}
        <path d={`M70 30V330H${right}`} fill="none" stroke="#94a3b8" />
        {geometry.points.map((point,index)=><circle key={index} data-auction-end={point.isEnd ? 'true' : undefined} cx={point.x} cy={point.y} r="3" fill={point.color}>
          <title>{point.isEnd ? '商品结束时间 · ' : ''}{point.time} · {point.username} · {point.price.toLocaleString('en-US')}円</title>
        </circle>)}
        {Array.from({length:tickCount},(_,i)=>{
          const ratio=tickCount===1?0:i/(tickCount-1); const x=70+ratio*(width-100);
          const stamp=geometry.start+(geometry.end-geometry.start)*ratio;return <g key={i}>
            <line x1={x} y1="330" x2={x} y2="336" stroke="#94a3b8" />
            <text x={x} y="353" textAnchor={i===0?'start':i===tickCount-1?'end':'middle'} fontSize="11">{timeLabel(stamp)}</text></g>;
        })}
        <text x="16" y="19" fontSize="12">价格（円）</text><text x={right} y="382" textAnchor="end" fontSize="12">时间（日本时间）</text>
      </svg>
    </div>
  </div>;
}
export default function AuctionHistoryChart({ item, onClose }) {
  const [result,setResult] = useState({loading:true,data:'',message:''});
  useEffect(()=>{
    if (!item) return;
    const controller = new AbortController(); const account = localStorage.getItem('actingUserId');
    setResult({loading:true,data:'',message:''});
    api.get(`/task/auction-history/${encodeURIComponent(item.product_id)}`,{params:{format:'chart'},signal:controller.signal})
      .then(({data})=>{
        if (!controller.signal.aborted && account===localStorage.getItem('actingUserId')) setResult({loading:false,data:data.data,endTime:data.end_time ?? item.end_time,message:''});
      }).catch(error=>{if(!controller.signal.aborted)setResult({loading:false,data:'',message:getApiErrorMessage(error,'图表读取失败')});});
    const close = ()=>onClose();
    window.addEventListener('acting-user-change',close);
    const key = event=>{if(event.key==='Escape')onClose();};window.addEventListener('keydown',key);
    return ()=>{controller.abort();window.removeEventListener('acting-user-change',close);window.removeEventListener('keydown',key);};
  },[item?.product_id]);
  if (!item) return null;
  return <div onClick={onClose} style={{position:'fixed',inset:0,zIndex:1100,background:'rgba(15,23,42,.4)',display:'flex',alignItems:'center',justifyContent:'center',padding:12}}>
    <div role="dialog" aria-modal="true" aria-label="用户拍卖记录图表" onClick={event=>event.stopPropagation()} style={{width:'min(1100px,100%)',maxHeight:'85vh',overflowY:'auto',borderRadius:12,background:'#fff',boxShadow:'0 12px 40px #0003'}}>
      <div style={{padding:'12px 14px',display:'flex',gap:12,alignItems:'center',borderBottom:'1px solid #e2e8f0',color:'#334155'}}>
        <div style={{flex:1,minWidth:0}}><strong>用户拍卖记录图表</strong><div style={{fontSize:12,overflowWrap:'anywhere',marginTop:4}}>{item.product_title || item.product_id}</div></div>
        <button type="button" onClick={onClose} style={{border:0,background:'transparent',cursor:'pointer',color:'#2563eb'}}>关闭</button>
      </div>
      {result.loading ? <div role="status" style={{padding:24}}>正在读取拍卖记录…</div> : result.message ? <div role="status" style={{padding:24}}>{result.message}</div> : <AuctionHistoryPlot data={result.data} endTime={result.endTime} />}
    </div>
  </div>;
}
