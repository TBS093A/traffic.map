// Test dymny w prawdziwej przeglądarce na stronie z sieci testowej.  Uruchom: npm run e2e
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { buildFixture, serve, launch, open } from './browser.mjs';

let server, browser;
before(async () => { server = await serve(buildFixture()); browser = await launch(); });
after(async () => { await browser?.close(); server?.stop(); });

test('strona się ładuje bez błędów i rysuje mapę', async () => {
  const { page, errors, ctx } = await open(browser, server.url);
  await page.waitForTimeout(800);
  assert.match(await page.title(), /Rzeszów w pikselach/);
  assert.match(await page.$eval('#clock', e => e.textContent), /^\d\d:\d\d:\d\d$/);
  const painted = await page.evaluate(() => { const c = document.querySelector('#c'); return c.width > 0 && c.height > 0; });
  assert.ok(painted);
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('szukajka znajduje linię i przystanek', async () => {
  const { page, ctx } = await open(browser, server.url);
  await page.keyboard.press('/');
  await page.fill('#q', 'zach');
  await page.waitForSelector('#results [data-g]');
  assert.match(await page.$eval('#results', e => e.textContent), /Zachód/);
  await page.fill('#q', 'B');
  assert.ok(await page.$('#results [data-r]'));
  await ctx.close();
});

test('link do przystanku otwiera tablicę, adres nadąża za widokiem', async () => {
  const { page, ctx, errors } = await open(browser, server.url + '#s=Centrum');
  await page.waitForSelector('#sheet.show h2');
  assert.match(await page.$eval('#sheet h2', e => e.textContent), /Centrum/);
  assert.ok(await page.$('#sheet [data-act=share]'));
  await page.waitForFunction(() => /v=.*s=Centrum/.test(location.hash));
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('link z trasą wyznacza połączenie z przesiadką', async () => {
  const { page, ctx } = await open(browser, server.url + '#from=s:Zachód&to=s:Daleko&at=06:00');
  await page.waitForSelector('#sheet.show h2');
  assert.match(await page.$eval('#sheet h2', e => e.textContent), /Zachód → Daleko/);
  const legs = await page.$$eval('#sheet li.leg', l => l.length);
  assert.ok(legs >= 3, 'przejazd, przejście, przejazd');
  await ctx.close();
});

test('na żywo: prognoza, odwołany kurs i komunikat na tablicy przystanku', async () => {
  const { page, ctx, errors } = await open(browser, server.url + '#s=Zachód&time=06:55');
  await page.waitForSelector('#sheet.show h2');
  await page.evaluate(() => {
    const ids = S.trips.filter(t => t.route === 0 && t.start >= 7 * 3600).slice(0, 2).map(t => t.id);
    live.tu = tripUpdatesFrom([{ tripId: ids[0], delay: 240, stops: [] }, { tripId: ids[1], canceled: true, stops: [] }]);
    live.alerts = alertsFrom([{ id: 'x', header: 'Objazd ul. Testowej', description: 'Remont', routes: ['A'], stops: [], periods: [] }]);
    live.last = Date.now(); lastSheet = 0; renderSheet();
  });
  await page.waitForSelector('#sheet .alert');
  const txt = await page.$eval('#sheet', e => e.textContent);
  assert.match(txt, /Objazd ul\. Testowej/);
  assert.match(txt, /\+4′/);
  assert.match(txt, /odwołany/);
  await page.waitForSelector('#bAlerts:not([hidden])');
  assert.deepEqual(errors, []);
  await ctx.close();
});

test('PWA: manifest i service worker, strona działa offline', async () => {
  const { page, ctx } = await open(browser, server.url);
  const manifest = await page.evaluate(async () => (await fetch('manifest.webmanifest')).json());
  assert.equal(manifest.display, 'standalone');
  await page.evaluate(() => navigator.serviceWorker.ready);
  await page.reload({ waitUntil: 'domcontentloaded' });          // teraz kontrolowana przez service worker
  await page.waitForFunction(() => document.querySelector('#loading')?.style.display === 'none');
  await ctx.setOffline(true);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForFunction(() => document.querySelector('#loading')?.style.display === 'none', null, { timeout: 120000 });
  assert.equal(await page.$eval('#err', e => e.textContent), '');
  await ctx.close();
});

test('telefon: bez poziomego przewijania, lista przystanków działa', async () => {
  const { page, ctx, errors } = await open(browser, server.url, { width: 390, height: 844, mobile: true });
  assert.ok(await page.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth));
  await page.tap('#bStops');
  await page.waitForSelector('#stopsOv.show #stopList li[data-g]');
  assert.deepEqual(errors, []);
  await ctx.close();
});
