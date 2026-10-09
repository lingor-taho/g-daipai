import { useEffect, useRef, useState } from 'react';
import { buildLineChartPoints, buildLineChartSegments, isStatisticsDateTick } from '../utils/statisticsChart';
import { cardStyle, colors, sectionTitleStyle } from '../styles';

function shortDate(date) {
  const [, month, day] = date.split('-');
  return `${Number(month)}/${Number(day)}`;
}

function percent(value) {
  return `${(Number(value || 0) * 100).toFixed(1).replace(/\.0$/, '')}%`;
}

export default function DailyStatisticsChart({ daily, kind }) {
  const [activeDate, setActiveDate] = useState('');
  const chartScrollRef = useRef(null);
  useEffect(() => {
    const node = chartScrollRef.current;
    if (!node || !daily.length) return;
    const frame = requestAnimationFrame(() => {
      node.scrollLeft = node.scrollWidth - node.clientWidth;
    });
    return () => cancelAnimationFrame(frame);
  }, [daily, kind]);
  const harvest = kind === 'harvest';
  const field = harvest ? 'harvest_rate' : 'task_count';
  const maxValue = harvest ? 1 : Math.max(4, Math.ceil(Math.max(...daily.map(item => Number(item.task_count || 0)), 0) / 4) * 4);
  const points = buildLineChartPoints(daily, field, maxValue);
  const segments = buildLineChartSegments(points);
  const active = daily.find(item => item.date === activeDate) || daily[daily.length - 1];
  const color = harvest ? '#16a34a' : colors.accent;

  return (
    <div style={{ ...cardStyle, padding: 14, marginBottom: 12 }}>
      <div style={{ ...sectionTitleStyle, marginBottom: 10 }}>{harvest ? '近90天收获指数' : '近90天活跃指数'}</div>
      <div style={{ minHeight: 42, fontSize: 13, lineHeight: 1.6, background: colors.cardSoft, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '9px 10px', marginBottom: 8 }}>
        {active ? <><strong>{active.date}</strong>：{harvest
          ? `${percent(active.harvest_rate)}（落札 ${active.item_count} 件 / 到期下架商品 ${active.ended_product_count} 件）`
          : `提交 ${active.task_count} 次任务`}</> : null}
      </div>
      <div style={{ display: 'flex' }}>
        <div style={{ width: 42, flexShrink: 0, position: 'relative', height: 242, color: colors.muted, fontSize: 11 }}>
          {[1, 0.75, 0.5, 0.25, 0].map(ratio => (
            <span key={ratio} style={{ position: 'absolute', top: 16 + (1 - ratio) * 190, right: 6, transform: 'translateY(-50%)' }}>
              {harvest ? `${ratio * 100}%` : ratio * maxValue}
            </span>
          ))}
        </div>
        <div ref={chartScrollRef} style={{ overflowX: 'auto', flex: 1, minWidth: 0 }}>
          <svg viewBox="0 0 930 242" preserveAspectRatio="none" style={{ display: 'block', width: '100%', minWidth: 960, height: 242 }} role="group" aria-label={harvest ? '每日落札数除以当日到期下架商品数折线图' : '每日提交任务总数折线图'}>
            <g transform="translate(15,16)">
              {[0, 0.25, 0.5, 0.75, 1].map(ratio => (
                <line key={ratio} x1="0" x2="900" y1={ratio * 190} y2={ratio * 190} stroke={colors.border} />
              ))}
              {segments.map((segment, index) => (
                <polyline key={index} points={segment.map(point => `${point.x},${point.y}`).join(' ')} fill="none" stroke={color} strokeWidth="2" strokeLinejoin="round" />
              ))}
              {points.map((point, index) => (
                <g key={point.date}>
                  {point.y != null ? point.overflow
                    ? <path d={`M ${point.x} -5 l -4 7 h 8 Z`} fill={colors.danger} />
                    : <circle cx={point.x} cy={point.y} r={point.date === active?.date ? 4 : 2.5} fill={color} /> : null}
                  <rect x={point.x - 5} y="-10" width="10" height="210" fill="transparent" tabIndex="0" role="button"
                    aria-label={`${point.date}：${harvest ? percent(point.value) : `${point.value} 次任务`}`}
                    onMouseEnter={() => setActiveDate(point.date)} onFocus={() => setActiveDate(point.date)} onClick={() => setActiveDate(point.date)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); setActiveDate(point.date); } }}
                    style={{ cursor: 'pointer' }}>
                    <title>{point.date}：{harvest ? percent(point.value) : `${point.value} 次任务`}</title>
                  </rect>
                  {isStatisticsDateTick(index, points.length) ? (
                    <text x={point.x} y="217" textAnchor={index === 0 ? 'start' : index === points.length - 1 ? 'end' : 'middle'} fontSize="11" fill={colors.muted}>{shortDate(point.date)}</text>
                  ) : null}
                </g>
              ))}
            </g>
          </svg>
        </div>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, lineHeight: 1.6, color: colors.muted }}>
        {harvest ? '每日落札数 ÷ 当日到期下架商品数，同一商品只计一次；非落札按商品结束时间，已落札按落札时间统计；无数据日按 0% 显示并连续连线。超过 100% 用顶端三角标记，点击查看实际比例。' : '按任务提交日期统计，包含成功、失败、终止及其他状态的全部任务。'}
      </div>
    </div>
  );
}
