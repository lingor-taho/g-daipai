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
  getTaskFailureLabel('outbid after bid'),
  '失败：出价后被超过'
);
assert.equal(
  getTaskFailureLabel('再入札が必要です：最高价未超过当前最高出价'),
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
  getTaskFailureLabel('confirm button not found'),
  '失败：系统原因'
);
