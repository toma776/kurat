// Corecturile țintite pe homepage-ul actual (structura rămâne aceeași): TVA pentru persoane fizice, ratingul cu sursă,
// o singură formulare a garanției, testimoniale cu persoana care vorbește.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {imported} from './helpers.mjs';
import {createStore} from '../src/core/store.mjs';
import {scan, processEvents, serve} from '../src/core/sync.mjs';
import {renderPath} from '../src/site/pages.mjs';

const setup = () => {
  const s = imported();
  scan(s.db);
  // o editare din /manage: sursa e manuală, deci confirmată (§1.4)
  return {...s, ana: createStore(s.db, {user: {name: 'Ana', email: 'ana@kurat.ro'}})};
};

test('structura homepage-ului rămâne aceeași, fără comutator', () => {
  const {db} = setup();
  const html = serve(db, '/').html;
  assert.doesNotMatch(html, /aud-radio|data-aud=/);
  for (const t of ['Tot ce ține de curat', 'De ce să alegi Kurat', 'Valorile care ne ghidează', 'Curățenie în 4 pași', 'Oferta ta în 60 de secunde', 'Peste 1.100 de clienți mulțumiți', 'Tot ce trebuie să știi'])
    assert.match(html, new RegExp(t), t);
});

test('ratingul declarat rămâne ca în original, fără recenzii Google și fără date structurate; în previzualizare e marcat, cu golul explicat', () => {
  const {db, ana} = setup();
  const pub = serve(db, '/').html;
  assert.match(pub, /Garanție sau banii înapoi/);
  assert.match(pub, /4\.9\/5/, 'ratingul Kurat, ca pe site-ul original');
  assert.doesNotMatch(pub, /recenzii Google/);
  assert.doesNotMatch(pub, /AggregateRating/, 'nici în datele structurate');
  assert.match(pub, /1\.100\+/, 'cifrele rămân, ca până acum');
  const prev = renderPath(db, '/', {preview: true}).html;
  assert.match(prev, /Lipsește: rating verificabil/);
  assert.match(prev, /Sursă neconfirmată/);
  // cu profilul Google completat (și deci confirmat), ratingul revine, cu numărul de recenzii, link și date structurate
  ana.update('firma', ana.singleton('firma').id, {google_url: 'https://g.page/kurat', google_rating: 4.9, google_recenzii: 87});
  processEvents(db);
  const after = serve(db, '/').html;
  assert.match(after, /4\.9\/5<\/strong><\/div><span><a href="https:\/\/g\.page\/kurat"[^>]*>87 recenzii Google<\/a>/);
  assert.match(after, /"reviewCount":87/);
});

test('persoanele fizice văd prețul final cu TVA, după ce cota e confirmată; firmele, prețul fără TVA', () => {
  const {db, ana} = setup();
  assert.match(serve(db, '/servicii/mentenanta').html, /350 lei \+ TVA/);
  assert.match(renderPath(db, '/servicii/mentenanta', {preview: true}).html, /Lipsește: prețul final pentru persoane fizice/);
  ana.update('firma', ana.singleton('firma').id, {cota_tva: 21});
  processEvents(db);
  const page = serve(db, '/servicii/mentenanta').html;
  assert.match(page, /424 lei <small class="vat">TVA inclus<\/small><span class="net">350 lei \+ TVA pentru firme<\/span>/);
  assert.match(serve(db, '/servicii/generala').html, /968–1\.452 lei <small class="vat">TVA inclus<\/small><span class="net">800–1\.200 lei \+ TVA pentru firme/, 'și intervalele');
  assert.match(serve(db, '/servicii').html, /de la <\/span><strong[^>]*>424 lei <small class="vat">TVA inclus/);
});

test('garanția: o singură formulare, din politica din Brain, odată publicată și confirmată', () => {
  const {db, ana} = setup();
  assert.match(serve(db, '/').html, /Curățenia pe care o meriți, sau banii înapoi\./);
  assert.match(renderPath(db, '/', {preview: true}).html, /Lipsește: o singură formulare a garanției/);
  ana.create('garantie', {titlu: 'Garanția Kurat', rezumat: 'Ne anunți în 48 de ore și refacem gratuit; dacă nici atunci nu ești mulțumit, îți dăm banii înapoi.'}, {publish: true});
  processEvents(db);
  const html = serve(db, '/').html;
  assert.match(html, />Garanția Kurat<\/h2>\s*<p[^>]*>Ne anunți în 48 de ore și refacem gratuit/);
  assert.doesNotMatch(renderPath(db, '/', {preview: true}).html, /o singură formulare a garanției/);
});

test('testimonialele arată persoana, funcția și data, când sunt completate', () => {
  const {db, ana} = setup();
  assert.match(renderPath(db, '/', {preview: true}).html, /Lipsește: cine vorbește în fiecare testimonial/);
  const t = db.prepare("SELECT t.id FROM testimonials t JOIN clients c ON c.id = t.client_id WHERE c.nume = 'Lensa' LIMIT 1").get().id;
  ana.update('testimoniale', t, {autor: 'Maria Ionescu', functie: 'office manager', data: '2026-03-10'}, {publish: true});
  processEvents(db);
  assert.match(serve(db, '/').html, />Lensa<\/strong><span>Maria Ionescu, office manager · martie 2026<\/span>/);
});
