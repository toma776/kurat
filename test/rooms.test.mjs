// „Ce includem, cameră cu cameră”: camera unei operațiuni vine din câmpul „Grup” al legăturii; fără cameră, se face peste tot.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imported} from './helpers.mjs';
import {createStore} from '../src/core/store.mjs';
import {scan, processEvents, serve} from '../src/core/sync.mjs';

test('planul locuinței: fiecare operațiune știe în ce camere se face, iar camerele își numără operațiunile', () => {
  const {db} = imported();
  scan(db);
  const ana = createStore(db, {user: {name: 'Ana', email: 'ana@kurat.ro'}});
  const svc = db.prepare("SELECT id FROM services WHERE slug = 'locuinte'").get().id;
  const links = ana.links('servicii', svc, 'sarcini');
  const items = links.map((l, i) => ({id: l.dst_id, attrs: {...(l.attrs ?? {}), grup: i === 0 ? 'Bucătărie, Baie' : i === 1 ? 'Garaj' : null}}));
  ana.setLinks('servicii', svc, 'sarcini', items);
  processEvents(db);
  const html = serve(db, '/servicii/locuinte').html;
  assert.match(html, /Ce includem, cameră cu cameră/);
  assert.match(html, /data-room="baie"/, 'planul unei locuințe');
  const ins = [...html.matchAll(/<li data-in="([^"]*)">/g)].map(m => m[1]);
  assert.equal(ins.length, links.length);
  assert.equal(ins[0], 'bucatarie baie', 'mai multe camere, separate prin virgulă');
  assert.equal(ins[1], '*', 'o cameră care nu e pe plan înseamnă peste tot');
  const all = ins.filter(x => x === '*').length;
  assert.match(html, new RegExp(`data-room="baie" aria-pressed="false">Baie<span>${all + 1}</span>`));
});

test('serviciile pentru firme primesc planul unui birou', () => {
  const {db} = imported();
  scan(db);
  const ana = createStore(db, {user: {name: 'Ana', email: 'ana@kurat.ro'}});
  const svc = db.prepare("SELECT id FROM services WHERE slug = 'birouri'").get().id;
  assert.match(serve(db, '/servicii/birouri').html, /data-room="dormitor"/, 'fără public, planul unei locuințe');
  ana.update('servicii', svc, {public: 'firma'}, {publish: true});
  processEvents(db);
  const html = serve(db, '/servicii/birouri').html;
  assert.match(html, /data-room="sanitar"/);
  assert.doesNotMatch(html, /data-room="dormitor"/);
});
