import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, List, SpinLoading, Tag, Toast } from 'antd-mobile';
import { useNavigate } from 'react-router-dom';
import UserNav from '../components/UserNav';
import { getActiveBiddingTaskList } from '../utils/api';
import { isUserIdle, USER_ACTIVE_EVENT } from '../utils/activity';
import { runDeduped } from '../utils/requestDedupe';

const STRATEGY_LABELS = {
  direct: '即时拍',
  multi_bid: '多次出价',
  '1min': '结束前 1 分钟',
  '2min': '结束前 2 分钟',
  '5min': '结束前 5 分钟',
  '10min': '结束前 10 分钟'
};

function formatJPY(value) {
  const amount = Number(value || 0);
  return amount > 0 ? `${amount.toLocaleString('ja-JP')}円` : '-';
}

function getDisplayPrice(item) {
  return item.current_price;
}

function isOutbidItem(item) {
  return item?.bidding_status === 'outbid' || Number(item?.is_highest_bidder) === 0;
}

function getProductUrl(item) {
  return item.product_url || `https://auctions.yahoo.co.jp/jp/auction/${item.product_id}`;
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

export default function ActiveBidding() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchItems = useCallback(() => {
    if (document.visibilityState === 'hidden' || isUserIdle()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    runDeduped('ActiveBidding:getActiveBiddingTaskList', () => getActiveBiddingTaskList({ limit: 100 }))
      .then(res => {
        setItems(res.data?.data || []);
      })
      .catch(e => {
        Toast.show({ content: e.response?.data?.error || '入札中商品加载失败' });
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, []);

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
    <div style={{ padding: 16 }}>
      <UserNav />
      <List
        header={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>入札中</span>
            <Button size="mini" fill="none" onClick={fetchItems}>刷新</Button>
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
          return (
            <List.Item key={item.id}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                {item.product_image_url ? (
                  <img
                    src={item.product_image_url}
                    alt={title}
                    style={{ width: 86, height: 86, objectFit: 'cover', borderRadius: 8, border: '1px solid #eee', flex: '0 0 86px' }}
                  />
                ) : (
                  <div style={{ width: 86, height: 86, borderRadius: 8, border: '1px solid #eee', background: '#f5f5f5', flex: '0 0 86px' }} />
                )}
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginBottom: 4 }}>
                    {outbid ? (
                      <Tag color="danger">高値更新</Tag>
                    ) : (
                      <Tag color="primary">最高价入札中</Tag>
                    )}
                    <span style={{ fontSize: 12, color: '#666' }}>{strategy}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, marginBottom: 6 }}>
                    {title}
                  </div>
                  <div style={{ fontSize: 12, color: '#666', lineHeight: 1.7 }}>
                    商品ID：{item.product_id}<br />
                    当前价格：<span style={{ color: '#dc2626', fontWeight: 700 }}>{formatJPY(getDisplayPrice(item))}</span>
                    {item.shipping_fee_text ? <span>　运费：{item.shipping_fee_text}</span> : null}
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
                    onClick={() => navigate(`/submit?url=${encodeURIComponent(getProductUrl(item))}`)}
                    style={{ flex: '0 0 auto', marginTop: 26 }}
                  >
                    再入札
                  </Button>
                ) : null}
              </div>
            </List.Item>
          );
        })}
      </List>
    </div>
  );
}
