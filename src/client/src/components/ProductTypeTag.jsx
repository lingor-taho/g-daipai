import priceRules from '../../../shared/priceRules.cjs';
import fleamarket from '../../../shared/fleamarket.cjs';

export default function ProductTypeTag({ product }) {
  if (fleamarket.isFleamarketProduct(product)) return null;
  const type = priceRules.normalizeProductType(
    product?.productType || product?.product_type,
    product?.taxType || product?.tax_type
  );
  const store = type === 'store';
  return (
    <span
      data-product-type={type}
      aria-label={store ? '商城商品' : '普通商品'}
      title={store ? '商城商品' : '普通商品'}
      style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6, padding: '0 7px',
        fontSize: 12, fontWeight: 400, lineHeight: '20px', whiteSpace: 'nowrap', borderRadius: 4,
        color: store ? '#f5222d' : '#52c41a', background: store ? '#fff1f0' : '#f6ffed',
        border: `1px solid ${store ? '#ffa39e' : '#b7eb8f'}` }}
    >
      {store ? '商' : '普'}
    </span>
  );
}
