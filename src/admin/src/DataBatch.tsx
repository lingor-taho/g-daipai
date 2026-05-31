import { Tabs } from 'antd';
import ShippingRefreshPage from './ShippingRefresh';
import ProductTypeRefreshPage from './ProductTypeRefresh';
import OrdersResyncPage from './OrdersResync';

export default function DataBatchPage() {
  return (
    <Tabs
      defaultActiveKey="shipping"
      items={[
        {
          key: 'shipping',
          label: '运费更新',
          children: <ShippingRefreshPage />
        },
        {
          key: 'productType',
          label: '商品类型更新',
          children: <ProductTypeRefreshPage />
        },
        {
          key: 'ordersResync',
          label: '落札商品更新',
          children: <OrdersResyncPage />
        }
      ]}
    />
  );
}
