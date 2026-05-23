function getDisplayPrice(price, taxType) {
  const value = Number(price || 0);
  if (taxType !== 'tax_included' || value < 10) return value;
  return Math.floor(value * 1.1);
}

export default function ProductCard({ product }) {
  const taxType = product.taxType || product.tax_type || 'tax_zero';
  const isStore = taxType === 'tax_included';
  const displayPrice = getDisplayPrice(product.currentPrice, taxType);
  const displayBuyoutPrice = getDisplayPrice(product.buyoutPrice, taxType);
  const price = Number(displayPrice || 0).toLocaleString('ja-JP');
  const buyoutPrice = Number(displayBuyoutPrice || 0);
  const taxLabel = taxType === 'tax_included' ? '税込' : '税0円';

  return (
    <div style={{ margin: 16, border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', background: '#fff', display: 'flex' }}>
      {product.imageUrl && (
        <img src={product.imageUrl} alt={product.title}
          style={{ width: 150, height: 150, objectFit: 'cover', flex: '0 0 150px' }} />
      )}
      <div style={{ padding: 12, minWidth: 0, flex: 1 }}>
        {isStore && (
          <div style={{ color: '#d4380d', fontSize: 13, fontWeight: 700, marginBottom: 4 }}>商城商品</div>
        )}
        <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>{product.title}</div>
        <div style={{ color: '#ff6600', fontSize: 16, fontWeight: 600 }}>当前价格: {price}円（{taxLabel}）</div>
        {buyoutPrice > 0 && (
          <div style={{ color: '#d4380d', fontSize: 14, fontWeight: 600, marginTop: 4 }}>
            即決价格: {buyoutPrice.toLocaleString('ja-JP')}円（{taxLabel}）
          </div>
        )}
        {product.endTime && (
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>截止: {product.endTime}</div>
        )}
      </div>
    </div>
  );
}
