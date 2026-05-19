import { useEffect, useState } from 'react';
import { Input, Button, Toast, List, Picker, Checkbox } from 'antd-mobile';
import { getPluginConfig, getProductInfo, submitTask } from '../utils/api';
import ProductCard from '../components/ProductCard';
import TaskList from './TaskList';

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

export default function Submit() {
  const [url, setUrl] = useState('');
  const [product, setProduct] = useState(null);
  const [maxPrice, setMaxPrice] = useState('');
  const [strategy, setStrategy] = useState('direct');
  const [multiBidIncrement, setMultiBidIncrement] = useState('');
  const [buyoutSelected, setBuyoutSelected] = useState(false);
  const [strategyPickerVisible, setStrategyPickerVisible] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [taskListVersion, setTaskListVersion] = useState(0);
  const [multiBidConfig, setMultiBidConfig] = useState({
    startHours: 0.5,
    intervalMinutes: 5
  });

  useEffect(() => {
    getPluginConfig()
      .then(res => {
        setMultiBidConfig({
          startHours: Number(res.data?.multiBidStartHours || 0.5),
          intervalMinutes: Number(res.data?.multiBidIntervalMinutes || 5)
        });
      })
      .catch(() => {});
  }, []);

  async function handleFetch() {
    if (!url) return;
    const auctionId = extractAuctionId(url);
    if (!auctionId) {
      Toast.show({ content: '无效的商品链接' });
      return;
    }

    setFetching(true);
    try {
      const res = await getProductInfo(url);
      const data = res.data?.data;
      if (data?.title && data.title !== '商品 ' + auctionId) {
        setProduct({
          auctionId: data.auctionId || auctionId,
          title: data.title || ('商品 ' + auctionId),
          currentPrice: data.currentPrice || 0,
          buyoutPrice: data.buyoutPrice || 0,
          taxType: data.taxType || 'tax_zero',
          imageUrl: data.imageUrl || '',
          endTime: data.endTime || ''
        });
        Toast.show({ content: data.imageUrl ? '已获取商品信息' : '已获取标题（价格需在页面提取）' });
      } else {
        setProduct({
          auctionId,
          title: '商品 ' + auctionId,
          currentPrice: 0,
          buyoutPrice: 0,
          taxType: 'tax_zero',
          imageUrl: '',
          endTime: ''
        });
        Toast.show({ content: '请先在 Chrome 打开商品页面，插件将自动提取完整数据' });
      }
    } catch (e) {
      setProduct({
        auctionId,
        title: '商品 ' + auctionId,
        currentPrice: 0,
        buyoutPrice: 0,
        taxType: 'tax_zero',
        imageUrl: '',
        endTime: ''
      });
      Toast.show({ content: '无法获取商品详情，已解析链接' });
    } finally {
      setFetching(false);
    }
  }

  async function handleSubmit() {
    const buyoutPrice = Number(product?.buyoutPrice || 0);
    const effectiveMaxPrice = buyoutSelected
      ? getDisplayPrice(buyoutPrice, product?.taxType)
      : Number(maxPrice || 0);
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
    try {
      const standardUrl = product?.auctionId
        ? `https://auctions.yahoo.co.jp/jp/auction/${product.auctionId}`
        : url;
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
        tax_type: product?.taxType || 'tax_zero',
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
      setTaskListVersion(version => version + 1);
    } catch (e) {
      Toast.show({ content: e.response?.data?.error || '提交失败' });
    }
  }

  return (
    <div style={{ padding: 16 }}>
      <List header="提交竞拍任务">
        <List.Item>
          <Input
            placeholder="粘贴商品链接"
            value={url}
            onChange={setUrl}
            onEnterPress={handleFetch}
          />
          <div style={{ height: 10 }} />
          <Button onClick={handleFetch} disabled={fetching} block>
            {fetching ? '获取中...' : '获取商品信息'}
          </Button>
        </List.Item>
      </List>

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
            <List.Item
              prefix="最高出价"
              extra={
                <Input
                  type="number"
                  value={buyoutSelected ? String(getDisplayPrice(product.buyoutPrice, product.taxType) || '') : maxPrice}
                  onChange={(value) => {
                    setMaxPrice(value);
                    if (strategy === 'multi_bid') {
                      const nextDefault = getDefaultMultiBidIncrement(Number(value || 0));
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
                setMultiBidIncrement(String(getDefaultMultiBidIncrement(Number(maxPrice || 0)) || ''));
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
                提示：输入金额应&gt;= {getMinMultiBidIncrement(Number(maxPrice || 0))}日元
              </div>
            </>
          )}

          <div style={{ padding: '0 16px 16px' }}>
            <Button block color="primary" onClick={handleSubmit}>
              提交任务
            </Button>
          </div>
        </>
      )}

      <TaskList key={taskListVersion} limit={10} embedded />
    </div>
  );
}

