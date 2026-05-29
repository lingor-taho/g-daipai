import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import {
  formatTotalAmount,
  parseShippingFeeForTotal
} from './totalAmount.js';

describe('parseShippingFeeForTotal', () => {
  it('uses numeric shipping fee text as yen', () => {
    assert.deepEqual(parseShippingFeeForTotal('送料 1,200円'), { pending: false, amount: 1200 });
    assert.deepEqual(parseShippingFeeForTotal('1,350円'), { pending: false, amount: 1350 });
  });

  it('treats free shipping as zero', () => {
    assert.deepEqual(parseShippingFeeForTotal('送料無料'), { pending: false, amount: 0 });
    assert.deepEqual(parseShippingFeeForTotal('送料 無料'), { pending: false, amount: 0 });
  });

  it('marks unclear shipping fee text as pending', () => {
    assert.deepEqual(parseShippingFeeForTotal('着払い'), { pending: true, amount: null });
    assert.deepEqual(parseShippingFeeForTotal('落札者負担'), { pending: true, amount: null });
    assert.deepEqual(parseShippingFeeForTotal(''), { pending: true, amount: null });
  });
});

describe('formatTotalAmount', () => {
  it('adds price and confirmed shipping fee', () => {
    assert.equal(formatTotalAmount(1000, '送料 200円'), '1,200円');
  });

  it('uses zero shipping for free shipping', () => {
    assert.equal(formatTotalAmount(1000, '無料'), '1,000円');
  });

  it('returns pending when shipping fee cannot be confirmed', () => {
    assert.equal(formatTotalAmount(1000, '落札者負担'), '待定');
  });
});
