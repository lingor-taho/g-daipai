export function buildAuctionHistoryChart(raw, endTime = '') {
  if (raw === '' || raw == null) return {message:'拍卖记录尚未采集',points:[],users:[]};
  if (raw === '数据已过期') return {message:'数据已过期',points:[],users:[]};
  let rows;
  try { rows = typeof raw === 'string' ? JSON.parse(raw) : raw; } catch (_) {}
  if (!Array.isArray(rows)) return {message:'拍卖记录数据无法解析',points:[],users:[]};
  if (!rows.length) return {message:'暂无入札记录',points:[],users:[]};
  const endText = String(endTime || '').replace(' ','T');
  const endMs = Date.parse(endText + (/[zZ]|[+-]\d\d:\d\d$/.test(endText)?'':'+09:00'));
  const anchor = Number.isFinite(endMs) ? new Date(endMs+9*3600000) : new Date();
  let year = anchor.getUTCFullYear(); let previous = Infinity;
  const parsed = [];
  for (const row of rows) {
    const match = String(row?.time || '').match(/^(\d{1,2})-(\d{1,2}) (\d{2}):(\d{2})$/);
    if (!match || typeof row.username !== 'string' || !Number.isSafeInteger(row.price) || row.price < 0) return {message:'拍卖记录数据无法解析',points:[],users:[]};
    const [m,d,h,min] = match.slice(1).map(Number);
    if (m<1 || m>12 || d<1 || d>31 || h>23 || min>59) return {message:'拍卖记录时间无效',points:[],users:[]};
    let stamp = Date.UTC(year,m-1,d,h,min);
    if (!parsed.length && Number.isFinite(endMs)) {
      const near = [year-1,year,year+1].sort((a,b)=>Math.abs(Date.UTC(a,m-1,d,h,min)-(endMs+9*3600000))-Math.abs(Date.UTC(b,m-1,d,h,min)-(endMs+9*3600000)));
      year = near[0]; stamp = Date.UTC(year,m-1,d,h,min);
    }
    if (stamp > previous) { year -= 1; stamp = Date.UTC(year,m-1,d,h,min); }
    if (new Date(stamp).getUTCMonth() !== m-1 || new Date(stamp).getUTCDate() !== d) return {message:'拍卖记录时间无效',points:[],users:[]};
    previous = stamp;
    parsed.push({...row,stamp});
  }
  const points = parsed.reverse(); const users = []; const colors = new Map(); let bidder = 0;
  for (const point of points) {
    if (!colors.has(point.username)) {
      const color = point.username === '开始' ? '#94a3b8' : `hsl(${(130+bidder++*137.508)%360}, 65%, 42%)`;
      colors.set(point.username,color); users.push({username:point.username,color});
    }
    point.color = colors.get(point.username);
  }
  return {points,users,message:''};
}

export function buildChartGeometry(points, width = 900) {
  if (!points.length) return {segments:[],points:[],maxPrice:1,start:0,end:0};
  const start = points[0].stamp; const end = points.at(-1).stamp;
  const maxPrice = Math.max(1,...points.map(p=>p.price))*1.08;
  const mapped = points.map(point=>({...point,x:70+(point.stamp-start)/Math.max(1,end-start)*(width-100),y:330-point.price/maxPrice*300}));
  return {start,end,maxPrice,points:mapped,segments:mapped.slice(1).map((point,index)=>({from:mapped[index],to:point,color:point.color}))};
}
