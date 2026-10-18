const assert = require('node:assert/strict');
if (!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Use isolated regression runner');
const db = require('../models');
const router = require('./proxy');
const { productService } = router;
const handler = router.stack.find(layer=>layer.route?.path==='/fetch').route.stack[0].handle;
async function main() {
  const fetch=productService.fetchProduct;
  const calls=[];
  try {
    db.raw.prepare("INSERT INTO products(product_id,product_type) VALUES('z705858626','normal'),('a123456789','fleamarket')").run();
    productService.fetchProduct=async(url,options)=>{calls.push({url,options});return {success:true,data:{productType:options.recordedProductType}};};
    const read=async query=>{
      let output;
      await handler({query},{json(data){output=data;},status(code){throw new Error(`unexpected ${code}`);}});
      return output;
    };
    assert.equal((await read({url:'z705858626',resolveStoredType:'1',productType:'fleamarket'})).data.productType,'normal');
    assert.equal((await read({url:'a123456789',resolveStoredType:'1',productType:'normal'})).data.productType,'fleamarket');
    await read({url:'z705858626'});
    assert.equal(calls.at(-1).options.recordedProductType,undefined,'first raw input keeps existing fetch identification');
    await read({url:'z999999999',resolveStoredType:'1'});
    assert.equal(calls.at(-1).options.recordedProductType,undefined,'a legacy favorite not yet in products is fetched before any URL is guessed');
    console.log('Favorite/list detail requests prefer product-table type over stale local type; raw first fetch remains unchanged');
  } finally {productService.fetchProduct=fetch;db.raw.close();}
}
main().catch(error=>{console.error(error);process.exitCode=1;});
