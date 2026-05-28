import assert from 'assert/strict';
import { buildWonStatsCsv } from './wonStats.js';

function testBuildWonStatsCsvUsesRequestedColumnsAndEscapesValues() {
  const csv = buildWonStatsCsv([
    {
      product_id: 'a123456789',
      product_title: '标题,含逗号',
      final_price: 23100,
      shipping_fee_text: '送料 1,000円',
      won_time_text: '2026年5月28日 12時34分'
    }
  ]);

  assert.equal(
    csv,
    [
      '商品id,商品名称,落札价,运费,落札时间',
      'a123456789,"标题,含逗号",23100,"送料 1,000円",2026年5月28日 12時34分'
    ].join('\r\n')
  );
}

testBuildWonStatsCsvUsesRequestedColumnsAndEscapesValues();
