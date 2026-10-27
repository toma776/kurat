// Serverul site-ului public kurat.ro: randat pe server din Brain, cu propagare live (§3).
// Rulare: node src/server.mjs  (PORT, BRAIN_DB, MEDIA_DIR, BACKUP_DIR, CRON_KEY, SITE_ORIGIN, BRAIN_INDEXING, BRAIN_GIT_SYNC din mediu)
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import crypto from 'node:crypto';
import {openDb} from './core/db.mjs';
import {createStore, onChange, ValidationError} from './core/store.mjs';
import {serve, scan, processEvents, publicPaths, syncStatus} from './core/sync.mjs';
import {refreshGraph} from './core/graph.mjs';
import {maybeAutoBackup} from './core/backup.mjs';
import {startGitSync} from './core/gitsync.mjs';
import {createManage} from './manage/routes.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC_DIR = path.join(ROOT, 'site', 'static');
const MEDIA_DIR = path.resolve(process.env.MEDIA_DIR ?? 'media');
const BACKUP_DIR = path.resolve(process.env.BACKUP_DIR ?? 'data/backups');
const ORIGIN = process.env.SITE_ORIGIN ?? 'https://kurat.ro';
const TYPES = {'.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png',
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.svg': 'image/svg+xml', '.ico': 'image/x-icon', '.avif': 'image/avif', '.gif': 'image/gif'};
// Motoarele de căutare NU indexează site-ul până la lansare: noindex pe orice răspuns (pagini, imagini, fișiere).
// Se deschide doar explicit, pe serverul de producție, la lansare: BRAIN_INDEXING=1.
export const indexing = () => process.env.BRAIN_INDEXING === '1';
const NOINDEX = 'noindex, nofollow, noarchive, nosnippet, noimageindex';
const SECURITY = {
  'x-content-type-options': 'nosniff', 'referrer-policy': 'strict-origin-when-cross-origin', 'x-frame-options': 'SAMEORIGIN',
  // stilurile inline sunt ale designului original (componentele Kurat); scripturile rămân doar 'self'
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; font-src https://fonts.gstatic.com; " +
    "frame-src https://maps.google.com https://www.google.com; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'self'"
};

// autoBackup: verificarea orară a copiei zilnice; pornită doar de serverul real (nu și în teste).
export function createServer(db, {log = console.log, mediaDir = MEDIA_DIR, backupDir = BACKUP_DIR, autoBackup = false} = {}) {
  mediaDir = path.resolve(mediaDir);
  backupDir = path.resolve(backupDir);
  const backupCheck = () => {
    try { const b = maybeAutoBackup(db, {dir: backupDir, mediaDir}); if (b) log(`copie de siguranță automată: ${b.file} (${Math.round(b.size / 1024)} KB)`); return b; }
    catch (err) { log('copia automată a eșuat:', err); return null; }
  };
  let backupTimer = null;
  if (autoBackup) { backupCheck(); backupTimer = setInterval(backupCheck, 3600_000); backupTimer.unref(); }
  const site = createStore(db, {user: {name: 'Site', system: true}});
  const hits = new Map(); // limită de cereri pe IP pentru /api/cerere

  const manage = createManage(db, {mediaDir, backupDir});

  // propagarea pornește imediat după COMMIT, apoi la fiecare minut pentru ce a rămas (§3.5)
  let scheduled = false;
  const kick = () => {
    if (scheduled) return;
    scheduled = true;
    setImmediate(() => {
      scheduled = false;
      const s = processEvents(db);
      if (s.events) {
        log(`propagare: ${s.events} evenimente, ${s.rendered} pagini refăcute, ${s.failed} eșecuri`);
        manage.sse.broadcast('sync', {...s, status: syncStatus(db)});
      }
    });
  };
  // fiecare modificare: indexul hărții se actualizează doar pentru ce s-a schimbat, panourile deschise află (SSE), propagarea pornește
  const off = onChange(ev => {
    const row = db.prepare('SELECT id, at, user_name, action, entity, entity_id, label, payload FROM change_events WHERE id = ?').get(ev.eventId);
    if (row) {
      refreshGraph(db, row);
      const {payload, ...pub} = row;
      manage.sse.broadcast('change', {...pub, records: JSON.parse(payload ?? '{}').records ?? null});
    }
    kick();
  });
  const timer = setInterval(() => { processEvents(db); nightlyScan(); }, 60_000);
  timer.unref();
  function nightlyScan() {
    const last = JSON.parse(db.prepare("SELECT value FROM meta WHERE key = 'last_scan'").get()?.value ?? '{}');
    const now = new Date();
    if (now.getHours() === 3 && (!last.at || now - new Date(last.at) > 20 * 3600_000)) log('scan nocturn:', scan(db));
  }

  const send = (res, status, body, headers = {}) => {
    res.writeHead(status, {...SECURITY, ...(indexing() ? {} : {'x-robots-tag': NOINDEX}), ...headers});
    res.end(body);
  };

  function sendFile(req, res, file, {immutable = false} = {}) {
    fs.stat(file, (err, st) => {
      if (err || !st.isFile()) return send(res, 404, 'Fișierul nu există.', {'content-type': 'text/plain; charset=utf-8'});
      const etag = `"${st.size.toString(36)}-${st.mtimeMs.toString(36)}"`;
      if (req.headers['if-none-match'] === etag) return send(res, 304, '');
      res.writeHead(200, {...SECURITY, ...(indexing() ? {} : {'x-robots-tag': NOINDEX}), 'content-type': TYPES[path.extname(file).toLowerCase()] ?? 'application/octet-stream', 'content-length': st.size, etag,
        'cache-control': immutable ? 'public, max-age=31536000, immutable' : 'public, max-age=3600'});
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(file).pipe(res);
    });
  }

  // fișierele se servesc doar din directorul lor (fără ../)
  const inside = (dir, rel) => { const f = path.resolve(dir, '.' + path.posix.normalize('/' + rel)); return f.startsWith(dir + path.sep) ? f : null; };

  async function readBody(req, max = 16_384) {
    let size = 0; const chunks = [];
    for await (const c of req) { size += c.length; if (size > max) throw Object.assign(new Error('Cerere prea mare.'), {status: 413}); chunks.push(c); }
    const raw = Buffer.concat(chunks).toString('utf8');
    return (req.headers['content-type'] ?? '').includes('application/json') ? JSON.parse(raw || '{}') : Object.fromEntries(new URLSearchParams(raw));
  }

  async function lead(req, res) {
    // scrierile venite din alt site sunt refuzate (§1.9)
    const origin = req.headers.origin;
    if (origin && new URL(origin).host !== req.headers.host) return json(res, 403, {error: 'Origine nepermisă.'});
    const ip = req.socket.remoteAddress ?? '';
    const recent = (hits.get(ip) ?? []).filter(t => Date.now() - t < 60_000);
    if (recent.length >= 5) return json(res, 429, {error: 'Prea multe cereri. Încearcă din nou peste un minut.'});
    hits.set(ip, [...recent, Date.now()]);
    try {
      const b = await readBody(req);
      const nume = String(b.nume ?? '').trim().slice(0, 120), contact = String(b.contact ?? '').trim().slice(0, 160);
      if (!nume || !contact) return json(res, 422, {error: 'Completează numele și un telefon sau un email.'});
      if (b.sursa !== 'calculator' && !b.acord) return json(res, 422, {error: 'Bifează acordul pentru a fi contactat.'});
      const detalii = b.detalii && typeof b.detalii === 'object' ? [b.detalii] : null;
      const id = site.create('cereri', {nume, contact, mesaj: String(b.mesaj ?? '').slice(0, 4000) || null,
        sursa: b.sursa === 'calculator' ? 'calculator' : 'formular', detalii, stare: 'noua'});
      log(`cerere nouă #${id} (${b.sursa ?? 'formular'})`);
      return json(res, 201, {ok: true});
    } catch (err) {
      if (err instanceof ValidationError) return json(res, 422, {error: err.message});
      return json(res, err.status ?? 400, {error: err.status ? err.message : 'Cerere invalidă.'});
    }
  }
  const json = (res, status, obj) => send(res, status, JSON.stringify(obj), {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store'});

  function sitemap(res) {
    const rows = db.prepare('SELECT path, rendered_at FROM page_index WHERE status = 200').all();
    const known = new Map(rows.map(r => [r.path, r.rendered_at]));
    const urls = publicPaths(db).map(p => `<url><loc>${ORIGIN}${p}</loc>${known.get(p) ? `<lastmod>${known.get(p).slice(0, 10)}</lastmod>` : ''}</url>`);
    send(res, 200, `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">${urls.join('')}</urlset>`,
      {'content-type': 'application/xml; charset=utf-8', 'cache-control': 'public, max-age=3600'});
  }

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url, 'http://local');
    let p = decodeURIComponent(url.pathname);
    try {
      if (req.method === 'POST' && p === '/api/cerere') return await lead(req, res);
      if (req.method === 'POST' && p === '/api/manage/cron/tick') {
        // temporizatoarele nu depind de un server care rulează mereu (§3.7)
        const key = process.env.CRON_KEY;
        const given = String(req.headers.authorization ?? '').replace(/^Bearer /, '');
        if (!key || given.length !== key.length || !crypto.timingSafeEqual(Buffer.from(given), Buffer.from(key))) return json(res, 401, {error: 'Cheie de cron invalidă.'});
        const needScan = db.prepare("SELECT value FROM meta WHERE key = 'scan_needed'").get()?.value === '1';
        return json(res, 200, {events: processEvents(db), scan: needScan ? scan(db) : null, backup: backupCheck(), status: syncStatus(db)});
      }
      if (await manage.handle(req, res, url)) return;
      if (req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, '', {allow: 'GET, HEAD, POST'});
      if (p.startsWith('/static/')) { const f = inside(STATIC_DIR, p.slice(8)); return f ? sendFile(req, res, f, {immutable: url.searchParams.has('v')}) : send(res, 404, ''); }
      if (p.startsWith('/media/')) { const f = inside(mediaDir, p.slice(7)); return f ? sendFile(req, res, f, {immutable: url.searchParams.has('v')}) : send(res, 404, ''); }
      if (p === '/favicon.ico') return sendFile(req, res, path.join(STATIC_DIR, 'favicon.ico'));
      if (p === '/sitemap.xml') return indexing() ? sitemap(res) : send(res, 404, '');
      // fără indexare, robots.txt lasă roboții să citească paginile (ca să vadă noindex și să le scoată din index) și nu anunță harta site-ului
      if (p === '/robots.txt') return send(res, 200, indexing() ? `User-agent: *\nAllow: /\nDisallow: /manage/\nDisallow: /api/\n\nSitemap: ${ORIGIN}/sitemap.xml\n`
        : `# Site în pregătire: paginile poartă noindex (antetul X-Robots-Tag și meta robots).\nUser-agent: *\nAllow: /\n`, {'content-type': 'text/plain; charset=utf-8'});
      if (/^\/(wp-admin|wp-json|feed)(\/|$)/.test(p)) return send(res, 404, '');
      // adresele fără bară la final, ca în site-ul vechi (§3.8)
      if (p.length > 1 && p.endsWith('/')) return send(res, 301, '', {location: p.replace(/\/+$/, '') + url.search});

      const r = serve(db, p);
      if (r.status === 301 || r.status === 302) return send(res, r.status, '', {location: r.location + url.search, 'cache-control': 'no-cache'});
      const etag = r.hash ? `"${r.hash.slice(0, 16)}"` : null;
      if (etag && req.headers['if-none-match'] === etag) return send(res, 304, '');
      send(res, r.status, req.method === 'HEAD' ? '' : r.html, {'content-type': 'text/html; charset=utf-8',
        'cache-control': r.status === 200 ? 'public, max-age=0, must-revalidate' : 'no-store', ...(etag ? {etag} : {})});
    } catch (err) {
      log('eroare', req.method, p, err);
      if (!res.headersSent) send(res, 500, '<!doctype html><meta charset="utf-8"><title>Eroare</title><p>A apărut o eroare. Încearcă din nou.</p>', {'content-type': 'text/html; charset=utf-8'});
    }
  });
  server.on('close', () => { off(); clearInterval(timer); if (backupTimer) clearInterval(backupTimer); manage.sse.close(); });
  return server;
}

// ———————————————————————————————————————————— pornire

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const db = openDb(process.env.BRAIN_DB ?? 'data/brain.db');
  const needScan = db.prepare("SELECT value FROM meta WHERE key = 'scan_needed'").get()?.value === '1'
    || !db.prepare('SELECT 1 FROM page_index LIMIT 1').get();
  if (needScan) { const t = Date.now(); const r = scan(db); console.log(`scan la pornire: ${r.rendered} pagini în ${Date.now() - t} ms, ${r.failed.length} eșecuri`); }
  const s = processEvents(db);
  if (s.events) console.log(`la pornire: ${s.events} evenimente procesate`);
  const port = +(process.env.PORT ?? 3000);
  createServer(db, {autoBackup: true}).listen(port, () => console.log(`kurat.ro din Brain: http://localhost:${port}`));
  // conținutul și imaginile ajung singure pe GitHub (doar serverul local; pe serverul clientului rămâne oprit)
  if (process.env.BRAIN_GIT_SYNC === '1') startGitSync(db);
}
