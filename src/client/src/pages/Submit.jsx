import { useEffect, useState } from 'react';
import { Input, Button, Toast, List, Picker, Checkbox, Dialog, Radio } from 'antd-mobile';
import { useSearchParams } from 'react-router-dom';
import { getApiErrorMessage, getPluginConfig, getProductInfo, getTaskList, submitTask } from '../utils/api';
import { getActualBidPrice, getBuyoutPrice, getBuyoutSubmitPrice, getMinimumBidInputRequirement, getSubmitMaxPrice, getSubmitTaxType, isBuyoutOnlyProduct, isStoreProduct } from '../utils/bidPrice';
import ProductCard from '../components/ProductCard';
import UserNav from '../components/UserNav';
import TaskList from './TaskList';
import { runDeduped } from '../utils/requestDedupe';

function extractAuctionId(input) {
  const match = input.match(/[a-zA-Z]?\d{8,10}/);
  if (!match) return null;
  return match[0].toLowerCase();
}

const STRATEGY_OPTIONS = [
  [
    { label: '即时拍（立即）', value: 'direct' },
    { label: '多次出价', value: 'multi_bid' },
    { label: '结束前 1 分钟', value: '1min' },
    { label: '结束前 2 分钟', value: '2min' },
    { label: '结束前 5 分钟', value: '5min' },
    { label: '结束前 10 分钟', value: '10min' },
  ]
];

const DIRECT_ONLY_STRATEGY_OPTIONS = [
  [
    { label: '即时拍（立即）', value: 'direct' }
  ]
];

function getDisplayPrice(price, taxType) {
  const value = Number(price || 0);
  if (taxType !== 'tax_included' || value < 10) return value;
  return Math.floor(value * 1.1);
}

const YAHOO_LOW_PRICE_THRESHOLD = 1000;
const YAHOO_LOW_PRICE_BID_LIMIT = 10000;
const YAHOO_LOW_PRICE_INITIAL_BID = 9000;

// 把含税值折回税前（Yahoo 内部口径）。普通商品税前=原值。
function toTaxExcludedYen(value, taxType) {
  const v = Number(value || 0);
  if (!Number.isFinite(v) || v <= 0) return 0;
  if (taxType !== 'tax_included' || v < 10) return Math.floor(v);
  return Math.floor(((v / 1.1) + 1e-6) / 10) * 10;
}

/**
 * Yahoo 出价规则：商品税前价不足 1000 时，单次税前出价不能超过 10000。
 * 口径：
 * - submitMaxPrice 是税后值，需折回税前再比较 10000
 * - currentPrice 来自 proxy 抓的 HTML price 字段，本身就是税前，直接比较 1000
 */
function shouldSplitDirectBidByYahooLowPriceRule({ strategy, bidMode, currentPrice, submitMaxPrice, taxType }) {
  if (strategy !== 'direct') return false;
  if (bidMode !== 'bid') return false;
  const submitTaxExcluded = toTaxExcludedYen(submitMaxPrice, taxType);
  if (submitTaxExcluded <= YAHOO_LOW_PRICE_BID_LIMIT) return false;
  const currentTaxExcluded = Number(currentPrice || 0);
  if (!Number.isFinite(currentTaxExcluded) || currentTaxExcluded <= 0) return true;
  return currentTaxExcluded < YAHOO_LOW_PRICE_THRESHOLD;
}

function getMinMultiBidIncrement(maxPrice) {
  const value = Number(maxPrice || 0);
  if (!Number.isFinite(value) || value <= 0) return 0;
  if (value < 1000) return 10;
  if (value < 5000) return 100;
  if (value < 10000) return 250;
  if (value < 50000) return 500;
  return 1000;
}

function getDefaultMultiBidIncrement(maxPrice) {
  return getMinMultiBidIncrement(maxPrice);
}

function hasDirectBiddingRecord(tasks, auctionId) {
  const normalizedAuctionId = String(auctionId || '').toLowerCase();
  return tasks.some(task => {
    const taskAuctionId = String(task.product_id || task.product_url?.match(/[a-zA-Z]?\d{8,10}/)?.[0] || '').toLowerCase();
    return taskAuctionId === normalizedAuctionId &&
      task.strategy === 'direct' &&
      task.status === 'bidding';
  });
}

export default function Submit() {
  const [searchParams] = useSearchParams();
  const [url, setUrl] = useState('');
  const [product, setProduct] = useState(null);
  const [maxPrice, setMaxPrice] = useState('');
  const [strategy, setStrategy] = useState('direct');
  const [multiBidIncrement, setMultiBidIncrement] = useState('');
  const [buyoutSelected, setBuyoutSelected] = useState(false);
  const [strategyPickerVisible, setStrategyPickerVisible] = useState(false);
  const [bidStrategyScope, setBidStrategyScope] = useState(localStorage.getItem('actingUserBidStrategyScope') || 'all');
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [storeBidPriceMode, setStoreBidPriceMode] = useState('tax_before');
  const [lastFetchedUrl, setLastFetchedUrl] = useState('');
  const [taskListVersion, setTaskListVersion] = useState(0);
  const [multiBidConfig, setMultiBidConfig] = useState({
    startHours: 0.5,
    intervalMinutes: 5,
    minPrice: 5000
  });
  const buyoutOnly = isBuyoutOnlyProduct(product);
  const isLoginClientAdmin = Number(localStorage.getItem('userLevel') || 1) >= 3;
  const isDirectOnlyUser = !isLoginClientAdmin && bidStrategyScope === 'direct_only';
  const availableStrategyOptions = isDirectOnlyUser ? DIRECT_ONLY_STRATEGY_OPTIONS : STRATEGY_OPTIONS;

  useEffect(() => {
    runDeduped('Submit:getPluginConfig', getPluginConfig)
      .then(res => {
        setMultiBidConfig({
          startHours: Number(res.data?.multiBidStartHours || 0.5),
          intervalMinutes: Number(res.data?.multiBidIntervalMinutes || 5),
          minPrice: Number(res.data?.multiBidMinPrice || 5000)
        });
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    const prefillUrl = String(searchParams.get('url') || '').trim();
    if (!prefillUrl) return;
    setUrl(prefillUrl);
    handleFetch(prefillUrl, { skipIfFetched: true });
  }, []);

  useEffect(() => {
    function handleActingUserChange(event) {
      const nextScope = event?.detail?.bid_strategy_scope || localStorage.getItem('actingUserBidStrategyScope') || 'all';
      setBidStrategyScope(nextScope);
      setUrl('');
      setProduct(null);
      setMaxPrice('');
      setStrategy('direct');
      setMultiBidIncrement('');
      setBuyoutSelected(false);
      setStoreBidPriceMode('tax_before');
      setLastFetchedUrl('');
      setTaskListVersion(version => version + 1);
    }
    window.addEventListener('acting-user-change', handleActingUserChange);
    return () => window.removeEventListener('acting-user-change', handleActingUserChange);
  }, []);

  useEffect(() => {
    if (isDirectOnlyUser && strategy !== 'direct') {
      setStrategy('direct');
      setMultiBidIncrement('');
    }
  }, [isDirectOnlyUser, strategy]);

  async function handleFetch(targetUrl = url, options = {}) {
    const normalizedInput = String(targetUrl || '').trim();
    if (!normalizedInput || fetching) return;
    if (options.skipIfFetched && normalizedInput === lastFetchedUrl) return;
    const inputAuctionId = extractAuctionId(normalizedInput);

    setFetching(true);
    try {
      const res = await getProductInfo(normalizedInput);
      const data = res.data?.data;
      const auctionId = data?.auctionId || inputAuctionId;
      if (!auctionId) {
        setProduct(null);
        Toast.show({ content: '服务器网络问题，请稍后重试！' });
        return;
      }
      if (data?.title && data.title !== '商品 ' + auctionId) {
        const nextProduct = {
          auctionId,
          title: data.title || ('商品 ' + auctionId),
          currentPrice: data.currentPrice || 0,
          buyoutPrice: data.buyoutPrice ?? data.buyout_price ?? 0,
          bidCount: Number(data.bidCount ?? data.bid_count ?? 0),
          buyoutOnly: Boolean(data.buyoutOnly || data.buyout_only),
          taxType: data.taxType || 'tax_zero',
          productType: data.productType || data.product_type || (data.taxType === 'tax_included' ? 'store' : 'normal'),
          shippingFeeText: data.shippingFeeText || data.shipping_fee_text || '',
          imageUrl: data.imageUrl || '',
          endTime: data.endTime || ''
        };
        setProduct(nextProduct);
        setStoreBidPriceMode('tax_before');
        if (isBuyoutOnlyProduct(nextProduct)) {
          setBuyoutSelected(true);
          setMaxPrice(String(getBuyoutSubmitPrice(nextProduct) || ''));
          setStrategy('direct');
        } else {
          setBuyoutSelected(false);
        }
        setLastFetchedUrl(normalizedInput);
        Toast.show({ content: data.imageUrl ? '已获取商品信息' : '已获取标题（价格需在页面提取）' });
      } else {
        setProduct(null);
        Toast.show({ content: '服务器网络问题，请稍后重试！' });
      }
    } catch (e) {
      setProduct(null);
      Toast.show({ content: e.response?.data?.error || '服务器网络问题，请稍后重试！' });
    } finally {
      setFetching(false);
    }
  }

  function handleUrlChange(value) {
    setUrl(value);
    if (String(value || '').trim() !== lastFetchedUrl) {
      setProduct(null);
    }
  }

  function handleUrlBlur() {
    handleFetch(url, { skipIfFetched: true, silentInvalid: true });
  }

  async function handleSubmit() {
    if (submitting) return;
    const submitTaxType = getSubmitTaxType(product, storeBidPriceMode);
    const buyoutPrice = getBuyoutPrice(product);
    const effectiveMaxPrice = (buyoutSelected || buyoutOnly)
      ? getBuyoutSubmitPrice(product)
      : getSubmitMaxPrice(maxPrice, product, storeBidPriceMode);
    if ((buyoutSelected || buyoutOnly) && buyoutPrice <= 0) {
      Toast.show({ content: '出价失败：该商品没有即決价格' });
      return;
    }
    if (!effectiveMaxPrice) {
      Toast.show({ content: '请输入最高出价' });
      return;
    }
    // 拍卖次数为 0 可按当前价提交；已有入札时必须满足 Yahoo 最低加价。
    const submitTaxExcludedPrice = toTaxExcludedYen(effectiveMaxPrice, submitTaxType);
    const inputRequirement = getMinimumBidInputRequirement(product, storeBidPriceMode);
    const inputPriceForRequirement = isStoreProduct(product) && storeBidPriceMode === 'tax_after'
      ? Number(maxPrice || 0)
      : submitTaxExcludedPrice;
    if (!buyoutSelected && !buyoutOnly && inputPriceForRequirement < inputRequirement.requiredPrice) {
      const reason = inputRequirement.increment > 0
        ? `${inputRequirement.currentLabel}${inputRequirement.currentPrice.toLocaleString('ja-JP')}円+最低加价${inputRequirement.increment.toLocaleString('ja-JP')}円=最低${inputRequirement.requiredPrice.toLocaleString('ja-JP')}円`
        : `${inputRequirement.currentLabel}${inputRequirement.currentPrice.toLocaleString('ja-JP')}円`;
      Toast.show({ content: `最高出价不能低于最低可出价（${reason}）` });
      return;
    }
    const selectedStrategy = (buyoutSelected || buyoutOnly) ? 'direct' : (strategy || 'direct');
    if (isDirectOnlyUser && selectedStrategy !== 'direct') {
      Toast.show({ content: '当前账号只能使用即时拍策略' });
      setStrategy('direct');
      return;
    }
    if (selectedStrategy === 'multi_bid' && effectiveMaxPrice < multiBidConfig.minPrice) {
      Toast.show({ content: `多次出价最高价不能低于${multiBidConfig.minPrice}円` });
      return;
    }
    const minMultiBidIncrement = getMinMultiBidIncrement(effectiveMaxPrice);
    const effectiveMultiBidIncrement = Number(multiBidIncrement || 0);
    if (selectedStrategy === 'multi_bid' && effectiveMultiBidIncrement < minMultiBidIncrement) {
      Toast.show({ content: `每次加价额度不能低于${minMultiBidIncrement}日元` });
      return;
    }
    setSubmitting(true);
    try {
      const standardUrl = product?.auctionId
        ? `https://auctions.yahoo.co.jp/jp/auction/${product.auctionId}`
        : url;
      const auctionId = product?.auctionId || extractAuctionId(standardUrl);
      if (selectedStrategy !== 'direct' && auctionId) {
        const taskRes = await getTaskList({ limit: 100 });
        const tasks = taskRes.data?.data || [];
        if (hasDirectBiddingRecord(tasks, auctionId)) {
          const confirmed = await Dialog.confirm({
            title: '已有即时拍出价',
            content: '该商品已有“即时拍”出价，是否继续提交新的策略？',
            confirmText: '继续提交',
            cancelText: '取消'
          });
          if (!confirmed) return;
        }
      }
      // Yahoo 出价规则：商品当前价不足 1000 时，单次出价不能超过 10000。
      // 仅对 direct + bid 模式生效，需要先拆分出 9000 的初始即时拍。
      const bidMode = (buyoutSelected || buyoutOnly) ? 'buyout' : 'bid';
      let submittedMaxPrice = effectiveMaxPrice;
      let pendingFollowupMaxPrice = null;
      if (shouldSplitDirectBidByYahooLowPriceRule({
        strategy: selectedStrategy,
        bidMode,
        currentPrice: product?.currentPrice,
        submitMaxPrice: effectiveMaxPrice,
        taxType: submitTaxType
      })) {
        // 弹窗里显示用户原本输入的最高价和价格类型（税前/税后），避免与"实际出价"混淆。
        const userTypedMaxPrice = Math.floor(Number(maxPrice || 0));
        const isStore = isStoreProduct(product);
        const priceTypeLabel = isStore
          ? (storeBidPriceMode === 'tax_before' ? '税前最高价' : '税后最高价')
          : '最高价';
        const confirmed = await Dialog.confirm({
          title: 'Yahoo 出价规则提示',
          content: `商品目前价格不足${YAHOO_LOW_PRICE_THRESHOLD}円，单次出价不能超过${YAHOO_LOW_PRICE_BID_LIMIT}円。本次出价将分两步：\n\n1. 先以 ${YAHOO_LOW_PRICE_INITIAL_BID.toLocaleString('ja-JP')}円 提交即时拍\n2. 当商品价格突破 ${YAHOO_LOW_PRICE_THRESHOLD}円 后，自动以原${priceTypeLabel} ${userTypedMaxPrice.toLocaleString('ja-JP')}円 再次提交即时拍`,
          confirmText: '继续提交',
          cancelText: '取消'
        });
        if (!confirmed) return;
        // 服务端会按 tax_type 再做一次税前换算（max_price = user_max_price / 1.1）。
        // 想让 Yahoo 实际收到 9000，对于含税商品要传 9900 给服务端。
        submittedMaxPrice = isStore
          ? Math.floor(YAHOO_LOW_PRICE_INITIAL_BID * 1.1)
          : YAHOO_LOW_PRICE_INITIAL_BID;
        pendingFollowupMaxPrice = effectiveMaxPrice;
      }
      // Include product data so server can save title/image_url
      await submitTask({
        product_url: standardUrl,
        max_price: submittedMaxPrice,
        strategy: selectedStrategy,
        bid_mode: bidMode,
        buyout_only: buyoutOnly,
        product_title: product?.title || null,
        product_image_url: product?.imageUrl || null,
        current_price: product?.currentPrice || null,
        buyout_price: buyoutPrice || null,
        bid_count: product?.bidCount ?? product?.bid_count ?? 0,
        tax_type: submitTaxType,
        product_type: product?.productType || product?.product_type || (submitTaxType === 'tax_included' ? 'store' : 'normal'),
        shipping_fee_text: product?.shippingFeeText || null,
        multi_bid_increment: selectedStrategy === 'multi_bid' ? effectiveMultiBidIncrement : null,
        end_time: product?.endTime || null,
        pending_followup_max_price: pendingFollowupMaxPrice
      });
      Toast.show({ content: '任务已提交' });
      setUrl('');
      setProduct(null);
      setMaxPrice('');
      setStrategy('direct');
      setMultiBidIncrement('');
      setBuyoutSelected(false);
      setStoreBidPriceMode('tax_before');
      setLastFetchedUrl('');
      setTaskListVersion(version => version + 1);
    } catch (e) {
      Toast.show({ content: getApiErrorMessage(e, '提交失败') });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <UserNav />
      <div style={{
        background: '#fff',
        border: '1px solid #d6e4ff',
        borderRadius: 8,
        padding: 14,
        boxShadow: '0 2px 8px rgba(22, 119, 255, 0.08)'
      }}>
        <div style={{ fontSize: 14, fontWeight: 700, color: '#1f2937', marginBottom: 10 }}>商品链接 / 商品名称</div>
        <div style={{
          border: '1px solid #1677ff',
          borderRadius: 8,
          padding: '10px 12px',
          background: '#f8fbff'
        }}>
          <Input
            placeholder="粘贴 Yahoo 拍卖商品链接或输入商品名称"
            value={url}
            onChange={handleUrlChange}
            onBlur={handleUrlBlur}
            onEnterPress={() => handleFetch(url)}
            clearable
          />
        </div>
        <Button
          onClick={() => handleFetch(url)}
          disabled={fetching}
          loading={fetching}
          color="primary"
          fill="outline"
          block
          style={{ marginTop: 12 }}
        >
          {fetching ? '获取中...' : '获取商品信息'}
        </Button>
      </div>

      {product && <ProductCard product={product} />}

      {product && (
        <>
          <List style={{ marginTop: 12 }}>
            {getBuyoutPrice(product) > 0 && (
              <List.Item
                prefix="即決"
                extra={
                  <Checkbox
                    checked={buyoutSelected || buyoutOnly}
                    disabled={buyoutOnly}
                    onChange={(checked) => {
                      if (buyoutOnly) return;
                      setBuyoutSelected(checked);
                      if (checked) {
                        setMaxPrice(String(getBuyoutSubmitPrice(product) || ''));
                        setStrategy('direct');
                      }
                    }}
                  />
                }
              >
                <span style={{ color: '#999', fontSize: 12 }}>使用即決价格直接落札</span>
                {buyoutOnly && (
                  <span style={{ color: '#d4380d', fontSize: 12, marginLeft: 8 }}>该商品仅支持即決</span>
                )}
              </List.Item>
            )}
            {isStoreProduct(product) && !buyoutSelected && !buyoutOnly && (
              <List.Item prefix="价格类型">
                <Radio.Group
                  value={storeBidPriceMode}
                  onChange={(value) => {
                    setStoreBidPriceMode(value);
                    if (strategy === 'multi_bid') {
                      const nextEffectiveMaxPrice = getSubmitMaxPrice(maxPrice, product, value);
                      setMultiBidIncrement(String(getDefaultMultiBidIncrement(nextEffectiveMaxPrice) || ''));
                    }
                  }}
                  style={{ display: 'flex', justifyContent: 'flex-end', gap: 18 }}
                >
                  <Radio value="tax_before">税前价</Radio>
                  <Radio value="tax_after">税后价</Radio>
                </Radio.Group>
              </List.Item>
            )}
            <List.Item
              prefix="最高出价"
              extra={
                <Input
                  type="number"
                  value={(buyoutSelected || buyoutOnly) ? String(getBuyoutSubmitPrice(product) || '') : maxPrice}
                  onChange={(value) => {
                    setMaxPrice(value);
                    if (strategy === 'multi_bid') {
                      const nextEffectiveMaxPrice = getSubmitMaxPrice(value, product, storeBidPriceMode);
                      const nextDefault = getDefaultMultiBidIncrement(nextEffectiveMaxPrice);
                      setMultiBidIncrement(String(nextDefault || ''));
                    }
                  }}
                  placeholder="日元"
                  disabled={buyoutSelected || buyoutOnly}
                  style={{ width: 100 }}
                />
              }
            >
              <span style={{ color: '#999', fontSize: 12 }}>日元</span>
            </List.Item>
            {isStoreProduct(product) && !buyoutSelected && !buyoutOnly && (
              <List.Item>
                <div style={{ textAlign: 'right', color: '#d4380d', fontSize: 13, fontWeight: 600 }}>
                  实际出价：{getActualBidPrice(maxPrice, product, storeBidPriceMode).toLocaleString('ja-JP')}日元
                </div>
              </List.Item>
            )}
          </List>

          <List style={{ marginTop: 12 }}>
            <List.Item
              prefix="出价策略"
              clickable={!buyoutSelected && !buyoutOnly}
              extra={availableStrategyOptions[0].find(item => item.value === strategy)?.label || '即时拍（立即）'}
              onClick={() => {
                if (!buyoutSelected && !buyoutOnly) setStrategyPickerVisible(true);
              }}
              style={(buyoutSelected || buyoutOnly) ? { opacity: 0.45 } : undefined}
            />
          </List>
          <Picker
            columns={availableStrategyOptions}
            visible={strategyPickerVisible}
            value={[strategy]}
            onClose={() => setStrategyPickerVisible(false)}
            onConfirm={val => {
              const nextStrategy = val[0] || 'direct';
              setStrategy(nextStrategy);
              if (nextStrategy === 'multi_bid') {
                const effectiveMaxPriceForIncrement = getSubmitMaxPrice(maxPrice, product, storeBidPriceMode);
                setMultiBidIncrement(String(getDefaultMultiBidIncrement(effectiveMaxPriceForIncrement) || ''));
              }
            }}
          />
          {strategy === 'multi_bid' && !buyoutSelected && !buyoutOnly && (
            <>
              <List style={{ marginTop: 12 }}>
                <List.Item
                  prefix="每次加价额度"
                  extra={
                    <Input
                      type="number"
                      value={multiBidIncrement}
                      onChange={setMultiBidIncrement}
                      placeholder="日元"
                      style={{ width: 100 }}
                    />
                  }
                >
                  <span style={{ color: '#999', fontSize: 12 }}>日元</span>
                </List.Item>
              </List>
              <div style={{ padding: '8px 16px 0', color: '#d4380d', fontSize: 13, lineHeight: 1.5 }}>
                多次出价标准：最高价不低于{multiBidConfig.minPrice}日元，商品结束前{multiBidConfig.startHours}小时开始，每{multiBidConfig.intervalMinutes}分钟自动加价。
                <br />
                提示：输入金额应&gt;= {getMinMultiBidIncrement(getSubmitMaxPrice(maxPrice, product, storeBidPriceMode))}日元
              </div>
            </>
          )}

          <div style={{ padding: '0 16px 16px' }}>
            <Button block color="primary" loading={submitting} disabled={submitting} onClick={handleSubmit}>
              {submitting ? '提交中...' : '提交任务'}
            </Button>
          </div>
        </>
      )}

      <TaskList key={taskListVersion} limit={10} embedded />
    </div>
  );
}

