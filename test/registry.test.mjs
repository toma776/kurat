import {test} from 'node:test';
import assert from 'node:assert/strict';
import {ENTITIES, RELATION_TYPES, checkRegistry, inverseRelations} from '../src/registry/entities.mjs';
import {openDb, migrate} from '../src/core/db.mjs';

test('registrul nu are erori statice', () => {
  assert.deepEqual(checkRegistry(), []);
});

test('fiecare relație are un id unic, verb și etichetă inversă', () => {
  const ids = RELATION_TYPES.map(r => r.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const r of RELATION_TYPES) {
    assert.ok(r.verb, `${r.id} fără verb`);
    assert.ok(r.inverseLabel, `${r.id} fără etichetă inversă`);
  }
});

test('relațiile inverse se calculează, nu se declară', () => {
  const inv = inverseRelations('servicii').map(r => r.id).sort();
  assert.deepEqual(inv, ['sectiuni.servicii_companii', 'sectiuni.servicii_persoane', 'studii.serviciu_id', 'tarife.serviciu_id']);
});

test('migrarea creează tabelele din registru și e idempotentă', () => {
  const db = openDb(':memory:');
  const tables = new Set(db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name));
  for (const e of ENTITIES) assert.ok(tables.has(e.table), `lipsește ${e.table}`);
  assert.ok(tables.has('rel_services_sarcini'));
  assert.ok(tables.has('rel_sections_servicii_companii'));
  const cols = db.prepare('PRAGMA table_info(rel_services_sarcini)').all().map(c => c.name);
  for (const c of ['position', 'status', 'confidence', 'source_id', 'note', 'attrs', 'created_by']) assert.ok(cols.includes(c), `rel fără ${c}`);
  assert.doesNotThrow(() => migrate(db));
});
