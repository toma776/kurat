// O înregistrare nouă apare singură pe site unde apar celelalte de același tip: intră, la prima publicare, la sfârșitul
// listelor secțiunilor care le afișează deja. Serviciile țin cont de public; o scoatere manuală rămâne.
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
const lists = (db, table, id) => db.prepare(`SELECT src_id, position FROM ${table} WHERE dst_id = ?`).all(id);

test('o întrebare nouă, publicată, apare în toate secțiunile de întrebări, la sfârșit', () => {
  const {db, ana} = setup();
  const sections = db.prepare('SELECT src_id, MAX(position) p FROM rel_sections_intrebari GROUP BY src_id').all();
  assert.ok(sections.length, 'există secțiuni cu întrebări');
  const q = ana.create('intrebari', {intrebare: 'Aduceți voi produsele de curățenie?', raspuns: '<p>Da, venim cu tot ce trebuie.</p>'}, {publish: true});
  const now = lists(db, 'rel_sections_intrebari', q);
  assert.equal(now.length, sections.length, 'în fiecare secțiune');
  for (const s of sections) assert.equal(now.find(x => x.src_id === s.src_id).position, s.p + 1, 'la sfârșitul listei');
  processEvents(db);
  const page = db.prepare("SELECT p.path FROM pages p JOIN rel_pages_sectiuni r ON r.src_id = p.id WHERE r.dst_id = ?").get(sections[0].src_id);
  if (page) assert.match(serve(db, page.path).html, /Aduceți voi produsele de curățenie\?/, 'și pe pagină');
});

test('o ciornă nu apare; intră în liste abia la prima publicare, iar o scoatere manuală nu se anulează la republicare', () => {
  const {db, ana} = setup();
  const q = ana.create('intrebari', {intrebare: 'Lucrați și duminica?', raspuns: '<p>Da, cu programare.</p>'}, {publish: false});
  assert.equal(lists(db, 'rel_sections_intrebari', q).length, 0, 'ciorna nu intră nicăieri');
  ana.setStatus('intrebari', q, 'published');
  const placed = lists(db, 'rel_sections_intrebari', q);
  assert.ok(placed.length, 'la publicare intră');
  // scoasă de mână dintr-o secțiune, apoi retrasă și republicată: rămâne scoasă
  ana.setInverse('intrebari', q, 'sectiuni', 'intrebari', {remove: placed[0].src_id});
  ana.setStatus('intrebari', q, 'draft');
  ana.setStatus('intrebari', q, 'published');
  assert.equal(lists(db, 'rel_sections_intrebari', q).length, placed.length - 1);
});

test('serviciile intră doar în lista publicului lor: firmele la companii, casele la persoane fizice, „ambele” în amândouă', () => {
  const {db, ana} = setup();
  const firm = ana.create('servicii', {nume: 'Curățenie pentru clinici', fel: 'curatenie', public: 'firma'}, {publish: true});
  const home = ana.create('servicii', {nume: 'Curățenie de primăvară', fel: 'curatenie', public: 'casa'}, {publish: true});
  const both = ana.create('servicii', {nume: 'Spălare geamuri', fel: 'curatenie', public: 'ambele'}, {publish: true});
  const where = id => [lists(db, 'rel_sections_servicii_companii', id).length > 0, lists(db, 'rel_sections_servicii_persoane', id).length > 0];
  assert.deepEqual(where(firm), [true, false]);
  assert.deepEqual(where(home), [false, true]);
  assert.deepEqual(where(both), [true, true]);
});

test('o secțiune nouă nu intră singură în paginile altora (listele deținute nu se ating)', () => {
  const {db, ana} = setup();
  const s = ana.create('sectiuni', {kind: 'text', titlu: 'Secțiune nouă'}, {publish: true});
  assert.equal(db.prepare('SELECT COUNT(*) n FROM rel_pages_sectiuni WHERE dst_id = ?').get(s).n, 0);
});
