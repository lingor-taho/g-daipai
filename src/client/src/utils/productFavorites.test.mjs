import assert from 'node:assert/strict';
import { favoritesKey, favoriteSnapshot, readFavorites, toggleFavorite, refreshFavorite, remainingFavoriteDays } from './productFavorites.js';

const data = new Map([['username', 'alice']]);
const storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
const key = favoritesKey(storage);
const now = Date.parse('2026-09-05T00:00:00Z');
const item = { auctionId: 'Q1242982152', title: 'Test', endTimeEpoch: (now + 1800000) / 1000, currentPrice: 1200 };
assert.equal(toggleFavorite(storage, key, item).added, true);
assert.equal(readFavorites(storage, key).length, 1);
assert.equal(readFavorites(storage, key)[0].auctionId, 'q1242982152');
assert.equal('currentPrice' in readFavorites(storage, key)[0], false);
assert.equal(remainingFavoriteDays(favoriteSnapshot(item).endTime, now), 1);
assert.equal(remainingFavoriteDays(new Date(now + 24.1 * 3600000).toISOString(), now), 2);
assert.equal(remainingFavoriteDays(new Date(now).toISOString(), now), 0);
assert.equal(remainingFavoriteDays(new Date(now - 1).toISOString(), now), 0);
assert.equal(remainingFavoriteDays('', now), null);
data.set('actingUsername', 'bob');
assert.equal(readFavorites(storage, favoritesKey(storage)).length, 0);
data.set('actingUsername', 'alice');
assert.equal(favoritesKey(storage), key);
assert.equal(toggleFavorite(storage, key, item).added, false);
assert.equal(readFavorites(storage, key).length, 0);
data.set(key, 'broken');
assert.deepEqual(readFavorites(storage, key), []);
assert.equal(toggleFavorite(storage, key, item).added, true);
assert.throws(() => toggleFavorite({ ...storage, setItem() { throw new Error('quota'); } }, key, item), /quota/);
assert.equal(readFavorites(storage, key).length, 1);
assert.equal(favoriteSnapshot({ auctionId: '../wrong' }), null);
for (const [id,productType,expected] of [
  ['Z705858626','normal','https://auctions.yahoo.co.jp/jp/auction/z705858626'],
  ['a123456789','fleamarket','https://paypayfleamarket.yahoo.co.jp/item/a123456789']
]) {
  const saved = favoriteSnapshot({auctionId:id,productType,standardUrl:'https://example.com/stale'});
  assert.equal(saved.productType,productType);
  assert.equal(saved.standardUrl,expected,'favorite URL must use saved type, not ID or old URL');
  toggleFavorite(storage,key,saved);
  assert.equal(readFavorites(storage,key).find(row=>row.auctionId===id.toLowerCase()).standardUrl,expected);
}
const legacy={auctionId:'z999999999',title:'old favorite'};
data.set(key,JSON.stringify([legacy]));
assert.equal(readFavorites(storage,key)[0].productType,'');
assert.equal(readFavorites(storage,key)[0].standardUrl,'','old favorites must not guess a domain');
refreshFavorite(storage,key,{...legacy,productType:'normal',title:'refreshed'});
assert.equal(readFavorites(storage,key)[0].standardUrl,'https://auctions.yahoo.co.jp/jp/auction/z999999999');
refreshFavorite(storage,key,{auctionId:'a123456789',productType:'fleamarket'});
assert.equal(readFavorites(storage,key).length,1,'detail refresh must not add a new favorite');
console.log('productFavorites tests passed');
