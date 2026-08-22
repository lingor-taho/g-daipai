import assert from 'assert/strict';
import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const currentDir = dirname(fileURLToPath(import.meta.url));
const source = readFileSync(join(currentDir, 'WonItems.jsx'), 'utf8');

assert.equal(
  source.includes("manual_import: '导入'") || source.includes('manual_import: "导入"'),
  true,
  'WonItems page must render manual_import strategy as 导入'
);

assert.equal(
  source.includes('购买页面') && source.includes('/purchase-page'),
  true,
  'WonItems page must link won items to the read-only purchase page'
);

assert.equal(
  source.includes("canViewPurchasePage = item.order_status === 'completed'") && source.includes('{canViewPurchasePage ?'),
  true,
  'WonItems page must show the purchase page button only for completed orders'
);

assert.equal(
  source.includes('消息') && !source.includes('卖家消息') && source.includes('seller_message_html') && source.includes('sellerMessageModal'),
  true,
  'WonItems page must show a neutral message button and read-only modal when fetched message HTML exists'
);

assert.equal(
  source.includes('seller-message-view') && !source.includes('sendSellerMessage'),
  true,
  'WonItems seller message modal must be read-only and use scoped message styles'
);

assert.equal(
  source.includes('<InfiniteScroll') && source.includes('hasMore={items.length < total}'),
  true,
  'WonItems must append the next 10 items when the user reaches the bottom'
);

assert.equal(
  source.includes('上一页') || source.includes('下一页'),
  false,
  'WonItems must not render previous/next pagination buttons'
);

assert.equal(
  source.includes('<RemarkFlag') && source.includes('修改商品备注') && source.includes('添加商品备注'),
  true,
  'WonItems must render the gray/red remark flag below the product image'
);

assert.equal(
  source.includes('删除备注') && source.includes('保存备注') && source.includes('maxLength={1000}'),
  true,
  'WonItems remark editor must support saving and deleting a 1000-character remark'
);

assert.equal(
  source.includes('Dialog.confirm') || source.includes('确定删除该商品的备注吗'),
  false,
  'WonItems must delete a remark directly without a second confirmation dialog'
);
