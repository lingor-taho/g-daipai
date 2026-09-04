import { useEffect, useRef, useState } from 'react';
import { Button, Popup, SpinLoading } from 'antd-mobile';
import { colors, outlineButtonStyle } from '../styles';

const popupStyles = `
  .product-search-popup-body {
    left: 0 !important;
    right: 0 !important;
    width: min(960px, calc(100vw - 32px));
    margin: 0 auto;
    border-radius: 16px 16px 0 0;
    overflow: hidden;
    background: var(--client-card);
  }
  .product-search-results-grid {
    display: grid;
    grid-template-columns: repeat(2, minmax(0, 1fr));
    gap: 10px;
    padding: 12px;
  }
  .product-search-result {
    display: grid;
    grid-template-columns: 96px minmax(0, 1fr) auto;
    gap: 10px;
    align-items: center;
    min-width: 0;
    padding: 10px;
    border: 1px solid var(--client-border);
    border-radius: 10px;
    background: var(--client-card);
  }
  .product-search-result-image {
    width: 96px;
    height: 96px;
    object-fit: cover;
    border-radius: 7px;
    background: var(--client-card-soft);
  }
  .product-search-result-link {
    min-width: 0;
    margin: 0;
    padding: 0;
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-align: left;
    cursor: pointer;
  }
  .product-search-result-image-link {
    display: block;
    width: 96px;
    height: 96px;
    border-radius: 7px;
    overflow: hidden;
  }
  .product-search-result-title {
    display: -webkit-box;
    overflow: hidden;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    font-size: 13px;
    font-weight: 600;
    line-height: 1.4;
    color: var(--client-text);
  }
  .product-search-detail {
    width: min(100%, 760px);
    margin: 0 auto;
    padding: 18px 18px 28px;
    box-sizing: border-box;
  }
  .product-search-detail-gallery-wrap {
    position: relative;
    width: 100%;
    overflow: hidden;
    border-radius: 14px;
    background: var(--client-card-soft);
  }
  .product-search-detail-gallery {
    display: flex;
    width: 100%;
    overflow-x: auto;
    scroll-snap-type: x mandatory;
    scrollbar-width: none;
    touch-action: pan-x pan-y;
  }
  .product-search-detail-gallery::-webkit-scrollbar {
    display: none;
  }
  .product-search-detail-slide {
    display: flex;
    align-items: center;
    justify-content: center;
    flex: 0 0 100%;
    min-width: 100%;
    height: min(50vh, 520px);
    scroll-snap-align: center;
    scroll-snap-stop: always;
  }
  .product-search-detail-image {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: contain;
  }
  .product-search-detail-gallery-button {
    position: absolute;
    top: 50%;
    z-index: 2;
    width: 34px;
    height: 34px;
    margin-top: -17px;
    padding: 0;
    border: 0;
    border-radius: 50%;
    color: #fff;
    font-size: 22px;
    line-height: 34px;
    background: rgba(15, 23, 42, 0.58);
    cursor: pointer;
  }
  .product-search-detail-gallery-button-prev { left: 10px; }
  .product-search-detail-gallery-button-next { right: 10px; }
  .product-search-detail-gallery-count {
    position: absolute;
    right: 10px;
    bottom: 10px;
    z-index: 2;
    padding: 4px 9px;
    border-radius: 999px;
    color: #fff;
    font-size: 12px;
    background: rgba(15, 23, 42, 0.68);
  }
  .product-search-detail-thumbnails {
    display: flex;
    gap: 7px;
    margin-top: 9px;
    padding-bottom: 2px;
    overflow-x: auto;
  }
  .product-search-detail-thumbnail {
    flex: 0 0 auto;
    width: 54px;
    height: 54px;
    padding: 2px;
    overflow: hidden;
    border: 2px solid transparent;
    border-radius: 7px;
    background: var(--client-card-soft);
    cursor: pointer;
  }
  .product-search-detail-thumbnail.is-active {
    border-color: var(--client-accent);
  }
  .product-search-detail-thumbnail img {
    display: block;
    width: 100%;
    height: 100%;
    object-fit: cover;
    border-radius: 3px;
  }
  .product-search-detail-title {
    margin: 18px 0 0;
    font-size: 20px;
    font-weight: 700;
    line-height: 1.45;
    color: var(--client-text);
  }
  .product-search-detail-price {
    margin-top: 16px;
    font-size: 23px;
    font-weight: 800;
    color: var(--client-danger, #dc2626);
  }
  .product-search-detail-meta {
    margin-top: 14px;
    padding: 12px 14px;
    border: 1px solid var(--client-border);
    border-radius: 10px;
    font-size: 14px;
    line-height: 1.8;
    color: var(--client-muted);
    background: var(--client-card-soft);
  }
  .product-search-detail-meta-row {
    display: grid;
    grid-template-columns: 88px minmax(0, 1fr);
    gap: 10px;
    padding: 4px 0;
  }
  .product-search-detail-meta-label {
    color: var(--client-faint);
  }
  .product-search-detail-description {
    margin-top: 18px;
    padding-top: 16px;
    border-top: 1px solid var(--client-border);
  }
  .product-search-detail-description-title {
    margin: 0 0 10px;
    font-size: 16px;
    color: var(--client-text);
  }
  .product-search-detail-description-text {
    overflow-wrap: anywhere;
    white-space: pre-wrap;
    font-size: 14px;
    line-height: 1.75;
    color: var(--client-text);
  }
  .product-search-detail-description-frame {
    display: block;
    width: 100%;
    min-height: 160px;
    border: 0;
    background: #fff;
  }
  .product-search-detail-state {
    display: flex;
    align-items: center;
    justify-content: center;
    flex-direction: column;
    gap: 12px;
    min-height: 360px;
    padding: 24px;
    color: var(--client-muted);
    text-align: center;
  }
  .product-search-detail-footer {
    flex: 0 0 auto;
    padding: 10px 18px calc(10px + env(safe-area-inset-bottom));
    border-top: 1px solid var(--client-border);
    background: var(--client-card);
  }
  @media (max-width: 720px) {
    .product-search-popup-body {
      width: 100%;
      border-radius: 12px 12px 0 0;
    }
    .product-search-results-grid {
      grid-template-columns: minmax(0, 1fr);
      gap: 8px;
      padding: 8px;
    }
    .product-search-result {
      grid-template-columns: 80px minmax(0, 1fr) auto;
      gap: 8px;
      padding: 8px;
    }
    .product-search-result-image {
      width: 80px;
      height: 80px;
    }
    .product-search-result-image-link {
      width: 80px;
      height: 80px;
    }
    .product-search-detail {
      padding: 12px 12px 22px;
    }
    .product-search-detail-gallery-wrap {
      border-radius: 10px;
    }
    .product-search-detail-slide {
      height: min(43vh, 440px);
    }
    .product-search-detail-gallery-button {
      width: 30px;
      height: 30px;
      margin-top: -15px;
      font-size: 19px;
      line-height: 30px;
    }
    .product-search-detail-title {
      margin-top: 14px;
      font-size: 17px;
    }
    .product-search-detail-price {
      margin-top: 12px;
      font-size: 21px;
    }
    .product-search-detail-footer {
      padding-right: 12px;
      padding-left: 12px;
    }
    .product-search-detail-meta-row {
      grid-template-columns: 72px minmax(0, 1fr);
      gap: 8px;
    }
  }
`;

function formatJPY(value) {
  const number = Number(value || 0);
  return number > 0 ? `${number.toLocaleString('ja-JP')}円` : '-';
}

function formatYahooEndTime(value) {
  if (!value) return '未显示';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return String(value);
  return `${new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false
  }).format(date)}（日本时间）`;
}

function getDetailImages(product) {
  const images = (Array.isArray(product?.images) ? product.images : [])
    .map(image => typeof image === 'string'
      ? { url: image, thumbnailUrl: image }
      : { url: image?.url, thumbnailUrl: image?.thumbnailUrl || image?.url })
    .filter(image => image.url);
  if (images.length === 0 && product?.imageUrl) {
    images.push({ url: product.imageUrl, thumbnailUrl: product.imageUrl });
  }
  return images;
}

function buildDescriptionDocument(descriptionHtml) {
  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data:; style-src 'unsafe-inline'"><style>*{box-sizing:border-box}html,body{margin:0;padding:0;background:#fff;color:#0f172a;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI','Noto Sans JP',sans-serif;font-size:14px;line-height:1.7;overflow:hidden}table{width:auto!important;max-width:100%!important}img{display:block;max-width:100%!important;height:auto!important;margin:8px auto}a{color:#1677ff;text-decoration:none;pointer-events:none}pre{max-width:100%;white-space:pre-wrap;overflow-wrap:anywhere}</style></head><body>${descriptionHtml || ''}</body></html>`;
}

export default function ProductSearchPopup({
  visible,
  keyword,
  items,
  hasMore,
  loadingMore,
  onClose,
  onLoadMore,
  onLoadDetail,
  onBid,
  detailOnlyItem = null
}) {
  const [selectedItem, setSelectedItem] = useState(null);
  const [detailProduct, setDetailProduct] = useState(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const [detailError, setDetailError] = useState('');
  const [activeImageIndex, setActiveImageIndex] = useState(0);
  const scrollContainerRef = useRef(null);
  const galleryRef = useRef(null);
  const savedListScrollTopRef = useRef(0);
  const detailRequestRef = useRef(0);
  const detailOnlyLoadKeyRef = useRef('');
  const detailOnly = Boolean(detailOnlyItem);

  useEffect(() => {
    detailRequestRef.current += 1;
    setSelectedItem(null);
    setDetailProduct(null);
    setDetailLoading(false);
    setDetailError('');
    savedListScrollTopRef.current = 0;
  }, [keyword]);

  useEffect(() => {
    if (!visible) {
      detailRequestRef.current += 1;
      detailOnlyLoadKeyRef.current = '';
      setSelectedItem(null);
      setDetailProduct(null);
      setDetailLoading(false);
      setDetailError('');
    }
  }, [visible]);

  useEffect(() => {
    const auctionId = detailOnlyItem?.auctionId;
    if (!visible || !auctionId || detailOnlyLoadKeyRef.current === auctionId) return;
    detailOnlyLoadKeyRef.current = auctionId;
    savedListScrollTopRef.current = 0;
    setSelectedItem(detailOnlyItem);
    loadDetail(detailOnlyItem);
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    });
  }, [visible, detailOnlyItem?.auctionId]);

  function handleScroll(event) {
    if (selectedItem) return;
    if (!hasMore || loadingMore) return;
    const element = event.currentTarget;
    if (element.scrollHeight - element.scrollTop - element.clientHeight <= 320) onLoadMore();
  }

  async function loadDetail(item) {
    const requestId = detailRequestRef.current + 1;
    detailRequestRef.current = requestId;
    setDetailProduct(null);
    setDetailLoading(true);
    setDetailError('');
    setActiveImageIndex(0);
    try {
      const product = await onLoadDetail(item);
      if (detailRequestRef.current !== requestId) return;
      setDetailProduct({ ...item, ...product });
    } catch (error) {
      if (detailRequestRef.current !== requestId) return;
      setDetailError(error?.message || '商品详情加载失败，请稍后重试');
    } finally {
      if (detailRequestRef.current === requestId) setDetailLoading(false);
    }
  }

  function openDetail(item) {
    savedListScrollTopRef.current = scrollContainerRef.current?.scrollTop || 0;
    setSelectedItem(item);
    loadDetail(item);
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) scrollContainerRef.current.scrollTop = 0;
    });
  }

  function returnToList() {
    detailRequestRef.current += 1;
    setSelectedItem(null);
    setDetailProduct(null);
    setDetailLoading(false);
    setDetailError('');
    requestAnimationFrame(() => {
      if (scrollContainerRef.current) {
        scrollContainerRef.current.scrollTop = savedListScrollTopRef.current;
      }
    });
  }

  function handleClose() {
    detailRequestRef.current += 1;
    detailOnlyLoadKeyRef.current = '';
    setSelectedItem(null);
    setDetailProduct(null);
    setDetailLoading(false);
    setDetailError('');
    onClose();
  }

  function handleGalleryScroll(event) {
    const element = event.currentTarget;
    if (!element.clientWidth) return;
    setActiveImageIndex(Math.round(element.scrollLeft / element.clientWidth));
  }

  function showImage(index) {
    const gallery = galleryRef.current;
    if (!gallery) return;
    const images = getDetailImages(detailProduct);
    const nextIndex = Math.max(0, Math.min(index, images.length - 1));
    gallery.scrollTo({ left: nextIndex * gallery.clientWidth, behavior: 'smooth' });
    setActiveImageIndex(nextIndex);
  }

  function resizeDescriptionFrame(event) {
    const frame = event.currentTarget;
    const resize = () => {
      try {
        const documentElement = frame.contentDocument?.documentElement;
        const body = frame.contentDocument?.body;
        const height = Math.max(documentElement?.scrollHeight || 0, body?.scrollHeight || 0, 160);
        frame.style.height = `${height}px`;
      } catch (_) {}
    };
    resize();
    window.setTimeout(resize, 500);
    window.setTimeout(resize, 1500);
  }

  const detailImages = getDetailImages(detailProduct);

  return (
    <>
      <style>{popupStyles}</style>
      <Popup
        visible={visible}
        onMaskClick={handleClose}
        bodyClassName="product-search-popup-body"
      >
        <div style={{ height: 'min(84vh, 820px)', display: 'flex', flexDirection: 'column', color: colors.text }}>
          <div style={{ flex: '0 0 auto', display: 'flex', alignItems: 'center', gap: 10, padding: '12px 14px', borderBottom: `1px solid ${colors.border}`, background: colors.card }}>
            {selectedItem && !detailOnly ? (
              <Button size="small" fill="none" onClick={returnToList}>← 返回</Button>
            ) : null}
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 16, fontWeight: 700 }}>{selectedItem || detailOnly ? '商品详情' : '商品搜索结果'}</div>
              {!selectedItem && !detailOnly ? (
                <div style={{ marginTop: 3, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontSize: 12, color: colors.muted }}>
                  “{keyword}”　已显示 {items.length} 条
                </div>
              ) : null}
            </div>
            <Button size="small" fill="none" onClick={handleClose}>关闭</Button>
          </div>

          <div
            ref={scrollContainerRef}
            onScroll={handleScroll}
            style={{ minHeight: 0, flex: 1, overflowY: 'auto', overscrollBehavior: 'contain' }}
          >
            {selectedItem ? (
              detailLoading ? (
                <div className="product-search-detail-state">
                  <SpinLoading style={{ '--size': '30px' }} />
                  <div>正在重新抓取 Yahoo 商品详情…</div>
                </div>
              ) : detailError ? (
                <div className="product-search-detail-state">
                  <div>{detailError}</div>
                  <Button size="small" color="primary" fill="outline" onClick={() => loadDetail(selectedItem)}>
                    重新加载
                  </Button>
                </div>
              ) : detailProduct ? (
                <div className="product-search-detail">
                  <div className="product-search-detail-gallery-wrap">
                    {detailImages.length > 0 ? (
                      <div ref={galleryRef} className="product-search-detail-gallery" onScroll={handleGalleryScroll}>
                        {detailImages.map((image, index) => (
                          <div className="product-search-detail-slide" key={`${image.url}-${index}`}>
                            <img
                              className="product-search-detail-image"
                              src={image.url}
                              alt={`${detailProduct.title} ${index + 1}`}
                              decoding={index === 0 ? 'sync' : 'async'}
                              loading={index === 0 ? 'eager' : 'lazy'}
                            />
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="product-search-detail-slide" style={{ color: colors.faint }}>暂无图片</div>
                    )}
                    {detailImages.length > 1 ? (
                      <>
                        {activeImageIndex > 0 ? (
                          <button
                            type="button"
                            className="product-search-detail-gallery-button product-search-detail-gallery-button-prev"
                            onClick={() => showImage(activeImageIndex - 1)}
                            aria-label="上一张图片"
                          >
                            ‹
                          </button>
                        ) : null}
                        {activeImageIndex < detailImages.length - 1 ? (
                          <button
                            type="button"
                            className="product-search-detail-gallery-button product-search-detail-gallery-button-next"
                            onClick={() => showImage(activeImageIndex + 1)}
                            aria-label="下一张图片"
                          >
                            ›
                          </button>
                        ) : null}
                        <div className="product-search-detail-gallery-count">
                          {activeImageIndex + 1} / {detailImages.length}
                        </div>
                      </>
                    ) : null}
                  </div>

                  {detailImages.length > 1 ? (
                    <div className="product-search-detail-thumbnails">
                      {detailImages.map((image, index) => (
                        <button
                          type="button"
                          className={`product-search-detail-thumbnail${activeImageIndex === index ? ' is-active' : ''}`}
                          onClick={() => showImage(index)}
                          aria-label={`查看第 ${index + 1} 张图片`}
                          key={`thumb-${image.url}-${index}`}
                        >
                          <img src={image.thumbnailUrl} alt="" loading="lazy" decoding="async" />
                        </button>
                      ))}
                    </div>
                  ) : null}

                  <h2 className="product-search-detail-title">{detailProduct.title}</h2>
                  <div className="product-search-detail-price">
                    当前：{detailProduct.detailDisplayPrice?.currentPriceText || formatJPY(detailProduct.currentPrice)}
                  </div>
                  <div className="product-search-detail-meta">
                    {Number(detailProduct.detailDisplayPrice?.buyoutPrice || detailProduct.buyoutPrice || 0) > 0 ? (
                      <div className="product-search-detail-meta-row">
                        <span className="product-search-detail-meta-label">即决价</span>
                        <span>{detailProduct.detailDisplayPrice?.buyoutPriceText || formatJPY(detailProduct.buyoutPrice)}</span>
                      </div>
                    ) : null}
                    <div className="product-search-detail-meta-row">
                      <span className="product-search-detail-meta-label">运费</span>
                      <span>{detailProduct.shippingFeeText || '未显示'}</span>
                    </div>
                    <div className="product-search-detail-meta-row">
                      <span className="product-search-detail-meta-label">拍卖次数</span>
                      <span>{Number(detailProduct.bidCount || 0)}</span>
                    </div>
                    <div className="product-search-detail-meta-row">
                      <span className="product-search-detail-meta-label">截止时间</span>
                      <span>{formatYahooEndTime(detailProduct.endTime)}</span>
                    </div>
                    <div className="product-search-detail-meta-row">
                      <span className="product-search-detail-meta-label">商品状态</span>
                      <span>{detailProduct.conditionName || '未显示'}</span>
                    </div>
                    <div className="product-search-detail-meta-row">
                      <span className="product-search-detail-meta-label">商品 ID</span>
                      <span>{detailProduct.auctionId}</span>
                    </div>
                  </div>

                  <section className="product-search-detail-description">
                    <h3 className="product-search-detail-description-title">商品详细说明</h3>
                    {detailProduct.descriptionHtml ? (
                      <iframe
                        className="product-search-detail-description-frame"
                        title="Yahoo 商品详细说明"
                        sandbox="allow-same-origin"
                        srcDoc={buildDescriptionDocument(detailProduct.descriptionHtml)}
                        onLoad={resizeDescriptionFrame}
                      />
                    ) : (
                      <div className="product-search-detail-description-text">
                        {detailProduct.descriptionText || '卖家未填写商品说明'}
                      </div>
                    )}
                  </section>
                </div>
              ) : null
            ) : (
              <>
                <div className="product-search-results-grid">
                  {items.map(item => (
                    <div className="product-search-result" key={item.auctionId}>
                      <button
                        type="button"
                        className="product-search-result-link product-search-result-image-link"
                        onClick={() => openDetail(item)}
                        aria-label={`查看商品详情：${item.title}`}
                      >
                        {item.imageUrl ? (
                          <img
                            className="product-search-result-image"
                            src={item.imageUrl}
                            alt={item.title}
                            loading="lazy"
                            decoding="async"
                          />
                        ) : (
                          <div className="product-search-result-image" />
                        )}
                      </button>
                      <div style={{ minWidth: 0 }}>
                        <button
                          type="button"
                          className="product-search-result-link product-search-result-title"
                          onClick={() => openDetail(item)}
                        >
                          {item.title}
                        </button>
                        <div style={{ marginTop: 5, fontSize: 12, lineHeight: 1.55, color: colors.muted }}>
                          <div style={{ color: colors.danger, fontWeight: 700 }}>
                            当前：{formatJPY(item.currentPrice)}
                            {Number(item.buyoutPrice || 0) > 0 ? `　即決：${formatJPY(item.buyoutPrice)}` : ''}
                          </div>
                          <div>{item.shippingFeeText || '运费未显示'}</div>
                          <div>
                            入札：{Number(item.bidCount || 0)}
                            {item.remainingTimeText ? `　剩余：${item.remainingTimeText}` : ''}
                          </div>
                          <div style={{ color: colors.faint }}>ID：{item.auctionId}</div>
                        </div>
                      </div>
                      <Button
                        size="mini"
                        color="danger"
                        fill="outline"
                        onClick={() => onBid(item)}
                        style={{ ...outlineButtonStyle, flex: '0 0 auto', '--text-color': colors.danger }}
                      >
                        入札
                      </Button>
                    </div>
                  ))}
                </div>
                <div style={{ minHeight: 46, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px 8px', fontSize: 12, color: colors.faint }}>
                  {loadingMore ? <><SpinLoading style={{ '--size': '18px', marginRight: 8 }} />正在加载更多</> : (hasMore ? '继续向下滚动加载更多' : '没有更多了')}
                </div>
              </>
            )}
          </div>

          {selectedItem ? (
            <div className="product-search-detail-footer">
              {detailOnly ? (
                <Button
                  block
                  color="danger"
                  onClick={handleClose}
                  style={{ '--background-color': colors.danger, '--border-color': colors.danger, fontSize: 17, fontWeight: 700 }}
                >
                  关闭
                </Button>
              ) : (
                <Button
                  block
                  color="danger"
                  disabled={detailLoading}
                  onClick={() => onBid(detailProduct || selectedItem)}
                  style={{ '--background-color': colors.danger, '--border-color': colors.danger, fontSize: 17, fontWeight: 700 }}
                >
                  購入へ
                </Button>
              )}
            </div>
          ) : null}
        </div>
      </Popup>
    </>
  );
}
