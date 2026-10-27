// Etapa 2 a importului (§1.3): citește snapshot-ul și scrie rapoarte JSON în reference/analysis/.
// Aici se văd și se discută deciziile înainte să ajungă în bază. Nu scrie nimic în Brain.
// Rulare: node scripts/analyze.mjs [--snapshot=reference/snapshot] [--out=reference/analysis]
//
// Forma unui element: {ref, fields, prov: {câmp: sursă}, links: {câmp: [{ref, status, confidence, evidence, attrs}]}}
// `ref` e cheia naturală (`servicii:generala`, `media:<sha1>`): importul o păstrează în legacy_ref → ID-uri deterministe.
import fs from 'node:fs';
import path from 'node:path';
import {parse, all, one, kids, txt, walk, clean, outer} from '../src/lib/html.mjs';
import {iconOf} from '../src/site/icons.mjs';
// iconița unui card din site-ul vechi (primul SVG din <kurat-icon>), ca nume din biblioteca de iconițe
const iconIn = node => iconOf(outer(one(one(node, 'kurat-icon') ?? node, 'svg')));
import {norm, slugify, fold} from '../src/core/util.mjs';
import {findMentions, phoneDisplay, paragraphs} from '../src/core/content.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const SNAP = path.resolve(arg('snapshot', 'reference/snapshot'));
const OUT = path.resolve(arg('out', 'reference/analysis'));

const manifest = JSON.parse(fs.readFileSync(path.join(SNAP, 'manifest.json'), 'utf8'));
const BASE = manifest.base;
const read = f => fs.readFileSync(path.join(SNAP, f));

// ———————————————————————————————————————————— intrări

const pages = new Map();
for (const it of manifest.items.filter(i => i.kind === 'page' && i.file)) {
  const html = read(it.file).toString('utf8');
  const root = parse(html);
  const p = new URL(it.url).pathname.replace(/\/$/, '') || '/';
  pages.set(p, {path: p, url: it.url, file: it.file, root, main: one(root, 'main') ?? root, fetched_at: it.fetched_at});
}
const P = p => { const x = pages.get(p); if (!x) throw new Error(`Pagina ${p} lipsește din snapshot`); return x; };

const jsItems = manifest.items.filter(i => i.kind === 'js' && i.file);
const jsText = jsItems.map(i => ({...i, src: read(i.file).toString('utf8')}));
const jsFind = re => { for (const j of jsText) { const m = re.exec(j.src); re.lastIndex = 0; if (m) return {m, js: j}; } return null; };
const jsAll = re => jsText.flatMap(j => [...j.src.matchAll(re)].map(m => ({m, js: j})));
// Literal de string din bundle. Decodat de mână: codul descărcat nu se evaluează niciodată.
const ESC = {n: '\n', r: '\r', t: '\t', b: '\b', f: '\f', v: '\v', 0: '\0'};
const jsStr = s => s.replace(/\\(x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|[\s\S])/g, (m, e) =>
  e[0] === 'x' ? String.fromCharCode(parseInt(e.slice(1), 16))
    : e[0] === 'u' && e.length > 1 ? String.fromCodePoint(parseInt(e.replace(/[u{}]/g, ''), 16))
      : ESC[e] ?? e);

const apiItem = manifest.items.find(i => i.kind === 'api' && i.file && i.url.endsWith('/api/calculator/config'));
const api = apiItem ? JSON.parse(read(apiItem.file).toString('utf8')) : null;

const src = (page, method, excerpt, extra = {}) => ({url: page.url, file: page.file, method, excerpt: excerpt == null ? null : String(excerpt).slice(0, 300), ...extra});
const jsSrc = (j, method, excerpt, extra = {}) => ({url: j.url, file: j.file, method, excerpt: String(excerpt ?? '').slice(0, 300), ...extra});
const apiSrc = (method, excerpt, extra = {}) => ({url: apiItem.url, file: apiItem.file, kind: 'endpoint', method, excerpt: String(excerpt ?? '').slice(0, 300), ...extra});

// ———————————————————————————————————————————— colecții

const C = {media: [], firma: [], sarcini: [], extra: [], servicii: [], tarife: [], clienti: [], testimoniale: [],
  valori: [], avantaje: [], pasi: [], intrebari: [], calculator: [], sectiuni: [], pagini: [], meniuri: []};
const byRef = new Map();
function put(type, ref, fields, prov = {}, links = {}) {
  const r = `${type}:${ref}`;
  const ex = byRef.get(r);
  if (ex) { // același lucru găsit din nou: unim câmpurile lipsă și sursele
    for (const [k, v] of Object.entries(fields)) if (ex.fields[k] == null && v != null) ex.fields[k] = v;
    for (const [k, v] of Object.entries(prov)) ex.prov[k] ??= v;
    ex.seen.push(prov[''] ?? Object.values(prov)[0]);
    return ex;
  }
  const item = {ref: r, fields, prov, links, seen: []};
  C[type].push(item); byRef.set(r, item);
  return item;
}
const observations = [];
const observe = (impact, message, extra = {}) => observations.push({impact, message, ...extra});

// ———————————————————————————————————————————— utilitare de citire

const stripQuotes = s => clean(s).replace(/^[“"„«]\s*|\s*[”"»]$/g, '');
const intStat = s => Number(String(s).replace(/[^\d]/g, ''));
function parsePrice(s) {
  const t = clean(s);
  if (/la cerere/i.test(t)) return {pret: null, pret_max: null, la_cerere: true, plus_tva: false};
  const m = t.match(/(\d[\d.]*)\s*(?:[–-]\s*(\d[\d.]*))?\s*lei/i);
  return {pret: m ? intStat(m[1]) : null, pret_max: m?.[2] ? intStat(m[2]) : null, la_cerere: false, plus_tva: /\+\s*TVA/i.test(t)};
}
function parseExtraPrice(s) {
  const m = clean(s).match(/\+?\s*(\d[\d.]*)\s*lei(?:\s*\/\s*(\S+))?/i);
  return {pret: m ? intStat(m[1]) : null, unitate: m?.[2] ?? null};
}
const textAfter = (scope, label) => {
  const leaves = all(scope, n => n.tag !== '#text' && !kids(n).length && txt(n));
  const i = leaves.findIndex(n => txt(n) === label);
  return i >= 0 ? txt(leaves[i + 1]) : null;
};
// Secțiunile de nivel superior (unele sunt învelite în componente Angular, de exemplu <kurat-price-calculator>).
const sectionsOf = page => all(page.main, n => n.tag === 'section' && !inside(n, p => p.tag === 'section'));
const sectionId = s => s.attrs['aria-labelledby'] ?? s.attrs.id ?? (s.attrs['aria-label'] ? slugify(s.attrs['aria-label']) : null);
const heading = s => one(s, n => /^h[1-3]$/.test(n.tag));
const inside = (n, pred) => { for (let p = n.parent; p; p = p.parent) if (pred(p)) return true; return false; };
const inCard = n => inside(n, p => /\blk-card\b/.test(p.attrs?.class ?? '') || ['li', 'figure', 'form', 'button'].includes(p.tag));

// ———————————————————————————————————————————— media (cheie naturală: amprenta fișierului, §1.2)

const assetByPath = new Map(manifest.items.filter(i => i.kind === 'asset' && i.file).map(i => [new URL(i.url).pathname, i]));
function media(srcPath, alt, page) {
  if (!srcPath) return null;
  const p = new URL(srcPath, BASE).pathname;
  const a = assetByPath.get(p);
  if (!a) { observe('mic', `Fișier media lipsă din snapshot: ${p}`, {url: page?.url}); return null; }
  const it = put('media', a.sha1, {path: p, file: a.file, sha1: a.sha1, mime: a.content_type, size: a.size, alt: alt ? clean(alt) : null, original_url: a.url},
    {'': {url: a.url, file: a.file, method: 'crawl'}});
  if (!it.fields.alt && alt) it.fields.alt = clean(alt);
  return it.ref;
}

// ———————————————————————————————————————————— 1. Date firmă

const home = P('/');
{
  const contact = home.main && sectionsOf(home).find(s => sectionId(s) === 'contact-h');
  const tel = one(contact, n => n.tag === 'a' && /^tel:/.test(n.attrs.href ?? ''));
  const mail = one(contact, n => n.tag === 'a' && /^mailto:/.test(n.attrs.href ?? ''));
  const wa = one(contact, n => n.tag === 'a' && /wa\.me\//.test(n.attrs.href ?? ''));
  const addr = textAfter(contact, 'Adresă');
  const [street, cityPart, country] = (addr ?? '').split(',').map(clean);
  const cod = cityPart?.match(/^\d+/)?.[0] ?? null, oras = cityPart?.replace(/^\d+\s*/, '') ?? null;
  const shopMail = one(P('/shop').root, n => n.tag === 'a' && /^mailto:/.test(n.attrs.href ?? ''));
  const footer = one(home.root, 'footer');
  const hero = sectionsOf(home)[0];
  const ratingEl = one(hero, n => /din 5 stele/.test(n.attrs?.['aria-label'] ?? ''));
  const stats = {};
  for (const n of all(hero, n => n.tag === 'div' && /^[\d.]+\+$/.test(txt(n)) && !kids(n).length)) {
    const label = txt(n.parent.children.filter(c => c.tag === 'div')[1]);
    if (/locuin/i.test(label)) stats.locuinte_curatate = intStat(txt(n));
    if (/clien/i.test(label)) stats.clienti_multumiti = intStat(txt(n));
    if (/birour/i.test(label)) stats.birouri_curatate = intStat(txt(n));
  }
  const story = sectionsOf(P('/despre-noi')).find(s => sectionId(s) === 'ab-story-h');
  const drive = one(story, n => n.tag === 'a' && /drive\.google/.test(n.attrs.href ?? ''));
  const anpc = all(footer, 'a').map(a => a.attrs.href ?? '');
  const fields = {
    nume: one(home.root, n => n.tag === 'a' && n.attrs['aria-label'] === 'Kurat — acasă') ? 'Kurat' : null,
    telefon: phoneDisplay(tel.attrs.href.slice(4)),
    whatsapp: phoneDisplay(wa.attrs.href.match(/wa\.me\/(\d+)/)[1]),
    email: mail.attrs.href.slice(7),
    email_comenzi: shopMail?.attrs.href.slice(7) ?? null,
    adresa: street ?? null,
    cod_postal: cod && /^\d{6}$/.test(cod) ? cod : null, // invalid → rămâne gol, de completat
    oras, tara: country ?? null,
    slogan: txt(one(footer, 'p')),
    rating: ratingEl ? Number(ratingEl.attrs['aria-label'].match(/([\d,]+) din/)[1].replace(',', '.')) : null,
    ...stats,
    prezentare_url: drive?.attrs.href ?? null,
    anpc_sal: anpc.find(h => /anpc/.test(h)) ?? null,
    anpc_sol: anpc.find(h => /europa\.eu/.test(h)) ?? null
  };
  const s = src(home, 'secțiunea Contact', addr);
  const prov = {'': s, telefon: src(home, 'link tel:', tel.attrs.href), email: src(home, 'link mailto:', mail.attrs.href),
    whatsapp: src(home, 'link wa.me', wa.attrs.href),
    rating: src(home, 'hero, aria-label', ratingEl?.attrs['aria-label'], {certainty: 'unverified', note: 'Rating fără număr de recenzii și fără sursă (Google?); de confirmat.'}),
    slogan: src(home, 'subsol', fields.slogan), prezentare_url: src(P('/despre-noi'), 'link „Vezi prezentarea companiei”', drive?.attrs.href),
    email_comenzi: src(P('/shop'), 'link mailto: (magazin)', shopMail?.attrs.href)};
  for (const k of ['locuinte_curatate', 'clienti_multumiti', 'birouri_curatate'])
    prov[k] = src(home, 'hero, cifre', fields[k], {certainty: 'unverified', note: 'Cifră de marketing fără sursă; de confirmat.'});
  if (cod && !fields.cod_postal) {
    prov.cod_postal = src(home, 'secțiunea Contact', addr, {certainty: 'unverified', note: `Codul „${cod}” are ${cod.length} cifre; în România are 6.`});
    observe('mic', `Codul poștal din site-ul vechi („${cod}”) are ${cod.length} cifre; câmpul rămâne gol până la confirmare.`, {ref: 'firma:kurat', url: home.url});
  }
  // al doilea martor: constantele din bundle
  const jsPhone = jsFind(/="(0\d{3} \d{3} \d{3})"/), jsAddr = jsFind(/="(Strada [^"]+)"/);
  if (jsPhone && jsPhone.m[1] === fields.telefon) prov.telefon.confirmedBy = jsSrc(jsPhone.js, 'constantă în bundle', jsPhone.m[0]);
  if (jsAddr) prov.adresa = jsSrc(jsAddr.js, 'constantă în bundle', jsStr(jsAddr.m[1]));
  put('firma', 'kurat', fields, prov);

  // valori scrise de mână, peste tot
  let n = 0;
  for (const pg of pages.values()) {
    const h = all(pg.root, a => a.tag === 'a' && /^(tel|mailto):/.test(a.attrs.href ?? '')).length;
    const t = (txt(pg.root).match(/0742 293 391/g) ?? []).length;
    n += h + t;
  }
  observe('mediu', `Telefonul și emailul sunt scrise de mână de ${n} ori în cele ${pages.size} pagini (linkuri tel:/mailto: și text). În Brain devin jetoane ({telefon}, {email}).`);
}

// ———————————————————————————————————————————— 2. Servicii, operațiuni, tarife, servicii suplimentare

const hub = P('/servicii');
const footerShort = new Map(all(one(home.root, 'footer'), 'a').filter(a => /^\/servicii\/./.test(a.attrs.href ?? ''))
  .map(a => [a.attrs.href.split('/').pop(), txt(a)]));
const extraKey = name => norm(name).replace(/\b(injectie|extractie)\b/g, '').replace(/\s+/g, ' ').trim();
const extraPagePrices = new Map(); // cheie → [{pret, page}]

for (const sec of sectionsOf(hub)) {
  const fel = {'svc-spatiu-h': 'spatiu', 'svc-tip-h': 'curatenie'}[sectionId(sec)];
  if (!fel) continue;
  for (const card of all(sec, 'a.lk-card')) {
    const href = card.attrs.href, slug = href.split('/').pop(), detail = P(href);
    const sd = sectionsOf(detail), heroSec = sd.find(s => sectionId(s) === 'sd-h');
    const img = one(heroSec, 'img');
    const hubCount = Number(txt(card).match(/(\d+) servicii incluse/)?.[1]);
    const hubFrom = txt(card).match(/de la\s+([\d.]+)\s*lei/)?.[1];
    const acoperaIdx = all(heroSec, 'span').map(txt);
    const acopera = acoperaIdx.includes('Acoperim:') ? acoperaIdx.slice(acoperaIdx.indexOf('Acoperim:') + 1).filter(Boolean) : null;
    const fields = {
      fel, nume: txt(one(detail.main, 'h1')), nume_scurt: footerShort.get(slug) ?? null, aliasuri: null, slug, pagina: true, icon: iconIn(card),
      descriere: txt(one(heroSec, 'p')), imagine_id: media(img?.attrs.src, img?.attrs.alt, detail), acopera, tarif_mp: null, cheie_calculator: null
    };
    if (fields.descriere !== txt(one(card, 'p'))) observe('mic', `Descrierea serviciului „${fields.nume}” diferă între /servicii și pagina lui.`, {ref: `servicii:${slug}`});
    const links = {sarcini: [], extra: []};

    // Ce includem — operațiunile sunt aceleași înregistrări între servicii (dublurile se unesc după text)
    const inc = sd.find(s => sectionId(s) === 'sd-include-h');
    let grup = null;
    for (const n of walk(inc)) {
      if (n.tag === 'h3') grup = txt(n);
      if (n.tag !== 'li') continue;
      const t = txt(n);
      const task = put('sarcini', norm(t), {text: t}, {'': src(detail, 'listă „Ce includem”', t)});
      links.sarcini.push({ref: task.ref, status: 'confirmed', attrs: grup ? {grup} : null});
    }
    if (hubCount && hubCount !== links.sarcini.length)
      observe('mediu', `„${fields.nume}”: /servicii spune ${hubCount} servicii incluse, pagina are ${links.sarcini.length}. În Brain numărul se calculează.`, {ref: `servicii:${slug}`});

    // Prețuri orientative
    const pr = sd.find(s => sectionId(s) === 'sd-price-h');
    if (pr) {
      const tiers = all(pr, n => n.tag === 'div' && kids(n, 'div').length === 2 && kids(n, 'div').every(d => !kids(d).length));
      tiers.forEach((t, i) => {
        const [label, price] = kids(t, 'div').map(txt);
        put('tarife', `${slug}:${norm(label)}`, {serviciu_id: `servicii:${slug}`, eticheta: label, ...parsePrice(price), ordine: i + 1},
          {'': src(detail, 'tabel „Prețuri orientative”', `${label}: ${price}`)});
      });
      const min = Math.min(...C.tarife.filter(t => t.fields.serviciu_id === `servicii:${slug}` && t.fields.pret != null).map(t => t.fields.pret));
      if (hubFrom && intStat(hubFrom) !== min) observe('mare', `„${fields.nume}”: /servicii spune „de la ${hubFrom} lei”, cel mai mic tarif e ${min} lei.`, {ref: `servicii:${slug}`});
      for (const li of all(pr, 'li')) {
        const name = txt(one(li, 'span')), {pret, unitate} = parseExtraPrice(txt(one(li, 'strong')));
        const k = extraKey(name);
        const ex = put('extra', k, {nume: name, pret, unitate, in_calculator: false},
          {'': src(detail, 'listă „Servicii suplimentare”', `${name}: ${txt(one(li, 'strong'))}`)});
        links.extra.push({ref: ex.ref, status: 'confirmed'});
        (extraPagePrices.get(k) ?? extraPagePrices.set(k, []).get(k)).push({pret, page: detail.path});
      }
    }
    put('servicii', slug, fields, {'': src(detail, 'pagina serviciului', fields.nume), descriere: src(detail, 'hero', fields.descriere),
      nume_scurt: fields.nume_scurt ? src(home, 'link în subsol', fields.nume_scurt) : undefined}, links);
  }
}
for (const [k, list] of extraPagePrices) {
  const prices = [...new Set(list.map(x => x.pret))];
  if (prices.length > 1) observe('mare', `Serviciul suplimentar „${byRef.get(`extra:${k}`).fields.nume}” are prețuri diferite între pagini: ${list.map(x => `${x.pret} lei pe ${x.page}`).join(', ')}.`, {ref: `extra:${k}`});
}

// ———————————————————————————————————————————— 3. Cardurile din homepage → servicii (unele fără pagină)

// Servicii care apar doar ca card pe homepage: devin înregistrări, fără pagină proprie.
const NEW_FROM_CARDS = [
  {re: /industrial/, slug: 'industriale', fel: 'spatiu', nume_scurt: 'Industriale'},
  {re: /petreceri|evenimente/, slug: 'dupa-evenimente', fel: 'curatenie', nume_scurt: 'După evenimente'},
  {re: /canapele|mocheta/, slug: 'canapele-mocheta', fel: 'curatenie', nume_scurt: 'Canapele & mochetă'}
];
// Carduri care par să prezinte un serviciu existent: legături DEDUSE (regulă: potrivire după nume), de confirmat de un om.
const CARD_RULES = [
  {re: /rezidential/, slug: 'locuinte', confidence: 0.9, why: '„rezidențial” = locuințe; descrierea cardului („apartamente, case și vile… cameră cu cameră”) repetă pagina Locuințe'},
  {re: /post.?constructie|renovare/, slug: 'dupa-constructor', confidence: 0.85, why: '„post-construcție sau renovare” ≈ „curățenie după constructor”; descrierea („praful și resturile după lucrări”) repetă pagina'},
  {re: /birouri/, slug: 'birouri', confidence: 0.6, why: 'cardul „Birouri și spații comerciale” acoperă două servicii; legat de Birouri, Spații comerciale e candidat separat'}
];
const homeCards = {companii: [], persoane: []}, homeIntros = {};
{
  const sec = sectionsOf(home).find(s => sectionId(s) === 'servicii-h');
  for (const grid of all(sec, '.lk-svc-grid')) {
    const who = /companii/i.test(txt(one(grid.parent, 'h3'))) ? 'companii' : 'persoane';
    homeIntros[who] = txt(one(one(grid.parent, 'h3').parent, 'p'));
    for (const card of all(grid, 'div.lk-card')) {
      const title = txt(one(card, 'h4')), text = txt(one(card, 'p')), puncte = all(card, 'li').map(txt);
      const count = Number(txt(card).match(/(\d+) servicii incluse/)?.[1]);
      const img = one(card, 'img'), key = norm(title);
      const make = NEW_FROM_CARDS.find(r => r.re.test(key));
      if (make) {
        put('servicii', make.slug, {fel: make.fel, icon: iconIn(card), nume: title, nume_scurt: make.nume_scurt, slug: make.slug, pagina: false,
          descriere: text, imagine_id: media(img?.attrs.src, img?.attrs.alt, home), acopera: null, aliasuri: null, tarif_mp: null, cheie_calculator: null},
          {'': src(home, `card „Pentru ${who}” fără pagină proprie`, `${title}: ${text}`)}, {sarcini: [], extra: []});
        observe('mediu', `„${title}” apare pe homepage, dar nu are pagină (cardul trimite la /servicii). În Brain e serviciu fără pagină; de decis dacă primește una.`, {ref: `servicii:${make.slug}`});
        homeCards[who].push({ref: `servicii:${make.slug}`, status: 'confirmed', attrs: {titlu: title, text, puncte, icon: iconIn(card), imagine: media(img?.attrs.src, img?.attrs.alt, home)},
          evidence: src(home, 'card homepage', title), oldCount: count});
        continue;
      }
      const rule = CARD_RULES.find(r => r.re.test(key));
      if (!rule) { observe('mediu', `Cardul „${title}” de pe homepage nu se potrivește cu niciun serviciu.`, {url: home.url}); continue; }
      homeCards[who].push({ref: `servicii:${rule.slug}`, status: 'inferred', confidence: rule.confidence,
        attrs: {titlu: title, text, puncte, icon: iconIn(card), imagine: media(img?.attrs.src, img?.attrs.alt, home)},
        evidence: src(home, `regulă: potrivire după nume — ${rule.why}`, `${title}: ${text}`), oldCount: count});
    }
  }
  for (const c of [...homeCards.companii, ...homeCards.persoane]) {
    const svc = byRef.get(c.ref), n = svc.links.sarcini.length;
    if (c.oldCount && svc.fields.pagina && c.oldCount !== n)
      observe('mediu', `Cardul „${c.attrs.titlu}” de pe homepage spune ${c.oldCount} servicii incluse; „${svc.fields.nume}” are ${n}.`, {ref: c.ref});
  }
}

// ———————————————————————————————————————————— 4. Calculatorul: API live vs rezerva din bundle

const CALC_KEYS = {maintenance: 'mentenanta', general: 'generala', 'post-construction': 'dupa-constructor', carpet: 'canapele-mocheta'};
{
  const fb = jsFind(/serviceRates:\[([\s\S]*?)\],furnishingMultipliers:\[([\s\S]*?)\],extras:\[([\s\S]*?)\],minimumPrice:(\d+)/);
  const fbRates = fb ? Object.fromEntries([...fb.m[1].matchAll(/key:"([\w-]+)",name:"((?:[^"\\]|\\.)*)",ratePerSqm:([\d.]+)/g)].map(m => [m[1], {name: jsStr(m[2]), rate: +m[3]}])) : {};
  const fbExtras = fb ? [...fb.m[3].matchAll(/name:"((?:[^"\\]|\\.)*)",price:([\d.]+)/g)].map(m => ({name: jsStr(m[1]), price: +m[2]})) : [];
  const fbMin = fb ? +fb.m[4] : null;
  const furnLabels = Object.fromEntries((jsFind(/\{None:"((?:[^"\\]|\\.)*)",Little:"((?:[^"\\]|\\.)*)",Full:"((?:[^"\\]|\\.)*)"\}/)?.m.slice(1) ?? [])
    .map((s, i) => [['None', 'Little', 'Full'][i], jsStr(s)]));

  if (!api) observe('mare', 'Configurația calculatorului nu e în snapshot (API indisponibil la crawl).');
  for (const r of api?.serviceRates ?? []) {
    const slug = CALC_KEYS[r.key];
    const svc = slug && byRef.get(`servicii:${slug}`);
    if (!svc) { observe('mare', `Calculatorul are serviciul „${r.name}” (${r.key}), fără corespondent pe site.`); continue; }
    svc.fields.tarif_mp = r.ratePerSqm;
    svc.fields.cheie_calculator = r.key;
    const aliases = new Set(svc.fields.aliasuri ?? []);
    if (norm(r.name) !== norm(svc.fields.nume) && norm(r.name) !== norm(svc.fields.nume_scurt)) aliases.add(r.name);
    const f = fbRates[r.key];
    if (f && norm(f.name) !== norm(svc.fields.nume) && norm(f.name) !== norm(svc.fields.nume_scurt)) aliases.add(f.name);
    svc.fields.aliasuri = aliases.size ? [...aliases] : null;
    const conflict = f && f.rate !== r.ratePerSqm;
    svc.prov.tarif_mp = apiSrc('API /api/calculator/config', `${r.key}: ${r.ratePerSqm} lei/mp`,
      conflict ? {certainty: 'unverified', note: `Rezerva din bundle spune ${f.rate} lei/mp.`, conflictsWith: jsSrc(fb.js, 'rezervă în bundle', `${r.key}: ${f.rate}`)} : {});
    if (conflict) observe('mare', `Tarif calculator „${svc.fields.nume}”: API ${r.ratePerSqm} lei/mp, rezerva din bundle ${f.rate} lei/mp.`, {ref: svc.ref});
  }
  for (const e of api?.extras ?? []) {
    const k = extraKey(e.name);
    const match = C.extra.find(x => x.ref === `extra:${k}` || k.startsWith(x.ref.slice(6)) || x.ref.slice(6).startsWith(k));
    if (match) {
      match.fields.in_calculator = true;
      if (match.fields.pret !== e.price) {
        match.prov.pret = {...(match.prov[''] ?? {}), method: 'listă „Servicii suplimentare” (pagină)', certainty: 'unverified',
          note: `Calculatorul (API) cere ${e.price} lei.`, conflictsWith: apiSrc('API /api/calculator/config', `${e.name}: ${e.price}`)};
        observe('mare', `„${match.fields.nume}”: pe pagini ${match.fields.pret} lei, în calculator ${e.price} lei.`, {ref: match.ref});
      }
      continue;
    }
    put('extra', k, {nume: e.name, pret: e.price, unitate: null, in_calculator: true}, {'': apiSrc('API /api/calculator/config', `${e.name}: ${e.price}`)});
  }
  if (fbExtras.length) {
    const live = new Map((api?.extras ?? []).map(e => [extraKey(e.name), e.price]));
    const diff = fbExtras.filter(e => live.get(extraKey(e.name)) !== e.price).map(e => `${e.name} ${e.price}`);
    if (diff.length) observe('mediu', `Rezerva calculatorului din bundle are alte servicii suplimentare/prețuri decât API-ul: ${diff.join(', ')}. Se folosește când API-ul nu răspunde.`);
  }
  // culoarea și iconița fiecărui tip de curățenie din calculatorul de pe homepage
  const calcSec = sectionsOf(home).find(s => sectionId(s) === 'calc-heading');
  for (const b of all(calcSec, 'button.lk-choice')) {
    const label = txt(one(b, n => n.tag === 'span' && /font-weight: 800/.test(n.attrs?.style ?? '')));
    const st = one(b, n => n.tag === 'span' && /border-radius: 12px/.test(n.attrs?.style ?? ''))?.attrs.style ?? '';
    const color = (st.match(/background: (#[0-9a-f]{6})/i) ?? st.match(/color: (#[0-9a-f]{6})/i))?.[1] ?? null;
    const key = Object.entries(fbRates).find(([, v]) => norm(v.name) === norm(label))?.[0];
    const svc = key && byRef.get(`servicii:${CALC_KEYS[key]}`);
    if (!svc) continue;
    if (color) { svc.fields.culoare = color.toLowerCase(); svc.prov.culoare = src(home, 'calculator, culoarea opțiunii', label); }
    svc.fields.icon ??= iconIn(b);
    // eticheta și descrierea scurte, pe un rând, cum apar în calculator
    const sub = txt(one(b, n => n.tag === 'span' && /font-size: 13px/.test(n.attrs?.style ?? '')));
    svc.fields.calc_eticheta = label; svc.prov.calc_eticheta = src(home, 'calculator, eticheta opțiunii', label);
    if (sub) { svc.fields.calc_descriere = sub; svc.prov.calc_descriere = src(home, 'calculator, descrierea opțiunii', sub); }
  }
  if (api) {
    put('calculator', 'kurat', {
      titlu: 'Calculator preț', pret_minim: api.minimumPrice,
      multiplicatori: api.furnishingMultipliers.map(m => ({nivel: m.level, eticheta: furnLabels[m.level] ?? m.level, multiplicator: m.multiplier}))
    }, {'': apiSrc('API /api/calculator/config', JSON.stringify(api).slice(0, 200)),
      pret_minim: apiSrc('API /api/calculator/config', `minimumPrice: ${api.minimumPrice}`, fbMin != null && fbMin !== api.minimumPrice
        ? {certainty: 'unverified', note: `Rezerva din bundle spune ${fbMin} lei.`} : {})});
    if (fbMin != null && fbMin !== api.minimumPrice) observe('mare', `Prețul minim al calculatorului: API ${api.minimumPrice} lei, rezerva din bundle ${fbMin} lei.`, {ref: 'calculator:kurat'});
  }
  const tiers = C.tarife.map(t => `${byRef.get(t.fields.serviciu_id).fields.nume_scurt ?? t.fields.serviciu_id} ${t.fields.eticheta}: ${t.fields.pret ?? 'la cerere'}`);
  observe('mare', `Paginile au prețuri pe camere/suprafață (${tiers.slice(0, 3).join('; ')}…), calculatorul calculează pe mp. Sunt două modele de preț pentru aceleași servicii; de decis care e sursa.`);
}

// ———————————————————————————————————————————— 5. Clienți și testimoniale

const portfolio = P('/portofoliu');
{
  const logos = sectionsOf(portfolio).find(s => sectionId(s) === 'pf-logos-h');
  all(logos, 'img').forEach((img, i) => {
    const name = clean(img.attrs.alt.replace(/\s*—\s*client Kurat\s*$/i, ''));
    put('clienti', norm(name), {nume: name, aliasuri: null, logo_id: media(img.attrs.src, `${name} — logo`, portfolio), site: null, in_portofoliu: true, ordine: i + 1},
      {'': src(portfolio, 'logo „Au avut încredere în noi”', img.attrs.alt)});
  });
  const seenText = new Map();
  let order = 0;
  for (const [page, secId] of [[home, 'recenzii-h'], [portfolio, 'pf-rev-h']]) {
    const sec = sectionsOf(page).find(s => sectionId(s) === secId);
    for (const fig of all(sec, 'figure')) {
      const text = stripQuotes(txt(one(fig, 'blockquote')));
      const cap = one(fig, 'figcaption');
      const leaves = all(cap, n => n.tag === 'span' && !kids(n).length).map(txt).filter(t => t && t !== 'Client Kurat' && !/^[A-Z]{1,3}$/.test(t));
      const name = leaves[0] ?? txt(cap);
      const stars = Number(one(fig, n => /din 5 stele/.test(n.attrs?.['aria-label'] ?? ''))?.attrs['aria-label'].match(/^(\d)/)?.[1]) || null;
      const ck = norm(name);
      if (!byRef.has(`clienti:${ck}`)) put('clienti', ck, {nume: name, aliasuri: null, logo_id: null, site: null, in_portofoliu: false, ordine: null},
        {'': src(page, 'autorul unui testimonial', name)});
      const t = put('testimoniale', norm(text).slice(0, 120), {text, client_id: `clienti:${ck}`, stele: stars, sursa: 'site', data: null, ordine: ++order},
        {'': src(page, 'testimonial', text.slice(0, 120))});
      (seenText.get(ck) ?? seenText.set(ck, new Set()).get(ck)).add(t.ref);
      // ordinea de pe fiecare pagină (portofoliul are altă ordine decât homepage-ul)
      (t.fields.pages ??= {})[page.path] ??= all(sec, 'figure').indexOf(fig);
    }
  }
  // culoarea fiecărui client (cercul cu inițiale din testimoniale), din datele componentei
  for (const {m, js} of jsAll(/\{brand:"((?:[^"\\]|\\.)*)",stars:\d+,color:"(#[0-9a-fA-F]{6})"/g)) {
    const c = byRef.get(`clienti:${norm(jsStr(m[1]))}`);
    if (c && !c.fields.culoare) { c.fields.culoare = m[2].toLowerCase(); c.prov.culoare = jsSrc(js, 'componenta testimoniale (bundle)', m[0].slice(0, 60)); }
  }
  for (const [ck, refs] of seenText) if (refs.size > 1)
    observe('mic', `${byRef.get(`clienti:${ck}`).fields.nume} are ${refs.size} testimoniale cu texte diferite (pe homepage și în portofoliu). Sunt păstrate amândouă; de ales dacă unul e versiunea corectă.`, {ref: `clienti:${ck}`});
}

// ———————————————————————————————————————————— 6. Valori, avantaje, pași, întrebări

const about = P('/despre-noi');
{
  const read = (page, id) => all(sectionsOf(page).find(s => sectionId(s) === id), n => n.tag === 'div' && one(n, 'h3') && kids(n).length === 3 && !kids(n, 'div').length)
    .map(d => ({litera: txt(kids(d, 'span')[0]), titlu: txt(one(d, 'h3')), text: txt(one(d, 'p'))}));
  const hv = read(home, 'valori-h'), av = read(about, 'ab-val-h');
  hv.forEach((v, i) => put('valori', norm(v.titlu), {...v, ordine: i + 1}, {'': src(home, 'secțiunea „Valorile care ne ghidează”', v.titlu)}));
  const diff = av.filter((v, i) => !hv[i] || hv[i].text !== v.text || hv[i].titlu !== v.titlu);
  if (av.length && diff.length) observe('mediu', `Valorile de pe /despre-noi diferă de cele de pe homepage: ${diff.map(v => v.titlu).join(', ')}.`);
  else if (av.length) observe('mic', 'Valorile K-U-R-A-T sunt copiate identic pe homepage și pe /despre-noi; în Brain sunt o singură listă, la care trimit ambele pagini.');

  const dec = sectionsOf(home).find(s => sectionId(s) === 'deceka-h');
  all(dec, 'li.lk-card').forEach((li, i) => {
    const spans = all(li, n => n.tag === 'span' && !kids(n).length).map(txt).filter(Boolean);
    const ri = spans.indexOf('Fără Kurat:');
    put('avantaje', norm(txt(one(li, 'h3'))), {categorie: spans[0], icon: iconIn(li), titlu: txt(one(li, 'h3')), text: txt(kids(li, 'p')[0]),
      risc_titlu: ri >= 0 ? spans[ri + 1] : null, risc_text: txt(all(li, 'p')[1]), ordine: i + 1},
    {'': src(home, 'secțiunea „De ce să alegi Kurat”', txt(one(li, 'h3')))});
  });

  const cum = sectionsOf(home).find(s => sectionId(s) === 'cum-h');
  all(one(cum, 'ol'), 'li').forEach((li, i) => put('pasi', `proces:${i + 1}`, {grup: 'proces', titlu: txt(one(li, 'h3')), text: txt(one(li, 'p')), ordine: i + 1},
    {'': src(home, 'secțiunea „Curățenie în 4 pași”', txt(li))}));
  const et = one(cum, n => n.attrs?.['aria-labelledby'] === 'etape-h');
  kids(et, 'div').forEach((d, i) => put('pasi', `etape:${i + 1}`, {grup: 'etape', titlu: txt(one(d, 'h4')), text: txt(one(d, 'p')), ordine: i + 1},
    {'': src(home, 'secțiunea „Etapele fiecărei curățenii”', txt(d))}));

  const faq = jsAll(/\{q:"((?:[^"\\]|\\.)*)",a:"((?:[^"\\]|\\.)*)"\}/g);
  faq.forEach(({m, js}, i) => {
    const q = jsStr(m[1]), a = jsStr(m[2]);
    put('intrebari', norm(q), {intrebare: q, raspuns: paragraphs([a]), ordine: i + 1}, {'': jsSrc(js, 'componenta FAQ (bundle)', `${q} — ${a}`)});
  });
  const shown = all(sectionsOf(home).find(s => sectionId(s) === 'faq-h'), 'button').map(b => txt(b));
  const missing = shown.filter(q => !byRef.has(`intrebari:${norm(q)}`));
  if (missing.length) observe('mare', `Întrebări afișate pe homepage fără răspuns găsit în bundle: ${missing.join('; ')}`);
}

// ———————————————————————————————————————————— 7. Pagini și secțiuni

const KIND = [
  [/^top$|^(ab|pf|ct|svc)-h$/, 'hero'], [/^servicii-h$/, 'servicii'], [/^svc-(spatiu|tip)-h$/, 'servicii-lista'], [/^deceka-h$/, 'avantaje'],
  [/^(valori|ab-val)-h$/, 'valori'], [/^cum-h$/, 'pasi'], [/^calc-heading$/, 'calculator'], [/^garantie-h$/, 'garantie'],
  [/^(recenzii|pf-rev)-h$/, 'testimoniale'], [/^pf-logos-h$/, 'clienti'], [/^faq-h$/, 'faq'], [/^contact-h$/, 'contact'], [/^ct-form-h$/, 'formular'],
  [/^cifrele-kurat$|^locatia-biroului-kurat$/, null], [/-cta-h$|^ab-story-h$/, 'text']
];
const linkHref = (a, page) => {
  const h = a.attrs.href;
  if (!h) return a.tag === 'button' ? '#calculator' : null; // butoanele din site-ul vechi deschid calculatorul
  if (/^tel:/.test(h)) return 'tel:{telefon}';
  if (/^mailto:/.test(h)) return 'mailto:{email}';
  if (/wa\.me\//.test(h)) return 'https://wa.me/{whatsapp}';
  const u = new URL(h, page.url);
  if (u.origin !== BASE) return u.href;
  const p = u.pathname.replace(/\/$/, '') || '/';
  if (/^\/servicii\/./.test(p)) return `ref:servicii:${p.split('/').pop()}`;
  return `ref:pagini:${p}`; // se rezolvă la import în ref:pagini:<id>
};

const navLabel = new Map(all(one(home.root, 'nav'), 'a').map(a => [a.attrs.href, txt(a)]));
for (const page of ['/', '/servicii', '/portofoliu', '/despre-noi', '/contact', '/shop'].map(P)) {
  const secRefs = [];
  sectionsOf(page).forEach((sec, i) => {
    if (!heading(sec) && !one(sec, 'p') && !one(sec, 'img') && !sec.attrs['aria-label']) return; // bară de interfață (sortare, filtre)
    const id = sectionId(sec) ?? `s${i + 1}`;
    let kind = KIND.find(([re]) => re.test(id))?.[1];
    if (kind === undefined) kind = page.path === '/shop' ? (i === 0 ? 'hero' : 'produse') : 'text';
    if (/^cifrele/.test(id)) kind = 'cifre';
    if (/^locatia/.test(id)) kind = 'harta';
    const h = heading(sec);
    const before = h ? [...walk(sec)].slice(0, [...walk(sec)].indexOf(h)).filter(n => n.tag === 'div' && !kids(n).length && txt(n) && txt(n).length < 40) : [];
    const ps = all(sec, 'p').filter(p => !inCard(p));
    const fields = {kind, eticheta: before.length ? txt(before[before.length - 1]) : null, titlu: h ? txt(h) : null,
      intro: kind === 'text' ? null : (ps[0] ? txt(ps[0]) : null), continut: null, puncte: null, butoane: null, imagine_id: null, filtru: null};
    if (kind === 'text') fields.continut = paragraphs(ps.map(txt));
    if (kind === 'avantaje' || kind === 'servicii') fields.nota = kind === 'avantaje' && ps.length > 1 ? txt(ps[ps.length - 1]) : null;
    if (kind === 'garantie') fields.eticheta = txt(one(one(sec, '.lk-guarantee') ?? sec, n => n.tag === 'span' && /border-radius/.test(n.attrs?.style ?? '')));
    if (kind === 'hero' && h) {
      // titlul cu rândul rupt (<br>) și cuvântul evidențiat (<span>), ca în original
      const parts = []; const acc = [];
      for (const n of walk(h)) { if (n.tag === 'br') parts.push('\n'); else if (n.tag === '#text') parts.push(n.text); if (n.tag === 'span') acc.push(txt(n)); }
      fields.titlu = parts.join('').split('\n').map(clean).filter(Boolean).join('\n');
      fields.accent = acc[0] ?? null;
      const top = kids(h.parent).find(n => n.tag === 'div' && one(n, 'span'));
      fields.insigna = top && top !== h ? txt(one(top, 'span')) || null : null;
      const fl = one(sec, '.lk-float');
      if (fl) { const d = all(fl, n => n.tag === 'div' && !kids(n).length); fields.card_titlu = txt(d[0]) || null; fields.card_text = txt(d[1]) || null; }
    }
    if (kind === 'servicii-lista') fields.filtru = id === 'svc-spatiu-h' ? 'spatiu' : 'curatenie';
    if (kind === 'garantie') fields.puncte = all(one(sec, 'ul'), 'span').map(txt).filter(Boolean);
    if (kind === 'calculator') fields.puncte = all(one(sec, 'ul'), 'li').map(txt).filter(Boolean);
    if (kind === 'hero' || kind === 'text') {
      const img = all(sec, 'img').find(x => !inCard(x));
      if (img) fields.imagine_id = media(img.attrs.src, img.attrs.alt, page);
    }
    const btns = all(sec, n => (n.tag === 'a' || n.tag === 'button') && /\blk-(btn|link)/.test(n.attrs.class ?? '')
      && !inside(n, p => /\blk-card\b/.test(p.attrs?.class ?? '') || p.tag === 'form' || p.tag === 'kurat-price-calculator'))
      .filter(n => !['contact', 'formular'].includes(kind) || n.tag === 'button')
      .map(n => ({label: txt(n), href: linkHref(n, page), stil: (n.attrs.class.match(/lk-(btn-[\w]+|link)/) ?? [])[1] ?? null}))
      .filter(b => b.label && b.href);
    if (btns.length) fields.butoane = btns;
    const links = {};
    const refsOf = type => C[type].map(x => ({ref: x.ref, status: 'confirmed'}));
    if (kind === 'valori') links.valori = refsOf('valori');
    if (kind === 'avantaje') links.avantaje = refsOf('avantaje');
    if (kind === 'pasi') links.pasi = refsOf('pasi');
    if (kind === 'faq') links.intrebari = refsOf('intrebari');
    if (kind === 'clienti') links.clienti = C.clienti.filter(c => c.fields.in_portofoliu).map(c => ({ref: c.ref, status: 'confirmed'}));
    if (kind === 'testimoniale') links.testimoniale = C.testimoniale.filter(t => page.path in t.fields.pages).sort((a, b) => a.fields.pages[page.path] - b.fields.pages[page.path]).map(t => ({ref: t.ref, status: 'confirmed'}));
    if (kind === 'servicii') {
      links.servicii_companii = homeCards.companii; links.servicii_persoane = homeCards.persoane;
      fields.intro_companii = homeIntros.companii ?? null; fields.intro_persoane = homeIntros.persoane ?? null;
    }
    const s = put('sectiuni', `${page.path}#${id}`, fields, {'': src(page, `secțiunea ${id}`, fields.titlu)}, links);
    secRefs.push({ref: s.ref, status: 'confirmed'});
  });
  const title = txt(one(page.root, 'title')), desc = one(page.root, n => n.tag === 'meta' && n.attrs.name === 'description')?.attrs.content ?? null;
  put('pagini', page.path, {titlu: txt(one(page.main, 'h1')), nume_scurt: navLabel.get(page.path) ?? (page.path === '/' ? 'Acasă' : null),
    path: page.path, meta_title: title, meta_description: desc},
  {'': src(page, 'pagină compusă', title), nume_scurt: navLabel.has(page.path) ? src(home, 'meniul principal', navLabel.get(page.path))
    : src(page, 'implicit: pagina nu apare în meniu', null, {certainty: 'inferred'})}, {sectiuni: secRefs});
}

// Meniurile: trimiteri spre entități; eticheta proprie doar când diferă de numele scurt al țintei.
{
  const shortOf = href => {
    const r = href.match(/^ref:(\w+):(.+)$/);
    const t = r && byRef.get(`${r[1]}:${r[2]}`);
    return t ? t.fields.nume_scurt ?? t.fields.nume ?? t.fields.titlu : null;
  };
  const item = a => {
    const href = linkHref(a, home);
    const label = txt(a);
    return shortOf(href) === label ? {href} : {href, label};
  };
  put('meniuri', 'principal', {cheie: 'principal', titlu: 'Meniul principal', linkuri: all(one(home.root, 'nav'), 'a').map(item)},
    {'': src(home, 'antet, <nav aria-label="Principal">', all(one(home.root, 'nav'), 'a').map(txt).join(' · '))});
  const footer = one(home.root, 'footer');
  for (const col of all(footer, n => n.tag === 'div' && kids(n, 'div').length === 2 && !kids(kids(n, 'div')[0]).length && all(kids(n, 'div')[1], 'a').length)) {
    const name = txt(kids(col, 'div')[0]);
    const links = all(kids(col, 'div')[1], 'a').filter(a => !/^(tel|mailto):/.test(a.attrs.href ?? ''));
    if (!links.length) continue;
    put('meniuri', `subsol-${slugify(name)}`, {cheie: `subsol-${slugify(name)}`, titlu: `Subsol — ${name}`, linkuri: links.map(item)},
      {'': src(home, `subsol, coloana „${name}”`, links.map(txt).join(' · '))});
  }
}
{
  const descs = new Set(C.pagini.map(p => p.fields.meta_description));
  const all12 = new Set([...pages.values()].map(p => one(p.root, n => n.tag === 'meta' && n.attrs.name === 'description')?.attrs.content));
  if (all12.size === 1) observe('mare', `Toate cele ${pages.size} pagini au aceeași meta description. Paginile compuse o primesc la import, dar trebuie rescrisă pe fiecare.`);
  if (descs.size === 1) for (const p of C.pagini)
    p.prov.meta_description = {...p.prov[''], method: '<meta name="description">', excerpt: p.fields.meta_description, certainty: 'unverified', note: 'Aceeași descriere pe toate paginile.'};
  for (const s of C.servicii.filter(s => s.fields.pagina)) observe('mic', `Pagina ${s.fields.nume} nu are meta description proprie; se generează din descriere până e scrisă.`, {ref: s.ref});
}
if (/Momentan nu sunt produse/i.test(txt(P('/shop').main))) observe('mic', 'Magazinul nu are niciun produs. Tipul `produse` există în registru, gol; de decis dacă produsele stau în Brain sau în api.kurat.ro.');

// ———————————————————————————————————————————— 8. Mențiuni (§1.6 b) — doar raport; în Brain se recalculează la rulare

const candidates = [...C.servicii.map(s => ({key: 'servicii', ref: s.ref, id: s.ref, names: [s.fields.nume, s.fields.nume_scurt, ...(s.fields.aliasuri ?? [])]})),
  ...C.clienti.map(c => ({key: 'clienti', ref: c.ref, id: c.ref, names: [c.fields.nume]}))];
const mentions = [];
for (const [type, fieldsToScan] of [['avantaje', ['text', 'risc_text']], ['pasi', ['text']], ['intrebari', ['raspuns']], ['sectiuni', ['intro', 'continut']], ['testimoniale', ['text']], ['servicii', ['descriere']]]) {
  for (const it of C[type]) for (const f of fieldsToScan) {
    for (const m of findMentions(it.fields[f], candidates.filter(c => c.ref !== it.ref)))
      mentions.push({in: it.ref, field: f, mentions: m.id, name: m.name, excerpt: m.excerpt});
  }
}
// numele scurte (< 8 caractere, un cuvânt) nu se caută: le raportăm, ca să se vadă de ce lipsesc
const shortNames = candidates.flatMap(c => c.names.filter(n => n && clean(n).length < 8 && clean(n).split(' ').length < 2).map(n => `${n} (${c.ref})`));

// ———————————————————————————————————————————— scriere

fs.rmSync(OUT, {recursive: true, force: true});
fs.mkdirSync(OUT, {recursive: true});
for (const it of C.testimoniale) delete it.fields.pages; // doar ajutor intern pentru secțiuni
for (const [k, items] of Object.entries(C)) fs.writeFileSync(path.join(OUT, `${k}.json`), JSON.stringify(items.map(({seen, ...x}) => x), null, 2));
fs.writeFileSync(path.join(OUT, 'observatii.json'), JSON.stringify(observations, null, 2));
fs.writeFileSync(path.join(OUT, 'mentiuni.json'), JSON.stringify({mentions, notSearched: shortNames}, null, 2));
fs.writeFileSync(path.join(OUT, 'index.json'), JSON.stringify({
  snapshot: path.relative(process.cwd(), SNAP), base: BASE, crawled_at: manifest.started_at,
  counts: Object.fromEntries(Object.entries(C).map(([k, v]) => [k, v.length])),
  order: Object.keys(C), observations: observations.length, mentions: mentions.length
}, null, 2));

console.log('Analiză scrisă în', path.relative(process.cwd(), OUT));
console.table(Object.fromEntries(Object.entries(C).map(([k, v]) => [k, v.length])));
const byImpact = i => observations.filter(o => o.impact === i);
for (const i of ['mare', 'mediu', 'mic']) { if (!byImpact(i).length) continue; console.log(`\nObservații — impact ${i}:`); for (const o of byImpact(i)) console.log(' •', o.message); }
console.log(`\nMențiuni găsite în texte: ${mentions.length}; nume prea scurte pentru căutare: ${shortNames.length}`);
