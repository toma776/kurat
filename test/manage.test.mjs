// /manage: autentificare, guvernanță (§5.15), API, „Unde apare”, hartă (§5.21–22), SSE.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {imported} from './helpers.mjs';
import {createServer} from '../src/server.mjs';
import {scan, processEvents} from '../src/core/sync.mjs';
import {createUser, hashPassword, verifyPassword} from '../src/auth/auth.mjs';
import {RELATION_TYPES} from '../src/registry/entities.mjs';
import * as graph from '../src/core/graph.mjs';

const PW = 'parola-de-test-123';
let server, base, db;
const sessions = {};

before(async () => {
  ({db} = imported());
  scan(db);
  for (const [role, email] of [['admin', 'admin@test.ro'], ['editor', 'editor@test.ro'], ['viewer', 'viewer@test.ro']])
    createUser(db, {email, name: role, role, password: PW});
  server = createServer(db, {log: () => {}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const role of ['admin', 'editor', 'viewer']) sessions[role] = await login(`${role}@test.ro`, PW);
});
after(() => server.close());

async function login(email, password) {
  const r = await fetch(`${base}/api/manage/login`, {method: 'POST', headers: {'content-type': 'application/json', origin: base}, body: JSON.stringify({email, password})});
  if (!r.ok) return {status: r.status};
  return {cookie: r.headers.get('set-cookie').split(';')[0], status: r.status};
}
const call = async (who, method, path, body, headers = {}) => {
  const r = await fetch(`${base}/api/manage${path}`, {method, headers: {'content-type': 'application/json', origin: base, ...(who ? {cookie: sessions[who].cookie} : {}), ...headers},
    body: body ? JSON.stringify(body) : undefined});
  return {status: r.status, body: await r.json().catch(() => null)};
};
const id = (table, where, ...p) => db.prepare(`SELECT id FROM ${table} WHERE ${where}`).get(...p).id;
const settle = () => new Promise(r => setTimeout(r, 30)); // propagarea pornește cu setImmediate după COMMIT

// ———————————————————————————————————————————— autentificare

test('parolele sunt hash-uite cu scrypt și verificate în timp constant', () => {
  const h = hashPassword('secret-lung-1');
  assert.match(h, /^scrypt\$/);
  assert.ok(verifyPassword('secret-lung-1', h));
  assert.ok(!verifyPassword('altceva', h));
});

test('fără sesiune: API-ul dă 401, panoul trimite la autentificare; cookie-ul de sesiune e HttpOnly', async () => {
  assert.equal((await call(null, 'GET', '/entities/servicii')).status, 401);
  const r = await fetch(`${base}/manage/`, {redirect: 'manual'});
  assert.equal(r.status, 303);
  assert.match(r.headers.get('location'), /^\/manage\/login\//);
  const ok = await fetch(`${base}/api/manage/login`, {method: 'POST', headers: {'content-type': 'application/json', origin: base}, body: JSON.stringify({email: 'viewer@test.ro', password: PW})});
  assert.match(ok.headers.get('set-cookie'), /HttpOnly/);
  assert.match(ok.headers.get('set-cookie'), /SameSite=Lax/);
});

test('încercările de autentificare sunt limitate', async () => {
  const codes = [];
  for (let i = 0; i < 9; i++) codes.push((await login('nimeni@test.ro', 'gresit')).status);
  assert.deepEqual(codes.slice(0, 8), Array(8).fill(401));
  assert.equal(codes[8], 429);
  db.prepare('DELETE FROM login_attempts').run();
});

test('scrierile venite din alt site sunt refuzate', async () => {
  const r = await call('admin', 'PUT', `/entities/valori/${id('values_kurat', '1 = 1 LIMIT 1')}`, {data: {text: 'x'}}, {origin: 'https://evil.example'});
  assert.equal(r.status, 403);
});

test('panourile se randează pentru un utilizator autentificat, fără cache', async () => {
  const s = id('services', "slug = 'generala'");
  for (const p of ['/manage/', '/manage/entitati/', '/manage/entitati/servicii/', `/manage/entitati/servicii/${s}/prezentare/`, `/manage/entitati/servicii/${s}/detalii/`,
    `/manage/entitati/servicii/${s}/relatii/`, `/manage/entitati/servicii/${s}/surse/`, `/manage/entitati/servicii/${s}/unde-apare/`, `/manage/entitati/servicii/${s}/istoric/`,
    '/manage/harta/', '/manage/surse/', '/manage/surse/legaturi/', '/manage/utilizatori/', '/manage/entitati/tarife/nou/']) {
    const r = await fetch(base + p, {headers: {cookie: sessions.admin.cookie}});
    assert.equal(r.status, 200, p);
    assert.equal(r.headers.get('cache-control'), 'no-store', p);
  }
  // utilizatorii: doar administratorii
  assert.equal((await fetch(`${base}/manage/utilizatori/`, {headers: {cookie: sessions.editor.cookie}})).status, 403);
});

// ———————————————————————————————————————————— guvernanță (§5.15)

test('§5.15 — un editor nu poate publica un tip cu aprobare, dar poate salva ciorna', async () => {
  const t = id('prices', '1 = 1 ORDER BY id LIMIT 1');
  assert.equal((await call('editor', 'PUT', `/entities/tarife/${t}`, {data: {pret: 999}, publish: true})).status, 403);
  assert.equal((await call('editor', 'POST', `/entities/tarife/${t}/status`, {status: 'published'})).status, 403);
  const draft = await call('editor', 'PUT', `/entities/tarife/${t}`, {data: {pret: 999}});
  assert.equal(draft.status, 200);
  assert.equal(draft.body.draft, true);
  assert.notEqual(db.prepare('SELECT pret FROM prices WHERE id = ?').get(t).pret, 999, 'site-ul nu se schimbă');
  // administratorul publică ciorna
  assert.equal((await call('admin', 'POST', `/entities/tarife/${t}/status`, {status: 'published'})).status, 200);
  assert.equal(db.prepare('SELECT pret FROM prices WHERE id = ?').get(t).pret, 999);
});

test('§5.15 — un editor nu poate arhiva un tip cu aprobare și nu poate confirma o sursă a lui', async () => {
  const x = id('extras', '1 = 1 ORDER BY id LIMIT 1');
  assert.equal((await call('editor', 'POST', `/entities/extra/${x}/status`, {status: 'archived'})).status, 403);
  const p = db.prepare("SELECT id FROM provenance WHERE entity = 'extra' AND certainty <> 'confirmed' LIMIT 1").get().id;
  assert.equal((await call('editor', 'POST', `/provenance/${p}/confirm`)).status, 403);
  assert.equal((await call('admin', 'POST', `/provenance/${p}/confirm`)).status, 200);
  assert.equal(db.prepare('SELECT certainty, verified_by FROM provenance WHERE id = ?').get(p).certainty, 'confirmed');
});

test('§5.15 — pe o relație sensibilă, un editor nu poate schimba legăturile și nu poate confirma legături (una câte una sau în masă)', async () => {
  const rel = RELATION_TYPES.find(r => r.id === 'sectiuni.servicii_persoane');
  rel.sensitive = true; // în registrul Kurat nicio relație nu e sensibilă; o marcăm doar pentru test
  try {
    const sec = id('sections', "kind = 'servicii'");
    const pending = db.prepare("SELECT dst_id FROM rel_sections_servicii_persoane WHERE src_id = ? AND status = 'inferred'").all(sec);
    assert.ok(pending.length);
    assert.equal((await call('editor', 'PUT', `/entities/sectiuni/${sec}/links/servicii_persoane`, {items: []})).status, 403);
    assert.equal((await call('editor', 'PUT', `/entities/sectiuni/${sec}/links/servicii_persoane/${pending[0].dst_id}/status`, {status: 'confirmed'})).status, 403);
    assert.equal((await call('editor', 'POST', '/inferred/sectiuni.servicii_persoane', {action: 'confirm', pairs: [{src: sec, dst: pending[0].dst_id}]})).status, 403);
    assert.equal(db.prepare("SELECT COUNT(*) n FROM rel_sections_servicii_persoane WHERE status = 'inferred'").get().n, pending.length, 'nimic nu s-a schimbat');
    // aceeași confirmare, pe relația nesensibilă: editorul poate
    rel.sensitive = false;
    assert.equal((await call('editor', 'PUT', `/entities/sectiuni/${sec}/links/servicii_persoane/${pending[0].dst_id}/status`, {status: 'confirmed'})).status, 200);
  } finally { rel.sensitive = false; }
});

test('vizualizarea: doar citire', async () => {
  assert.equal((await call('viewer', 'GET', '/entities/servicii')).status, 200);
  assert.equal((await call('viewer', 'PUT', `/entities/valori/${id('values_kurat', '1 = 1 LIMIT 1')}`, {data: {text: 'x'}, publish: true})).status, 403);
  assert.equal((await call('viewer', 'POST', '/entities/valori', {data: {titlu: 'x'}})).status, 403);
});

// ———————————————————————————————————————————— API: salvare, conflicte, ștergere, inverse, istoric

test('blocare optimistă: o salvare peste o versiune veche dă 409 și spune cine a salvat', async () => {
  const v = id('values_kurat', '1 = 1 ORDER BY id LIMIT 1');
  const {body: {record}} = await call('admin', 'GET', `/entities/valori/${v}`);
  await new Promise(r => setTimeout(r, 5));
  assert.equal((await call('editor', 'PUT', `/entities/valori/${v}`, {data: {text: 'Editorul a scris'}, publish: true, expectedUpdatedAt: record.updated_at})).status, 200);
  const r = await call('admin', 'PUT', `/entities/valori/${v}`, {data: {text: 'Adminul peste'}, publish: true, expectedUpdatedAt: record.updated_at});
  assert.equal(r.status, 409);
  assert.match(r.body.error, /editor/);
});

test('ce depinde obligatoriu de o înregistrare o ține pe loc; ștergerea rămâne în Istoric', async () => {
  const c = id('clients', "nume = 'Lensa'");
  const r = await call('admin', 'DELETE', `/entities/clienti/${c}`);
  assert.equal(r.status, 422);
  assert.match(r.body.error, /depind obligatoriu de ea/, 'testimonialele Lensa au nevoie de client');
  assert.match(r.body.error, /Testimonial/);
  const fresh = (await call('admin', 'POST', '/entities/valori', {data: {titlu: 'De șters'}, publish: true})).body.id;
  assert.equal((await call('admin', 'DELETE', `/entities/valori/${fresh}`)).status, 200);
  assert.equal(db.prepare("SELECT action FROM audit_log WHERE entity = 'valori' AND entity_id = ? ORDER BY id DESC").get(fresh).action, 'delete');
});

test('editarea din capătul invers: o relație N:1 obligatorie se mută, nu se scoate', async () => {
  const t = id('prices', "eticheta = '1–2 camere' AND serviciu_id = (SELECT id FROM services WHERE slug = 'generala')");
  const gen = id('services', "slug = 'generala'"), dc = id('services', "slug = 'dupa-constructor'");
  assert.equal((await call('admin', 'PUT', `/entities/servicii/${gen}/inverse/tarife/serviciu_id`, {remove: t})).status, 422);
  const r = await call('admin', 'PUT', `/entities/servicii/${dc}/inverse/tarife/serviciu_id`, {add: t});
  assert.equal(r.status, 200);
  assert.equal(r.body.moved, gen);
  assert.equal(db.prepare('SELECT serviciu_id FROM prices WHERE id = ?').get(t).serviciu_id, dc);
});

test('revenire din Istoric pe un singur câmp: tot o modificare, cu eveniment', async () => {
  const v = id('values_kurat', '1 = 1 ORDER BY id DESC LIMIT 1');
  const before = db.prepare('SELECT text FROM values_kurat WHERE id = ?').get(v).text;
  await call('admin', 'PUT', `/entities/valori/${v}`, {data: {text: 'Temporar'}, publish: true});
  const a = db.prepare("SELECT id FROM audit_log WHERE entity = 'valori' AND entity_id = ? ORDER BY id DESC").get(v).id;
  const ev0 = db.prepare('SELECT MAX(id) n FROM change_events').get().n;
  assert.equal((await call('admin', 'POST', `/history/${a}/revert`, {field: 'text'})).status, 200);
  assert.equal(db.prepare('SELECT text FROM values_kurat WHERE id = ?').get(v).text, before);
  assert.ok(db.prepare('SELECT MAX(id) n FROM change_events').get().n > ev0);
});

test('salvarea întoarce observațiile noi (§3.11)', async () => {
  const s = id('services', "slug = 'locuinte'");
  const r = await call('admin', 'PUT', `/entities/servicii/${s}`, {data: {descriere: 'Sună la 0722 111 222 pentru o ofertă.'}, publish: true});
  assert.equal(r.status, 200);
  assert.ok(r.body.observations.some(o => /0722 111 222/.test(o.message)));
});

// ———————————————————————————————————————————— previzualizare

test('previzualizarea arată ciorna, marcată; site-ul public nu; cere autentificare', async () => {
  const s = id('services', "slug = 'birouri'");
  await call('admin', 'PUT', `/entities/servicii/${s}`, {data: {descriere: 'Text în ciornă pentru birouri.'}});
  const prev = await (await fetch(`${base}/manage/previzualizare/servicii/birouri`, {headers: {cookie: sessions.viewer.cookie}})).text();
  assert.match(prev, /Previzualizare — conținut nepublicat/);
  assert.match(prev, /Text în ciornă pentru birouri/);
  assert.doesNotMatch(await (await fetch(`${base}/servicii/birouri`)).text(), /Text în ciornă/);
  assert.equal((await fetch(`${base}/manage/previzualizare/servicii/birouri`, {redirect: 'manual'})).status, 303);
  // modificare nesalvată, din editor
  const r = await call('editor', 'POST', '/preview', {key: 'servicii', id: s, data: {descriere: 'Nesalvat <script>alert(1)</script>'}});
  assert.equal(r.status, 200);
  assert.match(r.body.html, /Nesalvat/);
});

// ———————————————————————————————————————————— Unde apare, hartă, legături de verificat

test('„Unde apare”: cele patru niveluri și impactul', async () => {
  // un serviciu cu pagină care are încă o legătură dedusă spre el (testele anterioare au confirmat o parte)
  const s = db.prepare(`SELECT s.id, s.slug FROM services s WHERE s.pagina = 1 AND s.id IN (SELECT dst_id FROM rel_sections_servicii_persoane WHERE status = 'inferred'
    UNION SELECT dst_id FROM rel_sections_servicii_companii WHERE status = 'inferred') LIMIT 1`).get();
  const {body: w} = await call('viewer', 'GET', `/entities/servicii/${s.id}/where-used`);
  assert.ok(w.impact >= 2);
  assert.ok(w.direct.some(d => d.dir === 'out' && d.relation === 'servicii.sarcini'));
  assert.ok(w.direct.some(d => d.dir === 'in' && d.status === 'inferred'), 'cardul dedus de pe homepage');
  assert.ok(w.pages.some(p => p.path === `/servicii/${s.slug}`));
  assert.ok(w.pages.some(p => p.uses.some(u => u.via === 'Subsol')), 'componenta comună e numită');
  assert.ok(w.detected.some(d => d.kind === 'legătură dedusă'));
  const {body: f} = await call('viewer', 'GET', `/entities/firma/${id('company', '1 = 1')}/where-used`);
  assert.ok(f.tokens.some(t => t.tokens.includes('telefon')), '„Se completează automat în”');
});

test('§5.21 — traseul dintre două entități cunoscute are lungimea așteptată', () => {
  const t = id('prices', "eticheta = '3+ camere' AND serviciu_id = (SELECT id FROM services WHERE slug = 'generala')");
  const x = id('extras', "nume = 'Curățare saltea'");
  const r = graph.path(db, `tarife:${t}`, `extra:${x}`);
  assert.ok(r.found);
  assert.equal(r.steps.length, 2); // tarif → serviciu → serviciu suplimentar
  assert.equal(graph.path(db, `tarife:${t}`, `tarife:${t}`).steps.length, 0);
});

test('§5.22 — sănătatea hărții: 0 trimiteri rupte și 0 relații obligatorii goale', async () => {
  const {body: h} = await call('viewer', 'GET', '/graph/health');
  assert.deepEqual(h.broken, []);
  assert.deepEqual(h.requiredEmpty, []);
  const {body: o} = await call('viewer', 'GET', '/graph/overview');
  assert.ok(o.types.length >= 10 && o.links.some(l => l.relation === 'servicii.sarcini' && l.count > 50));
  const {body: e} = await call('viewer', 'GET', '/graph/edges');
  assert.equal(e.find(r => r.id === 'tarife.serviciu_id').storage, 'prices.serviciu_id');
});

test('legăturile de verificat: confirmarea în masă e o tranzacție cu UN eveniment și se propagă', async () => {
  const {body: groups} = await call('viewer', 'GET', '/inferred');
  const g = groups.find(x => x.relation === 'sectiuni.servicii_companii');
  assert.ok(g && g.items.length >= 1);
  const ev0 = db.prepare('SELECT MAX(id) n FROM change_events').get().n;
  const r = await call('editor', 'POST', '/inferred/sectiuni.servicii_companii', {action: 'confirm', pairs: g.items.map(i => ({src: i.src.id, dst: i.dst.id}))});
  assert.equal(r.status, 200);
  const evs = db.prepare('SELECT * FROM change_events WHERE id > ?').all(ev0);
  assert.equal(evs.length, 1);
  await settle(); processEvents(db);
  const log = db.prepare('SELECT path FROM sync_log WHERE event_id = ?').all(evs[0].id).map(x => x.path);
  assert.ok(log.includes('/'), 'homepage-ul (care afișează cardurile) se reface');
  assert.match(await (await fetch(`${base}/`)).text(), /Birouri și spații comerciale/);
  // fiecare înregistrare atinsă are istoricul ei
  assert.ok(db.prepare("SELECT COUNT(*) n FROM audit_log WHERE action = 'links-confirm'").get().n >= 1);
});

// ———————————————————————————————————————————— SSE

test('SSE: un panou deschis află de modificările altui utilizator', async () => {
  const ctrl = new AbortController();
  const res = await fetch(`${base}/api/manage/events`, {headers: {cookie: sessions.viewer.cookie}, signal: ctrl.signal});
  assert.equal(res.headers.get('content-type'), 'text/event-stream; charset=utf-8');
  const reader = res.body.getReader();
  const v = id('values_kurat', '1 = 1 ORDER BY id LIMIT 1');
  const got = (async () => {
    let buf = '';
    while (!buf.includes('event: change')) { const {value, done} = await reader.read(); if (done) break; buf += new TextDecoder().decode(value); }
    return buf;
  })();
  await new Promise(r => setTimeout(r, 50));
  await call('editor', 'PUT', `/entities/valori/${v}`, {data: {text: 'Schimbat de editor, live'}, publish: true});
  const buf = await Promise.race([got, new Promise((_, rej) => setTimeout(() => rej(new Error('niciun eveniment SSE')), 3000))]);
  ctrl.abort();
  const data = JSON.parse(buf.split('event: change\ndata: ')[1].split('\n')[0]);
  assert.equal(data.user_name, 'editor');
  assert.equal(data.entity, 'valori');
  assert.equal(data.entity_id, v);
});
