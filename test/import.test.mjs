// Testele obligatorii de identificare (§5, 16–20), pe datele reale ale kurat.ro (snapshot + analiză din reference/).
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imported, legacyMap} from './helpers.mjs';
import {createStore} from '../src/core/store.mjs';
import {ImportRefused} from '../src/core/import.mjs';
import {ENTITIES} from '../src/registry/entities.mjs';

const TABLES = ['media', ...ENTITIES.map(e => e.table)];

test('importul creează ce a găsit analiza', () => {
  const {db, report} = imported();
  const n = t => db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n;
  assert.equal(n('company'), 1);
  assert.equal(n('services'), 9);
  assert.equal(n('prices'), 10);
  assert.equal(n('tasks'), 56, 'operațiunile identice între servicii sunt o singură înregistrare');
  assert.equal(n('pages'), 6);
  assert.equal(report.mediaFiles, n('media'));
  // telefonul din Date firmă e în format de afișare, sursa jetoanelor
  assert.equal(db.prepare('SELECT telefon FROM company').get().telefon, '0742 293 391');
});

test('§5.17 — importul e determinist: rulat în două baze noi, dă aceleași ID-uri', () => {
  const a = imported(), b = imported();
  for (const t of TABLES) assert.deepEqual(legacyMap(a.db, t), legacyMap(b.db, t), `ID-uri diferite în ${t}`);
});

test('reimportul în aceeași bază actualizează, nu dublează', () => {
  const {db, reimport} = imported();
  const before = Object.fromEntries(TABLES.map(t => [t, db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n]));
  const r = reimport();
  assert.deepEqual(r.created, {});
  assert.deepEqual(r.updated, {});
  for (const t of TABLES) assert.equal(db.prepare(`SELECT COUNT(*) n FROM ${t}`).get().n, before[t], t);
});

test('§5.18 — verificarea dus-întors: fiecare text importat, citit înapoi, dă aceleași blocuri', () => {
  const {report} = imported();
  assert.ok(report.roundTrip.checked > 200, `prea puține câmpuri verificate: ${report.roundTrip.checked}`);
  assert.deepEqual(report.roundTrip.failed, []);
});

test('§1.4 — fiecare câmp importat își are sursa', () => {
  const {db} = imported();
  const store = createStore(db);
  const missing = [];
  for (const e of ENTITIES) {
    for (const rec of store.list(e.key)) {
      for (const f of e.fields) {
        if (f.type === 'refs' || rec[f.key] == null) continue;
        const p = db.prepare('SELECT 1 FROM provenance WHERE entity = ? AND entity_id = ? AND field = ?').get(e.key, rec.id, f.key);
        if (!p) missing.push(`${e.key}:${rec.id}.${f.key}`);
      }
    }
  }
  assert.deepEqual(missing, []);
});

test('§5.19 — o editare manuală scrie proveniență `manual` și înlocuiește sursa importului', () => {
  const {db} = imported();
  const ana = createStore(db, {user: {name: 'Ana', email: 'ana@kurat.ro'}});
  const q = ana.list('intrebari')[0];
  ana.update('intrebari', q.id, {raspuns: '<p>Da, venim cu tot ce trebuie.</p>'}, {publish: true});
  const rows = db.prepare(`SELECT p.method, p.certainty, p.verified_by, s.kind FROM provenance p JOIN sources s ON s.id = p.source_id
    WHERE p.entity = 'intrebari' AND p.entity_id = ? AND p.field = 'raspuns'`).all(q.id);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].kind, 'manual');
  assert.equal(rows[0].method, 'manual');
  assert.equal(rows[0].verified_by, 'Ana');
});

test('§5.16 — importul refuză să ruleze peste editări manuale fără --overwrite-edits', () => {
  const {db, reimport} = imported();
  const ana = createStore(db, {user: {name: 'Ana'}});
  const v = ana.list('valori')[0];
  ana.update('valori', v.id, {text: 'Text scris de Ana'}, {publish: true});
  assert.throws(() => reimport(), e => e instanceof ImportRefused && e.edits.some(x => x.key === 'valori' && x.id === v.id));
  assert.equal(ana.get('valori', v.id).text, 'Text scris de Ana', 'refuzul nu atinge nimic');
  reimport({overwriteEdits: true});
  assert.notEqual(ana.get('valori', v.id).text, 'Text scris de Ana');
});

test('§1.5 — legăturile deduse rămân deduse; decizia omului și respingerile nu se suprascriu la reimport', () => {
  const {db, reimport} = imported();
  const inferred = db.prepare("SELECT src_id, dst_id FROM rel_sections_servicii_persoane WHERE status = 'inferred' ORDER BY dst_id").all();
  assert.ok(inferred.length >= 2, 'cardurile potrivite după nume sunt deduse, nu confirmate');
  const ev = db.prepare("SELECT confidence, note, source_id FROM rel_sections_servicii_persoane WHERE status = 'inferred'").get();
  assert.ok(ev.confidence > 0 && ev.note && ev.source_id, 'legătura dedusă are dovadă, scor și sursă');

  // omul confirmă una și o respinge pe alta
  const [keep, drop] = inferred;
  db.prepare("UPDATE rel_sections_servicii_persoane SET status = 'confirmed', created_by = 'Ana' WHERE src_id = ? AND dst_id = ?").run(keep.src_id, keep.dst_id);
  db.prepare('DELETE FROM rel_sections_servicii_persoane WHERE src_id = ? AND dst_id = ?').run(drop.src_id, drop.dst_id);
  db.prepare("INSERT INTO link_dismissals (relation, src_id, dst_id, evidence, at, by) VALUES ('sectiuni.servicii_persoane', ?, ?, 'test', datetime('now'), 'Ana')")
    .run(drop.src_id, drop.dst_id);

  reimport({overwriteEdits: true});
  const after = db.prepare('SELECT dst_id, status FROM rel_sections_servicii_persoane WHERE src_id = ?').all(keep.src_id);
  assert.equal(after.find(l => l.dst_id === keep.dst_id)?.status, 'confirmed', 'confirmarea omului rămâne');
  assert.equal(after.find(l => l.dst_id === drop.dst_id), undefined, 'respingerea se ține minte');
});

test('valorile contradictorii din site-ul vechi intră ca neverificate, cu ambele surse', () => {
  const {db} = imported();
  const canapea = db.prepare("SELECT id, pret FROM extras WHERE nume LIKE 'Curățare canapea%'").get();
  const rows = db.prepare("SELECT certainty, excerpt FROM provenance WHERE entity = 'extra' AND entity_id = ? AND field = 'pret'").all(canapea.id);
  assert.ok(rows.length >= 2);
  assert.ok(rows.every(r => r.certainty === 'unverified'));
  assert.ok(rows.some(r => /250/.test(r.excerpt)) && rows.some(r => /200/.test(r.excerpt)));
});

test('evenimentele importului sunt marcate rezolvate și scanarea e cerută', () => {
  const {db} = imported();
  assert.equal(db.prepare("SELECT COUNT(*) n FROM change_events WHERE status <> 'done'").get().n, 0);
  assert.equal(db.prepare("SELECT value FROM meta WHERE key = 'scan_needed'").get().value, '1');
});
