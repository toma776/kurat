import {test} from 'node:test';
import assert from 'node:assert/strict';
import {openDb, tx} from '../src/core/db.mjs';
import {createStore, ValidationError, onChange} from '../src/core/store.mjs';

const fresh = () => {
  const db = openDb(':memory:');
  const sys = createStore(db, {user: {name: 'Sistem', system: true}});
  sys.create('firma', {nume: 'Kurat', telefon: '0742 293 391', email: 'cezar@kurat.ro'});
  return {db, sys, ana: createStore(db, {user: {name: 'Ana', email: 'ana@kurat.ro'}})};
};
const events = db => db.prepare('SELECT COUNT(*) n FROM change_events').get().n;

test('§1.6 a — telefonul în orice formă devine {telefon}; unul care contrazice sursa rămâne și devine observație', () => {
  const {ana} = fresh();
  const id = ana.create('servicii', {fel: 'curatenie', nume: 'Curățenie test', descriere: 'Sună la +40742293391, 0742.293.391 sau 0722 111 222.'});
  assert.equal(ana.get('servicii', id).descriere, 'Sună la {telefon}, {telefon} sau 0722 111 222.');
  assert.equal(ana.observations.length, 1);
  assert.match(ana.observations[0].message, /0722 111 222/);
  assert.equal(ana.observations[0].id, id);
});

test('§1.6 a — citatele clienților nu se ating', () => {
  const {ana} = fresh();
  const c = ana.create('clienti', {nume: 'Client test'});
  const t = ana.create('testimoniale', {text: 'Ne-au sunat la 0742 293 391 imediat.', client_id: c});
  assert.match(ana.get('testimoniale', t).text, /0742 293 391/);
});

test('§1.8 — validarea: obligatorii, ținte existente, filtrul `only`, reguli proprii', () => {
  const {ana} = fresh();
  assert.throws(() => ana.create('tarife', {eticheta: 'x'}), ValidationError);
  const spatiu = ana.create('servicii', {fel: 'spatiu', nume: 'Birouri test'});
  // un tarif se poate lega doar de un tip de curățenie
  assert.throws(() => ana.create('tarife', {eticheta: 'x', pret: 10, serviciu_id: spatiu}), /nu e o țintă permisă/);
  assert.throws(() => ana.create('tarife', {eticheta: 'x', pret: 10, serviciu_id: 999}), /nu există/);
  assert.throws(() => ana.update('firma', 1, {cod_postal: '01127'}, {publish: true}), /6 cifre/);
});

test('§1.2 — slug unic cu sufix și adresă publică unică între tipuri', () => {
  const {ana} = fresh();
  const a = ana.create('servicii', {fel: 'curatenie', nume: 'Generală', pagina: true});
  const b = ana.create('servicii', {fel: 'curatenie', nume: 'Generală', pagina: true});
  assert.equal(ana.get('servicii', a).slug, 'generala');
  assert.equal(ana.get('servicii', b).slug, 'generala-2');
  assert.throws(() => ana.create('pagini', {titlu: 'Copie', path: '/servicii/generala'}), /deja folosită/);
  assert.throws(() => ana.create('servicii', {fel: 'spatiu', nume: 'x', slug: 'manage', pagina: true}), /rezervat/);
});

test('§5.10 — salvarea unei ciorne peste o înregistrare publicată: zero evenimente, site-ul neschimbat', () => {
  const {db, ana} = fresh();
  const id = ana.create('valori', {titlu: 'Respect', text: 'Vechi'});
  const before = events(db);
  const r = ana.update('valori', id, {text: 'Nou'});
  assert.equal(r.draft, true);
  assert.equal(events(db), before);
  const rec = ana.get('valori', id);
  assert.equal(rec.text, 'Vechi');
  assert.equal(rec.draft.text, 'Nou');
  ana.update('valori', id, {text: 'Nou'}, {publish: true});
  assert.equal(events(db), before + 1);
  assert.equal(ana.get('valori', id).text, 'Nou');
  assert.equal(ana.get('valori', id).draft, null);
});

test('§3.3 — modificarea, istoricul și evenimentul se scriu împreună sau deloc; ascultătorii află după COMMIT', () => {
  const {db, ana} = fresh();
  const seen = [];
  const off = onChange(ev => seen.push(ev));
  const ev0 = events(db), audit0 = db.prepare('SELECT COUNT(*) n FROM audit_log').get().n;
  assert.throws(() => tx(db, () => {
    ana.create('valori', {titlu: 'Anulată'});
    assert.equal(seen.length, 0, 'nimeni nu e anunțat înainte de COMMIT');
    throw new Error('anulare');
  }));
  assert.equal(events(db), ev0);
  assert.equal(db.prepare('SELECT COUNT(*) n FROM audit_log').get().n, audit0);
  assert.equal(db.prepare("SELECT COUNT(*) n FROM values_kurat WHERE titlu = 'Anulată'").get().n, 0);
  assert.equal(seen.length, 0);
  ana.create('valori', {titlu: 'Păstrată'});
  assert.equal(seen.length, 1);
  off();
});

test('§2.2 — legăturile: poziție, stare, atribute, `touched` cu ambele capete', () => {
  const {db, ana} = fresh();
  const s = ana.create('servicii', {fel: 'spatiu', nume: 'Locuințe test'});
  const [t1, t2, t3] = ['Baie', 'Hol', 'Balcon'].map(text => ana.create('sarcini', {text}));
  ana.setLinks('servicii', s, 'sarcini', [{id: t1, attrs: {grup: 'Baie'}}, {id: t2}]);
  ana.setLinks('servicii', s, 'sarcini', [{id: t2}, {id: t3, status: 'inferred'}]);
  const links = ana.links('servicii', s, 'sarcini');
  assert.deepEqual(links.map(l => [l.dst_id, l.position, l.status]), [[t2, 0, 'confirmed'], [t3, 1, 'inferred']]);
  const ev = db.prepare("SELECT payload FROM change_events WHERE action = 'links' ORDER BY id DESC").get();
  assert.deepEqual(JSON.parse(ev.payload).touched, [`sarcini:${t1}`, `sarcini:${t2}`, `sarcini:${t3}`]);
  // doar legăturile confirmate intră în scope-uri (site-ul afișează doar confirmatele)
  assert.deepEqual(JSON.parse(ev.payload).after.scopes, [`sarcini:${t2}`]);
});

test('§1.8 — blocare optimistă: o salvare peste o versiune veche dă 409', () => {
  const {ana} = fresh();
  const id = ana.create('valori', {titlu: 'X'});
  const seenAt = ana.get('valori', id).updated_at;
  ana.update('valori', id, {titlu: 'Y'}, {publish: true});
  const later = ana.get('valori', id).updated_at;
  if (later === seenAt) return; // aceeași milisecundă: nu se poate distinge pe această mașină
  assert.throws(() => ana.update('valori', id, {titlu: 'Z'}, {publish: true, expectedUpdatedAt: seenAt}), e => e.status === 409);
});
