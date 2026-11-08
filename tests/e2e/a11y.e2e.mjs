// Dostępność: obsługa z klawiatury i automatyczny audyt axe-core (bez naruszeń krytycznych i poważnych).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { buildFixture, serve, launch, open } from './browser.mjs';

const axePath = createRequire(import.meta.url).resolve('axe-core/axe.min.js');
let server, browser;
before(async () => { server = await serve(buildFixture()); browser = await launch(); });
after(async () => { await browser?.close(); server?.stop(); });

async function audit(page, scope) {
  await page.addScriptTag({ path: axePath });
  const r = await page.evaluate(sel => axe.run(sel || document, { resultTypes: ['violations'] }), scope);
  return r.violations.filter(v => v.impact === 'critical' || v.impact === 'serious').map(v => `${v.id}: ${v.nodes.length}× ${v.help}`);
}

test('z klawiatury: szukaj, wybierz przystanek, zamknij Escape', async () => {
  const { page, ctx } = await open(browser, server.url);
  await page.keyboard.press('/');
  await page.keyboard.type('zach');
  await page.waitForSelector('#results li[data-g][role=button]');
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.matches('#results [role=button]')), true);
  await page.keyboard.press('Enter');
  await page.waitForSelector('#sheet.show h2');
  assert.match(await page.$eval('#sheet h2', e => e.textContent), /Zachód/);
  await page.keyboard.press('l');
  await page.waitForSelector('#linesOv.show');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('#linesOv.show'));
  await ctx.close();
});

test('audyt axe: strona, tablica przystanku i planer', async () => {
  const { page, ctx } = await open(browser, server.url + '#s=Centrum');
  await page.waitForSelector('#sheet.show h2');
  assert.deepEqual(await audit(page), []);
  await page.keyboard.press('p');
  await page.waitForSelector('#planOv.show');
  assert.deepEqual(await audit(page, '#planOv'), []);
  await ctx.close();
});
