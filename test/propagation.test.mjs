// Testele obligatorii de propagare (§5, 1–14 și 23), pe datele reale ale kurat.ro.
// Un test pică dacă se refac MAI MULTE pagini decât trebuie, nu doar mai puține.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {imported} from './helpers.mjs';
import {createStore} from '../src/core/store.mjs';
import {scan, processEvents, serve, hooks, retryEvent, publicPaths, cacheOf} from '../src/core/sync.mjs';

function site() {
  const {db, dir} = imported();
  scan(db);
  const ana = createStore(db, {user: {name: 'Ana', email: 'ana@kurat.ro'}});
  const lastEvent = () => db.prepare('SELECT COALESCE(MAX(id), 0) id FROM change_events').get().id;
  // aplică o modificare, rulează propagarea și întoarce paginile atinse de evenimentele ei
  const change = fn => {
    const from = lastEvent();
    fn();
    const summary = processEvents(db);
    const rows = db.prepare('SELECT path, action, detail FROM sync_log WHERE event_id > ?').all(from);
    return {summary, rows, paths: new Set(rows.map(r => r.path)), events: db.prepare('SELECT * FROM change_events WHERE id > ?').all(from)};
  };
  const html = p => serve(db, p).html ?? '';
  const id = (table, where, ...params) => db.prepare(`SELECT id FROM ${table} WHERE ${where}`).get(...params).id;
  return {db, dir, ana, change, html, id, all: publicPaths(db)};
}
const sorted = s => [...s].sort();

test('scanarea randează toate cele 12 pagini publice și scrie dependențele', () => {
  const {db, all} = site();
  assert.equal(all.length, 12);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM page_index WHERE error IS NULL').get().n, 12);
  // componentele comune: o singură copie a dependențelor, un singur rând pe pagină
  assert.ok(db.prepare("SELECT COUNT(*) n FROM page_deps WHERE path = '#layout:Antet'").get().n > 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM page_deps WHERE kind = 'layout' AND component = 'Antet'").get().n, 12);
});

test('§5.1 — schimb telefonul în Date firmă: toate paginile se refac, numărul vechi dispare de peste tot', () => {
  const {ana, change, html, all, id} = site();
  for (const p of all) assert.match(html(p), /0742 293 391/);
  const r = change(() => ana.update('firma', id('company', '1 = 1'), {telefon: '0722 000 111', whatsapp: '0722 000 111'}));
  assert.deepEqual(sorted(r.paths), all);
  for (const p of all) {
    const h = html(p);
    assert.doesNotMatch(h, /0742[ .]?293[ .]?391|40742293391/, `numărul vechi a rămas pe ${p}`);
    assert.match(h, /0722 000 111/);
    assert.match(h, /tel:\+40722000111/);
  }
  // și în textele cu {telefon} (pasul „Ne contactezi”)
  assert.match(html('/'), /Comandă serviciul dorit la 0722 000 111/);
});

test('§5.2 — schimb un preț: se refac DOAR paginile care îl afișează', () => {
  const {ana, change, html, id} = site();
  const t = id('prices', "eticheta = '1–2 camere' AND serviciu_id = (SELECT id FROM services WHERE slug = 'mentenanta')");
  const r = change(() => ana.update('tarife', t, {pret: 375}, {publish: true}));
  assert.deepEqual(sorted(r.paths), ['/servicii', '/servicii/mentenanta']);
  assert.match(html('/servicii/mentenanta'), /375 lei \+ TVA/);
  assert.match(html('/servicii'), /de la <\/span><strong[^>]*>375 lei/);
});

test('§5.3 — mut un tarif la alt serviciu: dispare din lista veche și apare în cea nouă', () => {
  const {ana, change, html, id} = site();
  const t = id('prices', "eticheta = 'Casă' AND serviciu_id = (SELECT id FROM services WHERE slug = 'mentenanta')");
  assert.match(html('/servicii/mentenanta'), /Casă/);
  const r = change(() => ana.update('tarife', t, {serviciu_id: id('services', "slug = 'dupa-constructor'")}, {publish: true}));
  assert.deepEqual(sorted(r.paths), ['/servicii', '/servicii/dupa-constructor', '/servicii/mentenanta']);
  assert.doesNotMatch(html('/servicii/mentenanta'), /Casă/);
  assert.match(html('/servicii/dupa-constructor'), /Casă/);
});

test('§5.4 — schimb doar descrierea unei entități spre care trimit meniuri: paginile cu doar linkul NU se refac', () => {
  const {ana, change, id} = site();
  const r = change(() => ana.update('servicii', id('services', "slug = 'birouri'"), {descriere: 'Curățenie pentru birouri, nouă.'}, {publish: true}));
  // subsolul (pe toate paginile) și „Alte servicii” au doar linkul; descrierea apare doar pe pagina proprie și pe /servicii
  assert.deepEqual(sorted(r.paths), ['/servicii', '/servicii/birouri']);
});

test('§5.5 — schimb numele aceleiași entități: meniurile și cardurile se refac', () => {
  const {ana, change, html, id, all} = site();
  const r = change(() => ana.update('servicii', id('services', "slug = 'birouri'"), {nume: 'Curățenie pentru birouri', nume_scurt: 'Birouri și sedii'}, {publish: true}));
  assert.deepEqual(sorted(r.paths), all, 'numele apare în subsol, deci pe toate paginile');
  for (const p of ['/servicii/locuinte', '/servicii/generala']) assert.match(html(p), /Curățenie pentru birouri/, `„Alte servicii” pe ${p}`);
  assert.match(html('/'), />Birouri și sedii</);
});

test('§5.6 — schimb adresa unei pagini publicate: 301 fără lanț, linkuri noi, adresa veche își pierde dependențele', () => {
  const {db, ana, change, html, id} = site();
  const g = id('services', "slug = 'generala'");
  const r = change(() => ana.update('servicii', g, {slug: 'curatenie-generala'}, {publish: true}));
  assert.ok(r.paths.has('/servicii/generala') && r.paths.has('/servicii/curatenie-generala'));
  assert.deepEqual(serve(db, '/servicii/generala'), {action: 'redirect', status: 301, location: '/servicii/curatenie-generala', html: undefined});
  assert.match(html('/servicii/locuinte'), /href="\/servicii\/curatenie-generala"/);
  assert.doesNotMatch(html('/servicii/locuinte'), /href="\/servicii\/generala"/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM page_deps WHERE path = '/servicii/generala'").get().n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM page_index WHERE path = '/servicii/generala'").get().n, 0);

  // a doua mutare: adresa cea mai veche duce direct la cea finală, fără lanț
  change(() => ana.update('servicii', g, {slug: 'generala-plus'}, {publish: true}));
  assert.equal(serve(db, '/servicii/generala').location, '/servicii/generala-plus');
  assert.equal(serve(db, '/servicii/curatenie-generala').location, '/servicii/generala-plus');
  // înapoi la adresa inițială: fără buclă
  change(() => ana.update('servicii', g, {slug: 'generala'}, {publish: true}));
  assert.equal(serve(db, '/servicii/generala').status, 200);
  assert.equal(serve(db, '/servicii/generala-plus').location, '/servicii/generala');
});

test('§5.7 — o redirecționare trimite la entitate, deci urmează singură adresa nouă', () => {
  const {db, ana, change, id} = site();
  const b = id('services', "slug = 'birouri'");
  db.prepare("INSERT INTO redirects (from_path, to_ref, code, created_at, updated_at) VALUES ('/curatenie-birouri', ?, 301, datetime('now'), datetime('now'))").run(`ref:servicii:${b}`);
  assert.equal(serve(db, '/curatenie-birouri').location, '/servicii/birouri');
  change(() => ana.update('servicii', b, {slug: 'sedii'}, {publish: true}));
  assert.equal(serve(db, '/curatenie-birouri').location, '/servicii/sedii');
});

test('§5.8 — leg o pagină de o ciornă: pe site nu apare nimic; public ciorna: pagina se reface singură (pending)', () => {
  const {db, ana, change, html, id, all} = site();
  const draft = ana.create('servicii', {fel: 'curatenie', nume: 'Curățenie geamuri', nume_scurt: 'Geamuri', pagina: true}, {publish: false});
  const menu = createStore(db).list('meniuri').find(m => m.cheie === 'subsol-servicii');
  const r1 = change(() => ana.update('meniuri', menu.id, {linkuri: [...menu.linkuri, {href: `ref:servicii:${draft}`}]}));
  assert.deepEqual(sorted(r1.paths), all, 'meniul din subsol e pe toate paginile');
  assert.doesNotMatch(html('/'), />Geamuri</);
  assert.ok(db.prepare("SELECT 1 FROM page_deps WHERE path = '#layout:Subsol' AND kind = 'pending' AND entity = 'servicii' AND entity_id = ?").get(draft));

  const r2 = change(() => ana.update('servicii', draft, {}, {publish: true}));
  assert.ok(r2.paths.has('/servicii/curatenie-geamuri'), 'pagina nouă');
  assert.deepEqual(sorted([...r2.paths].filter(p => p !== '/servicii/curatenie-geamuri')), all);
  assert.match(html('/'), /href="\/servicii\/curatenie-geamuri">Geamuri</);
  assert.ok(r2.rows.some(x => /așteaptă publicarea/.test(x.detail)));
  void id;
});

test('§5.9 — o legătură dedusă nu apare pe site; confirmată apare; scoasă dispare', () => {
  const {db, ana, change, html} = site();
  const sec = db.prepare("SELECT id FROM sections WHERE kind = 'servicii'").get().id;
  assert.doesNotMatch(html('/'), /Curățenie rezidențială/);
  const links = ana.links('sectiuni', sec, 'servicii_persoane');
  const confirm = links.map(l => ({id: l.dst_id, status: 'confirmed', attrs: l.attrs}));
  const r = change(() => ana.setLinks('sectiuni', sec, 'servicii_persoane', confirm));
  // homepage-ul (care afișează cardurile) + paginile proprii ale capetelor atinse (§3.4 pasul 6); serviciile fără pagină nu au ce reface
  assert.deepEqual(sorted(r.paths), ['/', '/servicii/dupa-constructor', '/servicii/locuinte']);
  assert.match(html('/'), /Curățenie rezidențială/);
  const locuinte = db.prepare("SELECT id FROM services WHERE slug = 'locuinte'").get().id;
  change(() => ana.setLinks('sectiuni', sec, 'servicii_persoane', confirm.filter(l => l.id !== locuinte)));
  assert.doesNotMatch(html('/'), /Curățenie rezidențială/);
});

test('§5.10 — salvez o ciornă: zero evenimente și niciun cache atins', () => {
  const {db, ana, change, html} = site();
  const v = createStore(db).list('valori')[0];
  const before = html('/'), cached = new Map(cacheOf(db));
  const r = change(() => ana.update('valori', v.id, {text: 'Ciornă nepublicată'}));
  assert.equal(r.events.length, 0);
  assert.equal(r.paths.size, 0);
  assert.deepEqual([...cacheOf(db).keys()].sort(), [...cached.keys()].sort());
  assert.equal(html('/'), before);
});

test('§5.12 — înlocuiesc o imagine: ID-ul rămâne, ?v= e nou pe toate paginile care o folosesc', () => {
  const {db, dir, ana, change, html} = site();
  const m = db.prepare("SELECT id, path, updated_at FROM media WHERE path LIKE '%/home.webp'").get();
  const oldV = html('/servicii').match(/home\.webp\?v=(\w+)/)[1];
  const written = [];
  const r = change(() => ana.replaceMedia(m.id, {buffer: Buffer.from('imagine nouă'), mime: 'image/webp', mediaDir: path.join(dir, 'media'),
    writeFile: (f, b) => { fs.mkdirSync(path.dirname(f), {recursive: true}); fs.writeFileSync(f, b); written.push(f); }}));
  assert.equal(written.length, 1, 'fișierul se scrie după COMMIT');
  assert.equal(db.prepare('SELECT id FROM media WHERE path = ?').get(m.path).id, m.id);
  const users = db.prepare("SELECT DISTINCT path FROM page_deps WHERE entity = 'media' AND entity_id = ? AND path NOT LIKE '#layout:%'").all(m.id).map(x => x.path);
  assert.ok(users.length >= 2);
  assert.deepEqual(sorted(r.paths), sorted(users));
  for (const p of users) {
    const v = html(p).match(/home\.webp\?v=(\w+)/)[1];
    assert.notEqual(v, oldV, `?v= vechi pe ${p}`);
  }
});

test('§5.14 — randarea unei pagini aruncă o eroare: evenimentul devine failed, se reia, celelalte pagini rămân valabile', () => {
  const {db, ana, change, html, id, all} = site();
  hooks.beforeRender = p => { if (p === '/servicii/birouri') throw new Error('eroare de test'); };
  try {
    const r = change(() => ana.update('firma', id('company', '1 = 1'), {email: 'contact@kurat.ro'}));
    const ev = r.events[0];
    assert.equal(ev.status, 'failed');
    assert.equal(ev.attempts, 1);
    assert.ok(ev.retry_at > new Date().toISOString(), 'reîncercarea are pauză');
    assert.match(ev.last_error, /\/servicii\/birouri: eroare de test/);
    assert.equal(r.rows.filter(x => x.action === 'rendered').length, all.length - 1, 'celelalte pagini s-au refăcut');
    assert.match(html('/servicii/locuinte'), /contact@kurat\.ro/);
    // înainte de pauză nu se reia singur
    assert.equal(processEvents(db).events, 0);
    hooks.beforeRender = null;
    retryEvent(db, ev.id); // „Reia” din Panou
    assert.equal(db.prepare('SELECT status FROM change_events WHERE id = ?').get(ev.id).status, 'done');
    assert.match(html('/servicii/birouri'), /contact@kurat\.ro/);
  } finally { hooks.beforeRender = null; }
});

test('§5.23 — nicio listă fără scope și fără câmpuri declarate (verificare statică pe ctx.query)', () => {
  const dir = new URL('../src/site/', import.meta.url);
  const bad = [];
  for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.mjs') && x !== 'context.mjs')) {
    const src = fs.readFileSync(new URL(f, dir), 'utf8');
    for (const m of src.matchAll(/ctx\.query\(/g)) {
      const call = src.slice(m.index, src.indexOf('ctx.', m.index + 4) > 0 ? Math.min(src.indexOf('ctx.', m.index + 4), m.index + 600) : m.index + 600);
      if (!/\b(scope|fields)\s*:/.test(call)) bad.push(`${f}: ${call.slice(0, 80)}`);
    }
  }
  assert.deepEqual(bad, []);
});
