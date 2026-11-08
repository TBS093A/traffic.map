'use strict';
const $ = s => document.querySelector(s);
const norm = s => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/ł/g, 'l');   // bez polskich znaków, do szukania
const esc = s => String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const lerp = (a, b, t) => a + (b - a) * t;
const smooth = (a, b, x) => { const t = clamp((x - a) / (b - a), 0, 1); return t * t * (3 - 2 * t); };
const store = { get(k, d) { try { const v = localStorage.getItem('rwp_' + k); return v === null ? d : JSON.parse(v); } catch (e) { return d; } },
                set(k, v) { try { localStorage.setItem('rwp_' + k, JSON.stringify(v)); } catch (e) {} } };
function setProgress(p, msg) { $('#lbar').style.width = (p * 100) + '%'; if (msg) $('#lmsg').textContent = msg; }
const tick = () => new Promise(r => setTimeout(r, 0));

