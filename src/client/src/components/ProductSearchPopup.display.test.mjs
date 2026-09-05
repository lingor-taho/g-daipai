import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { dirname, join } from 'path';
import { fileURLToPath } from 'url';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, 'ProductSearchPopup.jsx'), 'utf8');
const productCardSource = readFileSync(join(currentDir, 'ProductCard.jsx'), 'utf8');
const submitSource = readFileSync(join(currentDir, '..', 'pages', 'Submit.jsx'), 'utf8');

assert.equal(
  source.includes('grid-template-columns: repeat(2, minmax(0, 1fr))') &&
    source.includes('@media (max-width: 720px)') &&
    source.includes('grid-template-columns: minmax(0, 1fr)'),
  true,
  'Search results should use two desktop columns and one mobile column'
);

assert.equal(
  source.includes('loading="lazy"') && source.includes('decoding="async"'),
  true,
  'Search result images should load lazily'
);

assert.equal(
  source.includes('onClick={() => favoritesOnly ? onBid(item) : openDetail(item)}') &&
    source.includes('查看商品详情') &&
    source.includes('product-search-result-title'),
  true,
  'Search result images and titles should open the in-popup detail view'
);

assert.equal(
  source.includes('← 返回') &&
    source.includes('savedListScrollTopRef') &&
    source.includes('scrollContainerRef.current.scrollTop = savedListScrollTopRef.current'),
  true,
  'The detail view should return to the preserved list scroll position'
);

assert.equal(
  source.includes('const product = await onLoadDetail(item)') &&
    submitSource.includes('const res = await getProductInfo(item.auctionId)') &&
    submitSource.includes('onLoadDetail={loadSearchProductDetail}'),
  true,
  'Opening the detail view should fetch the complete Yahoo product details again'
);

assert.equal(
  source.includes('scroll-snap-type: x mandatory') &&
    source.includes('detailImages.map((image, index)') &&
    source.includes('onClick={() => showImage(activeImageIndex + 1)}'),
  true,
  'The detail view should expose every product image as a swipeable gallery'
);

assert.equal(
  source.includes('detailProduct.title') &&
    source.includes('detailProduct.currentPrice') &&
    source.includes('detailProduct.shippingFeeText') &&
    source.includes('detailProduct.bidCount') &&
    source.includes('formatYahooEndTime(detailProduct.endTime)') &&
    source.includes("detailProduct.conditionName || '未显示'"),
  true,
  'The detail view should show the requested main product information and Yahoo item condition'
);

assert.equal(
  productCardSource.includes('onOpenDetail') &&
    productCardSource.includes('aria-label={`查看商品详情：${product.title}`}') &&
    submitSource.includes('onOpenDetail={() => setSingleProductDetailVisible(true)}') &&
    submitSource.includes('detailOnlyItem={product}'),
  true,
  'The single-product image and title should open the shared detail popup'
);

assert.equal(
  source.includes('selectedItem && !detailOnly') &&
    source.includes("detailOnly ? (") &&
    source.includes('onClick={handleClose}') &&
    />\s*关闭\s*<\/Button>/.test(source),
  true,
  'Single-product detail mode should omit back/purchase actions and provide a close button'
);

assert.equal(
  source.includes('商品详细说明') &&
    source.includes('detailProduct.descriptionHtml') &&
    source.includes('sandbox="allow-same-origin"') &&
    source.includes('srcDoc={buildDescriptionDocument(detailProduct.descriptionHtml)}') &&
    source.includes('detailProduct.descriptionText') &&
    !source.includes('dangerouslySetInnerHTML'),
  true,
  'Complete seller descriptions and images should render inside an isolated frame with a text fallback'
);

assert.equal(
  source.includes('detailProduct.detailDisplayPrice?.currentPriceText') &&
    source.includes('detailProduct.detailDisplayPrice?.buyoutPriceText'),
  true,
  'Product details should use display-only Yahoo price fields'
);

assert.equal(
  source.includes('onClick={() => onBid(detailProduct || selectedItem)}') && />\s*去竞拍\s*<\/Button>/.test(source),
  true,
  'The detail view should expose only the existing bid-selection action as 去竞拍'
);

assert.equal(
  source.includes('onClick={() => onBid(item)}') && />\s*入札\s*<\/Button>/.test(source),
  true,
  'Every search result should expose an 入札 action'
);

assert.equal(
  source.includes('element.scrollHeight - element.scrollTop - element.clientHeight <= 320') &&
    source.includes('onLoadMore()'),
  true,
  'Search results should request the next page near the bottom'
);

assert.equal(
  /function handleSearchBid\(item\) \{\s*setFavoritesVisible\(false\);\s*closeProductSearch\(\);\s*const productUrl = item\.standardUrl \|\| `https:\/\/auctions\.yahoo\.co\.jp\/jp\/auction\/\$\{item\.auctionId\}`;\s*handleRebid\(productUrl\);\s*\}/.test(submitSource),
  true,
  'Search bid actions should close the popup and fill the standard Yahoo product URL'
);

assert.equal(
  submitSource.includes("appendUniqueItems(current, data.items || [], 'auctionId')"),
  true,
  'Additional Yahoo pages should be deduplicated by auction id'
);
