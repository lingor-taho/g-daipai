const assert = require('assert/strict');
const express = require('express');
const path = require('path');
const fs = require('fs');
const { chromium } = require('playwright');

(async () => {
  const app = express();
  const dist = path.resolve('src/client/dist');
  app.use(express.static(dist));
  app.get('*', (req, res) => res.sendFile(path.join(dist, 'index.html')));
  const server = await new Promise(resolve => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const browser = await chromium.launch({ headless: true, channel: 'chrome' });
  fs.mkdirSync('.test-artifacts', { recursive: true });
  const url = 'https://paypayfleamarket.yahoo.co.jp/item/z650804548';
  const image = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="lightblue"/></svg>';
  const product = { auctionId: 'z650804548', standardUrl: url, title: 'ワンフェス WF2026S Plastic Stick 影輝鋼衣龍王丸',
    currentPrice: 29700, buyoutPrice: 29700, buyoutOnly: true, isFleamarket: true,
    shippingFeeText: '送料無料', taxType: 'tax_zero', productType: 'fleamarket',
    imageUrl: image, images: [{ url: image }, { url: image }], descriptionText: '新品\n未塗装未組立のガレージキットです', endTime: '',auctionStatus:'open' };
  const normalProduct = { ...product, auctionId: 'x1234567890', standardUrl: 'https://auctions.yahoo.co.jp/jp/auction/x1234567890', title: '普通拍卖商品', productType: 'normal', isFleamarket: false, buyoutOnly: false, bidCount: 9, endTime: '2099-01-01T00:00:00+09:00' };
  const storeProduct = { ...normalProduct, auctionId: 'a1234567890', standardUrl: 'https://auctions.yahoo.co.jp/jp/auction/a1234567890', title: '商城拍卖商品', productType: 'store', taxType: 'tax_included' };
  const usedProduct = {...product, auctionId:'z705858626',standardUrl:'https://paypayfleamarket.yahoo.co.jp/item/z705858626',
    title:'ボストン型 伊達メガネ べっ甲柄 ブルーライトカット 度なし',currentPrice:300,buyoutPrice:300,
    conditionName:'やや傷や汚れあり',auctionStatus:'ended'};
  try {
    for (const width of [390, 1200]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      await page.addInitScript(() => {
        localStorage.setItem('token', 'mock-client-token'); localStorage.setItem('role', 'user'); localStorage.setItem('username', 'test');
        // Existing favorites contain only ID and display fields, with no URL or type.
        localStorage.setItem('productFavorites:v1:test', JSON.stringify([
          { auctionId: 'Z650804548', title: '旧收藏フリマ商品', imageUrl: '', endTime: '' },
          { auctionId: 'x1234567890', title: '旧收藏普通商品', imageUrl: '', endTime: '' }
        ]));
      });
      const submitted = []; const detailRequests = []; const batchRequests = [];
      await page.route('**/api/**', async route => {
        const request = route.request(); const target = new URL(request.url());
        let data = { success: true, data: [], total: 0 };
        if (target.pathname === '/api/proxy/search') data = { success: true, data: { items: [product, normalProduct, storeProduct], hasMore: false } };
        if (target.pathname === '/api/proxy/search' && target.searchParams.get('keyword').startsWith('single-')) {
          const selected = { 'single-normal': normalProduct, 'single-store': { ...storeProduct, standardUrl: undefined },
            'single-flea': { ...product, standardUrl: 'https://auctions.yahoo.co.jp/jp/auction/z650804548' } }[target.searchParams.get('keyword')];
          data = { success: true, data: { items: [selected], hasMore: false } };
        }
        if (target.pathname === '/api/proxy/fetch') {
          const input = target.searchParams.get('url'); detailRequests.push(input);
          const detail = [normalProduct, storeProduct, usedProduct].find(item => input.includes(item.auctionId)) || product;
          data = { success: true, data: detail };
        }
        if (target.pathname === '/api/task/batch-submit') {
          batchRequests.push(request.postDataJSON()); data = { success: true, count: request.postDataJSON().text.trim().split('\n').length, batch_id: batchRequests.length };
        }
        if (target.pathname === '/api/task/bidding') data = { success: true, total: 2,
          data: [normalProduct, storeProduct].map((item,index)=>({id:index+10,product_id:item.auctionId,
            product_title:item.title,product_type:item.productType,product_image_url:image,
            status:'bidding',strategy:'direct',current_price:29150,max_price:index ? 12345678 : 41000,user_max_price:index ? 12345678 : 41000,
            bidding_status:'highest',is_highest_bidder:1,end_time:'2099-01-01T00:00:00+09:00'})) };
        if (target.pathname === '/api/task/won') data = { success: true, total: 3,
          data: [product, normalProduct, storeProduct].map((item, index) => ({ id: index + 1, order_id: index + 1,
            product_id: item.auctionId, product_title: item.title, product_type: item.productType,
            product_url: item.productType === 'fleamarket' ? 'https://auctions.yahoo.co.jp/jp/auction/z650804548' : item.standardUrl, product_image_url: image, tax_type: item.taxType,
            final_price: item.buyoutPrice, won_time_text: '10/17 12:00', order_status: 'pending_shipment', strategy: 'direct',
            has_auction_history: 1, bid_history: [{ task_id: 1, amount: 30000, submitted_at: '2026-10-17T00:00:00Z' }] })) };
        if (target.pathname.includes('website-rate')) data = { success: true, rate: 0.05 };
        if (target.pathname.includes('bid-config')) data = { success: true, data: { multiBidStartHours: 12, multiBidIntervalMinutes: 5, multiBidMinPrice: 5000 } };
        if (target.pathname === '/api/task/submit') { submitted.push(request.postDataJSON()); data = { success: true, task_id: 1 }; }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const input = page.locator('input').first(); const fetch = page.getByRole('button', { name: '获取商品信息', exact: true });
      await input.fill(usedProduct.standardUrl);
      await fetch.click();
      await page.locator('[data-auction-ended]').waitFor();
      assert.equal(await page.getByRole('button',{name:'提交任务',exact:true}).count(),0);
      assert.equal(await page.getByText('最高出价',{exact:true}).count(),0);
      assert.equal(await page.getByText('出价策略',{exact:true}).count(),0);
      const endedBadge=await page.locator('[data-auction-ended]').boundingBox();
      const endedImage=await page.getByRole('button',{name:'查看商品详情：'+usedProduct.title,exact:true}).boundingBox();
      assert.equal(endedBadge.x,endedImage.x);assert.equal(endedBadge.y,endedImage.y);
      await page.screenshot({path:`.test-artifacts/fleamarket-ended-${width}.png`,fullPage:true});

      await page.getByRole('button',{name:usedProduct.title,exact:true}).click();
      await page.getByText(usedProduct.conditionName,{exact:true}).waitFor();
      assert.equal(await page.getByText('商品状态',{exact:true}).count(),1);
      await page.screenshot({path:`.test-artifacts/fleamarket-used-condition-${width}.png`,fullPage:true});
      await page.getByRole('button',{name:'关闭',exact:true}).first().click();
      for (const [keyword, expectedUrl, title] of [
        ['single-normal', normalProduct.standardUrl, normalProduct.title],
        ['single-store', storeProduct.standardUrl, storeProduct.title],
        ['single-flea', url, product.title]
      ]) {
        await input.fill(keyword);
        await Promise.all([page.waitForResponse(response => response.url().includes('/api/proxy/fetch')), fetch.click()]);
        await page.getByRole('button', { name: title, exact: true }).waitFor();
        assert.equal(await input.inputValue(), expectedUrl, 'single-result search fills the complete product URL');
        assert.equal(detailRequests.at(-1), expectedUrl, 'detail fetch uses the same complete URL');
      }
      await page.evaluate(()=>{
        localStorage.setItem('productFavorites:v1:test',JSON.stringify([
          {auctionId:'Z650804548',title:'旧收藏フリマ商品'},
          {auctionId:'x1234567890',title:'旧收藏普通商品'}
        ]));
        window.dispatchEvent(new Event('storage'));
      });
      for (const [title, expectedUrl] of [['旧收藏フリマ商品', url], ['旧收藏普通商品', normalProduct.standardUrl]]) {
        await page.getByRole('button', { name: '打开商品收藏', exact: true }).click();
        await Promise.all([
          page.waitForResponse(response => response.url().includes('/api/proxy/fetch') && new URL(response.url()).searchParams.get('url')===expectedUrl),
          page.locator('.product-search-result-title').filter({ hasText: title }).click()
        ]);
        assert.equal(await input.inputValue(), expectedUrl);
        assert.equal(detailRequests.at(-1), expectedUrl);
        await page.locator('.adm-popup').filter({has:page.getByText('商品收藏',{exact:true})}).waitFor({state:'hidden'});
        if (expectedUrl === url) {
          await page.getByRole('button', { name: '提交任务', exact: true }).waitFor();
          assert.equal(await page.locator('input[type=checkbox]').isChecked(), true);
          assert.equal(await page.locator('input[type=checkbox]').isDisabled(), true);
        } else {
          await page.getByRole('button', { name: '提交任务', exact: true }).waitFor();
        }
      }
      assert.equal(await page.evaluate(() => JSON.parse(localStorage.getItem('productFavorites:v1:test')).length), 2);
      const savedFavorites=await page.evaluate(()=>JSON.parse(localStorage.getItem('productFavorites:v1:test')));
      assert.equal(savedFavorites.find(row=>row.auctionId==='z650804548').productType,'fleamarket');
      assert.equal(savedFavorites.find(row=>row.auctionId==='x1234567890').productType,'normal');
      assert.equal(submitted.length, 0);
      await input.fill('ワンフェス WF2026S Plastic Stick'); await fetch.click();
      const searchPopup=page.locator('.adm-popup').filter({has:page.getByText('商品搜索结果',{exact:true})});
      const badges = searchPopup.locator('.product-search-result:visible img[src="/yahoo-assets/fleamarket-icon.svg"]');
      await badges.waitFor(); assert.equal(await badges.count(), 1);
      assert.equal(await badges.evaluate(img => img.complete && img.naturalWidth > 0), true);
      for (const [item, tag] of [[normalProduct, '普'], [storeProduct, '商']]) {
        const card = searchPopup.locator('.product-search-result').filter({ hasText: item.title });
        assert.equal(await card.locator('[data-product-type]').textContent(), item.productType === 'store' ? '商城商品' : '普通商品');
        await card.locator('.product-search-result-title').click();
        await page.locator('.product-search-detail-title [data-product-type=' + item.productType + ']').waitFor();
        assert.equal(await page.locator('.product-search-detail-title [data-product-type]').textContent(), tag);
        assert.equal(await page.getByText('拍卖次数', { exact: true }).count(), 1);
        assert.equal(await page.getByText('截止时间', { exact: true }).count(), 1);
        assert.equal(await page.getByRole('button', { name: '去竞拍', exact: true }).count(), 1);
        await page.getByRole('button', { name: '← 返回', exact: true }).click();
      }
      const flea = searchPopup.locator('.product-search-result').filter({ hasText: product.title });
      await flea.locator('.product-search-result-title').click();
      await page.getByText(product.descriptionText.split('\n')[1], { exact: false }).waitFor();
      assert.equal(detailRequests.at(-1), url);
      assert.equal(await page.locator('.product-search-detail-title [data-product-type=fleamarket]').textContent(), 'P');
      assert.equal(await page.getByRole('button', { name: '去購入', exact: true }).count(), 1);
      assert.equal(await page.getByText('拍卖次数', { exact: true }).count(), 0);
      assert.equal(await page.getByText('截止时间', { exact: true }).count(), 0);
      assert.equal(await badges.count(), 0);
      await page.screenshot({ path: `.test-artifacts/fleamarket-detail-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: '去購入', exact: true }).click();
      await page.getByRole('button', { name: '提交任务', exact: true }).waitFor();
      assert.equal(submitted.length, 0);
      await input.fill('ワンフェス WF2026S Plastic Stick'); await fetch.click();
      await badges.waitFor();
      await page.waitForTimeout(400);
      await page.screenshot({ path: `.test-artifacts/fleamarket-search-${width}.png`, fullPage: true });
      await flea.getByRole('button', { name: '購入', exact: true }).click();
      const oldBlockedMessage = 'Yahoo!フリマ 暂时无法购买，请联系管理员！';
      await page.getByRole('button', { name: '提交任务', exact: true }).waitFor();
      await badges.waitFor({ state: 'hidden' });
      assert.equal(await page.getByText(oldBlockedMessage, { exact: true }).count(), 0);
      assert.equal(await page.locator('input[type=checkbox]').isChecked(), true);
      assert.equal(await page.locator('input[type=checkbox]').isDisabled(), true);
      assert.equal(await page.getByText('フリマ 商品', { exact: true }).count(), 1);
      assert.equal(await page.getByText(/拍卖次数：/).count(), 0);
      assert.equal(await page.getByRole('button', { name: product.title, exact: true }).locator('[data-product-type]').count(), 0);
      for (const value of [url, 'Z650804548']) {
        await input.fill(value);
        await Promise.all([page.waitForResponse(response => response.url().includes('/api/proxy/fetch')), fetch.click()]);
        await page.getByRole('button', { name: '提交任务', exact: true }).waitFor();
        assert.equal(detailRequests.at(-1), value);
        assert.equal(await page.locator('input[type=checkbox]').isDisabled(), true);
      }
      await page.screenshot({ path: `.test-artifacts/fleamarket-buyout-${width}.png`, fullPage: true });
      await Promise.all([
        page.waitForResponse(response => response.url().includes('/api/task/submit')),
        page.getByRole('button', { name: '提交任务', exact: true }).click()
      ]);
      assert.equal(submitted.length, 1);
      assert.equal(submitted[0].product_url, url);
      assert.equal(submitted[0].bid_mode, 'buyout'); assert.equal(submitted[0].strategy, 'direct');
      assert.equal(submitted[0].max_price, 29700); assert.equal(submitted[0].product_type, 'fleamarket');
      await page.waitForFunction(() => document.querySelector('input')?.value === '');
      // Ordinary auction products still expose their original submission form.
      await input.fill('x1234567890'); await fetch.click();
      await page.getByRole('button', { name: '提交任务', exact: true }).waitFor();
      assert.equal(await page.getByText(oldBlockedMessage, { exact: true }).count(), 0);
      assert.equal(await page.getByRole('button', { name: normalProduct.title, exact: true }).locator('[data-product-type]').count(), 0);
      assert.equal(await page.getByText(/拍卖次数：/).count(), 1);
      assert.equal(submitted.length, 1);
      await page.screenshot({ path: `.test-artifacts/fleamarket-submit-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: '批量添加', exact: true }).click();
      const batchNotice=page.getByText('フリマ商品将跳过，其他商品照常提交。',{exact:true});
      const noticeLayout=await batchNotice.evaluate(el=>({bottom:el.getBoundingClientRect().bottom,
        labelTop:document.querySelector('label[for="batch-bid-input"]').getBoundingClientRect().top,
        color:getComputedStyle(el).color,nextIsLabel:el.nextElementSibling?.matches('label[for="batch-bid-input"]')}));
      assert.ok(noticeLayout.bottom<=noticeLayout.labelTop && noticeLayout.nextIsLabel,'red notice is directly before the input label');
      assert.equal(noticeLayout.color,'rgb(220, 38, 38)');
      await page.screenshot({path:`.test-artifacts/fleamarket-batch-notice-${width}.png`,fullPage:true,animations:'disabled'});
      await page.locator('textarea').fill('z650804548 29700\nx1234567890 2000\na1234567890 3000');
      await page.getByRole('button', { name: '提交批量任务', exact: true }).click();
      await page.getByText('不支持フリマ商品！已跳过 1 件，其他商品照常处理', { exact: true }).waitFor();
      assert.equal(batchRequests.length, 1);
      assert.ok(batchRequests[0].text.includes('x1234567890 2000'));
      assert.equal(submitted.length, 1);
      await page.getByRole('button', { name: '批量添加', exact: true }).click();
      await page.locator('textarea').fill('z650804548 29700');
      await page.getByRole('button', { name: '提交批量任务', exact: true }).click();
      await page.getByText('不支持フリマ商品！已跳过本批全部商品', { exact: true }).waitFor();
      assert.equal(batchRequests.length, 2);
      assert.equal(submitted.length, 1);
      await page.getByRole('link', { name: '成交商品', exact: true }).click();
      await page.getByText('成交商品', { exact: true }).last().waitFor();
      for (const [item, prefix] of [[product, '购入'], [normalProduct, '落札'], [storeProduct, '落札']]) {
        const row = page.locator('.adm-list-item').filter({ hasText: item.title });
        await row.getByText(prefix + '成功', { exact: true }).waitFor();
        assert.ok((await row.textContent()).includes(prefix + '价：'));
        assert.ok((await row.textContent()).includes(prefix + '时间：'));
        assert.equal(await row.getByRole('button', { name: '添加商品备注', exact: true }).count(), 1);
        const flea = item.productType === 'fleamarket';
        assert.equal(await row.getByRole('button', { name: '订单未暂停', exact: true }).count(), flea ? 0 : 1);
        assert.equal(await row.getByRole('button', { name: '查看拍卖记录图表', exact: true }).count(), flea ? 0 : 1);
        assert.equal(await row.getByRole('group', { name: '历史提交最高价对比', exact: true }).count(), flea ? 0 : 1);
        if (flea) {
          assert.equal(await row.locator('a[href="https://paypayfleamarket.yahoo.co.jp/item/z650804548"]').count(), 1);
          assert.equal((await row.textContent()).includes('落札'), false);
          assert.equal((await row.textContent()).includes('成交'), false);
        }
      }
      await page.screenshot({ path: `.test-artifacts/fleamarket-won-${width}.png`, fullPage: true });
      const fleaRow = page.locator('.adm-list-item').filter({ hasText: product.title });
      await fleaRow.getByRole('button', { name: '添加商品备注', exact: true }).click();
      const remark = page.getByRole('dialog', { name: '商品备注：' + product.auctionId, exact: true });
      await remark.waitFor(); await remark.getByRole('button', { name: '关闭', exact: true }).click();
      await page.getByRole('link', { name: '入札中', exact: true }).click();
      await page.getByRole('button', { name: '再入札', exact: true }).first().waitFor();
      for (const item of [normalProduct,storeProduct]) {
        const row=page.locator('.adm-list-item').filter({hasText:item.title});
        const thumbnail=await row.locator('img').boundingBox();
        const button=await row.getByRole('button',{name:'再入札',exact:true}).boundingBox();
        const price=await row.locator('[aria-label^="最高出价："]').boundingBox();
        assert.ok(Math.abs(thumbnail.x+thumbnail.width-button.x-button.width)<1, `rebid right edge equals thumbnail right edge ${JSON.stringify({thumbnail,button,price})}`);
        assert.ok(button.y>=price.y+price.height,'rebid sits below price');
      }
      await page.screenshot({path:`.test-artifacts/rebid-right-aligned-${width}.png`,fullPage:true});
      console.log(`${width}px: existing fleamarket/ordinary favorites use correct URLs; three product types, detail tags and labels passed; fleamarket single buyout, batch skip feedback, deal labels/flag-only/no-chart and ordinary auction display passed`);
      await page.close();
    }
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
