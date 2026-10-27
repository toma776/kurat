// Etapa 1 a importului (§1.3): snapshot local al site-ului vechi, din care se poate reface totul fără el.
// Pagini (linkuri descoperite, nu există sitemap), bundle-ul Angular, imaginile și API-ul calculatorului.
// Rulare: node scripts/crawl.mjs [--base=https://kurat.ro] [--out=reference/snapshot]
import fs from 'node:fs';
import path from 'node:path';
import {parse, all} from '../src/lib/html.mjs';
import {sha1, nowIso} from '../src/core/util.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const BASE = new URL(arg('base', 'https://kurat.ro')).origin;
const OUT = path.resolve(arg('out', 'reference/snapshot'));
const API = arg('api', 'https://api.kurat.ro');
const UA = 'Mozilla/5.0 (KuratBrain import; +https://kurat.ro)';

const manifest = {base: BASE, started_at: nowIso(), items: []};
const seen = new Set();

const fileFor = (u, kind) => {
  const {pathname} = new URL(u);
  if (kind === 'page') return path.join('pages', (pathname.replace(/\/$/, '') || '/index') + '.html');
  if (kind === 'api') return path.join('api', pathname.replace(/^\//, '').replace(/\//g, '_') + '.json');
  return pathname.replace(/^\//, '').replace(/\.\./g, '');
};

async function get(u, kind) {
  if (seen.has(u)) return null;
  seen.add(u);
  const res = await fetch(u, {headers: {'user-agent': UA}, redirect: 'manual'});
  const item = {url: u, kind, status: res.status, content_type: res.headers.get('content-type'), fetched_at: nowIso()};
  if (res.status >= 300 && res.status < 400) { item.location = res.headers.get('location'); manifest.items.push(item); return null; }
  const buf = Buffer.from(await res.arrayBuffer());
  if (res.ok) {
    item.file = fileFor(u, kind);
    item.sha1 = sha1(buf);
    item.size = buf.length;
    fs.mkdirSync(path.dirname(path.join(OUT, item.file)), {recursive: true});
    fs.writeFileSync(path.join(OUT, item.file), buf);
  }
  manifest.items.push(item);
  console.log(String(res.status).padEnd(4), kind.padEnd(6), u);
  return res.ok ? buf : null;
}

const internal = href => {
  try {
    const u = new URL(href, BASE);
    return u.origin === BASE ? u : null;
  } catch { return null; }
};
const isAsset = p => /\.(webp|png|jpe?g|gif|svg|ico|avif|mp4|pdf|woff2?)$/i.test(p);

fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});

// 1. pagini, în lățime, după linkurile descoperite
const queue = [`${BASE}/`];
const assets = new Set(), scripts = new Set();
while (queue.length) {
  const u = queue.shift();
  const buf = await get(u, 'page');
  if (!buf) continue;
  const root = parse(buf.toString('utf8'));
  for (const a of all(root, 'a[href]')) {
    const v = internal(a.attrs.href);
    if (!v) continue;
    v.hash = ''; v.search = '';
    if (isAsset(v.pathname)) assets.add(v.href);
    else if (!seen.has(v.href) && !queue.includes(v.href)) queue.push(v.href);
  }
  for (const n of all(root, n => n.attrs?.src || n.attrs?.href)) {
    const v = internal(n.attrs.src ?? n.attrs.href);
    if (!v) continue;
    if (/\.(m?js)$/.test(v.pathname)) scripts.add(v.href);
    else if (isAsset(v.pathname) || /\.css$/.test(v.pathname)) assets.add(v.href);
  }
  for (const m of buf.toString('utf8').matchAll(/url\((['"]?)(\/[^)'"]+)\1\)/g)) { const v = internal(m[2]); if (v) assets.add(v.href); }
}

// 2. bundle-ul (conținutul e scris în componente) și bucățile încărcate la cerere
const jsQueue = [...scripts];
while (jsQueue.length) {
  const u = jsQueue.shift();
  const buf = await get(u, 'js');
  if (!buf) continue;
  const src = buf.toString('utf8');
  for (const m of src.matchAll(/["'`](\.?\/?(?:chunk|main|polyfills)-[\w-]+\.js)["'`]/g)) {
    const v = new URL(m[1], u).href;
    if (!seen.has(v) && !jsQueue.includes(v)) jsQueue.push(v);
  }
  for (const m of src.matchAll(/["'`](\/(?:assets)\/[^"'`\s]+\.(?:webp|png|jpe?g|svg|gif|avif))["'`]/g)) assets.add(new URL(m[1], BASE).href);
}

// 3. fișierele media
for (const u of [...assets].sort()) await get(u, 'asset');

// 4. API-ul site-ului vechi: doar endpointurile publice, doar citire
for (const p of ['/api/calculator/config']) await get(`${API}${p}`, 'api');

manifest.finished_at = nowIso();
fs.writeFileSync(path.join(OUT, 'manifest.json'), JSON.stringify(manifest, null, 2));
const by = k => manifest.items.filter(i => i.kind === k && i.file).length;
console.log(`\nSnapshot: ${by('page')} pagini, ${by('js')} fișiere JS, ${by('asset')} fișiere media, ${by('api')} răspunsuri API → ${path.relative(process.cwd(), OUT)}`);
const failed = manifest.items.filter(i => !i.file && !i.location);
if (failed.length) console.log(`Eșuate (${failed.length}):`, failed.map(i => `${i.status} ${i.url}`).join(', '));
