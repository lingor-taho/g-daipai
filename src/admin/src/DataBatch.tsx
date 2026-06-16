import { Tabs } from 'antd';
import ShippingRefreshPage from './ShippingRefresh';
import ProductTypeRefreshPage from './ProductTypeRefresh';
import OrdersResyncPage from './OrdersResync';
import OrderStatusRefreshPage from './OrderStatusRefresh';
import ReceiptSheetBackfillPage from './ReceiptSheetBackfill';
import TrackingRescanPage from './TrackingRescan';
import ProductDataDeletePage from './ProductDataDelete';

const labels = {
  shipping: '运费更新',
  productType: '商品类型更新',
  ordersResync: '落札商品更新',
  orderStatus: '订单状态更新',
  receiptSheetBackfill: '待收货补表格',
  trackingRescan: '单号重扫',
  productDataDelete: '删除商品数据'
};

export default function DataBatchPage() {
  return (
    <Tabs
      className="admin-data-batch-tabs"
      defaultActiveKey="shipping"
      items={[
        {
          key: 'shipping',
          label: labels.shipping,
          children: <ShippingRefreshPage />
        },
        {
          key: 'productType',
          label: labels.productType,
          children: <ProductTypeRefreshPage />
        },
        {
          key: 'ordersResync',
          label: labels.ordersResync,
          children: <OrdersResyncPage />
        },
        {
          key: 'orderStatus',
          label: labels.orderStatus,
          children: <OrderStatusRefreshPage />
        },
        {
          key: 'receiptSheetBackfill',
          label: labels.receiptSheetBackfill,
          children: <ReceiptSheetBackfillPage />
        },
        {
          key: 'trackingRescan',
          label: labels.trackingRescan,
          children: <TrackingRescanPage />
        },
        {
          key: 'productDataDelete',
          label: labels.productDataDelete,
          children: <ProductDataDeletePage />
        }
      ]}
    />
  );
}
