import { Tabs } from 'antd';
import ShippingRefreshPage from './ShippingRefresh';
import ProductTypeRefreshPage from './ProductTypeRefresh';
import OrdersResyncPage from './OrdersResync';
import OrderStatusRefreshPage from './OrderStatusRefresh';
import ReceiptSheetBackfillPage from './ReceiptSheetBackfill';
import ProductDataDeletePage from './ProductDataDelete';

const labels = {
  shipping: '\u8fd0\u8d39\u66f4\u65b0',
  productType: '\u5546\u54c1\u7c7b\u578b\u66f4\u65b0',
  ordersResync: '\u843d\u672d\u5546\u54c1\u66f4\u65b0',
  orderStatus: '\u8ba2\u5355\u72b6\u6001\u66f4\u65b0',
  receiptSheetBackfill: '\u5f85\u6536\u8d27\u8865\u8868\u683c',
  productDataDelete: '\u5220\u9664\u5546\u54c1\u6570\u636e'
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
          key: 'productDataDelete',
          label: labels.productDataDelete,
          children: <ProductDataDeletePage />
        }
      ]}
    />
  );
}
