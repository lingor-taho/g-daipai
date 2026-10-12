const assert = require('assert/strict');
const {isAuctionEnded,auctionEndMs}=require('./auctionDeadline.cjs');
const now=Date.parse('2026-10-12T13:00:00+08:00');
for(const value of ['2026-10-12T12:59:59+08:00','2026-10-12T13:59:59+09:00','2026-10-12T04:59:59Z','2026-10-12 13:59:59']) assert(isAuctionEnded(value,now));
for(const value of ['2026-10-12T13:00:00+08:00','2026-10-12T13:00:01+08:00',null,'','invalid']) assert(!isAuctionEnded(value,now));
assert.equal(auctionEndMs('2026-10-12 14:00:00'),now);
console.log('Auction deadline strict boundary, explicit zones and Japan legacy clock tests passed');
