import { useState } from 'react';
import { Input, Button, Toast, List, Picker } from 'antd-mobile';
import { getProductInfo, submitTask } from '../utils/api';
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
    { label: '结束前 1 分钟', value: '1min' },
    { label: '结束前 2 分钟', value: '2min' },
    { label: '结束前 5 分钟', value: '5min' },
    { label: '结束前 10 分钟', value: '10min' },
  ]
];

export default function Submit() {
  const [url, setUrl] = useState('');
  const [product, setProduct] = useState(null);
  const [maxPrice, setMaxPrice] = useState('');
  const [strategy, setStrategy] = useState('direct');
  const [strategyPickerVisible, setStrategyPickerVisible] = useState(false);
  const [fetching, setFetching] = useState(false);
  const [taskListVersion, setTaskListVersion] = useState(0);

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
          imageUrl: data.imageUrl || '',
          endTime: data.endTime || ''
        });
        Toast.show({ content: data.imageUrl ? '已获取商品信息' : '已获取标题（价格需在页面提取）' });
      } else {
        setProduct({
          auctionId,
          title: '商品 ' + auctionId,
          currentPrice: 0,
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
        imageUrl: '',
        endTime: ''
      });
      Toast.show({ content: '无法获取商品详情，已解析链接' });
    } finally {
      setFetching(false);
    }
  }

  async function handleSubmit() {
    if (!maxPrice) {
      Toast.show({ content: '请输入最高出价' });
      return;
    }
    const selectedStrategy = strategy || 'direct';
    try {
      const standardUrl = product?.auctionId
        ? `https://auctions.yahoo.co.jp/jp/auction/${product.auctionId}`
        : url;
      // Include product data so server can save title/image_url
      await submitTask({
        product_url: standardUrl,
        max_price: parseInt(maxPrice),
        strategy: selectedStrategy,
        product_title: product?.title || null,
        product_image_url: product?.imageUrl || null,
        current_price: product?.currentPrice || null,
        end_time: product?.endTime || null
      });
      Toast.show({ content: '任务已提交' });
      setUrl('');
      setProduct(null);
      setMaxPrice('');
      setStrategy('direct');
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
            <List.Item
              prefix="最高出价"
              extra={
                <Input
                  type="number"
                  value={maxPrice}
                  onChange={setMaxPrice}
                  placeholder="日元"
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
              clickable
              extra={STRATEGY_OPTIONS[0].find(item => item.value === strategy)?.label || '即时拍（立即）'}
              onClick={() => setStrategyPickerVisible(true)}
            />
          </List>
          <Picker
            columns={STRATEGY_OPTIONS}
            visible={strategyPickerVisible}
            value={[strategy]}
            onClose={() => setStrategyPickerVisible(false)}
            onConfirm={val => setStrategy(val[0] || 'direct')}
          />

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

