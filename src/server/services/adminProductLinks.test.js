const assert = require('node:assert/strict');
const Database = require('better-sqlite3');
const { getProductItemUrl } = require('../../shared/adminProductUrl.cjs');
const { buildProductUrl } = require('../../admin/src/messageReadCsv');
const { buildOrdersCsv } = require('../../admin/src/ordersCsv');
const { addAdminAlertProductTypes, fetchAdminProduct } = require('./adminProductLinks');
const { createProductService } = require('../routes/proxy');
const fs = require('node:fs');
const path = require('node:path');
const { buildTrustedInputReportQueries, buildBidFailureReportQueries, buildAdminPendingTasksQuery, refreshProductShippingFee, refreshProductType } = require('../routes/admin');

async function main() {
  const raw = new Database(':memory:');
  try {
    raw.exec(`CREATE TABLE products(product_id TEXT PRIMARY KEY, product_type TEXT);
      INSERT INTO products VALUES ('z705858626','normal'),('a123456789','fleamarket'),('s123456789','store'),('z123456789',NULL);
      CREATE TABLE plugin_diagnostics(id INTEGER, type TEXT, level TEXT, product_id TEXT, order_id INTEGER,
        action TEXT, method TEXT, message TEXT, diagnostics TEXT, url TEXT, created_at TEXT);
      INSERT INTO plugin_diagnostics VALUES (1,'trusted_input','info','z705858626',NULL,'click','test','','','','2026-10-17');
      INSERT INTO plugin_diagnostics VALUES (2,'bid_failure','error','a123456789',NULL,'fail','test','','','','2026-10-17');`);
    const db = { async getAll(sql, params = []) { return raw.prepare(sql).all(...params); },
      async getOne(sql, params = []) { return raw.prepare(sql).get(...params); } };
    raw.exec(`ALTER TABLE products ADD COLUMN product_title TEXT;
      ALTER TABLE products ADD COLUMN end_time TEXT;
      CREATE TABLE tasks(id INTEGER, account_id INTEGER, execution_unknown INTEGER, product_id TEXT,
        bid_mode TEXT, user_max_price INTEGER, max_price INTEGER, strategy TEXT, start_minutes_before INTEGER,
        start_seconds_before INTEGER, status TEXT, last_bid_at TEXT, created_at TEXT);
      CREATE TABLE bid_logs(task_id INTEGER, bid_price INTEGER, result TEXT);
      INSERT INTO tasks(id,product_id,status,strategy) VALUES (1,'z705858626','pending','direct');`);
    const pendingQuery=buildAdminPendingTasksQuery();
    const pending=await db.getAll(pendingQuery.sql,pendingQuery.params);
    assert.equal(pending[0].product_type,'normal','next task must carry saved type, despite Z ID');
    for (const [id,type,expected] of [
      ['z705858626','normal','https://auctions.yahoo.co.jp/jp/auction/z705858626'],
      ['a123456789','fleamarket','https://paypayfleamarket.yahoo.co.jp/item/a123456789'],
      ['s123456789','store','https://auctions.yahoo.co.jp/jp/auction/s123456789']
    ]) {
      const row = {product_id:id,product_type:type,product_url:'https://paypayfleamarket.yahoo.co.jp/item/z999999999',final_price:300};
      assert.equal(getProductItemUrl(row), expected);
      assert.equal(buildProductUrl(row), expected);
      assert.ok(buildOrdersCsv([row]).includes(expected));
    }
    for (const type of [undefined,null,'','invalid']) {
      const row={product_id:'z705858626',product_type:type,product_url:'https://paypayfleamarket.yahoo.co.jp/item/z705858626'};
      assert.equal(getProductItemUrl(row),'');
      assert.equal(buildProductUrl(row),'');
    }
    assert.equal(getProductItemUrl({product_id:'z705858626',product_type:'normal',link_product_type:null}), '');
    for (const build of [buildTrustedInputReportQueries,buildBidFailureReportQueries]) {
      const query=build({}).rows;
      const rows=await db.getAll(query.sql,query.params);
      assert.equal(rows.length,1);
      assert.equal(rows[0].product_type,build===buildTrustedInputReportQueries?'normal':'fleamarket');
    }
    for (const [id,expected] of [['z705858626','https://auctions.yahoo.co.jp/jp/auction/z705858626'],
      ['a123456789','https://paypayfleamarket.yahoo.co.jp/item/a123456789']]) {
      const normalData={props:{pageProps:{initialState:{item:{detail:{item:{title:'Saved normal type',price:300}}}}}}};
      const html=id.startsWith('z') ? `<script id="__NEXT_DATA__">${JSON.stringify(normalData)}</script>` :
        fs.readFileSync(path.join(__dirname,'../routes/fixtures/fleamarket-product.html'),'utf8').replaceAll('z650804548',id);
      let fetchedUrl;
      const service=createProductService({httpFetcher:async url=>{fetchedUrl=url;return html;},
        playwrightFetcher:async()=>{throw new Error('unexpected browser fetch');}});
      const result=await fetchAdminProduct(db,service,id);
      assert.equal(fetchedUrl,expected,'real product service must not reconstruct domain from Z ID');
      assert.equal(result.url,expected);
      assert.equal(result.product.data.productType,id.startsWith('z')?'normal':'fleamarket');
      assert.equal(result.product.data.standardUrl,expected);
    }
    const flags={paymentAlertMessage:'z705858626 / a123456789',
      googleSheetAlerts:[{productId:'z705858626',product_type:'fleamarket'}],
      shipmentAlerts:[{productId:'a123456789'}],auctionHistoryAlerts:[{items:[{productId:'s123456789'}]}]};
    const enriched=await addAdminAlertProductTypes(db,flags);
    assert.equal(enriched.productTypes.z705858626,'normal');
    assert.equal(enriched.googleSheetAlerts[0].product_type,'normal');
    assert.equal(enriched.shipmentAlerts[0].product_type,'fleamarket');
    assert.equal(enriched.auctionHistoryAlerts[0].items[0].product_type,'store');
    assert.equal(flags.googleSheetAlerts[0].product_type,'fleamarket','stored alert must not be rewritten');
    for (const refresh of [refreshProductShippingFee,refreshProductType]) {
      const result=await refresh({async getOne(sql){return /COUNT/.test(sql)?{count:1}:null;}},
        {async fetchProduct(){throw new Error('missing type must not fetch');}},'z705858626');
      assert.equal(result.success,false);
      assert.match(result.error,/商品类型缺失/);
    }
    console.log('Admin-only type authority, conflicting IDs/URLs, missing types, CSVs, report SQL and alert enrichment passed');
  } finally { raw.close(); }
}
main().catch(error=>{console.error(error);process.exitCode=1;});
