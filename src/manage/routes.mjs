// Rutele /manage (panouri HTML) și /api/manage (JSON). /manage se randează la fiecare cerere, fără cache (no-store).
import fs from 'node:fs';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {hasEntity, entity} from '../registry/entities.mjs';
import {currentUser, can} from '../auth/auth.mjs';
import {createApi, createSse} from './api.mjs';
import * as views from './views.mjs';
import {renderPath} from '../site/pages.mjs';

const STATIC = path.join(path.dirname(fileURLToPath(import.meta.url)), 'static');
const TYPES = {'.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.svg': 'image/svg+xml'};
const HEADERS = {
  'cache-control': 'no-store', 'x-robots-tag': 'noindex, nofollow', 'x-content-type-options': 'nosniff', 'x-frame-options': 'SAMEORIGIN', 'referrer-policy': 'same-origin',
  // stilurile inline (culorile tipurilor din registru) sunt permise; scripturile rămân strict 'self'
  'content-security-policy': "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com; frame-src 'self' https://maps.google.com https://www.google.com; script-src 'self'; connect-src 'self'; form-action 'self'; base-uri 'self'"
};

export function createManage(db, {mediaDir = 'media', backupDir = 'data/backups'} = {}) {
  const sse = createSse(db);
  const user = req => currentUser(db, req);
  const api = createApi(db, {user, sse, mediaDir, backupDir});

  const html = (res, status, body) => { res.writeHead(status, {...HEADERS, 'content-type': 'text/html; charset=utf-8'}); res.end(body); };
  const redirect = (res, to) => { res.writeHead(303, {...HEADERS, location: to}); res.end(); };

  async function handle(req, res, url) {
    const p = url.pathname;
    if (p.startsWith('/api/manage/')) return api(req, res, url);
    if (!p.startsWith('/manage')) return false;

    if (p.startsWith('/manage/static/')) {
      const f = path.resolve(STATIC, '.' + path.posix.normalize('/' + p.slice('/manage/static/'.length)));
      if (!f.startsWith(STATIC + path.sep) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return true; }
      res.writeHead(200, {'content-type': TYPES[path.extname(f)] ?? 'application/octet-stream',
        'cache-control': url.searchParams.has('v') ? 'public, max-age=31536000, immutable' : 'no-cache', 'x-content-type-options': 'nosniff', 'x-robots-tag': 'noindex, nofollow'});
      fs.createReadStream(f).pipe(res);
      return true;
    }
    if (req.method !== 'GET' && req.method !== 'HEAD') { res.writeHead(405); res.end(); return true; }
    if (p === '/manage') return redirect(res, '/manage/'), true;
    if (!p.endsWith('/') && !p.startsWith('/manage/previzualizare/')) return redirect(res, p + '/' + url.search), true;

    const u = user(req);
    if (p === '/manage/login/') return html(res, 200, views.loginPage()), true;
    if (!u) return redirect(res, `/manage/login/?next=${encodeURIComponent(p + url.search)}`), true;
    if (!can(u, 'content.read')) return html(res, 403, views.forbiddenPage(db, u, 'Contul nu are acces la Brain.')), true;

    // previzualizarea: pagina cu ciornele, marcată „Previzualizare — conținut nepublicat”; doar pentru utilizatorii din /manage
    if (p.startsWith('/manage/previzualizare/')) {
      const target = p.slice('/manage/previzualizare'.length) || '/';
      const r = renderPath(db, target, {preview: true});
      if (r.status === 301) return redirect(res, `/manage/previzualizare${r.location}`), true;
      return html(res, r.status, r.html.replace(/href="\/(?!static|media|manage)([^"]*)"/g, 'href="/manage/previzualizare/$1"')), true;
    }

    let m;
    if (p === '/manage/') return html(res, 200, views.dashboard(db, u)), true;
    if (p === '/manage/entitati/') return html(res, 200, views.typesIndex(db, u)), true;
    if ((m = /^\/manage\/entitati\/([\w-]+)\/$/.exec(p)) && hasEntity(m[1])) {
      const r = views.entityList(db, u, m[1], url);
      return r.redirect ? redirect(res, r.redirect) : html(res, 200, r.html), true;
    }
    if ((m = /^\/manage\/entitati\/([\w-]+)\/nou\/$/.exec(p)) && hasEntity(m[1])) {
      if (!can(u, 'content.write') || entity(m[1]).creatable === false) return html(res, 403, views.forbiddenPage(db, u, 'Nu poți crea acest tip.')), true;
      return html(res, 200, views.newEntity(db, u, m[1])), true;
    }
    if ((m = /^\/manage\/entitati\/([\w-]+)\/(\d+)\/(?:([\w-]+)\/)?$/.exec(p)) && hasEntity(m[1])) {
      const out = views.entityPage(db, u, m[1], +m[2], m[3] ?? 'prezentare', url);
      return html(res, out ? 200 : 404, out ?? views.forbiddenPage(db, u, 'Înregistrarea nu există.')), true;
    }
    if (p === '/manage/harta/') return html(res, 200, views.mapPage(db, u)), true;
    if (p === '/manage/modificari/') return html(res, 200, views.changesPage(db, u, url)), true;
    if (p === '/manage/media/' || (m = /^\/manage\/media\/(\d+)\/$/.exec(p))) {
      if (!can(u, 'media.read')) return html(res, 403, views.forbiddenPage(db, u, 'Nu ai acces la bibliotecă.')), true;
      if (p === '/manage/media/') return html(res, 200, views.mediaPage(db, u, url)), true;
      const out = views.mediaDetail(db, u, +m[1]);
      return html(res, out ? 200 : 404, out ?? views.forbiddenPage(db, u, 'Fișierul nu există.')), true;
    }
    if (p === '/manage/surse/') return html(res, 200, views.sourcesPage(db, u)), true;
    if (p === '/manage/setari/') {
      if (!can(u, 'backups.create')) return html(res, 403, views.forbiddenPage(db, u, 'Setările sunt doar pentru administratori.')), true;
      return html(res, 200, views.settingsPage(db, u, {backupDir, mediaDir})), true;
    }
    if (p === '/manage/surse/legaturi/') return html(res, 200, views.inferredPage(db, u)), true;
    if (p === '/manage/utilizatori/') {
      if (!can(u, 'users.write')) return html(res, 403, views.forbiddenPage(db, u, 'Doar administratorii gestionează utilizatorii.')), true;
      return html(res, 200, views.usersPage(db, u)), true;
    }
    html(res, 404, views.forbiddenPage(db, u, 'Pagina nu există în /manage.'));
    return true;
  }

  return {handle, sse};
}
