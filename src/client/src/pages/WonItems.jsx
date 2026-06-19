import { useCallback, useEffect, useState } from 'react';
import { Button, Empty, List, SpinLoading, Tag, Toast } from 'antd-mobile';
import UserNav from '../components/UserNav';
import UserFooter from '../components/UserFooter';
import { getWonTaskList } from '../utils/api';
import { isUserIdle, USER_ACTIVE_EVENT } from '../utils/activity';
import { runDeduped } from '../utils/requestDedupe';
import { formatBeijingDateTime } from '../utils/datetime';
import { formatTotalAmount } from '../utils/totalAmount';
import { colors, imageThumbStyle, itemCardStyle, listStyle, outlineButtonStyle, pageButtonStyle, pageStyle } from '../styles';

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

function renderOrderStatusTag(status) {
  if (status === 'cancelled') return <Tag color="danger">取消</Tag>;
  if (status === 'pending_receipt') return <Tag color="warning">待收货</Tag>;
  if (status === 'pending_shipment') return <Tag color="primary">待发货</Tag>;
  if (status === 'completed') return <Tag color="success">完了</Tag>;
  return null;
}

function getWonItemStyle(item) {
  if (item.order_status === 'cancelled') return { ...itemCardStyle, background: colors.cancelledBg };
  if (item.order_status === 'completed') return { ...itemCardStyle, background: colors.completedBg };
  return itemCardStyle;
}

export default function WonItems() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const pageSize = 10;
  const totalPages = Math.max(1, Math.ceil(total / pageSize));

  const fetchWonItems = useCallback((nextPage = page) => {
    const requestedPage = Number.isFinite(Number(nextPage)) && Number(nextPage) > 0 ? Number(nextPage) : page;
    if (document.visibilityState === 'hidden' || isUserIdle()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    runDeduped(`WonItems:getWonTaskList:${requestedPage}`, () => getWonTaskList({ page: requestedPage, limit: pageSize }))
      .then(res => {
        setItems(res.data?.data || []);
        setTotal(Number(res.data?.total || 0));
        setPage(Number(res.data?.page || requestedPage));
      })
      .catch(e => {
        Toast.show({ content: e.response?.data?.error || '落札商品加载失败' });
        setItems([]);
        setTotal(0);
      })
      .finally(() => setLoading(false));
  }, [page]);

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
    <div style={pageStyle}>
      <UserNav />
      <List
        style={listStyle}
        header={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: colors.text, fontWeight: 500, borderBottom: '1px solid #eee', paddingBottom: 10 }}>
            <span>落札商品</span>
            <Button size="mini" fill="outline" style={outlineButtonStyle} onClick={() => fetchWonItems(page)}>刷新</Button>
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
          const isCancelled = item.order_status === 'cancelled';
          return (
            <List.Item key={item.id} style={getWonItemStyle(item)}>
              <div style={{ display: 'flex', gap: 12 }}>
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
                    {isCancelled ? <Tag color="danger">取消</Tag> : <Tag color="success">落札成功</Tag>}
                    {!isCancelled && renderOrderStatusTag(item.order_status)}
                    <span style={{ fontSize: 12, color: colors.muted }}>{strategy}</span>
                  </div>
                  <div style={{ fontSize: 13, fontWeight: 600, lineHeight: 1.35, marginBottom: 6, color: colors.text }}>
                    {title}
                  </div>
                  <div style={{ fontSize: 12, color: colors.muted, lineHeight: 1.7 }}>
                    商品ID：{item.product_id}<br />
                    落札价：<span style={{ color: colors.danger, fontWeight: 600 }}>{formatJPY(finalPrice)}</span>
                    {item.shipping_fee_text ? (
                      <span>　运费：{item.shipping_fee_text}</span>
                    ) : null}
                    <br />
                    合计金额：<span style={{ color: colors.text, fontWeight: 600 }}>{formatTotalAmount(finalPrice, item.shipping_fee_text)}</span>
                    {wonTime ? (
                      <>
                        <br />
                        落札时间：{wonTime}
                      </>
                    ) : null}
                  </div>
                </div>
              </div>
            </List.Item>
          );
        })}
        {!loading && total > pageSize && (
          <div style={{ padding: 12, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12 }}>
            <Button size="mini" fill="outline" style={pageButtonStyle(false)} disabled={page <= 1} onClick={() => fetchWonItems(page - 1)}>上一页</Button>
            <span style={{ fontSize: 12, color: colors.muted, fontWeight: 700 }}>{page} / {totalPages}</span>
            <Button size="mini" fill="outline" style={pageButtonStyle(false)} disabled={page >= totalPages} onClick={() => fetchWonItems(page + 1)}>下一页</Button>
          </div>
        )}
      </List>
      <UserFooter />
    </div>
  );
}
