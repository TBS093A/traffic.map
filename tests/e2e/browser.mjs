// Wspólne dla testów e2e i screenów: budowa strony, serwer z proxy.mjs, przeglądarka.
import { spawn, spawnSync } from 'node:child_process';
import { mkdtempSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir, homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export function buildFixture() {
  const out = mkdtempSync(path.join(tmpdir(), 'rwp-e2e-'));
  const r = spawnSync('python3', [path.join(ROOT, 'tests', 'e2e', 'build_fixture.py'), out], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error('build_fixture.py: ' + r.stderr);
  return path.join(out, 'index.html');
}

// serwer proxy.mjs dla podanej strony; zwraca { url, stop }
export async function serve(page, port = 18000 + Math.floor(Math.random() * 2000)) {
  const p = spawn(process.execPath, [path.join(ROOT, 'proxy.mjs')], { env: { ...process.env, PAGE: page, PORT: String(port), FEED_URL: '' }, stdio: ['ignore', 'pipe', 'inherit'] });
  await new Promise((ok, fail) => { p.stdout.on('data', d => { if (String(d).includes('http://')) ok(); }); p.on('exit', c => fail(new Error('serwer zakończył się: ' + c))); });
  return { url: `http://localhost:${port}/`, stop: () => p.kill() };
}

// Chromium z Playwrighta; CHROME_PATH pozwala użyć innej binarki (np. z cache ~/.cache/ms-playwright)
function chromePath() {
  if (process.env.CHROME_PATH) return process.env.CHROME_PATH;
  try { if (existsSync(chromium.executablePath())) return undefined; } catch { /* brak wbudowanej */ }
  const base = path.join(homedir(), '.cache', 'ms-playwright');
  for (const d of existsSync(base) ? readdirSync(base).filter(d => d.startsWith('chromium-')).sort().reverse() : []) {
    for (const sub of readdirSync(path.join(base, d))) { const exe = path.join(base, d, sub, 'chrome'); if (existsSync(exe)) return exe; }
  }
  return undefined;
}
export async function launch() {
  // WebGL 2 bez GPU: programowy renderer SwiftShader
  return chromium.launch({ executablePath: chromePath(), args: ['--use-gl=angle', '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
}

// otwiera stronę i czeka, aż zniknie ekran ładowania; zbiera błędy konsoli
// store: wartości ustawień strony (localStorage, bez prefiksu rwp_) ustawione przed załadowaniem
export async function open(browser, url, { width = 1280, height = 800, mobile = false, timezoneId = 'Europe/Warsaw', store = null } = {}) {
  const ctx = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: mobile ? 2 : 1, isMobile: mobile, hasTouch: mobile, timezoneId, locale: 'pl-PL' });
  if (store) await ctx.addInitScript(s => { for (const [k, v] of Object.entries(s)) localStorage.setItem('rwp_' + k, JSON.stringify(v)); }, store);
  const page = await ctx.newPage(), errors = [];
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url, { waitUntil: 'domcontentloaded' });   // nie czekamy na czcionki z Google
  await page.waitForFunction(() => document.querySelector('#loading')?.style.display === 'none' || document.querySelector('#err')?.textContent, null, { timeout: 180000 });
  const err = await page.$eval('#err', e => e.textContent);
  if (err) throw new Error('strona zgłosiła błąd: ' + err);
  return { page, ctx, errors };
}
