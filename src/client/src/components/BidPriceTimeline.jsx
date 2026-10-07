import { buildBidPriceMarkers, formatBidSubmissionTime } from '../utils/bidPriceTimeline';
import { colors } from '../styles';

export default function BidPriceTimeline({ currentPrice, bids = [], endpointLabel = '当前' }) {
  const markers = buildBidPriceMarkers(bids, currentPrice);
  const timeLabels = markers.filter((marker, index) => index === 0 || index === markers.length - 1)
    .map(marker => ({ ...marker, time: formatBidSubmissionTime(marker.created_at), labelX: Math.max(60, Math.min(292, 16 + marker.x)) }))
    .filter(marker => marker.time);
  const stackedLabels = timeLabels.length === 2 && Math.abs(timeLabels[0].labelX - timeLabels[1].labelX) < 112;
  const lanes = Math.max(0, ...markers.map(marker => marker.lane));
  const baseline = 10 + lanes * 7;
  const height = baseline + 3;
  const currentX = 16 + (markers[0]?.currentX ?? 320);
  const scaleMax = markers[0]?.scaleMax ?? Number(currentPrice);
  if (!(Number(currentPrice) > 0)) {
    return <div style={{ fontSize: 12, color: colors.muted, marginTop: 6 }}>{endpointLabel}价格尚未记录</div>;
  }
  return (
    <div style={{ width: '100%', maxWidth: 380, boxSizing: 'border-box', marginTop: 7, padding: '7px 8px 5px', borderRadius: 8, background: colors.cardSoft }} role="group" aria-label="历史提交最高价对比">
      {timeLabels.length ? <div style={{ position: 'relative', height: stackedLabels ? 34 : 19 }}>
        {timeLabels.map((marker, index) => (
          <span key={marker.task_id || index} title={`提交时间（北京时间）：${marker.time}`} style={{
            position: 'absolute', left: `clamp(43px, ${(16 + marker.x) / 352 * 100}%, calc(100% - 43px))`,
            top: stackedLabels ? index * 16 : 0, transform: 'translateX(-50%)', whiteSpace: 'nowrap',
            fontSize: 10, lineHeight: '15px', fontVariantNumeric: 'tabular-nums', color: colors.muted,
            padding: '0 4px', borderRadius: 4, background: colors.card
          }}>{marker.time}</span>
        ))}
      </div> : null}
      <svg viewBox={`0 0 352 ${height}`} preserveAspectRatio="none" style={{ display: 'block', width: '100%', height }}>
      <line x1="16" y1={baseline} x2="336" y2={baseline} stroke={colors.borderStrong} strokeWidth="2" strokeLinecap="round" />
      <path d={`M16 ${baseline - 3}v3 M${currentX} ${baseline - 3}v3`} fill="none" stroke={colors.muted} strokeWidth="1" />
      {markers.map((marker, index) => {
        const x = 16 + marker.x;
        const y = baseline - marker.lane * 7;
        return (
          <g key={marker.task_id || index} tabIndex="0" aria-label={`第 ${index + 1} 次提交：${marker.amount.toLocaleString('ja-JP')}円${marker.overflow ? `，高于${endpointLabel}价格` : ''}`}>
            {marker.lane > 0 ? <line x1={x} x2={x} y1={y} y2={baseline} stroke={colors.accent} strokeWidth="0.75" strokeDasharray="2 2" /> : null}
            <path d={`M${x} ${y - 6}l-4 6h8Z`} fill={marker.overflow ? colors.danger : colors.accent} stroke={colors.card} strokeWidth="1" strokeLinejoin="round" />
            <title>{`第 ${index + 1} 次提交：${marker.amount.toLocaleString('ja-JP')}円${marker.created_at ? `（${marker.created_at}）` : ''}`}</title>
          </g>
        );
      })}
      </svg>
      <div style={{ display: 'flex', justifyContent: 'space-between', gap: 6, padding: '1px 4.5% 0', fontSize: 10, lineHeight: '15px', fontVariantNumeric: 'tabular-nums', color: colors.muted }}>
        <span>0円</span>
        <span style={{ textAlign: 'right' }}>
          {scaleMax > Number(currentPrice) ? `${endpointLabel} ` : ''}{Number(currentPrice).toLocaleString('ja-JP')}円
          {scaleMax > Number(currentPrice) ? <span style={{ color: colors.danger }}> · 上限 {scaleMax.toLocaleString('ja-JP')}円</span> : null}
        </span>
      </div>
    </div>
  );
}
