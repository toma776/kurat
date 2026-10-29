// Ștergerea dintr-un panou scoate înregistrarea de peste tot de pe site: din listele secțiunilor, din butoanele și meniurile
// care trimit la ea, din linkurile din text. Blochează doar ce depinde obligatoriu de ea.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imported} from './helpers.mjs';
import {createStore} from '../src/core/store.mjs';
import {scan, processEvents, serve} from '../src/core/sync.mjs';

const setup = () => {
  const s = imported();
  scan(s.db);
  return {...s, ana: createStore(s.db, {user: {name: 'Ana', email: 'ana@kurat.ro'}})};
};

test('un serviciu șters dispare din cardurile homepage-ului, din meniu și din linkurile din text', () => {
  const {db, ana} = setup();
  // un serviciu din cardurile homepage-ului, fără tarife (de care ar depinde obligatoriu)
  const svc = db.prepare("SELECT id, nume FROM services WHERE slug = 'canapele-mocheta'").get();
  assert.ok(db.prepare('SELECT 1 FROM rel_sections_servicii_persoane WHERE dst_id = ?').get(svc.id), 'e în cardurile homepage-ului');
  const menu = ana.list('meniuri')[0];
  ana.update('meniuri', menu.id, {linkuri: [...(menu.linkuri ?? []), {href: `ref:servicii:${svc.id}`, label: 'Spre serviciu'}, {href: `ref:servicii:${svc.id}0`, label: 'Alt serviciu'}]}, {publish: true});
  const faq = ana.list('intrebari')[0];
  ana.update('intrebari', faq.id, {raspuns: `<p>Vezi <a data-ref="servicii:${svc.id}">serviciul nostru</a> pentru detalii.</p>`}, {publish: true});
  processEvents(db);
  const cards = () => (serve(db, "/").html.match(/class="ds-card ds-svc"/g) ?? []).length;
  const before = cards();

  const r = ana.remove('servicii', svc.id);
  assert.equal(r.deleted, true);
  assert.deepEqual(new Set(r.unlinked.map(u => u.key)), new Set(['sectiuni', 'meniuri', 'intrebari']), 'spune de unde a fost scos');
  processEvents(db);

  assert.equal(db.prepare('SELECT COUNT(*) n FROM rel_sections_servicii_persoane WHERE dst_id = ?').get(svc.id).n, 0);
  assert.equal(cards(), before - 1, 'un card mai puțin pe homepage');
  const links = ana.get('meniuri', menu.id).linkuri.map(l => l.href);
  assert.ok(!links.includes(`ref:servicii:${svc.id}`), 'linkul de meniu e scos');
  assert.ok(links.includes(`ref:servicii:${svc.id}0`), 'un id care doar începe la fel rămâne');
  assert.equal(ana.get('intrebari', faq.id).raspuns, '<p>Vezi serviciul nostru pentru detalii.</p>', 'linkul din text rămâne doar text');
  const log = JSON.parse(db.prepare("SELECT changes FROM audit_log WHERE entity = 'servicii' AND entity_id = ? AND action = 'delete'").get(svc.id).changes);
  assert.equal(log.unlinked[0].length, r.unlinked.length, 'locurile din care a fost scos rămân în Istoric');
});

test('un câmp opțional care trimite la înregistrare se golește; unul obligatoriu blochează ștergerea, cu numele celor care depind', () => {
  const {db, ana} = setup();
  const lensa = db.prepare("SELECT id FROM clients WHERE nume = 'Lensa'").get().id;
  assert.throws(() => ana.remove('clienti', lensa), err => /depind obligatoriu de ea/.test(err.message) && /Testimonial/.test(err.message));
  assert.ok(ana.get('clienti', lensa), 'clientul rămâne');
});
