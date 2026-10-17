import priceRules from '../../../shared/priceRules.cjs';
import fleamarket from '../../../shared/fleamarket.cjs';
import { colors } from '../styles';

export default function ProductTypeTag({ product, fullName = false }) {
  const type = fleamarket.isFleamarketProduct(product) ? 'fleamarket' : priceRules.normalizeProductType(
    product?.productType || product?.product_type,
    product?.taxType || product?.tax_type
  );
  const store = type === 'store';
  const market = type === 'fleamarket';
  const label = market ? 'フリマ 商品' : store ? '商城商品' : '普通商品';
  return (
    <span
      data-product-type={type}
      aria-label={label}
      title={label}
      style={{ display: 'inline-block', verticalAlign: 'middle', marginRight: 6, padding: '0 7px',
        fontSize: 12, fontWeight: 400, lineHeight: '20px', whiteSpace: 'nowrap', borderRadius: 4,
        color: market ? '#722ed1' : store ? '#f5222d' : '#52c41a', background: market ? '#f9f0ff' : store ? '#fff1f0' : '#f6ffed',
        border: `1px solid ${market ? '#d3adf7' : store ? '#ffa39e' : '#b7eb8f'}`,
        ...(fullName ? { color: market ? '#722ed1' : store ? '#1d4ed8' : colors.accent,
          background: market ? '#f9f0ff' : '#eff6ff', borderColor: market ? '#d3adf7' : colors.border,
          borderRadius: 6, padding: '2px 7px', fontWeight: 700, marginBottom: 6 } : {}) }}
    >
      {fullName ? label : market ? 'P' : store ? '商' : '普'}
    </span>
  );
}
