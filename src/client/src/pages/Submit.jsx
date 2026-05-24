import { useEffect, useState } from 'react';
import { Input, Button, Toast, List, Picker, Checkbox, Dialog, Radio } from 'antd-mobile';
import { useSearchParams } from 'react-router-dom';
import { getApiErrorMessage, getPluginConfig, getProductInfo, getTaskList, submitTask } from '../utils/api';
import { getActualBidPrice, getSubmitMaxPrice, getSubmitTaxType, isStoreProduct } from '../utils/bidPrice';
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

function getDisplayPrice(price, taxType) {
  const value = Number(price || 0);
  if (taxType !== 'tax_included' || value < 10) return value;
  return Math.floor(value * 1.1);
}

function getMinMultiBidIncrement(maxPrice) {
  const value = Number(maxPrice || 0);
  return value > 0 ? Math.floor(value / 20) : 0;
}

function getDefaultMultiBidIncrement(maxPrice) {
  return Math.max(500, getMinMultiBidIncrement(maxPrice));
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
  const [fetching, setFetching] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [storeBidPriceMode, setStoreBidPriceMode] = useState('tax_before');
  const [lastFetchedUrl, setLastFetchedUrl] = useState('');
  const [taskListVersion, setTaskListVersion] = useState(0);
  const [multiBidConfig, setMultiBidConfig] = useState({
    startHours: 0.5,
    intervalMinutes: 5
  });

  useEffect(() => {
    runDeduped('Submit:getPluginConfig', getPluginConfig)
      .then(res => {
        setMultiBidConfig({
          startHours: Number(res.data?.multiBidStartHours || 0.5),
          intervalMinutes: Number(res.data?.multiBidIntervalMinutes || 5)
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
    function handleActingUserChange() {
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
        setProduct({
          auctionId,
          title: data.title || ('商品 ' + auctionId),
          currentPrice: data.currentPrice || 0,
          buyoutPrice: data.buyoutPrice || 0,
          taxType: data.taxType || 'tax_zero',
          shippingFeeText: data.shippingFeeText || '',
          imageUrl: data.imageUrl || '',
          endTime: data.endTime || ''
        });
        setStoreBidPriceMode('tax_before');
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
    const buyoutPrice = Number(product?.buyoutPrice || 0);
    const effectiveMaxPrice = buyoutSelected
      ? getDisplayPrice(buyoutPrice, submitTaxType)
      : getSubmitMaxPrice(maxPrice, product, storeBidPriceMode);
    if (buyoutSelected && buyoutPrice <= 0) {
      Toast.show({ content: '出价失败：该商品没有即決价格' });
      return;
    }
    if (!effectiveMaxPrice) {
      Toast.show({ content: '请输入最高出价' });
      return;
    }
    const selectedStrategy = buyoutSelected ? 'direct' : (strategy || 'direct');
    if (selectedStrategy === 'multi_bid' && effectiveMaxPrice < 5500) {
      Toast.show({ content: '多次出价最高价不能低于5500円' });
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
      // Include product data so server can save title/image_url
      await submitTask({
        product_url: standardUrl,
        max_price: effectiveMaxPrice,
        strategy: selectedStrategy,
        bid_mode: buyoutSelected ? 'buyout' : 'bid',
        product_title: product?.title || null,
        product_image_url: product?.imageUrl || null,
        current_price: product?.currentPrice || null,
        buyout_price: buyoutPrice || null,
        tax_type: submitTaxType,
        shipping_fee_text: product?.shippingFeeText || null,
        multi_bid_increment: selectedStrategy === 'multi_bid' ? effectiveMultiBidIncrement : null,
        end_time: product?.endTime || null
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
            {Number(product.buyoutPrice || 0) > 0 && (
              <List.Item
                prefix="即決"
                extra={
                  <Checkbox
                    checked={buyoutSelected}
                    onChange={(checked) => {
                      setBuyoutSelected(checked);
                      if (checked) {
                        setMaxPrice(String(getDisplayPrice(product.buyoutPrice, product.taxType) || ''));
                        setStrategy('direct');
                      }
                    }}
                  />
                }
              >
                <span style={{ color: '#999', fontSize: 12 }}>使用即決价格直接落札</span>
              </List.Item>
            )}
            {isStoreProduct(product) && !buyoutSelected && (
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
                  value={buyoutSelected ? String(getDisplayPrice(product.buyoutPrice, getSubmitTaxType(product, storeBidPriceMode)) || '') : maxPrice}
                  onChange={(value) => {
                    setMaxPrice(value);
                    if (strategy === 'multi_bid') {
                      const nextEffectiveMaxPrice = getSubmitMaxPrice(value, product, storeBidPriceMode);
                      const nextDefault = getDefaultMultiBidIncrement(nextEffectiveMaxPrice);
                      setMultiBidIncrement(String(nextDefault || ''));
                    }
                  }}
                  placeholder="日元"
                  disabled={buyoutSelected}
                  style={{ width: 100 }}
                />
              }
            >
              <span style={{ color: '#999', fontSize: 12 }}>日元</span>
            </List.Item>
            {isStoreProduct(product) && !buyoutSelected && (
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
              clickable={!buyoutSelected}
              extra={STRATEGY_OPTIONS[0].find(item => item.value === strategy)?.label || '即时拍（立即）'}
              onClick={() => {
                if (!buyoutSelected) setStrategyPickerVisible(true);
              }}
              style={buyoutSelected ? { opacity: 0.45 } : undefined}
            />
          </List>
          <Picker
            columns={STRATEGY_OPTIONS}
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
          {strategy === 'multi_bid' && !buyoutSelected && (
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
                多次出价标准：最高价不低于5500日元，商品结束前{multiBidConfig.startHours}小时开始，每{multiBidConfig.intervalMinutes}分钟自动加价。
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

