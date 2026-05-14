const assert = require('assert/strict');
const { buildSubmitTaskInput, buildTaskListInput } = require('./task');

function testSubmitUsesAuthenticatedUserId() {
  const input = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/x1234567890',
      max_price: 1200,
      strategy: 'direct'
    }
  );

  assert.equal(input.userId, 7);
  assert.equal(input.productId, 'x1234567890');
  assert.equal(input.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/x1234567890');
  assert.equal(input.maxPrice, 1200);
  assert.equal(input.bidMode, 'bid');
}

function testSubmitAcceptsBuyoutMode() {
  const input = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/x1234567890',
      max_price: 1200,
      bid_mode: 'buyout'
    }
  );

  assert.equal(input.bidMode, 'buyout');
}

function testSubmitAcceptsThirdPartyAndNumericAuctionUrls() {
  const thirdParty = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://www.fromjapan.co.jp/japan/cn/auction/yahoo/input/g1225234655/',
      max_price: 1200
    }
  );
  assert.equal(thirdParty.productId, 'g1225234655');
  assert.equal(thirdParty.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/g1225234655');

  const numeric = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/1229405242',
      max_price: 1200
    }
  );
  assert.equal(numeric.productId, '1229405242');
  assert.equal(numeric.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/1229405242');

  const paypay = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://paypayfleamarket.yahoo.co.jp/item/z562177666',
      max_price: 1200
    }
  );
  assert.equal(paypay.productId, 'z562177666');
  assert.equal(paypay.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/z562177666');

  const numericNine = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://example.com/item/562177666',
      max_price: 1200
    }
  );
  assert.equal(numericNine.productId, '562177666');
  assert.equal(numericNine.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/562177666');

  const letterEight = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://example.com/item/a12345678',
      max_price: 1200
    }
  );
  assert.equal(letterEight.productId, 'a12345678');
  assert.equal(letterEight.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/a12345678');

  const numericEight = buildSubmitTaskInput(
    { id: 7 },
    {
      product_url: 'https://example.com/item/12345678',
      max_price: 1200
    }
  );
  assert.equal(numericEight.productId, '12345678');
  assert.equal(numericEight.standardUrl, 'https://auctions.yahoo.co.jp/jp/auction/12345678');
}

function testSubmitRejectsMissingAuthenticatedUser() {
  assert.throws(
    () => buildSubmitTaskInput(null, {
      product_url: 'https://auctions.yahoo.co.jp/jp/auction/x1234567890',
      max_price: 1200
    }),
    /not logged in/
  );
}

function testTaskListUsesAuthenticatedUserId() {
  const input = buildTaskListInput({ id: 9 });
  assert.equal(input.userId, 9);
}

testSubmitUsesAuthenticatedUserId();
testSubmitAcceptsBuyoutMode();
testSubmitAcceptsThirdPartyAndNumericAuctionUrls();
testSubmitRejectsMissingAuthenticatedUser();
testTaskListUsesAuthenticatedUserId();
