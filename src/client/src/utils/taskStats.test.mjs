import assert from 'assert/strict';
import { getTaskStatCards } from './taskStats.js';

function testTaskStatCardsHideProcessingCard() {
  const cards = getTaskStatCards({
    total: 7,
    pending: 1,
    processing: 2,
    bidding: 3,
    success: 4,
    failed: 5,
    cancelled: 6
  });

  assert.deepEqual(cards.map(card => card.label), [
    '总任务',
    '队列中',
    '已出价',
    '成功',
    '出价失败',
    '已终止'
  ]);
  assert.equal(cards.length, 6);
}

testTaskStatCardsHideProcessingCard();
