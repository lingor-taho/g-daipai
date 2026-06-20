import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Button, Empty, SpinLoading, Toast } from 'antd-mobile';
import { getWonStats } from '../utils/api';
import { USER_ACTIVE_EVENT } from '../utils/activity';
import { runDeduped } from '../utils/requestDedupe';
import { buildWonStatsCsv, downloadCsv } from '../utils/wonStats';
import { cardStyle, colors, outlineButtonStyle, sectionTitleStyle } from '../styles';

function formatJPY(value) {
  const amount = Number(value || 0);
  return `${amount.toLocaleString('ja-JP')}円`;
}

function formatShortDate(value) {
  const [, month, day] = String(value || '').split('-');
  return month && day ? `${Number(month)}/${Number(day)}` : value;
}

function buildCsvFilename() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `won-items-${year}${month}${day}.csv`;
}

export default function Statistics() {
  const [daily, setDaily] = useState([]);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeDate, setActiveDate] = useState('');
  const chartScrollRef = useRef(null);

  const fetchStats = useCallback(() => {
    setLoading(true);
    runDeduped('Statistics:getWonStats', () => getWonStats({ days: 30 }))
      .then(res => {
        const data = res.data?.data || {};
        const nextDaily = data.daily || [];
        setDaily(nextDaily);
        setItems(data.items || []);
        setActiveDate(nextDaily[nextDaily.length - 1]?.date || '');
      })
      .catch(e => {
        Toast.show({ content: e.response?.data?.error || '统计数据加载失败' });
        setDaily([]);
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchStats();
    window.addEventListener('acting-user-change', fetchStats);
    window.addEventListener(USER_ACTIVE_EVENT, fetchStats);
    window.addEventListener('focus', fetchStats);
    return () => {
      window.removeEventListener('acting-user-change', fetchStats);
      window.removeEventListener(USER_ACTIVE_EVENT, fetchStats);
      window.removeEventListener('focus', fetchStats);
    };
  }, [fetchStats]);

  useEffect(() => {
    const node = chartScrollRef.current;
    if (!node || !daily.length || loading) return;
    requestAnimationFrame(() => {
      node.scrollLeft = node.scrollWidth - node.clientWidth;
    });
  }, [daily, loading]);

  const maxAmount = useMemo(
    () => Math.max(1, ...daily.map(item => Number(item.total_amount || 0))),
    [daily]
  );
  const activeItem = daily.find(item => item.date === activeDate) || daily[daily.length - 1] || null;
  const totalAmount = daily.reduce((sum, item) => sum + Number(item.total_amount || 0), 0);
  const totalCount = daily.reduce((sum, item) => sum + Number(item.item_count || 0), 0);

  function handleExport() {
    downloadCsv(buildCsvFilename(), buildWonStatsCsv(items));
  }

  return (
    <>
      <div style={{ ...cardStyle, padding: 14, marginBottom: 12 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginBottom: 10 }}>
          <div>
            <div style={sectionTitleStyle}>近30天落札统计</div>
            <div style={{ fontSize: 12, color: colors.muted, marginTop: 4 }}>
              合计 {formatJPY(totalAmount)} / {totalCount} 件
            </div>
          </div>
          <Button size="small" color="primary" fill="outline" style={outlineButtonStyle} disabled={!items.length} onClick={handleExport}>
            导出CSV
          </Button>
        </div>

        {loading && (
          <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
            <SpinLoading />
          </div>
        )}

        {!loading && daily.length === 0 && (
          <div style={{ padding: 24 }}>
            <Empty description="暂无统计数据" />
          </div>
        )}

        {!loading && daily.length > 0 && (
          <>
            <div style={{ minHeight: 42, marginBottom: 8, fontSize: 13, color: colors.text, background: colors.cardSoft, border: `1px solid ${colors.border}`, borderRadius: 8, padding: '9px 10px', boxSizing: 'border-box' }}>
              {activeItem ? (
                <>
                  <strong>{activeItem.date}</strong>
                  <span>：{formatJPY(activeItem.total_amount)}，{activeItem.item_count} 件</span>
                </>
              ) : null}
            </div>
            <div ref={chartScrollRef} style={{ overflowX: 'auto', paddingBottom: 4 }}>
              <div
                style={{
                  minWidth: 720,
                  height: 250,
                  display: 'grid',
                  gridTemplateColumns: `repeat(${daily.length}, minmax(16px, 1fr))`,
                  gap: 6,
                  alignItems: 'end',
                  borderLeft: `1px solid ${colors.border}`,
                  borderBottom: `1px solid ${colors.border}`,
                  borderRadius: 8,
                  background: colors.card,
                  padding: '12px 8px 22px 8px',
                  position: 'relative'
                }}
              >
                {daily.map(item => {
                  const amount = Number(item.total_amount || 0);
                  const height = amount > 0 ? Math.max(8, Math.round((amount / maxAmount) * 190)) : 2;
                  const selected = item.date === activeDate;
                  return (
                    <button
                      key={item.date}
                      type="button"
                      title={`${item.date}：${item.item_count} 件`}
                      onClick={() => setActiveDate(item.date)}
                      onMouseEnter={() => setActiveDate(item.date)}
                      style={{
                        height: 216,
                        border: 0,
                        padding: 0,
                        background: 'transparent',
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'flex-end',
                        gap: 6,
                        cursor: 'pointer'
                      }}
                    >
                      <span
                        style={{
                          width: '100%',
                          maxWidth: 24,
                          height,
                          borderRadius: '5px 5px 0 0',
                          background: selected ? colors.accent : colors.accent2,
                          boxShadow: selected ? `0 4px 10px ${colors.buttonShadow}` : `0 4px 10px ${colors.shadow}`,
                          transition: 'height 160ms ease, background 120ms ease, box-shadow 120ms ease'
                        }}
                      />
                      <span style={{ fontSize: 10, color: selected ? colors.text : colors.muted, height: 12, fontWeight: selected ? 700 : 400 }}>
                        {formatShortDate(item.date)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
          </>
        )}
      </div>
    </>
  );
}
