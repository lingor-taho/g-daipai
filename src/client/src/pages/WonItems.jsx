import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Dialog, Empty, InfiniteScroll, List, SpinLoading, Tag, TextArea, Toast } from 'antd-mobile';
import { deleteWonItemRemark, getWonTaskList, saveWonItemRemark } from '../utils/api';
import { isUserIdle, USER_ACTIVE_EVENT } from '../utils/activity';
import { runDeduped } from '../utils/requestDedupe';
import { formatBeijingDateTime } from '../utils/datetime';
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

const sellerMessageOverlayStyle = {
  position: 'fixed',
  inset: 0,
  background: 'rgba(15, 23, 42, 0.45)',
  zIndex: 1200,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  padding: 12
};

const sellerMessageDialogStyle = {
  width: 'min(860px, 100%)',
  maxHeight: '88vh',
  background: '#fff',
  borderRadius: 8,
  boxShadow: '0 18px 50px rgba(15, 23, 42, 0.25)',
  display: 'flex',
  flexDirection: 'column',
  overflow: 'hidden'
};

const sellerMessageHeaderStyle = {
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 12,
  padding: '12px 14px',
  borderBottom: '1px solid #eee',
  color: colors.text,
  fontWeight: 700
};

const sellerMessageButtonStyle = {
  '--border-radius': '4px',
  fontSize: 12,
  fontWeight: 700,
  flex: '0 0 auto'
};

const sellerMessageBodyStyle = {
  padding: 12,
  overflow: 'auto',
  maxHeight: 'calc(88vh - 54px)',
  color: '#222',
  background: '#fff'
};

const remarkDialogStyle = {
  ...sellerMessageDialogStyle,
  width: 'min(520px, 100%)'
};

const remarkBodyStyle = {
  padding: 14,
  color: colors.text,
  background: colors.card
};

const remarkButtonRowStyle = {
  display: 'grid',
  gridTemplateColumns: '1fr 1fr',
  gap: 10,
  marginTop: 14
};

const sellerMessageCss = `
  .seller-message-view, .seller-message-view * {
    box-sizing: border-box;
  }
  .seller-message-view {
    font-size: 14px;
    line-height: 1.55;
    overflow-wrap: anywhere;
  }
  .seller-message-view script,
  .seller-message-view style,
  .seller-message-view input,
  .seller-message-view textarea,
  .seller-message-view button {
    display: none !important;
  }
  .seller-message-view .acMdMsgForm,
  .seller-message-view .untPreMsg,
  .seller-message-view #messagelist,
  .seller-message-view ul,
  .seller-message-view ol {
    margin: 0;
    padding: 0;
  }
  .seller-message-view li {
    list-style: none;
  }
  .seller-message-view dl,
  .seller-message-view li > div {
    display: grid;
    grid-template-columns: 112px minmax(0, 1fr);
    gap: 0;
    margin: 0 0 8px;
    border-radius: 4px;
    overflow: hidden;
    background: #ffffd8;
  }
  .seller-message-view .yahoo-own-message,
  .seller-message-view dl.ptsOwn {
    background: #f0f0ff;
  }
  .seller-message-view dt,
  .seller-message-view li > div > div:first-child {
    padding: 12px 8px;
    text-align: center;
    color: #666;
    background: rgba(255, 255, 255, 0.35);
  }
  .seller-message-view dt p,
  .seller-message-view dt span {
    display: block;
    margin: 0 0 6px;
  }
  .seller-message-view #buyerid,
  .seller-message-view .decUsrName {
    color: #c96b00;
    font-weight: 700;
  }
  .seller-message-view dl.ptsOwn #buyerid,
  .seller-message-view .yahoo-own-message #buyerid,
  .seller-message-view .yahoo-own-message .decUsrName {
    color: #111;
  }
  .seller-message-view .decTime {
    color: #888;
    font-size: 12px;
    font-weight: 400;
  }
  .seller-message-view dd,
  .seller-message-view li > div > div:last-child {
    margin: 0;
    padding: 12px;
    white-space: pre-wrap;
    color: #111;
  }
  @media (max-width: 520px) {
    .seller-message-view {
      font-size: 13px;
    }
    .seller-message-view dl,
    .seller-message-view li > div {
      grid-template-columns: 86px minmax(0, 1fr);
    }
    .seller-message-view dt,
    .seller-message-view li > div > div:first-child,
    .seller-message-view dd,
    .seller-message-view li > div > div:last-child {
      padding: 10px 8px;
    }
  }
`;

function sanitizeTradeHtml(html) {
  if (!html) return '';
  const doc = new DOMParser().parseFromString(String(html), 'text/html');
  doc.querySelectorAll('script, style, iframe, object, embed').forEach(node => node.remove());
  doc.querySelectorAll('*').forEach(node => {
    [...node.attributes].forEach(attr => {
      const name = attr.name.toLowerCase();
      const value = String(attr.value || '').trim().toLowerCase();
      if (name.startsWith('on') || (['href', 'src', 'action'].includes(name) && value.startsWith('javascript:'))) {
        node.removeAttribute(attr.name);
      }
    });
  });
  return doc.body.innerHTML;
}

function renderTradeHtml(html) {
  const safeHtml = sanitizeTradeHtml(html);
  if (!safeHtml) return '';
  const doc = new DOMParser().parseFromString(safeHtml, 'text/html');
  doc.querySelectorAll('dl').forEach(dl => {
    const name = (dl.querySelector('dt')?.textContent || '').trim();
    dl.classList.add(name.includes('\u3042\u306a\u305f') ? 'yahoo-own-message' : 'yahoo-partner-message');
  });
  doc.querySelectorAll('li > div').forEach(row => {
    const name = (row.firstElementChild?.textContent || '').trim();
    row.classList.add(name.includes('\u3042\u306a\u305f') ? 'yahoo-own-message' : 'yahoo-partner-message');
  });
  return doc.body.innerHTML;
}

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

function getProductUrl(item) {
  return item.product_url || `https://auctions.yahoo.co.jp/jp/auction/${item.product_id}`;
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

function RemarkFlag({ active }) {
  const color = active ? colors.danger : colors.faint;
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M6 3v18" stroke={color} strokeWidth="2" strokeLinecap="round" />
      <path d="M7 4h10.2c.9 0 1.35 1.1.7 1.72L15.6 8l2.3 2.28c.65.63.2 1.72-.7 1.72H7V4Z" fill={color} />
    </svg>
  );
}

export default function WonItems() {
  const navigate = useNavigate();
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [page, setPage] = useState(0);
  const [total, setTotal] = useState(0);
  const [sellerMessageModal, setSellerMessageModal] = useState(null);
  const [remarkEditor, setRemarkEditor] = useState(null);
  const [remarkText, setRemarkText] = useState('');
  const [remarkSaving, setRemarkSaving] = useState(false);
  const [remarkDeleting, setRemarkDeleting] = useState(false);
  const pageSize = 10;

  const resetWonItems = useCallback(async () => {
    if (document.visibilityState === 'hidden' || isUserIdle()) {
      setLoading(false);
      return;
    }
    setLoading(true);
    try {
      const actingUserKey = localStorage.getItem('actingUserId') || 'self';
      const res = await runDeduped(`WonItems:getWonTaskList:${actingUserKey}:1`, () => getWonTaskList({ page: 1, limit: pageSize }));
      if ((localStorage.getItem('actingUserId') || 'self') !== actingUserKey) return;
      setItems(res.data?.data || []);
      setTotal(Number(res.data?.total || 0));
      setPage(1);
    } catch (e) {
      Toast.show({ content: e.response?.data?.error || '落札商品加载失败' });
      setItems([]);
      setTotal(0);
      setPage(0);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadMore = useCallback(async () => {
    const nextPage = page + 1;
    try {
      const actingUserKey = localStorage.getItem('actingUserId') || 'self';
      const res = await getWonTaskList({ page: nextPage, limit: pageSize });
      if ((localStorage.getItem('actingUserId') || 'self') !== actingUserKey) return;
      setItems(current => appendUniqueItems(current, res.data?.data || [], item => item.order_id || item.id));
      setTotal(Number(res.data?.total || 0));
      setPage(Number(res.data?.page || nextPage));
    } catch (e) {
      Toast.show({ content: e.response?.data?.error || '更多落札商品加载失败' });
      throw e;
    }
  }, [page]);

  const refreshLoadedItems = useCallback(async () => {
    if (document.visibilityState === 'hidden' || isUserIdle()) return;
    const actingUserKey = localStorage.getItem('actingUserId') || 'self';
    const refreshLimit = Math.min(Math.max(page, 1) * pageSize, 100);
    try {
      const res = await runDeduped(
        `WonItems:refresh:${actingUserKey}:${refreshLimit}`,
        () => getWonTaskList({ page: 1, limit: refreshLimit })
      );
      if ((localStorage.getItem('actingUserId') || 'self') !== actingUserKey) return;
      const refreshedItems = res.data?.data || [];
      setItems(refreshedItems);
      setTotal(Number(res.data?.total || 0));
      setPage(Math.max(1, Math.ceil(refreshedItems.length / pageSize)));
    } catch (_) {}
  }, [page]);

  useEffect(() => {
    resetWonItems();
  }, [resetWonItems]);

  useEffect(() => {
    const handleActingUserChange = () => {
      setItems([]);
      setTotal(0);
      setPage(0);
      setRemarkEditor(null);
      resetWonItems();
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
  }, [refreshLoadedItems, resetWonItems]);

  function openRemarkEditor(item) {
    if (!item.order_id) {
      Toast.show({ content: '该落札商品尚未生成订单，暂时无法备注' });
      return;
    }
    setRemarkEditor(item);
    setRemarkText(item.user_remark || '');
  }

  async function handleSaveRemark() {
    const normalizedRemark = remarkText.trim();
    if (!normalizedRemark) {
      Toast.show({ content: '请输入备注内容' });
      return;
    }
    setRemarkSaving(true);
    try {
      const res = await saveWonItemRemark(remarkEditor.order_id, normalizedRemark);
      const savedRemark = res.data?.user_remark || normalizedRemark;
      setItems(current => current.map(item => item.order_id === remarkEditor.order_id
        ? { ...item, user_remark: savedRemark }
        : item));
      Toast.show({ content: '备注已保存' });
      setRemarkEditor(null);
    } catch (e) {
      Toast.show({ content: e.response?.data?.error || '备注保存失败' });
    } finally {
      setRemarkSaving(false);
    }
  }

  async function handleDeleteRemark() {
    if (!remarkEditor?.user_remark) return;
    const confirmed = await Dialog.confirm({
      title: '删除备注',
      content: '确定删除该商品的备注吗？',
      confirmText: '删除',
      cancelText: '取消'
    });
    if (!confirmed) return;
    setRemarkDeleting(true);
    try {
      await deleteWonItemRemark(remarkEditor.order_id);
      setItems(current => current.map(item => item.order_id === remarkEditor.order_id
        ? { ...item, user_remark: null }
        : item));
      Toast.show({ content: '备注已删除' });
      setRemarkEditor(null);
    } catch (e) {
      Toast.show({ content: e.response?.data?.error || '备注删除失败' });
    } finally {
      setRemarkDeleting(false);
    }
  }

  return (
    <>
      <List
        style={listStyle}
        header={
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: colors.text, fontWeight: 500, borderBottom: '1px solid #eee', paddingBottom: 10 }}>
            <span>落札商品</span>
            <Button size="mini" fill="outline" style={outlineButtonStyle} onClick={resetWonItems}>刷新</Button>
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
          const canViewPurchasePage = item.order_status === 'completed';
          return (
            <List.Item key={item.order_id || item.id} style={getWonItemStyle(item)}>
              <div style={{ display: 'flex', gap: 12 }}>
                <div style={{ width: imageThumbStyle.width, flex: '0 0 auto', display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
                  {item.product_image_url ? (
                    <img
                      src={item.product_image_url}
                      alt={title}
                      style={imageThumbStyle}
                    />
                  ) : (
                    <div style={imageThumbStyle} />
                  )}
                  <button
                    type="button"
                    aria-label={item.user_remark ? '修改商品备注' : '添加商品备注'}
                    title={item.user_remark ? '修改商品备注' : '添加商品备注'}
                    onClick={() => openRemarkEditor(item)}
                    style={{ border: 0, background: 'transparent', padding: '5px 8px 0', lineHeight: 0, cursor: 'pointer' }}
                  >
                    <RemarkFlag active={Boolean(String(item.user_remark || '').trim())} />
                  </button>
                </div>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 4 }}>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, flexWrap: 'wrap' }}>
                      {isCancelled ? <Tag color="danger">取消</Tag> : <Tag color="success">落札成功</Tag>}
                      {!isCancelled && renderOrderStatusTag(item.order_status)}
                      <span style={{ fontSize: 12, color: colors.muted }}>{strategy}</span>
                    </div>
                    {canViewPurchasePage ? (
                      <Button
                        size="mini"
                        fill="outline"
                        style={{ ...outlineButtonStyle, flex: '0 0 auto', '--border-radius': '4px', fontSize: 12 }}
                        onClick={() => navigate(`/won/${item.id}/purchase-page`, { state: { item } })}
                      >
                        购买页面
                      </Button>
                    ) : null}
                  </div>
                  <a
                    href={getProductUrl(item)}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ ...titleLinkStyle, display: 'block', fontSize: 13, fontWeight: 600, lineHeight: 1.35, marginBottom: 6 }}
                  >
                    {title}
                  </a>
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
                  {item.seller_message_html ? (
                    <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: 8 }}>
                      <Button
                        size="mini"
                        fill="outline"
                        style={sellerMessageButtonStyle}
                        onClick={() => setSellerMessageModal(item)}
                      >
                        消息
                      </Button>
                    </div>
                  ) : null}
                </div>
              </div>
            </List.Item>
          );
        })}
        {!loading && items.length > 0 ? (
          <InfiniteScroll loadMore={loadMore} hasMore={items.length < total} />
        ) : null}
      </List>
      {remarkEditor ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={`商品备注：${remarkEditor.product_id}`}
          style={sellerMessageOverlayStyle}
          onClick={() => {
            if (!remarkSaving && !remarkDeleting) setRemarkEditor(null);
          }}
        >
          <div style={remarkDialogStyle} onClick={event => event.stopPropagation()}>
            <div style={sellerMessageHeaderStyle}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                商品备注：{remarkEditor.product_id}
              </span>
              <Button
                size="mini"
                fill="none"
                disabled={remarkSaving || remarkDeleting}
                onClick={() => setRemarkEditor(null)}
              >
                关闭
              </Button>
            </div>
            <div style={remarkBodyStyle}>
              <TextArea
                value={remarkText}
                onChange={setRemarkText}
                rows={5}
                maxLength={1000}
                showCount
                autoFocus
                placeholder="请输入该商品的备注"
                style={{ '--font-size': '14px', padding: 10, border: `1px solid ${colors.borderStrong}`, borderRadius: 6 }}
              />
              <div style={remarkButtonRowStyle}>
                <Button
                  color="danger"
                  fill="outline"
                  disabled={!String(remarkEditor.user_remark || '').trim() || remarkSaving}
                  loading={remarkDeleting}
                  onClick={handleDeleteRemark}
                >
                  删除备注
                </Button>
                <Button
                  color="primary"
                  disabled={remarkDeleting}
                  loading={remarkSaving}
                  onClick={handleSaveRemark}
                >
                  保存备注
                </Button>
              </div>
            </div>
          </div>
        </div>
      ) : null}
      {sellerMessageModal ? (
        <div
          role="dialog"
          aria-modal="true"
          style={sellerMessageOverlayStyle}
          onClick={() => setSellerMessageModal(null)}
        >
          <div style={sellerMessageDialogStyle} onClick={event => event.stopPropagation()}>
            <div style={sellerMessageHeaderStyle}>
              <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                消息：{sellerMessageModal.product_id}
              </span>
              <Button size="mini" fill="none" onClick={() => setSellerMessageModal(null)}>关闭</Button>
            </div>
            <style>{sellerMessageCss}</style>
            <div
              className="seller-message-view"
              style={sellerMessageBodyStyle}
              dangerouslySetInnerHTML={{ __html: renderTradeHtml(sellerMessageModal.seller_message_html) }}
            />
          </div>
        </div>
      ) : null}
    </>
  );
}
