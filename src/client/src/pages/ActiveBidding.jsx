import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, List, SpinLoading, Tag, Toast } from 'antd-mobile';
import { useNavigate } from 'react-router-dom';
import { getActiveBiddingTaskList } from '../utils/api';
import { isUserIdle, USER_ACTIVE_EVENT } from '../utils/activity';
import { runDeduped } from '../utils/requestDedupe';
import { getAuctionProductUrl, getRebidSubmitPath } from '../utils/rebid';
import { formatTotalAmount } from '../utils/totalAmount';
import { colors, imageThumbStyle, itemCardStyle, listStyle, outlineButtonStyle, pageButtonStyle } from '../styles';

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
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const fetchItems = useCallback((nextPage = page) => {
    const requestedPage = Number.isFinite(Number(nextPage)) && Number(nextPage) > 0 ? Number(nextPage) : page;
    if (document.visibilityState === 'hidden' || isUserIdle()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    runDeduped(`ActiveBidding:getActiveBiddingTaskList:${requestedPage}`, () => getActiveBiddingTaskList({ page: requestedPage, limit: pageSize }))
      .then(res => {
        setItems(res.data?.data || []);
        setTotal(Number(res.data?.total || 0));
        setPage(Number(res.data?.page || requestedPage));
      })
      .catch(e => {
        Toast.show({ content: e.response?.data?.error || '入札中商品加载失败' });
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [page]);

  useEffect(() => {
    fetchItems();
    window.addEventListener('acting-user-change', fetchItems);
    window.addEventListener(USER_ACTIVE_EVENT, fetchItems);
    document.addEventListener('visibilitychange', fetchItems);
    window.addEventListener('focus', fetchItems);
    return () => {
      window.removeEventListener('acting-user-change', fetchItems);
      window.removeEventListener(USER_ACTIVE_EVENT, fetchItems);
      document.removeEventListener('visibilitychange', fetchItems);
      window.removeEventListener('focus', fetchItems);
    };
  }, [fetchItems]);

  return (
    <>
      <List
        style={listStyle}
        header={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: colors.text, fontWeight: 500, borderBottom: '1px solid #eee', paddingBottom: 10 }}>
            <span>入札中</span>
            <Button size="mini" fill="outline" style={outlineButtonStyle} onClick={() => fetchItems(page)}>刷新</Button>
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
            <Empty description="暂无入札中商品" />
          </div>
        )}
        {!loading && items.map(item => {
          const title = item.product_title || `商品 ${item.product_id}`;
          const strategy = STRATEGY_LABELS[item.strategy] || item.strategy || '即时拍';
          const outbid = isOutbidItem(item);
          const canRebid = item.strategy === 'direct';
          const displayPrice = getDisplayPrice(item);
          return (
            <List.Item key={item.id} style={itemCardStyle}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {item.product_image_url ? (
                  <img
                    src={item.product_image_url}
                    alt={title}
                    style={imageThumbStyle}
                  />
                ) : (
                  <div style={imageThumbStyle} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    {outbid ? (
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
        {!loading && total > pageSize && (
          <div style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Button size="mini" fill="outline" style={pageButtonStyle(false)} disabled={page <= 1} onClick={() => fetchItems(page - 1)}>上一页</Button>
            <span style={{ fontSize: 12, color: colors.muted, fontWeight: 700 }}>{page} / {totalPages}</span>
            <Button size="mini" fill="outline" style={pageButtonStyle(false)} disabled={page >= totalPages} onClick={() => fetchItems(page + 1)}>下一页</Button>
          </div>
        )}
      </List>
    </>
  );
}
