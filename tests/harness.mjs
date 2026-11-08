// Wczytuje logikę strony (bez WebGL i DOM) do izolowanego kontekstu, żeby testować ją w Node.
// Moduły są sklejane w tej samej kolejności co w src/index.html, więc działają tak jak w przeglądarce.
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
export const ROOT = path.dirname(HERE);
const LOGIC = ['util', 'data', 'time', 'stops', 'geocode', 'planner', 'timetable', 'links', 'frequency'];
const EXPORTS = ['S', 'prepData', 'buildStopGroups', 'buildStopSides', 'buildGeo', 'raptorIndex', 'planRoute', 'geocode', 'servicesFor',
  'warsaw', 'ymdShift', 'fmtT', 'tripDist', 'norm', 'plan', 'timetableFor', 'encodeLink', 'decodeLink', 'reachFrom', 'routeFrequency'];

// buduje dane z fixture.py (sztuczna sieć) i zwraca obiekt D
export function fixtureData() {
  const dir = mkdtempSync(path.join(tmpdir(), 'rwp-test-'));
  try {
    const r = spawnSync('python3', [path.join(HERE, 'fixture.py'), path.join(dir, 'gtfs'), path.join(dir, 'data.json')], { encoding: 'utf8' });
    if (r.status !== 0) throw new Error('fixture.py: ' + r.stderr);
    return JSON.parse(readFileSync(path.join(dir, 'data.json'), 'utf8'));
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

// logika strony gotowa do użycia: dane wczytane i zindeksowane jak w main()
export function loadApp(D, extra = {}) {
  const files = LOGIC.map(n => path.join(ROOT, 'src', 'js', n + '.js'));
  let src = '';
  for (const f of files) { try { src += readFileSync(f, 'utf8') + '\n'; } catch (e) { if (e.code !== 'ENOENT') throw e; } }
  const names = EXPORTS.map(n => `${n}: typeof ${n} === 'undefined' ? undefined : ${n}`).join(', ');
  src += `\nglobalThis.__app = { setD(d) { D = d; }, ${names} };`;
  const ctx = vm.createContext({ console, performance, ...extra });
  vm.runInContext(src, ctx, { filename: 'app.js' });
  const app = ctx.__app;
  app.setD(D);
  app.prepData(); app.buildStopGroups(); app.buildStopSides(); app.buildGeo(); app.raptorIndex();
  return app;
}

export const hm = s => { const [h, m] = s.split(':').map(Number); return h * 3600 + m * 60; };
