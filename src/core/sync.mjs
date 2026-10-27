// Propagarea live (§3.4, §3.5): paginile afectate de un eveniment, refăcute imediat și explicabil.
import {tx} from './db.mjs';
import {createStore} from './store.mjs';
import {ENTITIES, pathOf} from '../registry/entities.mjs';
import {renderPath} from '../site/pages.mjs';
import {nowIso, sha1, same} from './util.mjs';

export const RENDER_NOW = 150;
export const MAX_ATTEMPTS = 5;
const BACKOFF_MS = 30_000;

// Doar pentru teste: un cârlig apelat înainte de randarea fiecărei pagini.
export const hooks = {beforeRender: null};

// ———————————————————————————————————————————— cache-ul paginilor (în proces) și indexul (în bază)

const caches = new WeakMap();
export const cacheOf = db => { let c = caches.get(db); if (!c) caches.set(db, c = new Map()); return c; };

export function publicPaths(db) {
  const store = createStore(db), out = new Set();
  for (const e of ENTITIES) {
    if (!e.public) continue;
    for (const r of store.list(e.key)) {
      if (!e.noStatus && r.status !== 'published') continue;
      const p = pathOf(e.key, r);
      if (p) out.add(p);
    }
  }
  return [...out].sort();
}

const dedupe = deps => {
  const seen = new Set();
  return deps.filter(d => {
    const k = [d.entity, d.entity_id, d.kind, d.component, d.scope, d.fields].join('|');
    return !seen.has(k) && seen.add(k);
  });
};

function writeDeps(db, path, deps) {
  db.prepare('DELETE FROM page_deps WHERE path = ?').run(path);
  const ins = db.prepare('INSERT INTO page_deps (path, entity, entity_id, kind, component, scope, fields, reason) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  for (const d of dedupe(deps)) ins.run(path, d.entity, d.entity_id, d.kind, d.component, d.scope, d.fields, d.reason);
}

function removePage(db, path) {
  db.prepare('DELETE FROM page_deps WHERE path = ?').run(path);
  db.prepare('DELETE FROM page_index WHERE path = ?').run(path);
  cacheOf(db).delete(path);
}

// Randează o adresă și îi rescrie dependențele. Componentele comune își scriu dependențele o singură dată, sub #layout:<nume>.
export function renderAndStore(db, path) {
  return tx(db, () => {
    hooks.beforeRender?.(path);
    const r = renderPath(db, path);
    if (r.status !== 200) {
      removePage(db, path);
      return {action: r.status === 301 ? 'redirect' : 'removed', status: r.status, location: r.location, html: r.html};
    }
    writeDeps(db, path, r.ctx.deps);
    for (const [name, deps] of r.ctx.layouts) writeDeps(db, `#layout:${name}`, deps);
    const hash = sha1(r.html);
    db.prepare(`INSERT INTO page_index (path, owner_entity, owner_id, title, status, rendered_at, hash, deps, error, stale)
      VALUES (?, ?, ?, ?, 200, ?, ?, ?, NULL, 0)
      ON CONFLICT(path) DO UPDATE SET owner_entity = excluded.owner_entity, owner_id = excluded.owner_id, title = excluded.title, status = 200,
        rendered_at = excluded.rendered_at, hash = excluded.hash, deps = excluded.deps, error = NULL, stale = 0`)
      .run(path, r.owner?.key ?? null, r.owner?.id ?? null, r.title ?? null, nowIso(), hash, dedupe(r.ctx.deps).length);
    cacheOf(db).set(path, {html: r.html, hash, at: Date.now()});
    return {action: 'rendered', status: 200, html: r.html, hash};
  });
}

// Pentru server: din cache dacă e proaspătă, altfel randată acum (și indexată).
export function serve(db, path) {
  const hit = cacheOf(db).get(path);
  if (hit) return {status: 200, html: hit.html, hash: hit.hash};
  try {
    return renderAndStore(db, path);
  } catch (err) {
    db.prepare('UPDATE page_index SET error = ? WHERE path = ?').run(String(err.message), path);
    throw err;
  }
}

// ———————————————————————————————————————————— paginile afectate (§3.4)

const parse = p => typeof p === 'string' ? JSON.parse(p) : p ?? {};

export function linkMatters(before, after) {
  if (!before || !after) return true;                                  // creare sau ștergere
  if (before.status !== after.status) return true;                     // publicare, retragere, arhivare
  if (!same(before.paths, after.paths)) return true;                   // adresă schimbată
  return !same(before.linkFields, after.linkFields);                   // un câmp care contează pentru link
}

const changedFields = (before, after) => {
  const keys = new Set([...Object.keys(before?.values ?? {}), ...Object.keys(after?.values ?? {})]);
  return new Set([...keys].filter(k => !same(before?.values?.[k], after?.values?.[k])));
};

export function affected(db, ev) {
  const out = new Map();
  const {before, after, touched = []} = parse(ev.payload);
  const add = (p, why) => { if (!out.has(p)) out.set(p, why); };
  // un rând de dependență poate fi al unei componente comune: atunci se extinde la toate paginile care o folosesc
  const layoutPages = db.prepare("SELECT DISTINCT path FROM page_deps WHERE kind = 'layout' AND component = ?");
  const expand = (p, why) => {
    if (!p.startsWith('#layout:')) return add(p, why);
    const name = p.slice(8);
    for (const r of layoutPages.all(name)) add(r.path, `${name} — ${why}`);
  };

  // 1. modificare globală (setări fără entitate, restaurare)
  if (!ev.entity || ev.action === 'global') {
    for (const p of new Set([...db.prepare('SELECT path FROM page_index').all().map(r => r.path), ...publicPaths(db)])) add(p, 'modificare globală');
    return out;
  }

  // acțiune în masă (§2.5): un singur eveniment pentru mai multe înregistrări; fiecare contează ca modificată
  const payload = parse(ev.payload);
  if (payload.bulk) {
    for (const rec of payload.records ?? []) {
      const [k, id] = rec.split(':');
      for (const r of db.prepare("SELECT * FROM page_deps WHERE entity = ? AND entity_id = ? AND kind IN ('page','direct','list','pending')").all(k, +id))
        expand(r.path, `${payload.relation}: ${r.component}`);
    }
    for (const t of touched) {
      const [k, id] = t.split(':');
      for (const r of db.prepare("SELECT DISTINCT path FROM page_deps WHERE entity = ? AND entity_id = ? AND kind = 'page'").all(k, +id))
        add(r.path, `capăt al relației (${t})`);
    }
    return out;
  }

  // 2. dependențele înregistrării
  const lm = linkMatters(before, after);
  for (const r of db.prepare('SELECT * FROM page_deps WHERE entity = ? AND entity_id = ?').all(ev.entity, ev.entity_id)) {
    const why = r.reason ? `${r.component} — ${r.reason}` : r.component;
    if (r.kind === 'page') expand(r.path, 'pagina proprie');
    else if (r.kind === 'pending') expand(r.path, `așteaptă publicarea (${why})`);
    else if (r.kind === 'link') { if (lm) expand(r.path, `link: ${why}`); }
    else if (['direct', 'list', 'media'].includes(r.kind)) expand(r.path, why);
  }

  // 3–4. listele tipului: reordonare; query fără scope (cu câmpuri: doar dacă s-au schimbat); query cu scope atins
  const membership = !before || !after || before.status !== after.status;
  const changed = changedFields(before, after);
  const scopes = new Set([...(before?.scopes ?? []), ...(after?.scopes ?? [])]);
  for (const r of db.prepare("SELECT * FROM page_deps WHERE entity = ? AND kind = 'query'").all(ev.entity)) {
    const fields = r.fields ? JSON.parse(r.fields) : null;
    const hit = ev.action === 'reorder'
      || (r.scope ? scopes.has(r.scope) : (!fields || membership || fields.some(f => changed.has(f))));
    if (hit) expand(r.path, `lista ${r.component}${r.scope ? ` (${r.scope})` : ''}${r.reason ? ` — ${r.reason}` : ''}`);
  }

  // 5. adresele proprii, cea veche și cea nouă
  for (const p of before?.paths ?? []) add(p, after?.paths?.includes(p) ? 'pagina proprie' : 'adresa veche');
  for (const p of after?.paths ?? []) add(p, before?.paths?.includes(p) ? 'pagina proprie' : 'adresă nouă');

  // 6. capetele relațiilor atinse: paginile lor proprii
  for (const t of touched) {
    const [k, id] = t.split(':');
    for (const r of db.prepare("SELECT DISTINCT path FROM page_deps WHERE entity = ? AND entity_id = ? AND kind = 'page'").all(k, +id))
      add(r.path, `capăt al relației (${t})`);
  }
  // 7. componentele comune sunt extinse în expand(); 8. jetoanele sunt deja dependențe `direct` pe Date firmă.
  return out;
}

// ———————————————————————————————————————————— procesarea evenimentelor (§3.5)

const running = new WeakSet();

export function processEvents(db, {limit = RENDER_NOW, log = () => {}} = {}) {
  if (running.has(db)) return {skipped: true};
  running.add(db);
  const summary = {events: 0, rendered: 0, invalidated: 0, failed: 0};
  try {
    const due = db.prepare(`SELECT * FROM change_events
      WHERE status = 'pending' OR (status = 'failed' AND attempts < ? AND (retry_at IS NULL OR retry_at <= ?)) ORDER BY id`).all(MAX_ATTEMPTS, nowIso());
    for (const ev of due) {
      const r = processEvent(db, ev, {limit});
      summary.events++; summary.rendered += r.rendered; summary.invalidated += r.invalidated; summary.failed += r.failed.length;
      log(ev, r);
    }
  } finally { running.delete(db); }
  return summary;
}

export function processEvent(db, ev, {limit = RENDER_NOW} = {}) {
  const result = {affected: 0, rendered: 0, invalidated: 0, failed: [], paths: new Map()};
  tx(db, () => {
    const aff = affected(db, ev);
    result.affected = aff.size;
    const logRow = db.prepare('INSERT INTO sync_log (event_id, at, path, action, detail) VALUES (?, ?, ?, ?, ?)');
    let i = 0;
    for (const [p, why] of aff) {
      cacheOf(db).delete(p);
      db.prepare('UPDATE page_index SET stale = 1 WHERE path = ?').run(p);
      if (i++ >= limit) { logRow.run(ev.id, nowIso(), p, 'invalidated', why); result.invalidated++; result.paths.set(p, 'invalidated'); continue; }
      try {
        const r = renderAndStore(db, p);
        logRow.run(ev.id, nowIso(), p, r.action, why);
        result.rendered++; result.paths.set(p, r.action);
      } catch (err) {
        // paginile reușite rămân valabile; cea eșuată rămâne `stale` și se reia
        db.prepare('UPDATE page_index SET error = ? WHERE path = ?').run(String(err.message), p);
        logRow.run(ev.id, nowIso(), p, 'failed', `${why}: ${err.message}`);
        result.failed.push({path: p, error: err.message}); result.paths.set(p, 'failed');
      }
    }
    if (result.failed.length) {
      const attempts = ev.attempts + 1;
      db.prepare(`UPDATE change_events SET status = 'failed', attempts = ?, last_error = ?, retry_at = ?, processed_at = ?, affected = ? WHERE id = ?`)
        .run(attempts, result.failed.map(f => `${f.path}: ${f.error}`).join('\n'), new Date(Date.now() + BACKOFF_MS * 2 ** (attempts - 1)).toISOString(),
          nowIso(), aff.size, ev.id);
    } else {
      db.prepare(`UPDATE change_events SET status = 'done', processed_at = ?, affected = ?, last_error = NULL, retry_at = NULL WHERE id = ?`).run(nowIso(), aff.size, ev.id);
    }
  });
  return result;
}

// „Reia” din Panou: evenimentul intră din nou la procesare, imediat.
export function retryEvent(db, id) {
  db.prepare(`UPDATE change_events SET status = 'pending', retry_at = NULL WHERE id = ? AND status = 'failed'`).run(id);
  return processEvents(db);
}

// ———————————————————————————————————————————— scanarea (§3.5): toate adresele publice, de la zero

export function scan(db, {log = () => {}} = {}) {
  const paths = publicPaths(db), res = {rendered: 0, failed: [], removed: 0};
  for (const p of paths) {
    try { renderAndStore(db, p); res.rendered++; log(p, 'rendered'); }
    catch (err) {
      db.prepare(`INSERT INTO page_index (path, status, error, stale) VALUES (?, 500, ?, 1)
        ON CONFLICT(path) DO UPDATE SET error = excluded.error, stale = 1`).run(p, String(err.message));
      res.failed.push({path: p, error: err.message}); log(p, 'failed', err);
    }
  }
  tx(db, () => {
    const keep = new Set(paths);
    for (const r of db.prepare('SELECT path FROM page_index').all()) if (!keep.has(r.path)) { removePage(db, r.path); res.removed++; }
    for (const r of db.prepare("SELECT DISTINCT path FROM page_deps WHERE path NOT LIKE '#layout:%'").all()) if (!keep.has(r.path)) { removePage(db, r.path); res.removed++; }
    db.prepare(`INSERT INTO meta (key, value) VALUES ('scan_needed', '0') ON CONFLICT(key) DO UPDATE SET value = '0'`).run();
    db.prepare(`INSERT INTO meta (key, value) VALUES ('last_scan', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify({at: nowIso(), pages: res.rendered, failed: res.failed.length, removed: res.removed}));
  });
  return res;
}

// Starea propagării (§3.5), pentru Panou.
export function syncStatus(db) {
  const n = sql => db.prepare(sql).get().n;
  return {
    pending: n("SELECT COUNT(*) n FROM change_events WHERE status = 'pending'"),
    failed: n("SELECT COUNT(*) n FROM change_events WHERE status = 'failed'"),
    pages: n('SELECT COUNT(*) n FROM page_index'),
    stale: n('SELECT COUNT(*) n FROM page_index WHERE stale = 1'),
    errors: n('SELECT COUNT(*) n FROM page_index WHERE error IS NOT NULL'),
    deps: n('SELECT COUNT(*) n FROM page_deps'),
    last: db.prepare("SELECT processed_at FROM change_events WHERE status = 'done' ORDER BY processed_at DESC LIMIT 1").get()?.processed_at ?? null
  };
}
