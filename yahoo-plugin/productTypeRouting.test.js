const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync(require.resolve('./background.js'),'utf8');
const types = source.slice(source.indexOf('function savedProductType('),source.indexOf('async function executeManualOrderImportJob('));
// Exercise the real dispatch gate; the ordinary auction executor is covered by
// background.test.js, and the P executor by fleamarketPurchase.test.js.
const start=source.indexOf('async function executeBidTask(');
const gate=source.slice(start,source.indexOf('  const reportStatus=',start))+'  return "ordinary";\n}';
async function main() {
  const calls=[];
  const context={async markTaskStatus(...args){calls.push(args);},async executeFleamarketPurchaseTask(){return 'P';}};
  vm.runInNewContext(types+gate+'\nthis.dispatch=executeBidTask;this.isP=isFleamarketManualImportItem;',context);
  for(const [type,id,expected] of [['normal','z705858626','ordinary'],['store','z705858626','ordinary'],['fleamarket','a123456789','P']]) {
    const task={id:1,product_id:id,product_type:type,product_url:'https://paypayfleamarket.yahoo.co.jp/item/z999999999',isFleamarket:true};
    assert.equal(await context.dispatch(task),expected);
    assert.equal(context.isP(task),type==='fleamarket');
  }
  assert.equal(await context.dispatch({id:2,product_id:'z705858626'}),undefined);
  assert.match(calls[0][2],/商品类型缺失/);
  assert.equal(context.isP({productId:'z705858626'}),false);
  assert.equal(context.isP({productId:'z705858626',productType:'normal'}),false);
  console.log('Task dispatch uses recorded type despite conflicting IDs, URLs and flags; missing type cannot execute');
}
main().catch(error=>{console.error(error);process.exitCode=1;});
