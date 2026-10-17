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
    shippingFeeText: '送料無料', taxType: 'tax_zero', productType: 'normal',
    imageUrl: image, images: [{ url: image }, { url: image }], descriptionText: '新品\n未塗装未組立のガレージキットです', endTime: '' };
  try {
    for (const width of [390, 1200]) {
      const page = await browser.newPage({ viewport: { width, height: 950 } });
      await page.addInitScript(() => {
        localStorage.setItem('token', 'mock-client-token'); localStorage.setItem('role', 'user'); localStorage.setItem('username', 'test');
      });
      const submitted = []; const detailRequests = [];
      await page.route('**/api/**', async route => {
        const request = route.request(); const target = new URL(request.url());
        let data = { success: true, data: [], total: 0 };
        if (target.pathname === '/api/proxy/search') data = { success: true, data: { items: [product, {
          ...product, auctionId: 'x1234567890', title: '普通拍卖商品', standardUrl: 'https://auctions.yahoo.co.jp/jp/auction/x1234567890', isFleamarket: false, buyoutOnly: false
        }], hasMore: false } };
        if (target.pathname === '/api/proxy/fetch') { detailRequests.push(target.searchParams.get('url')); data = { success: true, data: product }; }
        if (target.pathname.includes('website-rate')) data = { success: true, rate: 0.05 };
        if (target.pathname.includes('bid-config')) data = { success: true, data: { multiBidStartHours: 12, multiBidIntervalMinutes: 5, multiBidMinPrice: 5000 } };
        if (target.pathname === '/api/task/submit') { submitted.push(request.postDataJSON()); data = { success: true, task_id: 1 }; }
        await route.fulfill({ contentType: 'application/json', body: JSON.stringify(data) });
      });
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      const input = page.locator('input').first(); const fetch = page.getByRole('button', { name: '获取商品信息', exact: true });
      await input.fill('ワンフェス WF2026S Plastic Stick'); await fetch.click();
      const badges = page.locator('.product-search-result:visible img[src="/yahoo-assets/fleamarket-icon.svg"]');
      await badges.waitFor(); assert.equal(await badges.count(), 1);
      assert.equal(await badges.evaluate(img => img.complete && img.naturalWidth > 0), true);
      const flea = page.locator('.product-search-result').filter({ hasText: product.title });
      await flea.locator('.product-search-result-title').click();
      await page.getByText(product.descriptionText.split('\n')[1], { exact: false }).waitFor();
      assert.equal(detailRequests.at(-1), url);
      assert.equal(await badges.count(), 0);
      await page.screenshot({ path: `.test-artifacts/fleamarket-detail-${width}.png`, fullPage: true });
      await page.getByRole('button', { name: '← 返回', exact: true }).click();
      await page.screenshot({ path: `.test-artifacts/fleamarket-search-${width}.png`, fullPage: true });
      await flea.getByRole('button', { name: '入札', exact: true }).click();
      const blockedMessage = 'Yahoo!フリマ 暂时无法购买，请联系管理员！';
      await page.getByRole('alert').filter({ hasText: blockedMessage }).waitFor();
      await badges.waitFor({ state: 'hidden' });
      assert.equal(await badges.count(), 0);
      assert.equal(await page.getByRole('button', { name: '提交任务', exact: true }).count(), 0);
      assert.equal(await page.getByText('最高出价', { exact: true }).count(), 0);
      assert.equal(await page.getByText('出价策略', { exact: true }).count(), 0);
      assert.equal(submitted.length, 0);
      for (const value of [url, 'Z650804548']) {
        await input.fill(value);
        await Promise.all([page.waitForResponse(response => response.url().includes('/api/proxy/fetch')), fetch.click()]);
        await page.getByRole('alert').filter({ hasText: blockedMessage }).waitFor();
        assert.equal(detailRequests.at(-1), value);
        assert.equal(await page.getByRole('button', { name: '提交任务', exact: true }).count(), 0);
      }
      // Ordinary auction products still expose their original submission form.
      await page.route('**/api/proxy/fetch?**', route => route.fulfill({ contentType: 'application/json', body: JSON.stringify({
        success: true, data: { ...product, auctionId: 'x1234567890', standardUrl: 'https://auctions.yahoo.co.jp/jp/auction/x1234567890',
          title: '普通拍卖商品', isFleamarket: false, buyoutOnly: false }
      }) }));
      await input.fill('x1234567890'); await fetch.click();
      await page.getByRole('button', { name: '提交任务', exact: true }).waitFor();
      assert.equal(await page.getByRole('alert').filter({ hasText: blockedMessage }).count(), 0);
      assert.equal(submitted.length, 0);
      await page.screenshot({ path: `.test-artifacts/fleamarket-submit-${width}.png`, fullPage: true });
      console.log(`${width}px: search-only original logo, full detail URL, URL/uppercase ID input and purchase blocked; ordinary auction form retained`);
      await page.close();
    }
  } finally { await browser.close(); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
})().catch(error => { console.error(error); process.exitCode = 1; });
