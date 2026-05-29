import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, List, SpinLoading, Tag, Toast } from 'antd-mobile';
import UserNav from '../components/UserNav';
import { getWonTaskList } from '../utils/api';
import { isUserIdle, USER_ACTIVE_EVENT } from '../utils/activity';
import { runDeduped } from '../utils/requestDedupe';
import { formatBeijingDateTime } from '../utils/datetime';
import { formatTotalAmount } from '../utils/totalAmount';

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

function getFinalPrice(item) {
  return item.final_price;
}

function getWonTimeDisplay(item) {
  return item.won_time_text || (item.won_at ? formatBeijingDateTime(item.won_at) : '');
}

export default function WonItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchWonItems = useCallback(() => {
    if (document.visibilityState === 'hidden' || isUserIdle()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    runDeduped('WonItems:getWonTaskList', () => getWonTaskList({ limit: 100 }))
      .then(res => {
        setItems(res.data?.data || []);
      })
      .catch(e => {
        Toast.show({ content: e.response?.data?.error || '落札商品加载失败' });
        setItems([]);
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    fetchWonItems();
    window.addEventListener('acting-user-change', fetchWonItems);
    window.addEventListener(USER_ACTIVE_EVENT, fetchWonItems);
    document.addEventListener('visibilitychange', fetchWonItems);
    window.addEventListener('focus', fetchWonItems);
    return () => {
      window.removeEventListener('acting-user-change', fetchWonItems);
      window.removeEventListener(USER_ACTIVE_EVENT, fetchWonItems);
      document.removeEventListener('visibilitychange', fetchWonItems);
      window.removeEventListener('focus', fetchWonItems);
    };
  }, [fetchWonItems]);

  return (
    <div style={{ padding: 16 }}>
      <UserNav />
      <List
        header={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span>落札商品</span>
            <Button size="mini" fill="none" onClick={fetchWonItems}>刷新</Button>
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
            <Empty description="暂无落札商品" />
          </div>
        )}
        {!loading && items.map(item => {
          const title = item.product_title || `商品 ${item.product_id}`;
          const strategy = STRATEGY_LABELS[item.strategy] || item.strategy || '即时拍';
          const finalPrice = getFinalPrice(item);
          const wonTime = getWonTimeDisplay(item);
          return (
            <List.Item key={item.id}>
              <div style={{ display: 'flex', gap: 12 }}>
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
                    <Tag color="success">落札成功</Tag>
                    <span style={{ fontSize: 12, color: '#666' }}>{strategy}</span>
                  </div>
                  <div style={{ fontSize: 14, fontWeight: 600, lineHeight: 1.35, marginBottom: 6 }}>
                    {title}
                  </div>
                  <div style={{ fontSize: 12, color: '#666', lineHeight: 1.7 }}>
                    商品ID：{item.product_id}<br />
                    落札价：<span style={{ color: '#dc2626', fontWeight: 700 }}>{formatJPY(finalPrice)}</span>
                    {item.shipping_fee_text ? (
                      <span>　运费：{item.shipping_fee_text}</span>
                    ) : null}
                    <br />
                    合计金额：<span style={{ color: '#111827', fontWeight: 700 }}>{formatTotalAmount(finalPrice, item.shipping_fee_text)}</span>
                    {wonTime ? (
                      <>
                        <br />
                        落札时间：{wonTime}
                      </>
                    ) : null}
                    {item.tracking_number ? (
                      <>
                        <br />
                        追踪号：{item.tracking_number}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </List.Item>
          );
        })}
      </List>
    </div>
  );
}
