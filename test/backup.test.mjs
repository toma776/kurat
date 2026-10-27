// Copiile de siguranță (§3.12): creare, verificarea orară, păstrare, descărcare, restaurare cu eveniment global.
import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import {imported} from './helpers.mjs';
import {createStore} from '../src/core/store.mjs';
import {scan, processEvents, serve} from '../src/core/sync.mjs';
import {createBackup, maybeAutoBackup, listBackups, readArchive, restoreBackup} from '../src/core/backup.mjs';
import {pack, unpack} from '../src/lib/tar.mjs';
import {createServer} from '../src/server.mjs';
import {createUser} from '../src/auth/auth.mjs';

const setup = () => {
  const s = imported();
  scan(s.db);
  return {...s, bdir: path.join(s.dir, 'backups'), mdir: path.join(s.dir, 'media'), ana: createStore(s.db, {user: {name: 'Ana'}})};
};
const id = (db, table, where, ...p) => db.prepare(`SELECT id FROM ${table} WHERE ${where}`).get(...p).id;

test('tar: împachetat și despachetat dă aceleași fișiere, inclusiv nume lungi', () => {
  const long = `media/uploads/${'a'.repeat(90)}/${'b'.repeat(60)}.webp`;
  const entries = [{name: 'backup.json', data: Buffer.from('{}')}, {name: long, data: Buffer.alloc(1025, 7)}, {name: 'gol.txt', data: Buffer.alloc(0)}];
  const out = unpack(pack(entries));
  assert.deepEqual(out.map(e => [e.name, e.data.length]), entries.map(e => [e.name, e.data.length]));
  assert.ok(out[1].data.every(b => b === 7));
  const bad = pack(entries); bad[150] ^= 1;
  assert.throws(() => unpack(bad), /sumă de control/);
});

test('o copie conține baza consistentă, fișierele media și manifestul', () => {
  const {db, bdir, mdir} = setup();
  const r = createBackup(db, {dir: bdir, mediaDir: mdir, kind: 'manual', by: 'Ana', note: 'test'});
  assert.ok(fs.existsSync(path.join(bdir, r.file)));
  const a = readArchive(fs.readFileSync(path.join(bdir, r.file)));
  assert.equal(a.manifest.counts.services, 9);
  assert.equal(a.media.length, db.prepare('SELECT COUNT(*) n FROM media').get().n);
  assert.deepEqual(r.missing, []);
  assert.equal(listBackups(db, bdir)[0].note, 'test');
});

test('verificarea orară: copie automată doar dacă ultima are peste 20 de ore; copiile automate vechi se șterg', () => {
  const {db, bdir, mdir} = setup();
  assert.ok(maybeAutoBackup(db, {dir: bdir, mediaDir: mdir}), 'nicio copie: se face una');
  assert.equal(maybeAutoBackup(db, {dir: bdir, mediaDir: mdir}), null, 'ultima e de acum');
  assert.ok(maybeAutoBackup(db, {dir: bdir, mediaDir: mdir, now: Date.now() + 21 * 3600_000}), 'după 21 de ore: încă una');
  // păstrare: cel mult 14 automate
  for (let i = 0; i < 15; i++) createBackup(db, {dir: bdir, mediaDir: mdir, kind: 'auto'});
  assert.equal(db.prepare("SELECT COUNT(*) n FROM backups WHERE kind = 'auto'").get().n, 14);
  assert.equal(fs.readdirSync(bdir).filter(f => f.endsWith('-auto.tar.gz')).length, 14);
});

test('restaurarea readuce conținutul, sursele și fișierele, păstrează conturile și reface toate paginile (eveniment global)', () => {
  const {db, bdir, mdir, ana} = setup();
  createUser(db, {email: 'ana@test.ro', name: 'Ana', role: 'admin', password: 'parola-de-test-123'});
  const tarif = id(db, 'prices', "eticheta = '1–2 camere' AND serviciu_id = (SELECT id FROM services WHERE slug = 'mentenanta')");
  const v = {id: ana.create('valori', {titlu: 'Valoare nefolosită'})};
  const copy = createBackup(db, {dir: bdir, mediaDir: mdir, kind: 'manual', by: 'Ana'});

  // după copie: un preț schimbat, o valoare ștearsă, un fișier media modificat pe disc, un utilizator nou
  ana.update('tarife', tarif, {pret: 999}, {publish: true});
  ana.remove('valori', v.id);
  const home = db.prepare("SELECT path FROM media WHERE path LIKE '%/home.webp'").get().path;
  fs.writeFileSync(path.join(mdir, home.replace(/^\/media\//, '')), 'stricat');
  createUser(db, {email: 'nou@test.ro', name: 'Nou', role: 'editor', password: 'parola-de-test-123'});
  processEvents(db);
  assert.match(serve(db, '/servicii/mentenanta').html, /999 lei/);

  const ev0 = db.prepare('SELECT MAX(id) n FROM change_events').get().n;
  const r = restoreBackup(db, {buffer: fs.readFileSync(path.join(bdir, copy.file)), dir: bdir, mediaDir: mdir, user: {name: 'Ana'}, backupId: copy.id});
  assert.ok(r.restored > 10);
  assert.equal(db.prepare('SELECT pret FROM prices WHERE id = ?').get(tarif).pret, 350);
  assert.ok(createStore(db).get('valori', v.id), 'înregistrarea ștearsă a revenit, cu același ID');
  assert.notEqual(fs.readFileSync(path.join(mdir, home.replace(/^\/media\//, ''))).toString(), 'stricat');
  assert.ok(db.prepare("SELECT 1 FROM users WHERE email = 'nou@test.ro'").get(), 'conturile nu se ating');
  assert.ok(db.prepare("SELECT 1 FROM backups WHERE kind = 'pre-restore'").get(), 'întâi o copie a stării curente');
  assert.equal(db.prepare('PRAGMA foreign_key_check').all().length, 0);
  // ID-urile șterse nu se refolosesc: contorul AUTOINCREMENT vine din copie
  assert.ok(createStore(db, {user: {name: 'Ana'}}).create('valori', {titlu: 'Nouă'}) > v.id);

  // evenimentul global reface toate paginile
  const evs = db.prepare('SELECT * FROM change_events WHERE id > ?').all(ev0);
  const global = evs.find(e => e.action === 'restore');
  assert.ok(global && global.entity === null);
  processEvents(db);
  const rendered = new Set(db.prepare('SELECT path FROM sync_log WHERE event_id = ?').all(global.id).map(x => x.path));
  assert.equal(rendered.size, 12);
  assert.match(serve(db, '/servicii/mentenanta').html, /350 lei/);
  assert.ok(db.prepare("SELECT 1 FROM audit_log WHERE action = 'restore'").get(), 'restaurarea e în Istoric');
});

test('o arhivă invalidă sau periculoasă e refuzată înainte să atingă ceva', () => {
  const {db, bdir, mdir} = setup();
  const before = db.prepare('SELECT COUNT(*) n FROM services').get().n;
  const restore = buffer => restoreBackup(db, {buffer, dir: bdir, mediaDir: mdir, user: {name: 'Ana'}});
  assert.throws(() => restore(Buffer.from('nu e gzip')), /tar\.gz/);
  assert.throws(() => restore(zlib.gzipSync(pack([{name: 'x.txt', data: Buffer.from('x')}]))), /backup\.json/);
  const manifest = Buffer.from(JSON.stringify({app: 'kurat-brain', media: []}));
  assert.throws(() => restore(zlib.gzipSync(pack([{name: 'backup.json', data: manifest}, {name: 'brain.db', data: Buffer.from('x')},
    {name: 'media/../../evil.js', data: Buffer.from('x')}]))), /căi nepermise/);
  assert.throws(() => restore(zlib.gzipSync(pack([{name: 'backup.json', data: manifest}, {name: 'brain.db', data: Buffer.from('nu e sqlite')}]))));
  assert.equal(db.prepare('SELECT COUNT(*) n FROM services').get().n, before);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM backups WHERE kind = 'pre-restore'").get().n, 0);
});

// ———————————————————————————————————————————— prin API: drepturi, descărcare, restaurare din fișier

let server, base, db, cookies = {}, dirs;
before(async () => {
  const s = setup();
  ({db} = s); dirs = s;
  createUser(db, {email: 'admin@test.ro', name: 'Admin', role: 'admin', password: 'parola-de-test-123'});
  createUser(db, {email: 'editor@test.ro', name: 'Editor', role: 'editor', password: 'parola-de-test-123'});
  server = createServer(db, {log: () => {}, mediaDir: s.mdir, backupDir: s.bdir});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
  for (const who of ['admin', 'editor'])
    cookies[who] = (await fetch(`${base}/api/manage/login`, {method: 'POST', headers: {'content-type': 'application/json', origin: base},
      body: JSON.stringify({email: `${who}@test.ro`, password: 'parola-de-test-123'})})).headers.get('set-cookie').split(';')[0];
});
after(() => server.close());
const call = (who, method, url, body, headers = {}) => fetch(`${base}/api/manage${url}`, {method, body: body && !Buffer.isBuffer(body) ? JSON.stringify(body) : body,
  headers: {'content-type': 'application/json', origin: base, cookie: cookies[who], ...headers}});

test('API: doar administratorul creează, descarcă și restaurează copii', async () => {
  assert.equal((await call('editor', 'POST', '/backups', {})).status, 403);
  assert.equal((await call('editor', 'GET', '/backups')).status, 403);
  const r = await call('admin', 'POST', '/backups', {note: 'din API'});
  assert.equal(r.status, 200);
  const b = await r.json();
  const dl = await call('admin', 'GET', `/backups/${b.id}/download`);
  assert.equal(dl.status, 200);
  assert.match(dl.headers.get('content-disposition'), /attachment; filename="kurat-brain-.*-manual\.tar\.gz"/);
  const buf = Buffer.from(await dl.arrayBuffer());
  assert.equal(readArchive(buf).manifest.note, 'din API');
  assert.equal((await call('editor', 'GET', `/backups/${b.id}/download`)).status, 403);
  assert.equal((await call('admin', 'POST', `/backups/${b.id}/restore`, {})).status, 422, 'fără confirmare explicită');
  assert.equal((await call('editor', 'POST', `/backups/${b.id}/restore`, {confirm: true})).status, 403);

  // restaurarea dintr-un fișier încărcat: după o modificare, copia o readuce
  const v = id(db, 'values_kurat', '1 = 1 ORDER BY id LIMIT 1');
  const before = db.prepare('SELECT text FROM values_kurat WHERE id = ?').get(v).text;
  createStore(db, {user: {name: 'X'}}).update('valori', v, {text: 'schimbat după copie'}, {publish: true});
  const up = await call('admin', 'POST', '/backups/restore-upload?confirm=1', buf, {'content-type': 'application/gzip'});
  assert.equal(up.status, 200);
  assert.equal(db.prepare('SELECT text FROM values_kurat WHERE id = ?').get(v).text, before);
  assert.ok(db.prepare("SELECT 1 FROM backups WHERE kind = 'upload' AND restored_by = 'Admin'").get());
  // sesiunea administratorului a supraviețuit restaurării
  assert.equal((await call('admin', 'GET', '/me')).status, 200);
  assert.equal((await fetch(`${base}/manage/setari/`, {headers: {cookie: cookies.admin}})).status, 200);
  assert.equal((await fetch(`${base}/manage/setari/`, {headers: {cookie: cookies.editor}})).status, 403);
});

test('tick-ul de cron face și verificarea copiei zilnice', async () => {
  process.env.CRON_KEY = 'cheie-cron-de-test';
  try {
    db.prepare('DELETE FROM backups').run();
    const r = await fetch(`${base}/api/manage/cron/tick`, {method: 'POST', headers: {authorization: 'Bearer cheie-cron-de-test'}});
    assert.equal(r.status, 200);
    assert.ok((await r.json()).backup?.file);
    assert.ok(db.prepare("SELECT 1 FROM backups WHERE kind = 'auto'").get());
  } finally { delete process.env.CRON_KEY; }
});
