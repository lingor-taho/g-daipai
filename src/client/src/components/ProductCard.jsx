export default function ProductCard({ product }) {
  const price = Number(product.currentPrice || 0).toLocaleString('ja-JP');
  const buyoutPrice = Number(product.buyoutPrice || 0);

  return (
    <div style={{ margin: 16, border: '1px solid #eee', borderRadius: 8, overflow: 'hidden', background: '#fff', display: 'flex' }}>
      {product.imageUrl && (
        <img src={product.imageUrl} alt={product.title}
          style={{ width: 150, height: 150, objectFit: 'cover', flex: '0 0 150px' }} />
      )}
      <div style={{ padding: 12, minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 14, fontWeight: 'bold', marginBottom: 8 }}>{product.title}</div>
        <div style={{ color: '#ff6600', fontSize: 16, fontWeight: 600 }}>当前价格: {price}円</div>
        {buyoutPrice > 0 && (
          <div style={{ color: '#d4380d', fontSize: 14, fontWeight: 600, marginTop: 4 }}>
            即決价格: {buyoutPrice.toLocaleString('ja-JP')}円
          </div>
        )}
        {product.endTime && (
          <div style={{ fontSize: 12, color: '#999', marginTop: 4 }}>截止: {product.endTime}</div>
        )}
      </div>
    </div>
  );
}
