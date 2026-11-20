import { useEffect, useRef, useState } from 'react';
import { Toast } from 'antd-mobile';
import ProductTypeTag from './ProductTypeTag';
import { getBuyoutPrice } from '../utils/bidPrice';
import { formatTotalAmount } from '../utils/totalAmount';
import { cardStyle, colors } from '../styles';
import fleamarket from '../../../shared/fleamarket.cjs';
import negotiation from '../../../shared/fleamarketNegotiation.cjs';
import { getApiErrorMessage, getFleamarketNegotiation, submitFleamarketNegotiation } from '../utils/api';

function getDisplayPrice(price, taxType) {
  const value = Number(price || 0);
  if (taxType !== 'tax_included' || value < 10) return value;
  return Math.floor(value * 1.1);
}

export function BidCountIcon() {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 24 24"
      width="15"
      height="15"
      style={{ display: 'inline-block', flex: '0 0 15px' }}
    >
      <path
        d="M7.2 4.3 4.6 6.9l5.5 5.5 2.6-2.6L7.2 4.3Zm1.5-1.5 5.5 5.5 1.5-1.5-5.5-5.5-1.5 1.5Zm6.1 10.2-1.6 1.6 6.1 6.1c.5.5 1.2.5 1.7 0s.5-1.2 0-1.7l-6.2-6ZM3.6 8l-1.5 1.5 5.5 5.5 1.5-1.5L3.6 8Z"
        fill="currentColor"
      />
    </svg>
  );
}

export default function ProductCard({ product, onOpenDetail, ended = false }) {
  const taxType = product.taxType || product.tax_type || 'tax_zero';
  const displayPrice = getDisplayPrice(product.currentPrice, taxType);
  const displayBuyoutPrice = getBuyoutPrice(product);
  const price = Number(displayPrice || 0).toLocaleString('ja-JP');
  const buyoutPrice = Number(displayBuyoutPrice || 0);
  const shippingFeeText = product.shippingFeeText || product.shipping_fee_text || '';
  const taxLabel = taxType === 'tax_included' ? '税込' : '税0円';
  const bidCount = Number(product.bidCount ?? product.bid_count ?? 0);
  const isFleamarket = fleamarket.isStoredFleamarketProduct(product);
  const productId = product.auctionId;
  const canNegotiate = isFleamarket && !ended && product.canNegotiate;
  const [showNegotiation, setShowNegotiation] = useState(false);
  const [negotiationSnapshot, setNegotiationSnapshot] = useState(null);
  const negotiationStatus = negotiationSnapshot?.product === product ? negotiationSnapshot.data : null;
  const [offer, setOffer] = useState('');
  const [sendingOffer, setSendingOffer] = useState(false);
  const awaitingResult = useRef(false);

  useEffect(() => {
    if (!isFleamarket || !productId || sendingOffer) return;
    const controller = new AbortController();
    let timer;
    function schedule() {
      timer = setTimeout(refresh, 2500);
    }
    async function refresh() {
      try {
        const { data } = await getFleamarketNegotiation(productId, controller.signal);
        if (controller.signal.aborted) return;
        setNegotiationSnapshot({ product, data });
        if (data.state === 'submitted' && awaitingResult.current) {
          Toast.show({ content: '砍价信息已提交！' });
        }
        if (data.state === 'pending') {
          setShowNegotiation(false);
          schedule();
        } else {
          awaitingResult.current = false;
        }
      } catch (_) {
        if (!controller.signal.aborted) schedule();
      }
    }
    refresh();
    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [isFleamarket, productId, product, sendingOffer, showNegotiation]);

  const canSubmitOffer = canNegotiate && negotiationStatus?.state === 'available';
  const hasNegotiationHistory = negotiationStatus?.state === 'submitted';
  const showKnife = canNegotiate || hasNegotiationHistory || negotiationStatus?.state === 'pending';
  const knifeEnabled = canSubmitOffer || hasNegotiationHistory;
  const minimum = Math.max(300, negotiation.minimumNegotiationPrice(displayPrice));

  async function handleNegotiation() {
    if (sendingOffer || !canSubmitOffer) return;
    const price = /^\d+$/.test(offer.trim()) ? Number(offer) : NaN;
    if (!negotiation.isNegotiationPriceValid(price, displayPrice)) {
      Toast.show({ content: `请输入 ${minimum.toLocaleString('ja-JP')}–${(displayPrice - 1).toLocaleString('ja-JP')} 円的整数报价` });
      return;
    }
    setSendingOffer(true);
    try {
      const { data } = await submitFleamarketNegotiation(productId, price);
      awaitingResult.current = true;
      setNegotiationSnapshot({ product, data });
      setShowNegotiation(false);
      setOffer('');
      Toast.show({ content: '砍价信息已排队' });
    } catch (error) {
      awaitingResult.current = !error.response;
      Toast.show({ content: getApiErrorMessage(error, '砍价提交失败') });
    } finally {
      setSendingOffer(false);
    }
  }

  return (
    <>
    <div style={{ ...cardStyle, margin: '14px 0', overflow: 'hidden', display: 'flex' }}>
      {product.imageUrl && (
        <button
          type="button"
          onClick={onOpenDetail}
          aria-label={`查看商品详情：${product.title}`}
          style={{ width: 136, height: 136, padding: 0, border: 0, flex: '0 0 136px', background: colors.cardSoft, cursor: 'pointer', position: 'relative' }}
        >
          <img src={product.imageUrl} alt={product.title}
            style={{ display: 'block', width: '100%', height: '100%', objectFit: 'cover' }} />
          {ended && <span data-auction-ended style={{ position: 'absolute', top: 0, left: 0, background: '#ff3141', color: '#fff', padding: '4px 8px', fontSize: 12, fontWeight: 700, borderBottomRightRadius: 6 }}>已结束</span>}
        </button>
      )}
      <div style={{ padding: 12, minWidth: 0, flex: 1 }}>
        <ProductTypeTag product={product} fullName />
        {showKnife && (
          <button type="button" aria-label="砍价" title="砍价"
            disabled={!knifeEnabled} aria-expanded={knifeEnabled && showNegotiation}
            onClick={() => setShowNegotiation(open => !open)}
            style={{ border: 0, padding: '4px 8px', marginBottom: 6, background: 'transparent',
              verticalAlign: 'middle', opacity: knifeEnabled ? 1 : 0.45,
              cursor: knifeEnabled ? 'pointer' : 'default' }}>
            <svg aria-hidden="true" width="16" height="16" viewBox="0 0 20 20"
              style={{ display: 'block' }} stroke="#272321" strokeWidth="1.25" strokeLinejoin="round">
              <path d="m7.3 6 7 6.8c1.7 1.7 3 3.6 3.7 5.1-2.7-.4-4.9-1.6-6.9-3.6L5.6 8.6Z" fill="#e5e7eb" />
              <path d="m7 8 5 5" fill="none" stroke="#9198a0" strokeWidth="1" strokeLinecap="round" />
              <path d="M2.6 2.6a2 2 0 0 1 2.8 0l4.2 4.2-2.8 2.8-4.2-4.2a2 2 0 0 1 0-2.8Z" fill="#a16c42" />
            </svg>
          </button>
        )}
        <button
          type="button"
          onClick={onOpenDetail}
          style={{ display: 'block', width: '100%', padding: 0, border: 0, marginBottom: 8, background: 'transparent', color: colors.text, fontSize: 13, fontWeight: 600, lineHeight: 1.35, textAlign: 'left', cursor: 'pointer' }}
        >
          {product.title}
        </button>
        <div style={{ color: colors.danger, fontSize: 16, fontWeight: 600 }}>
          当前价格: {price}円（{taxLabel}）
          {shippingFeeText ? <span>　运费：{shippingFeeText}</span> : null}
        </div>
        {buyoutPrice > 0 && (
          <div style={{ color: colors.accent, fontSize: 14, fontWeight: 500, marginTop: 4 }}>
            即決价格: {buyoutPrice.toLocaleString('ja-JP')}円（{taxLabel}）
          </div>
        )}
        <div style={{ color: colors.text, fontSize: 14, fontWeight: 500, marginTop: 4 }}>
          当前合计金额：{formatTotalAmount(displayPrice, shippingFeeText)}
        </div>
        {!isFleamarket && <div style={{ color: colors.muted, fontSize: 13, marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
          <BidCountIcon />
          <span>拍卖次数：{Number.isFinite(bidCount) && bidCount >= 0 ? bidCount : 0}件</span>
        </div>}
        {product.endTime && (
          <div style={{ fontSize: 12, color: colors.faint, marginTop: 4 }}>截止: {product.endTime}</div>
        )}
      </div>
    </div>
    {knifeEnabled && showNegotiation && (
      <div style={{ ...cardStyle, padding: '10px 12px', margin: '-6px 0 14px', border: `1px solid ${colors.danger}`, fontSize: 13 }}>
        {hasNegotiationHistory && (
          <div>该商品在 {new Date(negotiationStatus.submittedAt).toLocaleString('zh-CN', {
            timeZone: 'Asia/Shanghai', hour12: false
          })} 以 <strong style={{ color: colors.danger }}>{negotiationStatus.price.toLocaleString('ja-JP')} 円</strong> 提交了砍价。</div>
        )}
        {canSubmitOffer && (
          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input type="text" inputMode="numeric" maxLength={7} aria-label="砍价报价（日元）"
              placeholder={`最低 ${minimum.toLocaleString('ja-JP')} 円`}
              value={offer} disabled={sendingOffer} onChange={event => setOffer(event.target.value)}
              onKeyDown={event => {
                if (event.key === 'Enter') { event.preventDefault(); void handleNegotiation(); }
              }}
              style={{ flex: '1 1 100px', minWidth: 0, padding: '7px 8px', border: `1px solid ${colors.border}`,
                borderRadius: 6, background: colors.cardSoft, color: colors.text, fontSize: 14 }} />
            <button type="button" disabled={sendingOffer} onClick={handleNegotiation}
              style={{ border: 0, borderRadius: 6, padding: '8px 12px', background: colors.accent, color: '#fff' }}>
              {sendingOffer ? '提交中…' : '提交砍价'}
            </button>
          </div>
        )}
      </div>
    )}
    </>
  );
}
