import { useEffect, useState } from 'react';
import { Button, SpinLoading } from 'antd-mobile';
import { getApiErrorMessage, getProductBidHistory } from '../utils/api';
import { colors } from '../styles';

export default function BidHistoryPanel({ auctionId, title }) {
  const [pageUrl, setPageUrl] = useState('');
  const [retry, setRetry] = useState(0);
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const controller = new AbortController();
    setLoading(true);
    setError('');
    setData(null);
    getProductBidHistory(auctionId, pageUrl, controller.signal).then(res => {
      if (!controller.signal.aborted) setData(res.data.data);
    }).catch(error => {
      if (!controller.signal.aborted) setError(getApiErrorMessage(error, '拍卖记录加载失败，请稍后重试'));
    }).finally(() => {
      if (!controller.signal.aborted) setLoading(false);
    });
    return () => controller.abort();
  }, [auctionId, pageUrl, retry]);

  return (
    <div style={{ padding: 18, color: colors.text }}>
      <div style={{ fontWeight: 600, marginBottom: 8 }}>{title}</div>
      <div style={{ color: colors.muted, fontSize: 12, marginBottom: 16 }}>商品 ID：{auctionId}　时间为 Yahoo 页面显示的日本时间</div>
      {loading ? (
        <div className="product-search-detail-state"><SpinLoading /><div>正在抓取 Yahoo 拍卖记录…</div></div>
      ) : error ? (
        <div className="product-search-detail-state">
          <div role="alert">{error}</div>
          <Button size="small" fill="outline" color="primary" onClick={() => setRetry(value => value + 1)}>重新加载</Button>
        </div>
      ) : data ? (
        <>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 12 }}>
            <Button size="small" fill="outline" onClick={() => setRetry(value => value + 1)}>刷新记录</Button>
            {data.links.map(link => (
              <Button key={link.url} size="small" fill="outline" color="primary" onClick={() => setPageUrl(link.url)}>{link.label}</Button>
            ))}
          </div>
          {data.pageLabel ? <div style={{ textAlign: 'center', marginBottom: 8, color: colors.muted }}>{data.pageLabel}</div> : null}
          {data.rows.length === 0 ? <div style={{ padding: 32, textAlign: 'center', color: colors.muted }}>暂无拍卖记录</div> : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', minWidth: 580, borderCollapse: 'collapse', fontSize: 13 }}>
                <thead><tr>{data.headers.map((header, index) => (
                  <th key={index} style={{ padding: '12px 10px', textAlign: 'left', borderBottom: `1px solid ${colors.border}`, background: colors.cardSoft }}>{header}</th>
                ))}</tr></thead>
                <tbody>{data.rows.map((row, rowIndex) => (
                  <tr key={rowIndex}>{row.map((cell, cellIndex) => (
                    <td key={cellIndex} style={{ padding: '12px 10px', borderBottom: `1px solid ${colors.border}`, whiteSpace: cellIndex > 0 ? 'nowrap' : undefined }}>{cell}</td>
                  ))}</tr>
                ))}</tbody>
              </table>
            </div>
          )}
        </>
      ) : null}
    </div>
  );
}
