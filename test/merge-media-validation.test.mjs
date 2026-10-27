// §5.13 (unirea dublurilor), biblioteca media (§3.9) și „Datele sunt corecte” (§1.8), pe datele reale.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {imported} from './helpers.mjs';
import {createStore} from '../src/core/store.mjs';
import {scan, processEvents, serve} from '../src/core/sync.mjs';
import {findDuplicates, signature, similarity} from '../src/core/duplicates.mjs';
import {validate, validationState} from '../src/core/validations.mjs';
import {createServer} from '../src/server.mjs';
import {createUser} from '../src/auth/auth.mjs';

const fresh = () => { const s = imported(); scan(s.db); return {...s, ana: createStore(s.db, {user: {name: 'Ana', email: 'ana@kurat.ro'}})}; };
const id = (db, table, where, ...p) => db.prepare(`SELECT id FROM ${table} WHERE ${where}`).get(...p).id;

// ———————————————————————————————————————————— dubluri

test('regula de dublură: aceleași cuvinte (pe rădăcină, fără diacritice) și aceleași cifre', () => {
  const s = t => signature([t]);
  assert.equal(similarity(s('Ecografie tiroidiană — 250 lei'), s('Ecografie tiroidă — 250 lei')), 1);
  assert.equal(similarity(s('Masaj 30 de minute'), s('Masaj 60 de minute')), 0);
  assert.ok(similarity(s('Aerisirea încăperilor'), s('Aerisirea și odorizarea încăperilor')) < 0.75, 'un cuvânt de conținut în plus schimbă sensul');
});

test('dublurile se găsesc pe orice tip cu regula declarată în registru', () => {
  const {db} = fresh();
  const pairs = findDuplicates(db, 'sarcini');
  assert.ok(pairs.some(p => /Detartrarea/.test(p.a.title) && p.score === 1));
});

test('§5.13 — unesc două tarife: listele, linkurile și textele (inclusiv ciornele) trimit la cel păstrat; dublura e în Istoric', () => {
  const {db, ana} = fresh();
  const svc = id(db, 'services', "slug = 'mentenanta'");
  const keep = id(db, 'prices', "eticheta = '1–2 camere' AND serviciu_id = ?", svc);
  const dup = ana.create('tarife', {serviciu_id: svc, eticheta: '1-2 camere', pret: 350, plus_tva: true, ordine: 9});
  // trimiteri spre dublură din toate felurile de locuri
  const q = createStore(db).list('intrebari')[0];
  ana.update('intrebari', q.id, {raspuns: `<p>Vezi <a data-ref="tarife:${dup}">tariful</a>.</p>`}, {publish: true});
  const q2 = createStore(db).list('intrebari')[1];
  ana.update('intrebari', q2.id, {raspuns: `<p>Ciornă cu <a data-ref="tarife:${dup}">tarif</a>.</p>`}); // ciornă
  const menu = createStore(db).list('meniuri').find(m => m.cheie === 'subsol-companie');
  ana.update('meniuri', menu.id, {linkuri: [...menu.linkuri, {href: `ref:tarife:${dup}`, label: 'Tarif'}]});
  db.prepare("INSERT INTO redirects (from_path, to_ref, code, created_at, updated_at) VALUES ('/tarif-vechi', ?, 301, datetime('now'), datetime('now'))").run(`ref:tarife:${dup}`);
  processEvents(db);
  assert.match(serve(db, '/servicii/mentenanta').html, /1-2 camere/);
  assert.ok(findDuplicates(db, 'tarife', keep).some(d => d.b.id === dup), 'dublura e propusă');

  const ev0 = db.prepare('SELECT MAX(id) n FROM change_events').get().n;
  const r = ana.merge('tarife', keep, [dup]);
  assert.deepEqual(r.merged, [dup]);

  const dump = JSON.stringify(db.prepare('SELECT raspuns, draft FROM faq').all()) + JSON.stringify(db.prepare('SELECT linkuri FROM menus').all())
    + JSON.stringify(db.prepare('SELECT to_ref FROM redirects').all());
  assert.doesNotMatch(dump, new RegExp(`tarife:${dup}(?!\\d)`), 'nicio trimitere spre dublură');
  assert.match(createStore(db).get('intrebari', q.id).raspuns, new RegExp(`data-ref="tarife:${keep}"`));
  assert.match(JSON.stringify(createStore(db).get('intrebari', q2.id).draft), new RegExp(`tarife:${keep}`), 'și în ciornă');
  assert.ok(createStore(db).get('meniuri', menu.id).linkuri.some(l => l.href === `ref:tarife:${keep}`));
  assert.equal(db.prepare("SELECT to_ref FROM redirects WHERE from_path = '/tarif-vechi'").get().to_ref, `ref:tarife:${keep}`);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM prices WHERE id = ?').get(dup).n, 0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM provenance WHERE entity = 'tarife' AND entity_id = ?").get(dup).n, 0, 'sursele au trecut pe cel păstrat');
  const hist = db.prepare("SELECT changes FROM audit_log WHERE entity = 'tarife' AND entity_id = ? AND action = 'merge-delete'").get(dup);
  assert.equal(JSON.parse(hist.changes).snapshot[0].eticheta, '1-2 camere', 'dublura e în Istoric, cu instantaneu');

  // fiecare înregistrare atinsă primește un eveniment; paginile se refac singure
  const evs = db.prepare('SELECT entity, entity_id, action FROM change_events WHERE id > ?').all(ev0);
  assert.ok(evs.some(e => e.entity === 'meniuri' && e.action === 'merge'));
  assert.ok(evs.some(e => e.entity === 'intrebari' && e.entity_id === q.id));
  assert.ok(evs.some(e => e.entity === 'tarife' && e.entity_id === dup && e.action === 'delete'));
  processEvents(db);
  assert.doesNotMatch(serve(db, '/servicii/mentenanta').html, /1-2 camere/);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM change_events WHERE status <> 'done'").get().n, 0);
});

test('unirea a două operațiuni reale: serviciile care le includeau trimit la cea păstrată, fără legături dublate', () => {
  const {db, ana} = fresh();
  const [a, b] = ['Detartrarea și spălarea faianței și a obiectelor sanitare din băi', 'Detartrarea și spălarea obiectelor sanitare și a faianței în băi'].map(t => id(db, 'tasks', 'text = ?', t));
  const users = rel => db.prepare('SELECT src_id FROM rel_services_sarcini WHERE dst_id = ? ORDER BY src_id').all(rel).map(r => r.src_id);
  const before = [...new Set([...users(a), ...users(b)])].sort();
  ana.merge('sarcini', a, [b]);
  assert.deepEqual(users(a), before);
  assert.deepEqual(users(b), []);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rel_services_sarcini GROUP BY src_id, dst_id HAVING n > 1').all().length, 0);
  const s = processEvents(db);
  assert.ok(s.rendered >= before.length, 'paginile serviciilor s-au refăcut');
});

// ———————————————————————————————————————————— „Datele sunt corecte”

test('§1.8 — validarea păstrează amprenta și expiră singură la orice modificare (nu și la o ciornă)', () => {
  const {db, ana} = fresh();
  const s = id(db, 'services', "slug = 'birouri'");
  assert.equal(validationState(db, 'servicii', s).state, 'none');
  validate(db, {name: 'Ana'}, 'servicii', s, 'Verificat cu clientul');
  assert.deepEqual({...validationState(db, 'servicii', s), at: undefined}, {state: 'valid', by: 'Ana', at: undefined, comment: 'Verificat cu clientul'});
  ana.update('servicii', s, {descriere: 'Ciornă'}); // ciornă: versiunea publicată nu se schimbă
  assert.equal(validationState(db, 'servicii', s).state, 'valid');
  ana.update('servicii', s, {descriere: 'Publicat altfel'}, {publish: true});
  assert.equal(validationState(db, 'servicii', s).state, 'expired');
  validate(db, {name: 'Ana'}, 'servicii', s);
  const links = ana.links('servicii', s, 'sarcini');
  ana.setLinks('servicii', s, 'sarcini', links.slice(1).map(l => ({id: l.dst_id, attrs: l.attrs})));
  assert.equal(validationState(db, 'servicii', s).state, 'expired', 'și o schimbare de legături o expiră');
  assert.throws(() => validate(db, {name: 'Ana'}, 'cereri', 1), /date de lucru/);
});

// ———————————————————————————————————————————— biblioteca media, prin API

let server, base, db, dir, cookie, viewerCookie;
before(async () => {
  ({db, dir} = imported());
  scan(db);
  createUser(db, {email: 'admin@test.ro', name: 'Admin', role: 'admin', password: 'parola-de-test-123'});
  createUser(db, {email: 'viewer@test.ro', name: 'Viewer', role: 'viewer', password: 'parola-de-test-123'});
  server = createServer(db, {log: () => {}, mediaDir: path.join(dir, 'media')});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  const login = async email => (await fetch(`${base}/api/manage/login`, {method: 'POST', headers: {'content-type': 'application/json', origin: base},
    body: JSON.stringify({email, password: 'parola-de-test-123'})})).headers.get('set-cookie').split(';')[0];
  cookie = await login('admin@test.ro'); viewerCookie = await login('viewer@test.ro');
});
after(() => server.close());

const PNG = (seed = 1) => Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.from(`png-de-test-${seed}`)]);
const WEBP = (seed = 1) => { const b = Buffer.from(`RIFF0000WEBPVP8 webp-de-test-${seed}`); return b; };
const send = (method, url, body, {type = 'image/png', c = cookie} = {}) => fetch(`${base}/api/manage${url}`, {method, body,
  headers: {'content-type': type, origin: base, cookie: c}}).then(async r => ({status: r.status, body: await r.json().catch(() => null)}));
const settle = () => new Promise(r => setTimeout(r, 40));

test('media: încărcare (tip verificat după conținut), fără dubluri, fișierul ajunge pe disc', async () => {
  const r = await send('POST', '/media?name=Poză Test.png', PNG());
  assert.equal(r.status, 200);
  assert.equal(r.body.existing, false);
  assert.equal(r.body.path, '/media/uploads/poza-test.png');
  assert.ok(fs.existsSync(path.join(dir, 'media', 'uploads', 'poza-test.png')));
  assert.equal((await fetch(base + r.body.path)).status, 200);
  const again = await send('POST', '/media?name=alt-nume.png', PNG());
  assert.equal(again.body.existing, true, 'același conținut nu se încarcă de două ori');
  assert.equal(again.body.id, r.body.id);
  assert.equal((await send('POST', '/media?name=x.svg', Buffer.from('<svg onload="alert(1)"/>'), {type: 'image/svg+xml'})).status, 422);
  assert.equal((await send('POST', '/media?name=x.png', PNG(9), {c: viewerCookie})).status, 403);
});

test('media: textul alternativ editat în bibliotecă ajunge pe toate paginile care afișează fișierul', async () => {
  const m = db.prepare("SELECT id FROM media WHERE path LIKE '%/hero-team.webp'").get();
  const r = await send('PUT', `/media/${m.id}`, JSON.stringify({alt: 'Echipa Kurat, alt text nou'}), {type: 'application/json'});
  assert.equal(r.status, 200);
  await settle(); processEvents(db);
  assert.match(serve(db, '/').html, /alt="Echipa Kurat, alt text nou"/);
});

test('media: înlocuirea păstrează ID-ul și adresa, schimbă ?v=; alt tip e refuzat', async () => {
  const m = db.prepare("SELECT id, path FROM media WHERE path LIKE '%/home.webp'").get();
  const oldV = serve(db, '/servicii').html.match(/home\.webp\?v=(\w+)/)[1];
  assert.equal((await send('PUT', `/media/${m.id}/file`, PNG(2))).status, 422, 'alt tip decât cel inițial');
  await new Promise(r => setTimeout(r, 5));
  const r = await send('PUT', `/media/${m.id}/file`, WEBP(2), {type: 'image/webp'});
  assert.equal(r.status, 200);
  assert.equal(r.body.id, m.id);
  await settle(); processEvents(db);
  assert.notEqual(serve(db, '/servicii').html.match(/home\.webp\?v=(\w+)/)[1], oldV);
  assert.equal(fs.readFileSync(path.join(dir, 'media', m.path.replace(/^\/media\//, ''))).toString().includes('webp-de-test-2'), true);
});

test('media: un fișier folosit nu se poate șterge; unul nefolosit da', async () => {
  const used = db.prepare("SELECT id FROM media WHERE path LIKE '%/birou.webp'").get().id;
  const r = await send('DELETE', `/media/${used}`);
  assert.equal(r.status, 422);
  assert.match(r.body.error, /folosit/);
  const {body: info} = await send('GET', `/media/${used}`);
  assert.ok(info.usage.records.length && info.usage.pages.length);
  const unused = (await send('POST', '/media?name=nefolosit.png', PNG(5))).body.id;
  assert.equal((await send('DELETE', `/media/${unused}`)).status, 200);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE entity = 'media' AND entity_id = ? AND action = 'media-delete'").get(unused));
});

test('panourile noi se randează: Media, detaliul unui fișier, Prezentare cu validare și dubluri', async () => {
  const t = db.prepare("SELECT id FROM tasks WHERE text LIKE 'Detartrarea și spălarea faianței%'").get().id;
  for (const p of ['/manage/media/', `/manage/media/${db.prepare('SELECT id FROM media LIMIT 1').get().id}/`, `/manage/entitati/sarcini/${t}/prezentare/`, '/manage/']) {
    const r = await fetch(base + p, {headers: {cookie}});
    assert.equal(r.status, 200, p);
  }
  const html = await (await fetch(`${base}/manage/entitati/sarcini/${t}/prezentare/`, {headers: {cookie}})).text();
  assert.match(html, /Seamănă cu/);
  assert.match(html, /Datele sunt corecte/);
  // validare și unire prin API
  assert.equal((await send('POST', `/entities/sarcini/${t}/validate`, JSON.stringify({comment: 'ok'}), {type: 'application/json'})).status, 200);
  assert.equal((await send('POST', `/entities/cereri/1/validate`, JSON.stringify({}), {type: 'application/json'})).status, 422, 'cererile sunt date de lucru');
  const dup = db.prepare("SELECT id FROM tasks WHERE text LIKE 'Detartrarea și spălarea obiectelor%'").get().id;
  assert.equal((await send('POST', `/entities/sarcini/${t}/merge`, JSON.stringify({duplicates: [dup]}), {type: 'application/json', c: viewerCookie})).status, 403);
  assert.equal((await send('POST', `/entities/sarcini/${t}/merge`, JSON.stringify({duplicates: [dup]}), {type: 'application/json'})).status, 200);
});
