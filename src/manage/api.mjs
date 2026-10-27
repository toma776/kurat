// API-ul /api/manage (Anexa C). Toate rutele cer sesiune și dreptul indicat, verificat pe server la fiecare cerere.
import {createStore, ValidationError} from '../core/store.mjs';
import {entity, hasEntity, titleOf, pathOf, fieldsOf, ENTITIES, RELATION_TYPES} from '../registry/entities.mjs';
import {need, can, needApprovalFor, needsApproval, Forbidden, sameOrigin, login, logout, sessionCookie, clearCookie, storeUser,
  createUser, randomPassword, ROLES} from '../auth/auth.mjs';
import {whereUsed, pageCounts} from '../core/whereused.mjs';
import * as graph from '../core/graph.mjs';
import {inferredGroups} from '../core/inferred.mjs';
import {todo} from '../core/todo.mjs';
import {retryEvent, syncStatus} from '../core/sync.mjs';
import {renderPath} from '../site/pages.mjs';
import {fold, sha1} from '../core/util.mjs';
import {createBackup, listBackups, backupPath, restoreBackup, readArchive} from '../core/backup.mjs';
import {sanitizeContent} from '../core/content.mjs';
import {findDuplicates} from '../core/duplicates.mjs';
import {validate, validationState} from '../core/validations.mjs';
import {sniffMime} from '../core/store.mjs';
import fs from 'node:fs';
import nodePath from 'node:path';

async function rawBody(req, max = 15 * 1024 * 1024) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, 'Fișierul depășește 15 MB.'); chunks.push(c); }
  if (!size) throw new HttpError(422, 'Fișier gol.');
  return Buffer.concat(chunks);
}
const writeFile = (f, b) => { fs.mkdirSync(nodePath.dirname(f), {recursive: true}); fs.writeFileSync(f, b); };

export class HttpError extends Error { constructor(status, msg, extra = {}) { super(msg); this.status = status; Object.assign(this, extra); } }

async function body(req, max = 1_000_000) {
  let size = 0; const chunks = [];
  for await (const c of req) { size += c.length; if (size > max) throw new HttpError(413, 'Cerere prea mare.'); chunks.push(c); }
  const raw = Buffer.concat(chunks).toString('utf8');
  if (!raw) return {};
  try { return (req.headers['content-type'] ?? '').includes('json') ? JSON.parse(raw) : Object.fromEntries(new URLSearchParams(raw)); }
  catch { throw new HttpError(400, 'JSON invalid.'); }
}

const typeOf = k => { if (!hasEntity(k)) throw new HttpError(404, `Tip necunoscut: ${k}`); return entity(k); };
const isSecure = req => req.headers['x-forwarded-proto'] === 'https' || !!req.socket.encrypted;

// Observațiile din „De făcut” care privesc o înregistrare: în răspunsul salvării, ca omul să vadă ce a rezolvat sau stricat (§3.11).
const todoFor = (db, key, id) => todo(db).filter(t => t.href?.includes(`/entitati/${key}/${id}/`));

export function createApi(db, {user: getUser, sse, mediaDir = 'media', backupDir = 'data/backups'}) {
  const routes = [];
  const on = (method, pattern, perm, fn) => routes.push({method, re: new RegExp(`^/api/manage${pattern.replace(/:(\w+)/g, '(?<$1>[^/]+)')}$`), perm, fn});

  // ———————————————————————————— sesiune
  on('POST', '/login', null, async ({req, res}) => {
    const b = await body(req);
    const s = login(db, {email: b.email, password: b.password, ip: req.socket.remoteAddress, userAgent: req.headers['user-agent']});
    res.setHeader('set-cookie', sessionCookie(s, {secure: isSecure(req)}));
    return {ok: true};
  });
  on('POST', '/logout', null, ({req, res}) => { logout(db, req); res.setHeader('set-cookie', clearCookie({secure: isSecure(req)})); return {ok: true}; });
  on('GET', '/me', 'content.read', ({user}) => ({...user, perms: ROLES[user.role].perms}));

  // ———————————————————————————— entități
  on('GET', '/search', 'content.read', ({url}) => graph.search(db, url.searchParams.get('q') ?? ''));
  on('GET', '/entities/:tip', 'content.read', ({p, url}) => {
    const e = typeOf(p.tip), store = createStore(db);
    const q = fold(url.searchParams.get('q') ?? ''), status = url.searchParams.get('status');
    const counts = pageCounts(db, e.key);
    return store.list(e.key).filter(r => (!q || fold(titleOf(e.key, r)).includes(q) || (r.search ?? '').includes(q)) && (!status || r.status === status))
      .map(r => ({id: r.id, title: titleOf(e.key, r), status: r.status ?? null, draft: !!r.draft, path: pathOf(e.key, r), updated_at: r.updated_at, updated_by: r.updated_by, pages: counts.get(r.id) ?? 0}));
  });
  on('POST', '/entities/:tip', 'content.write', async ({p, req, user}) => {
    const e = typeOf(p.tip), b = await body(req);
    if (e.creatable === false) throw new HttpError(403, `${e.label} nu se creează din /manage.`);
    const publish = !!b.publish && !e.noStatus;
    if (publish) { need(user, 'content.publish'); needApprovalFor(user, {key: e.key}); }
    const store = createStore(db, {user: storeUser(user)});
    const id = store.create(e.key, b.data ?? {}, {publish});
    return {id, observations: store.observations, todo: todoFor(db, e.key, id)};
  });
  on('GET', '/entities/:tip/:id', 'content.read', ({p}) => {
    const e = typeOf(p.tip), store = createStore(db), rec = store.get(e.key, +p.id);
    if (!rec) throw new HttpError(404, 'Nu există.');
    const links = Object.fromEntries(e.fields.filter(f => f.type === 'refs').map(f => [f.key, store.links(e.key, rec.id, f.key)]));
    return {record: rec, links, title: titleOf(e.key, rec), path: pathOf(e.key, rec)};
  });
  on('PUT', '/entities/:tip/:id', 'content.write', async ({p, req, user}) => {
    const e = typeOf(p.tip), b = await body(req);
    const store = createStore(db, {user: storeUser(user)});
    const cur = store.get(e.key, +p.id);
    if (!cur) throw new HttpError(404, 'Nu există.');
    // pe o înregistrare publicată, fără `publish` salvarea merge în ciornă; publicarea cere drepturile ei
    const publish = !!b.publish;
    if (publish || e.noStatus) {
      if (!e.noStatus) need(user, 'content.publish');
      needApprovalFor(user, {key: e.key});
    }
    try {
      const r = store.update(e.key, +p.id, b.data ?? {}, {publish, expectedUpdatedAt: b.expectedUpdatedAt ?? null});
      return {...r, record: store.get(e.key, +p.id), observations: store.observations, todo: todoFor(db, e.key, +p.id)};
    } catch (err) {
      if (err.status === 409) {
        const last = db.prepare('SELECT user_name, at, changes FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 1').get(e.key, +p.id);
        throw new HttpError(409, `Între timp a salvat ${last?.user_name ?? 'altcineva'} (${last?.at ?? ''}). Reîncarcă și reaplică modificările.`, {current: err.current, last});
      }
      throw err;
    }
  });
  on('DELETE', '/entities/:tip/:id', 'content.delete', ({p, user}) => createStore(db, {user: storeUser(user)}).remove(typeOf(p.tip).key, +p.id));
  on('POST', '/entities/:tip/:id/status', 'content.publish', async ({p, req, user}) => {
    const e = typeOf(p.tip), b = await body(req);
    needApprovalFor(user, {key: e.key}); // publicare, retragere, arhivare: aceeași regulă (NOU)
    return createStore(db, {user: storeUser(user)}).setStatus(e.key, +p.id, b.status);
  });
  on('POST', '/entities/:tip/:id/discard-draft', 'content.write', ({p, user}) => createStore(db, {user: storeUser(user)}).discardDraft(typeOf(p.tip).key, +p.id));
  on('PUT', '/entities/:tip/:id/links/:camp', 'content.write', async ({p, req, user}) => {
    const e = typeOf(p.tip), b = await body(req);
    needApprovalFor(user, {relationId: `${e.key}.${p.camp}`});
    const store = createStore(db, {user: storeUser(user)});
    return {...store.setLinks(e.key, +p.id, p.camp, b.items ?? []), links: store.links(e.key, +p.id, p.camp)};
  });
  on('PUT', '/entities/:tip/:id/links/:camp/:dst/status', 'content.write', async ({p, req, user}) => {
    const e = typeOf(p.tip), b = await body(req);
    needApprovalFor(user, {relationId: `${e.key}.${p.camp}`});
    const store = createStore(db, {user: storeUser(user)});
    const items = store.links(e.key, +p.id, p.camp).map(l => ({id: l.dst_id, status: l.dst_id === +p.dst ? b.status : l.status,
      confidence: l.confidence, source_id: l.source_id, note: l.dst_id === +p.dst && b.status === 'confirmed' ? null : l.note, attrs: l.attrs}));
    return store.setLinks(e.key, +p.id, p.camp, items);
  });
  on('PUT', '/entities/:tip/:id/inverse/:src/:camp', 'content.write', async ({p, req, user}) => {
    const e = typeOf(p.tip), b = await body(req);
    typeOf(p.src);
    needApprovalFor(user, {relationId: `${p.src}.${p.camp}`});
    return createStore(db, {user: storeUser(user)}).setInverse(e.key, +p.id, p.src, p.camp, {add: b.add ?? null, remove: b.remove ?? null});
  });
  on('GET', '/entities/:tip/:id/where-used', 'content.read', ({p}) => whereUsed(db, typeOf(p.tip).key, +p.id) ?? (() => { throw new HttpError(404, 'Nu există.'); })());
  on('GET', '/entities/:tip/:id/history', 'content.read', ({p}) =>
    db.prepare('SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 200').all(typeOf(p.tip).key, +p.id)
      .map(a => ({...a, changes: JSON.parse(a.changes ?? '{}')})));
  on('POST', '/history/:audit/revert', 'content.write', async ({p, req, user}) => {
    const b = await body(req);
    const a = db.prepare('SELECT entity FROM audit_log WHERE id = ?').get(+p.audit);
    if (!a) throw new HttpError(404, 'Intrare inexistentă.');
    if (!entity(a.entity).noStatus) need(user, 'content.publish');
    needApprovalFor(user, {key: a.entity});
    return createStore(db, {user: storeUser(user)}).revert(+p.audit, b.field ?? null);
  });

  // ———————————————————————————— dubluri și unire (§1.7), validare (§1.8)
  on('GET', '/entities/:tip/:id/duplicates', 'content.read', ({p}) => findDuplicates(db, typeOf(p.tip).key, +p.id));
  on('POST', '/entities/:tip/:id/merge', 'content.write', async ({p, req, user}) => {
    const e = typeOf(p.tip), b = await body(req);
    need(user, 'content.delete', 'Unirea șterge dublurile: cere dreptul de ștergere.');
    needApprovalFor(user, {key: e.key});
    return createStore(db, {user: storeUser(user)}).merge(e.key, +p.id, b.duplicates ?? []);
  });
  on('GET', '/entities/:tip/:id/validation', 'content.read', ({p}) => validationState(db, typeOf(p.tip).key, +p.id));
  on('POST', '/entities/:tip/:id/validate', 'content.write', async ({p, req, user}) => {
    const b = await body(req);
    return validate(db, storeUser(user), typeOf(p.tip).key, +p.id, b.comment ?? null);
  });

  // ———————————————————————————— biblioteca media (§3.9)
  on('GET', '/media', 'media.read', ({url}) => {
    const q = fold(url.searchParams.get('q') ?? '');
    const counts = new Map(db.prepare("SELECT entity_id, COUNT(DISTINCT path) n FROM page_deps WHERE entity = 'media' AND path NOT LIKE '#layout:%' GROUP BY entity_id").all().map(r => [r.entity_id, r.n]));
    return db.prepare('SELECT * FROM media ORDER BY updated_at DESC').all()
      .filter(m => !q || fold(`${m.path} ${m.alt ?? ''} ${m.title ?? ''}`).includes(q)).map(m => ({...m, pages: counts.get(m.id) ?? 0}));
  });
  on('POST', '/media', 'media.write', async ({req, url, user}) => {
    const buffer = await rawBody(req);
    const r = createStore(db, {user: storeUser(user)}).createMedia({buffer, name: url.searchParams.get('name'), alt: url.searchParams.get('alt'), mediaDir, writeFile});
    return r;
  });
  on('GET', '/media/:id', 'media.read', ({p}) => {
    const m = db.prepare('SELECT * FROM media WHERE id = ?').get(+p.id);
    if (!m) throw new HttpError(404, 'Fișierul nu există.');
    return {...m, usage: createStore(db).mediaUsage(+p.id)};
  });
  on('PUT', '/media/:id', 'media.write', async ({p, req, user}) => {
    const b = await body(req);
    return createStore(db, {user: storeUser(user)}).updateMedia(+p.id, {alt: b.alt, title: b.title});
  });
  on('PUT', '/media/:id/file', 'media.write', async ({p, req, user}) => {
    const m = db.prepare('SELECT mime FROM media WHERE id = ?').get(+p.id);
    if (!m) throw new HttpError(404, 'Fișierul nu există.');
    const buffer = await rawBody(req), mime = sniffMime(buffer);
    if (!mime) throw new HttpError(422, 'Tip de fișier nepermis.');
    // același tip, ca adresa (și extensia ei) să rămână valabilă; ID-ul nu se schimbă
    if (mime !== m.mime) throw new HttpError(422, `Înlocuiește cu un fișier de același tip (${m.mime}); pentru alt tip, încarcă un fișier nou.`);
    return createStore(db, {user: storeUser(user)}).replaceMedia(+p.id, {buffer, mime, mediaDir, writeFile});
  });
  on('DELETE', '/media/:id', 'media.write', ({p, user}) => createStore(db, {user: storeUser(user)}).deleteMedia(+p.id));

  // ———————————————————————————— copii de siguranță (§3.12)
  on('GET', '/backups', 'backups.create', () => listBackups(db, backupDir));
  on('POST', '/backups', 'backups.create', async ({req, user}) => {
    const b = await body(req);
    return createBackup(db, {dir: backupDir, mediaDir, kind: 'manual', by: user.name, note: b.note ? String(b.note).slice(0, 200) : null});
  });
  on('GET', '/backups/:id/download', 'backups.download', ({p, res}) => {
    const b = backupPath(db, backupDir, +p.id);
    if (!b) throw new HttpError(404, 'Copia nu mai există pe disc.');
    res.writeHead(200, {'content-type': 'application/gzip', 'content-length': fs.statSync(b.path).size, 'cache-control': 'no-store',
      'content-disposition': `attachment; filename="${b.file}"`, 'x-content-type-options': 'nosniff'});
    fs.createReadStream(b.path).pipe(res);
    return SKIP;
  });
  on('POST', '/backups/:id/restore', 'backups.restore', async ({p, req, user}) => {
    const b = await body(req);
    if (b.confirm !== true) throw new HttpError(422, 'Restaurarea trebuie confirmată explicit.');
    const bk = backupPath(db, backupDir, +p.id);
    if (!bk) throw new HttpError(404, 'Copia nu mai există pe disc.');
    return restoreBackup(db, {buffer: fs.readFileSync(bk.path), dir: backupDir, mediaDir, user: storeUser(user), backupId: bk.id});
  });
  on('POST', '/backups/restore-upload', 'backups.restore', async ({req, url, user}) => {
    if (url.searchParams.get('confirm') !== '1') throw new HttpError(422, 'Restaurarea trebuie confirmată explicit.');
    const buffer = await rawBody(req, 500 * 1024 * 1024);
    readArchive(buffer); // se verifică înainte de a fi păstrată
    // copia încărcată se păstrează în registru, ca restaurarea să fie trasabilă
    fs.mkdirSync(backupDir, {recursive: true});
    const file = `kurat-brain-incarcata-${Date.now()}-upload.tar.gz`;
    fs.writeFileSync(nodePath.join(backupDir, file), buffer);
    const {lastInsertRowid} = db.prepare("INSERT INTO backups (file, at, kind, size, sha1, by, note) VALUES (?, ?, 'upload', ?, ?, ?, 'încărcată pentru restaurare')")
      .run(file, new Date().toISOString(), buffer.length, sha1(buffer), user.name);
    return restoreBackup(db, {buffer, dir: backupDir, mediaDir, user: storeUser(user), backupId: Number(lastInsertRowid)});
  });

  // ———————————————————————————— surse și legături de verificat
  on('GET', '/sources', 'content.read', () => db.prepare(`SELECT s.*, COUNT(p.id) uses, SUM(p.certainty <> 'confirmed') unsure FROM sources s
    LEFT JOIN provenance p ON p.source_id = s.id GROUP BY s.id ORDER BY unsure DESC, s.kind, s.url`).all());
  on('POST', '/provenance/:id/confirm', 'content.write', ({p, user}) => {
    const row = db.prepare('SELECT entity FROM provenance WHERE id = ?').get(+p.id);
    if (!row) throw new HttpError(404, 'Sursă inexistentă.');
    needApprovalFor(user, {key: row.entity}); // NOU: și confirmarea unei surse cere aprobare pe tipurile cu aprobare
    return createStore(db, {user: storeUser(user)}).confirmProvenance(+p.id);
  });
  on('GET', '/inferred', 'content.read', () => inferredGroups(db));
  on('POST', '/inferred/:relatie', 'content.write', async ({p, req, user}) => {
    const b = await body(req);
    if (!RELATION_TYPES.some(r => r.id === p.relatie)) throw new HttpError(404, 'Relație necunoscută.');
    needApprovalFor(user, {relationId: p.relatie}); // și confirmarea în masă (NOU)
    return createStore(db, {user: storeUser(user)}).bulkLinks(p.relatie, b.pairs ?? [], b.action);
  });

  // ———————————————————————————— harta
  const layers = url => url.searchParams.get('layers')?.split(',').filter(Boolean) || undefined;
  on('GET', '/graph/overview', 'content.read', ({url}) => graph.overview(db, {layers: layers(url)}));
  on('GET', '/graph/members', 'content.read', ({url}) => graph.members(db, url.searchParams.get('type'), {q: url.searchParams.get('q') ?? '', offset: +(url.searchParams.get('offset') ?? 0), layers: layers(url)}));
  on('GET', '/graph/neighbors', 'content.read', ({url}) => graph.neighbors(db, url.searchParams.get('node'), {layers: layers(url)}) ?? (() => { throw new HttpError(404, 'Nod inexistent.'); })());
  on('GET', '/graph/node', 'content.read', ({url}) => graph.neighbors(db, url.searchParams.get('node')));
  on('GET', '/graph/search', 'content.read', ({url}) => graph.search(db, url.searchParams.get('q') ?? ''));
  on('GET', '/graph/path', 'content.read', ({url}) => graph.path(db, url.searchParams.get('from'), url.searchParams.get('to'), {layers: layers(url)}));
  on('GET', '/graph/health', 'content.read', () => graph.health(db));
  on('GET', '/graph/edges', 'content.read', () => graph.edgesTable(db));

  // ———————————————————————————— propagare, De făcut, previzualizare
  on('GET', '/todo', 'content.read', () => todo(db));
  on('GET', '/sync', 'content.read', () => ({...syncStatus(db),
    failedEvents: db.prepare("SELECT id, at, label, action, attempts, last_error, retry_at FROM change_events WHERE status = 'failed' ORDER BY id DESC").all(),
    recent: db.prepare('SELECT id, at, user_name, action, entity, entity_id, label, status, affected FROM change_events ORDER BY id DESC LIMIT 20').all()}));
  on('GET', '/sync/:id/log', 'content.read', ({p}) => db.prepare('SELECT * FROM sync_log WHERE event_id = ? ORDER BY id').all(+p.id));
  on('POST', '/sync/retry/:id', 'content.write', ({p}) => retryEvent(db, +p.id));
  on('POST', '/preview', 'content.read', async ({req}) => {
    const b = await body(req);
    const e = typeOf(b.key);
    const rec = createStore(db).get(e.key, +b.id);
    // textul bogat nesalvat trece prin același vocabular fix ca la salvare
    const data = Object.fromEntries(Object.entries(b.data ?? {}).map(([k, v]) =>
      [k, e.fields.find(f => f.key === k)?.type === 'richtext' && typeof v === 'string' ? sanitizeContent(v) : v]));
    const path = b.path ?? pathOf(e.key, {...rec, ...data}) ?? pathOf(e.key, rec);
    if (!path) throw new HttpError(422, 'Înregistrarea nu are pagină proprie; previzualizează o pagină care o afișează.');
    const r = renderPath(db, path, {overlay: {key: e.key, id: +b.id, data}});
    return {path, status: r.status, html: r.html};
  });

  // ———————————————————————————— utilizatori
  on('GET', '/users', 'users.write', () => db.prepare('SELECT id, email, name, role, active, created_at FROM users ORDER BY id').all());
  on('POST', '/users', 'users.write', async ({req}) => {
    const b = await body(req);
    const password = b.password || randomPassword();
    const id = createUser(db, {email: b.email, name: b.name, role: b.role, password});
    return {id, password: b.password ? undefined : password};
  });
  on('POST', '/users/:id', 'users.write', async ({p, req, user}) => {
    const b = await body(req);
    if (+p.id === user.id && (b.active === false || (b.role && b.role !== 'admin'))) throw new HttpError(422, 'Nu îți poți retrage singur accesul de administrator.');
    if (b.role) { if (!ROLES[b.role]) throw new HttpError(422, 'Rol necunoscut.'); db.prepare('UPDATE users SET role = ? WHERE id = ?').run(b.role, +p.id); }
    if (b.active != null) { db.prepare('UPDATE users SET active = ? WHERE id = ?').run(b.active ? 1 : 0, +p.id); if (!b.active) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(+p.id); }
    return {ok: true};
  });

  // ———————————————————————————— modificările live (SSE)
  on('GET', '/events', 'content.read', ({req, res, user}) => { sse.add(req, res, user); return SKIP; });

  const SKIP = Symbol('skip');

  return async function handle(req, res, url) {
    const path = url.pathname;
    for (const r of routes) {
      if (r.method !== req.method) continue;
      const m = r.re.exec(path);
      if (!m) continue;
      const send = (status, obj) => { res.writeHead(status, {'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', 'x-content-type-options': 'nosniff'}); res.end(JSON.stringify(obj)); };
      try {
        if (req.method !== 'GET' && !sameOrigin(req)) throw new HttpError(403, 'Scrierile din alt site sunt refuzate.');
        const user = getUser(req);
        if (r.perm) {
          if (!user) throw new HttpError(401, 'Autentifică-te.');
          need(user, r.perm);
        }
        const out = await r.fn({req, res, url, user, p: Object.fromEntries(Object.entries(m.groups ?? {}).map(([k, v]) => [k, decodeURIComponent(v)]))});
        if (out === SKIP) return true;
        send(200, out ?? {ok: true});
      } catch (err) {
        if (err instanceof ValidationError) send(422, {error: err.message, errors: err.errors, blockers: err.blockers});
        else if (err instanceof Forbidden) send(403, {error: err.message, perm: err.perm});
        else if (err.status) send(err.status, {error: err.message, current: err.current, last: err.last});
        else { console.error('api', req.method, path, err); send(500, {error: 'Eroare internă.'}); }
      }
      return true;
    }
    if (path.startsWith('/api/manage/')) { res.writeHead(404, {'content-type': 'application/json'}); res.end('{"error":"Rută inexistentă."}'); return true; }
    return false;
  };
}

// Canalul SSE (§3.11 NOU): fiecare modificare ajunge la panourile deschise ale celorlalți utilizatori.
export function createSse(db) {
  const clients = new Set();
  const ping = setInterval(() => { for (const c of clients) c.res.write(': ping\n\n'); }, 25_000);
  ping.unref();
  return {
    add(req, res, user) {
      res.writeHead(200, {'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no'});
      res.write(`retry: 3000\n\n`);
      const c = {res, user};
      clients.add(c);
      req.on('close', () => clients.delete(c));
    },
    broadcast(type, data) {
      const msg = `event: ${type}\ndata: ${JSON.stringify(data)}\n\n`;
      for (const c of clients) c.res.write(msg);
    },
    get size() { return clients.size; },
    close() { clearInterval(ping); for (const c of clients) c.res.end(); clients.clear(); }
  };
}

export {can, needsApproval, ENTITIES, fieldsOf};
