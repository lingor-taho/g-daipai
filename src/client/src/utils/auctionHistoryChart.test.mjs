import assert from 'node:assert/strict';
import { buildAuctionHistoryChart, buildChartGeometry } from './auctionHistoryChart.js';
const rows = [
  {time:'10-8 21:46',username:'Bob',price:81000},
  {time:'10-8 21:44',username:'Alice',price:80000},
  {time:'10-1 18:55',username:'开始',price:1}
];
const chart = buildAuctionHistoryChart(JSON.stringify(rows),'2026-10-08T21:46:00+09:00');
assert.deepEqual(chart.points.map(p=>p.username),['开始','Alice','Bob']);
assert.equal(chart.users.length,3);
assert.notEqual(chart.points[1].color,chart.points[2].color);
assert.equal(chart.points[1].color,'hsl(130, 65%, 42%)');
const geometry = buildChartGeometry(chart.points);
assert.equal(geometry.segments[0].color,chart.points[1].color);
assert.equal(geometry.segments[1].color,chart.points[2].color);
assert.ok(geometry.points[0].x < geometry.points[1].x);
assert.ok(geometry.points[1].x < geometry.points[2].x);
assert.ok(geometry.points[1].y > geometry.points[2].y);
assert.equal(chart.points[0].price,1);
assert.equal(buildAuctionHistoryChart('数据已过期').message,'数据已过期');
assert.equal(buildAuctionHistoryChart('[]').message,'暂无入札记录');
assert.equal(buildAuctionHistoryChart('').message,'拍卖记录尚未采集');
assert.ok(buildAuctionHistoryChart('invalid').message);
assert.ok(buildAuctionHistoryChart([{...rows[0],time:'2-30 12:00'}]).message);
const crossYear = buildAuctionHistoryChart([{time:'1-1 00:05',username:'Alice',price:2},{time:'12-31 23:59',username:'开始',price:1}],'2027-01-01T00:05:00+09:00');
assert.equal(crossYear.points[1].stamp-crossYear.points[0].stamp,6*60000);
const sameMinute = buildAuctionHistoryChart([{time:'10-8 21:46',username:'Alice',price:2},{time:'10-8 21:46',username:'开始',price:1}],'2026-10-08T21:46:00+09:00');
const same = buildChartGeometry(sameMinute.points);
assert.equal(same.points[0].x,same.points[1].x);
assert.ok(same.points.every(p=>Number.isFinite(p.x)&&Number.isFinite(p.y)));
for (const price of [1,900,1000,3619]) {
  const actual = buildAuctionHistoryChart([{time:'10-6 00:42',username:'Alice',price},{time:'10-5 00:41',username:'开始',price}], '2026-10-06T00:42:00+09:00');
  const plotted = buildChartGeometry(actual.points);
  assert.equal(actual.points[0].price,price);
  assert.equal(plotted.segments[0].from.y,plotted.segments[0].to.y);
  assert.ok(plotted.points[0].y < 330);
}
console.log('Auction history chart chronology, time scale, colors, expiry and cross-year tests passed');
