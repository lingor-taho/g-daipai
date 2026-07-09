const assert = require('assert/strict');
const { readFileSync } = require('fs');
const { join } = require('path');

const source = readFileSync(join(__dirname, 'MessageRead.tsx'), 'utf8');

assert.equal(
  source.includes('yahoo-message-view'),
  true,
  'MessageRead modal should scope Yahoo-style trade message rendering'
);

assert.equal(
  source.includes('yahoo-own-message'),
  true,
  'MessageRead modal should decorate own Yahoo messages before rendering'
);

assert.equal(
  source.includes('#fffdd1') && source.includes('#f1f2ff'),
  true,
  'MessageRead modal should render seller/store messages and own messages with different Yahoo-like backgrounds'
);

assert.equal(
  source.includes('ul.sc-c46fd2ce-0') && source.includes('#messagelist'),
  true,
  'MessageRead modal should style both store and normal Yahoo message markup'
);

assert.equal(
  source.includes('canRequestMessageUpdate') &&
    source.includes("row.order_status === 'cancelled'") &&
    source.includes("row.order_status === 'bundle_completed'") &&
    source.includes('isWonMoreThan45DaysAgo') &&
    source.includes('45 * 24 * 60 * 60 * 1000'),
  true,
  'MessageRead should hide update button for cancelled, bundle child, and 45-day-old won orders'
);

assert.equal(
  source.includes("row.order_status === 'completed'"),
  false,
  'MessageRead should allow message updates for completed orders'
);

assert.equal(
  source.includes("title: '订单状态'") && source.includes("dataIndex: 'order_status'") && source.includes('renderOrderStatus'),
  true,
  'MessageRead table should show order status after won time'
);

assert.equal(
  source.includes('MESSAGE_PROCESSING_TIMEOUT_MS = 30000') &&
    source.includes('isMessageFetchInProgress') &&
    source.includes('fetch_started_at'),
  true,
  'MessageRead should let stuck message processing rows become clickable after 30 seconds'
);

assert.equal(
  source.includes('function shouldShowMessageFetchError') &&
    source.includes('row.fetch_requested_at') &&
    source.includes('row.fetch_started_at') &&
    source.includes('row.message_updated_at'),
  true,
  'MessageRead should only show fetch errors for rows with an actual fetch attempt'
);

{
  const messageTimeColumnIndex = source.indexOf("dataIndex: 'message_updated_at'");
  const failedStatusIndex = source.indexOf('shouldShowMessageFetchError(row)', messageTimeColumnIndex);
  const oldMessageTimeIndex = source.indexOf('value ? (', messageTimeColumnIndex);
  assert.equal(
    failedStatusIndex > messageTimeColumnIndex && failedStatusIndex < oldMessageTimeIndex,
    true,
    'MessageRead should show fetch failures before old successful message timestamps'
  );
  assert.equal(
    source.includes('旧记录'),
    false,
    'MessageRead should not offer old messages after a later fetch attempt fails'
  );
}
