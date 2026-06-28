import assert from 'node:assert/strict';
import { getTaskFailureLabel } from '../../../shared/taskFailureReason.js';

assert.equal(
  getTaskFailureLabel('Current price is above max price before execution'),
  '失败：低于当前价'
);
assert.equal(
  getTaskFailureLabel('税込合計金額 5600円 已高于最高价 5500円，停止出价'),
  '失败：低于当前价'
);
assert.equal(
  getTaskFailureLabel('Auction ended before plugin execution'),
  '失败：商品已结束'
);
assert.equal(
  getTaskFailureLabel('Auction ended according to product page snapshot'),
  '失败：商品已结束'
);
assert.equal(
  getTaskFailureLabel('outbid after bid'),
  '失败：出价后被超过'
);
assert.equal(
  getTaskFailureLabel('再入札が必要です：最高价未超过当前最高出价'),
  '失败：出价后被超过'
);
assert.equal(
  getTaskFailureLabel('Rebid required: current bid is not high enough'),
  '失败：出价后被超过'
);
assert.equal(
  getTaskFailureLabel('商品页加载超时'),
  '失败：响应超时'
);
assert.equal(
  getTaskFailureLabel('需要登录 Yahoo'),
  '失败：yahoo登录失败'
);
assert.equal(
  getTaskFailureLabel('Server tab error: No tab with id: 57727524'),
  '失败：服务器tab异常'
);
assert.equal(
  getTaskFailureLabel('Tabs cannot be edited right now (user may be dragging a tab).'),
  '失败：服务器tab异常'
);
assert.equal(
  getTaskFailureLabel('confirm button not found'),
  '失败：系统原因'
);

assert.equal(
  getTaskFailureLabel('Yahoo bid failed: Yahoo system error page'),
  '失败：Yahoo页面错误'
);
assert.equal(
  getTaskFailureLabel('?????????30??????????????????tab'),
  getTaskFailureLabel('timeout')
);
assert.equal(
  getTaskFailureLabel('Task execution timeout after 30s; task tab closed'),
  getTaskFailureLabel('timeout')
);
assert.equal(
  getTaskFailureLabel('garbled 30 seconds no response task tab'),
  getTaskFailureLabel('timeout')
);

assert.equal(
  getTaskFailureLabel('\u5931\u8d25\uff1a\u5356\u5bb6\u9ed1\u540d\u5355'),
  '\u5931\u8d25\uff1a\u5356\u5bb6\u9ed1\u540d\u5355'
);
