import { getBuyoutPrice } from '../utils/bidPrice';
import { formatTotalAmount } from '../utils/totalAmount';
import { cardStyle, colors } from '../styles';

function getDisplayPrice(price, taxType) {
  const value = Number(price || 0);
  if (taxType !== 'tax_included' || value < 10) return value;
  return Math.floor(value * 1.1);
}

function BidCountIcon() {
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

export default function ProductCard({ product }) {
  const taxType = product.taxType || product.tax_type || 'tax_zero';
  const productType = product.productType || product.product_type || (taxType === 'tax_included' ? 'store' : 'normal');
  const productTypeLabel = productType === 'store' ? '商城商品' : '普通商品';
  const displayPrice = getDisplayPrice(product.currentPrice, taxType);
  const displayBuyoutPrice = getBuyoutPrice(product);
  const price = Number(displayPrice || 0).toLocaleString('ja-JP');
  const buyoutPrice = Number(displayBuyoutPrice || 0);
  const shippingFeeText = product.shippingFeeText || product.shipping_fee_text || '';
  const taxLabel = taxType === 'tax_included' ? '税込' : '税0円';
  const bidCount = Number(product.bidCount ?? product.bid_count ?? 0);

  return (
    <div style={{ ...cardStyle, margin: '14px 0', overflow: 'hidden', display: 'flex' }}>
      {product.imageUrl && (
        <img src={product.imageUrl} alt={product.title}
          style={{ width: 136, height: 136, objectFit: 'cover', flex: '0 0 136px', background: colors.cardSoft }} />
      )}
      <div style={{ padding: 12, minWidth: 0, flex: 1 }}>
        <div style={{ display: 'inline-block', color: productType === 'store' ? '#1d4ed8' : colors.accent, background: '#eff6ff', border: `1px solid ${colors.border}`, borderRadius: 6, padding: '2px 7px', fontSize: 12, fontWeight: 700, marginBottom: 6 }}>
          {productTypeLabel}
        </div>
        <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 8, lineHeight: 1.35, color: colors.text }}>{product.title}</div>
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
        <div style={{ color: colors.muted, fontSize: 13, marginTop: 5, display: 'flex', alignItems: 'center', gap: 4 }}>
          <BidCountIcon />
          <span>拍卖次数：{Number.isFinite(bidCount) && bidCount >= 0 ? bidCount : 0}件</span>
        </div>
        {product.endTime && (
          <div style={{ fontSize: 12, color: colors.faint, marginTop: 4 }}>截止: {product.endTime}</div>
        )}
      </div>
    </div>
  );
}
