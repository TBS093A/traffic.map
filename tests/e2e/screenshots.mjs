// Odświeża screeny w docs/screenshots/ z prawdziwej strony (dist/index.html po pipeline.py).
// Każda scena to link do widoku (zob. src/js/links.js) z zatrzymanym zegarem, więc kadr jest powtarzalny.
//   node tests/e2e/screenshots.mjs [dist/index.html] [katalog_wyjściowy]
import path from 'node:path';
import { mkdirSync, writeFileSync } from 'node:fs';
import { ROOT, serve, launch, open } from './browser.mjs';

const page = path.resolve(process.argv[2] || path.join(ROOT, 'dist', 'index.html'));
const outDir = path.resolve(process.argv[3] || path.join(ROOT, 'docs', 'screenshots'));
const enc = encodeURIComponent;
// v = x, z (= -y), obrót 0–3, pół-wysokość kadru [m]; współrzędne w metrach od Rynku
const SCENES = [
  { name: 'centrum', hash: 'v=-40,20,0,330&time=12:30&speed=0' },
  { name: 'wislok', hash: 'v=1000,-200,0,850&time=13:00&speed=0' },
  { name: 'miasto-dzien', hash: 'v=300,0,0,5200&time=12:00&speed=0' },
  { name: 'millenium', hash: 'v=684,1125,0,200&time=14:00&speed=0' },
  { name: 'stadion', hash: 'v=-552,1744,0,330&time=14:00&speed=0' },
  { name: 'most', hash: 'v=589,337,1,170&time=13:00&speed=0' },
  { name: 'miasto-noc', hash: 'v=0,0,0,900&time=21:30&speed=0' },
  { name: 'linia', hash: 'l=17&time=08:00&speed=0' },
  { name: 'przystanek', hash: `s=${enc('Rejtana / Krzyżanowskiego')}&time=08:00&speed=0` },
  { name: 'lista-linii', hash: 'v=0,0,0,700&time=08:00&speed=0', run: async p => { await p.keyboard.press('l'); await p.waitForSelector('#linesOv.show'); } },
  { name: 'planer', hash: 'v=0,0,0,700&time=07:30&speed=0', run: async p => {
    await p.keyboard.press('p'); await p.waitForSelector('#planOv.show');
    for (const [f, q] of [['#pFrom', 'Lwowska 60'], ['#pTo', 'Krakowska 20']]) { await p.fill(f, q); await p.waitForSelector(`${f} + .sug [data-pi]`); await p.press(f, 'Enter'); }
    await p.waitForSelector('#pRes .opts li');
  } },
  { name: 'planer-trasa', hash: `from=${enc('s:Lwowska szpital')}&to=${enc('s:Krakowska / Wyzwolenia')}&at=07:30&time=07:30&speed=0` },
  { name: 'mobile', hash: 'v=-40,20,0,420&time=12:30&speed=0', mobile: true },
];

const only = process.env.SCENES ? process.env.SCENES.split(',') : null;
const server = await serve(page), browser = await launch(), done = [];
mkdirSync(outDir, { recursive: true });
try {
  for (const s of SCENES) {
    if (only && !only.includes(s.name)) continue;
    const { page: p, ctx, errors } = await open(browser, server.url + '#' + s.hash, s.mobile ? { width: 390, height: 844, mobile: true } : {});
    await p.addStyleTag({ content: '#hint{display:none}' });
    if (s.run) await s.run(p);
    await p.waitForTimeout(2500);                    // podpisy i autobusy na miejscu
    await p.screenshot({ path: path.join(outDir, s.name + '.png') });
    if (errors.length) console.warn(s.name + ': błędy w konsoli:', errors);
    done.push(s.name); console.log('✔', s.name);
    await ctx.close();
  }
} finally { await browser.close(); server.stop(); }
writeFileSync(path.join(outDir, 'README.txt'), `Screeny wygenerowane ${new Date().toISOString().slice(0, 10)} przez tests/e2e/screenshots.mjs (${done.length} scen).\n`);
