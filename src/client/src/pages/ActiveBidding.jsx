import { useCallback, useEffect, useRef, useState } from 'react';
import { Button, Empty, InfiniteScroll, List, SpinLoading, Tag, Toast } from 'antd-mobile';
import { useNavigate } from 'react-router-dom';
import { getActiveBiddingTaskList, getBiddingFailureAnalysis } from '../utils/api';
import { BidCountIcon } from '../components/ProductCard';
import ProductItemDetailPopup from '../components/ProductItemDetailPopup';
import BidPriceTimeline from '../components/BidPriceTimeline';
import AuctionHistoryChart, { AuctionHistoryChartButton } from '../components/AuctionHistoryChart';
import { isUserIdle, USER_ACTIVE_EVENT } from '../utils/activity';
import { runDeduped } from '../utils/requestDedupe';
import { getAuctionProductUrl, getRebidSubmitPath } from '../utils/rebid';
import { formatTotalAmount } from '../utils/totalAmount';
import { appendUniqueItems } from '../utils/pagedList';
import { colors, imageThumbStyle, itemCardStyle, listStyle, outlineButtonStyle } from '../styles';

const STRATEGY_LABELS = {
  direct: '即时拍',
  multi_bid: '多次出价',
  manual_import: '导入',
  '1min': '结束前 1 分钟',
  '2min': '结束前 2 分钟',
  '5min': '结束前 5 分钟',
  '10min': '结束前 10 分钟'
};

const titleLinkStyle = {
  color: colors.text,
  textDecoration: 'none',
  wordBreak: 'break-word'
};

function formatJPY(value) {
  const amount = Number(value || 0);
  return amount > 0 ? `${amount.toLocaleString('ja-JP')}円` : '-';
}

// current_price 是税前口径。商城商品页面显示是税后，要 ×1.1 才符合用户预期。
function getDisplayPrice(item) {
  const value = Number(item?.current_price || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (item?.tax_type !== 'tax_included' || value < 10) return value;
  return Math.floor(value * 1.1);
}

function isOutbidItem(item) {
  return item?.bidding_status === 'outbid' || Number(item?.is_highest_bidder) === 0;
}

function formatBeijingTime(value) {
  if (!value) return '';
  const raw = String(value).trim();
  const date = new Date(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw) ? raw.replace(' ', 'T') + 'Z' : raw);
  if (Number.isNaN(date.getTime())) return raw;
  return new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).format(date).replace(/\//g, '-');
}

function TimeIcon({ color = 'currentColor' }) {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill={color} aria-hidden="true" style={{ flex: '0 0 auto' }}>
      <path fillRule="evenodd" d="M2 12C2 6.48 6.47 2 11.99 2 17.52 2 22 6.48 22 12s-4.48 10-10.01 10C6.47 22 2 17.52 2 12Zm2 0c0 4.42 3.58 8 8 8s8-3.58 8-8-3.58-8-8-8Zm7-5h1.5v5.25l4.5 2.67-.75 1.23L11 13V7Z" clipRule="evenodd" />
    </svg>
  );
}

export default function ActiveBidding() {
  const navigate = useNavigate();
  const [analysisMode, setAnalysisMode] = useState(false);
  const requestRef = useRef(0);
  const [detailItem, setDetailItem] = useState(null);
  const [historyChartItem, setHistoryChartItem] = useState(null);
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const pageSize = 10;

  const resetItems = useCallback(async () => {
    const requestId = ++requestRef.current;
    if (document.visibilityState === 'hidden' || isUserIdle()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const actingUserKey = localStorage.getItem('actingUserId') || 'self';
      const fetchList = analysisMode ? getBiddingFailureAnalysis : getActiveBiddingTaskList;
      const res = await runDeduped(`ActiveBidding:${analysisMode ? 'analysis' : 'active'}:${actingUserKey}:1`, () => fetchList({ page: 1, limit: pageSize }));
      if (requestRef.current !== requestId || (localStorage.getItem('actingUserId') || 'self') !== actingUserKey) return;
      setItems(res.data?.data || []);
      setTotal(Number(res.data?.total || 0));
      setPage(1);
    } catch (e) {
      if (requestRef.current !== requestId) return;
      Toast.show({ content: e.response?.data?.error || (analysisMode ? '失败分析加载失败' : '入札中商品加载失败') });
      setItems([]);
      setTotal(0);
      setPage(0);
    } finally {
      if (requestRef.current === requestId) setLoading(false);
    }
  }, [analysisMode]);

  const loadMore = useCallback(async () => {
    const requestId = requestRef.current;
    const nextPage = page + 1;
    try {
      const actingUserKey = localStorage.getItem('actingUserId') || 'self';
      const fetchList = analysisMode ? getBiddingFailureAnalysis : getActiveBiddingTaskList;
      const res = await fetchList({ page: nextPage, limit: pageSize });
      if (requestRef.current !== requestId || (localStorage.getItem('actingUserId') || 'self') !== actingUserKey) return;
      setItems(current => appendUniqueItems(current, res.data?.data || [], 'product_id'));
      setTotal(Number(res.data?.total || 0));
      setPage(Number(res.data?.page || nextPage));
    } catch (e) {
      if (requestRef.current !== requestId) return;
      Toast.show({ content: e.response?.data?.error || (analysisMode ? '更多失败分析加载失败' : '更多入札中商品加载失败') });
      throw e;
    }
  }, [page, analysisMode]);

  const refreshLoadedItems = useCallback(async () => {
    if (document.visibilityState === 'hidden' || isUserIdle()) return;
    const actingUserKey = localStorage.getItem('actingUserId') || 'self';
    const requestId = requestRef.current;
    const refreshLimit = Math.min(Math.max(page, 1) * pageSize, 100);
    try {
      const res = await runDeduped(
        `ActiveBidding:refresh:${analysisMode ? 'analysis' : 'active'}:${actingUserKey}:${refreshLimit}`,
        () => (analysisMode ? getBiddingFailureAnalysis : getActiveBiddingTaskList)({ page: 1, limit: refreshLimit })
      );
      if (requestRef.current !== requestId || (localStorage.getItem('actingUserId') || 'self') !== actingUserKey) return;
      const refreshedItems = res.data?.data || [];
      setItems(refreshedItems);
      setTotal(Number(res.data?.total || 0));
      setPage(Math.max(1, Math.ceil(refreshedItems.length / pageSize)));
    } catch (_) {}
  }, [page, analysisMode]);

  useEffect(() => {
    resetItems();
    return () => { requestRef.current += 1; };
  }, [resetItems]);

  useEffect(() => {
    const handleActingUserChange = () => {
      setItems([]);
      setTotal(0);
      setPage(0);
      setDetailItem(null);
      resetItems();
    };
    window.addEventListener('acting-user-change', handleActingUserChange);
    window.addEventListener(USER_ACTIVE_EVENT, refreshLoadedItems);
    document.addEventListener('visibilitychange', refreshLoadedItems);
    window.addEventListener('focus', refreshLoadedItems);
    return () => {
      window.removeEventListener('acting-user-change', handleActingUserChange);
      window.removeEventListener(USER_ACTIVE_EVENT, refreshLoadedItems);
      document.removeEventListener('visibilitychange', refreshLoadedItems);
      window.removeEventListener('focus', refreshLoadedItems);
    };
  }, [refreshLoadedItems, resetItems]);

  return (
    <>
      <List
        style={listStyle}
        header={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: colors.text, fontWeight: 500, borderBottom: '1px solid #eee', paddingBottom: 10 }}>
            <button type="button" onClick={() => {
              requestRef.current += 1;
              setAnalysisMode(value => !value);
              setItems([]);
              setTotal(0);
              setPage(0);
              setDetailItem(null);
              setLoading(true);
            }} style={{ border: 0, padding: 0, background: 'transparent', color: 'inherit', font: 'inherit', cursor: 'pointer' }}>
              {analysisMode ? '失败分析 → 返回' : '入札中'}
            </button>
            <Button size="mini" fill="outline" style={outlineButtonStyle} onClick={resetItems}>刷新</Button>
          </div>
        }
      >
        {loading && (
          <div style={{ padding: 32, display: 'flex', justifyContent: 'center' }}>
            <SpinLoading />
          </div>
        )}
        {!loading && items.length === 0 && (
          <div style={{ padding: 24 }}>
            <Empty description={analysisMode ? '暂无已到期未落札商品' : '暂无入札中商品'} />
          </div>
        )}
        {!loading && items.map(item => {
          const title = item.product_title || `商品 ${item.product_id}`;
          const strategy = STRATEGY_LABELS[item.strategy] || item.strategy || '即时拍';
          const outbid = isOutbidItem(item);
          const canRebid = !analysisMode && item.strategy === 'direct';
          const displayPrice = getDisplayPrice(item);
          return (
            <List.Item key={item.id} style={itemCardStyle}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{ flex: '0 0 auto', minWidth: imageThumbStyle.width }}>
                  <button type="button" aria-label={`查看商品详情：${title}`} onClick={() => setDetailItem(item)}
                    style={{ display: 'block', padding: 0, border: 0, background: 'transparent', cursor: 'pointer' }}>
                  {item.product_image_url ? (
                    <img
                      src={item.product_image_url}
                      alt={title}
                      style={{ ...imageThumbStyle, display: 'block' }}
                    />
                  ) : (
                    <div style={imageThumbStyle} />
                  )}
                  </button>
                  {analysisMode ? <div style={{textAlign:'center'}}><AuctionHistoryChartButton item={item} onClick={() => setHistoryChartItem(item)} /></div> : null}
                  {!analysisMode && item.strategy === 'direct' ? (
                    <div
                      aria-label={`最高出价：${formatJPY(item.user_max_price || item.max_price)}`}
                      title="最高出价"
                      style={{ display: 'flex', alignItems: 'center', gap: 3, marginTop: 6, fontSize: 12, color: colors.muted, whiteSpace: 'nowrap' }}
                    >
                      <BidCountIcon />
                      <svg
                        aria-hidden="true"
                        width="14"
                        height="14"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        style={{ display: 'block', flex: '0 0 14px' }}
                      >
                        <path d="M4 12h16m-6-6 6 6-6 6" />
                      </svg>
                      <Tag color={outbid ? 'danger' : 'primary'} style={{ flexShrink: 0 }}>
                        {formatJPY(item.user_max_price || item.max_price)}
                      </Tag>
                    </div>
                  ) : null}
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    {analysisMode ? (
                      <Tag color="danger">未落札</Tag>
                    ) : outbid ? (
                      <Tag color="danger">高値更新</Tag>
                    ) : (
                      <Tag color="primary">最高价入札中</Tag>
                    )}
                    <span style={{ fontSize: 12, color: colors.muted }}>{strategy}</span>
                  </div>
                  <a
                    href={getAuctionProductUrl(item)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...titleLinkStyle, display: 'block', fontSize: 13, fontWeight: 600, lineHeight: 1.35, marginBottom: 6 }}
                  >
                    {title}
                  </a>
                  <div style={{ fontSize: 12, color: colors.muted, lineHeight: 1.7 }}>
                    商品ID：{item.product_id}<br />
                    {analysisMode ? (
                      <>
                        最终出价 <span style={{ color: colors.text, fontWeight: 600 }}>{formatJPY(item.final_bid)}</span>
                        {' / '}落札价 <span style={{ color: colors.danger, fontWeight: 600 }}>{formatJPY(displayPrice)}</span>
                        <div style={{ marginTop: 4 }}>商品结束时间：{formatBeijingTime(item.end_time) || '-'}</div>
                        <BidPriceTimeline currentPrice={displayPrice} bids={item.bid_history || []} />
                      </>
                    ) : (
                      <>
                    当前价格：<span style={{ color: colors.danger, fontWeight: 600 }}>{formatJPY(displayPrice)}</span>
                    {item.shipping_fee_text ? <span>　运费：{item.shipping_fee_text}</span> : null}
                    <br />
                    当前合计金额：<span style={{ color: colors.text, fontWeight: 600 }}>{formatTotalAmount(displayPrice, item.shipping_fee_text)}</span>
                    {item.remaining_time_text ? (
                      <>
                        <br />
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, color: colors.danger, fontWeight: 700 }}>
                          <TimeIcon color={colors.danger} />
                          剩余时间：{item.remaining_time_text}
                        </span>
                      </>
                    ) : null}
                    {item.updated_at ? (
                      <>
                        <br />
                        最近更新时间：{formatBeijingTime(item.updated_at)}
                      </>
                    ) : null}
                      </>
                    )}
                  </div>
                </div>
                {canRebid ? (
                  <Button
                    size="mini"
                    color="danger"
                    fill="outline"
                    onClick={() => navigate(getRebidSubmitPath(item))}
                    style={{ ...outlineButtonStyle, flex: '0 0 auto', marginTop: 26, '--text-color': colors.danger }}
                  >
                    再入札
                  </Button>
                ) : null}
              </div>
            </List.Item>
          );
        })}
        {!loading && items.length > 0 ? (
          <InfiniteScroll loadMore={loadMore} hasMore={items.length < total} />
        ) : null}
      </List>
      <AuctionHistoryChart item={historyChartItem} onClose={() => setHistoryChartItem(null)} />
      <ProductItemDetailPopup item={detailItem} onClose={() => setDetailItem(null)}
        onBid={analysisMode ? undefined : item => navigate(getRebidSubmitPath(item))} />
    </>
  );
}
