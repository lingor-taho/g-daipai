const assert=require('assert/strict');
if(!process.env.DATABASE_URL?.includes('gdaipai-regression-')) throw new Error('Use isolated regression runner');
const db=require('../models');
const {submitAuctionTask}=require('./task');
const {createProductService,productService}=require('./proxy');
(async()=>{
  db.raw.prepare("INSERT INTO users(id,username,password_hash,role) VALUES(9101,'deadline-user','test','user')").run();
  const context={user:{id:9101,role:'user'},actingUser:{id:9101,role:'user',bid_strategy_scope:'all'}};
  const base={product_url:'n1247281943',max_price:24000,strategy:'direct',product_title:'ended product',product_image_url:'https://example.com/image.jpg',current_price:20000,tax_type:'tax_zero',product_type:'normal',shipping_fee_text:'580円'};
  const before=db.raw.serialize();
  await assert.rejects(submitAuctionTask(context,{...base,end_time:'2026-01-01T10:00:00+09:00'},{database:db}),/商品已结束/);
  assert.deepEqual(db.raw.serialize(),before,'Ended submission must not reserve an account, create a task or change product data');
  await assert.rejects(submitAuctionTask(context,{product_url:'k1247037995',max_price:20500,strategy:'direct'},{database:db,fetchProduct:async()=>({data:{title:'ended fetched',imageUrl:'https://example.com/image.jpg',currentPrice:20000,endTime:'2026-01-01T10:00:00+09:00',taxType:'tax_zero',productType:'normal',shippingFeeText:'落札者負担'}})}),/商品已结束/);
  assert.deepEqual(db.raw.serialize(),before);
  await assert.rejects(submitAuctionTask(context,{product_url:'k1247037995',max_price:20500,strategy:'direct',end_time:'2099-01-01T10:00:00+09:00'},{database:db,fetchProduct:async()=>({data:{title:'ended fetched',imageUrl:'https://example.com/image.jpg',currentPrice:20000,endTime:'2026-01-01T10:00:00+09:00',taxType:'tax_zero',productType:'normal',shippingFeeText:'落札者負担'}})}),/商品已结束/);
  assert.deepEqual(db.raw.serialize(),before,'Fresh ended page must take precedence over an old future timestamp');

  const invalidId = '253585279';
  const invalidProduct = createProductService({
    httpFetcher: async () => '<title>日本最大級のネットオークション・フリマアプリ</title><main>指定されたページは存在しません</main>'
  });
  for (const body of [
    {product_url:invalidId,max_price:9000,current_price:0,product_title:'日本最大級のネットオークション・フリマアプリ'},
    {...base,product_url:invalidId,end_time:'2099-01-01T10:00:00+09:00'}
  ]) {
    await assert.rejects(submitAuctionTask(context,body,{database:db,fetchProduct:invalidProduct.fetchProduct}),{
      statusCode:404,message:/商品不存在或已删除/
    });
  }
  const timeout=Object.assign(new Error('服务器网络问题，请稍后重试！'),{statusCode:502});
  await assert.rejects(submitAuctionTask(context,{product_url:invalidId,max_price:9000},{
    database:db,fetchProduct:async()=>{throw timeout;}
  }),{statusCode:502});
  assert.deepEqual(db.raw.serialize(),before,'Invalid and unavailable products must not make any database writes');

  const account=db.raw.prepare('SELECT id FROM yahoo_accounts WHERE is_primary=1').get();
  db.raw.prepare("UPDATE yahoo_accounts SET heartbeat_at=?,instance_id='deadline-test-instance',enabled=1 WHERE id=?").run(Date.now(),account.id);
  const endTime='2099-01-01T10:00:00+09:00';
  productService.cacheProduct({auctionId:base.product_url,title:base.product_title,productType:'normal',currentPrice:20000,endTime});
  const submitted=await submitAuctionTask(context,{...base,end_time:endTime},{database:db,fetchProduct:async()=>{throw new Error('Verified snapshot must not refetch');}});
  const task=db.raw.prepare('SELECT max_price,strategy,status FROM tasks WHERE id=?').get(submitted.task_id);
  assert.deepEqual(task,{max_price:24000,strategy:'direct',status:'pending'});
  db.raw.close();console.log('Expired task submit rejects before writes; fetched deadline and normal price/strategy preserved');
})().catch(e=>{console.error(e);process.exitCode=1;});
