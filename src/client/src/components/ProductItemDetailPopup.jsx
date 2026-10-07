import ProductSearchPopup from './ProductSearchPopup';
import { getApiErrorMessage, getProductInfo } from '../utils/api';
import { getAuctionProductUrl } from '../utils/rebid';
import useProductFavorites from '../utils/useProductFavorites';

async function loadDetail(item) {
  try {
    const res = await getProductInfo(item.auctionId);
    const product = res.data?.data;
    if (!product?.auctionId) throw new Error('商品详情数据不完整');
    return product;
  } catch (error) {
    throw new Error(getApiErrorMessage(error, '商品详情加载失败，请稍后重试'));
  }
}

export default function ProductItemDetailPopup({ item, onClose, onBid }) {
  const favoriteProps = useProductFavorites();
  return (
    <ProductSearchPopup
      {...favoriteProps}
      visible={Boolean(item)}
      keyword=""
      items={[]}
      hasMore={false}
      loadingMore={false}
      onClose={onClose}
      onLoadDetail={loadDetail}
      onBid={() => onBid?.(item)}
      detailAction={onBid ? 'bid' : 'close'}
      detailOnlyItem={item ? {
        auctionId: item.product_id,
        standardUrl: getAuctionProductUrl(item),
        title: item.product_title,
        imageUrl: item.product_image_url
      } : null}
    />
  );
}
