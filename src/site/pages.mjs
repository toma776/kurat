// Site-ul public, randat pe server din Brain. Toate citirile trec prin contextul urmărit (ctx).
// Fiecare bucată de pagină spune ce componentă e și de ce citește ce citește (ctx.within), de aici „Unde apare”.
import fs from 'node:fs';
import {createContext, esc} from './context.mjs';
import {entity} from '../registry/entities.mjs';
import {sha1} from '../core/util.mjs';
import {lei, jsonLd} from './ui.mjs';
import {SECTIONS, whatsappFab} from './theme.mjs';
// Kurat DS 2 pe tot site-ul; secțiunile originale (theme.mjs) rămân doar ca rezervă pentru un tip de secțiune nou, încă nedesenat
import {SECTIONS as DS, header, footer, mobileBar, servicePageBody} from './modern.mjs';
import {icon} from './icons.mjs';

// CSS și JS versionate după conținut: o modificare ajunge imediat la vizitatori, iar fișierul se poate ține în cache un an.
const asset = name => {
  try { return `/static/${name}?v=${sha1(fs.readFileSync(new URL(`./static/${name}`, import.meta.url))).slice(0, 10)}`; }
  catch { return `/static/${name}`; }
};
const BASE = asset('kurat.css'), CSS = asset('site.css'), DSCSS = asset('ds.css'), JS = asset('site.js');

// ———————————————————————————————————————————— rutare

export function renderPath(db, path, {preview = false, overlay = null} = {}) {
  const ctx = createContext(db, {path, preview: preview || !!overlay, overlay});
  const red = db.prepare('SELECT * FROM redirects WHERE from_path = ?').get(path);
  if (red) {
    const location = red.to_ref ? ctx.href(red.to_ref) : red.to_path;
    if (location && location !== path) return {status: red.code, location, ctx};
  }
  const row = (table, where, ...params) => db.prepare(`SELECT id FROM ${table} WHERE ${where}`).get(...params);
  let r;
  if ((r = row(entity('pagini').table, 'path = ?', path))) {
    const page = ctx.page('pagini', r.id);
    if (page) return {status: 200, html: composedPage(ctx, page), title: page.meta_title ?? page.titlu, owner: {key: 'pagini', id: page.id}, ctx};
  }
  let m;
  if ((m = /^\/servicii\/([\w-]+)$/.exec(path)) && (r = row(entity('servicii').table, 'slug = ? AND pagina = 1', m[1]))) {
    const svc = ctx.page('servicii', r.id);
    if (svc) return {status: 200, html: servicePage(ctx, svc), title: svc.nume, owner: {key: 'servicii', id: svc.id}, ctx};
  }
  if ((m = /^\/shop\/([\w-]+)$/.exec(path)) && (r = row(entity('produse').table, 'slug = ?', m[1]))) {
    const p = ctx.page('produse', r.id);
    if (p) return {status: 200, html: productPage(ctx, p), title: p.nume, owner: {key: 'produse', id: p.id}, ctx};
  }
  return {status: 404, html: notFound(ctx), title: 'Pagina nu există', ctx};
}

// ———————————————————————————————————————————— document și componente comune

// Date structurate pentru motoarele de căutare și AI (lipseau din site-ul vechi).
function structuredData(ctx) {
  return ctx.layout('Date structurate', () => {
    const f = ctx.firma();
    const ld = {'@context': 'https://schema.org', '@type': 'CleaningService', name: f.nume, telephone: ctx.href('tel:{telefon}').slice(4), email: f.email,
      url: 'https://kurat.ro/', areaServed: f.tara ?? 'România',
      address: f.adresa ? {'@type': 'PostalAddress', streetAddress: f.adresa, postalCode: f.cod_postal ?? undefined, addressLocality: f.oras, addressCountry: 'RO'} : undefined,
      // ratingul intră în datele structurate doar cu sursa confirmată (Google, cu numărul real de recenzii);
      // numărul de clienți nu e un număr de recenzii și nu se trimite ca atare
      aggregateRating: ['google_rating', 'google_recenzii'].every(k => ctx.claim('firma', f, k).state === 'ok')
        ? {'@type': 'AggregateRating', ratingValue: f.google_rating, bestRating: 5, reviewCount: f.google_recenzii} : undefined};
    return jsonLd(ld);
  });
}

function doc(ctx, {title, description, body, extraHead = ''}) {
  const f = ctx.within('Antet', 'numele firmei în titlu', () => ctx.firma());
  const fullTitle = title.includes(f.nume) ? title : `${title} — ${f.nume}`;
  const head = header(ctx), foot = footer(ctx), fab = whatsappFab(ctx), bar = mobileBar(ctx), ld = structuredData(ctx);
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(fullTitle)}</title>${description ? `<meta name="description" content="${esc(description)}">` : ''}
${process.env.BRAIN_INDEXING === '1' ? '' : '<meta name="robots" content="noindex, nofollow, noarchive">\n'}<link rel="canonical" href="https://kurat.ro${esc(ctx.path === '/' ? '/' : ctx.path)}">
<meta property="og:title" content="${esc(fullTitle)}">${description ? `<meta property="og:description" content="${esc(description)}">` : ''}<meta property="og:locale" content="ro_RO">
<link rel="icon" href="/static/favicon.ico"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="${BASE}"><link rel="stylesheet" href="${CSS}"><link rel="stylesheet" href="${DSCSS}"><meta name="theme-color" content="#0a54d1">${ld}${extraHead}</head><body class="ds">
${ctx.preview ? '<div class="preview-bar">Previzualizare — conținut nepublicat</div>' : ''}<a class="skip" href="#main">Sari la conținut</a>
${head}<main id="main">${body}</main>${foot}${fab}${bar}<script src="${JS}" defer></script></body></html>`;
}

// ———————————————————————————————————————————— pagini compuse din secțiuni

function composedPage(ctx, page) {
  const sections = ctx.links('pagini', page.id, 'sectiuni', {reason: 'secțiunile paginii'});
  const extra = [];
  const body = sections.map((s, i) => ctx.within(`${s.titlu ?? s.kind} (${page.nume_scurt ?? page.path})`, `secțiunea „${s.kind}”`,
    () => (DS[s.kind] ?? SECTIONS[s.kind] ?? DS.text)(ctx, s, {page, first: i === 0, extra}))).join('\n');
  return doc(ctx, {title: page.meta_title ?? page.titlu, description: page.meta_description, body, extraHead: extra.join('')});
}

// ———————————————————————————————————————————— pagina unui serviciu

function servicePage(ctx, svc) {
  const body = servicePageBody(ctx, svc);
  const prices = ctx.within('Date structurate', 'ofertele serviciului', () =>
    ctx.query('tarife', {scope: `servicii:${svc.id}`, where: t => t.serviciu_id === svc.id, order: (a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)}));
  const ld = jsonLd({'@context': 'https://schema.org', '@type': 'Service', name: svc.nume, description: svc.descriere ?? undefined, serviceType: svc.nume_scurt ?? svc.nume,
    provider: {'@type': 'CleaningService', name: ctx.firma().nume},
    offers: prices.filter(t => t.pret != null).map(t => ({'@type': 'Offer', name: t.eticheta, price: t.pret, priceCurrency: 'RON'}))});
  return doc(ctx, {title: svc.nume, description: svc.descriere, body, extraHead: ld});
}

function productPage(ctx, p) {
  const pic = ctx.media(p.imagine_id);
  const shop = ctx.pageAt('/shop', {reason: 'firul de navigare'});
  return doc(ctx, {title: p.nume, description: null, body: `<section class="ds-page-hero" aria-labelledby="pr-h"><div class="ds-wrap">
    ${shop ? `<nav aria-label="Breadcrumb"><ol class="ds-crumbs"><li><a href="/">Acasă</a></li><li aria-hidden="true">/</li><li><a href="${esc(shop.href)}">${ctx.text(shop.label)}</a></li><li aria-hidden="true">/</li><li><span aria-current="page">${esc(p.nume)}</span></li></ol></nav>` : ''}
    <div class="ds-hero-grid" style="align-items:start">${pic ? `<div class="ds-page-media" style="aspect-ratio:1;background:var(--ds-bg-soft)"><img src="${esc(pic.src)}" alt="${esc(pic.alt)}" style="object-fit:contain;padding:24px"></div>` : '<div></div>'}
    <div class="ds-page-hero-copy"><h1 id="pr-h" class="ds-display" style="font-size:clamp(2rem,1.4rem + 2vw,3rem)">${esc(p.nume)}</h1><span class="ds-price-tag" style="font-size:1.8rem">${lei(p.pret)}</span>
      <div class="ds-lead">${ctx.rich(p.descriere)}</div></div></div></div></section>`});
}

function notFound(ctx) {
  return doc(ctx, {title: 'Pagina nu există', body: `<section class="ds-page-hero" aria-labelledby="nf-h" style="padding-block:clamp(72px,10vw,140px)"><div class="ds-wrap"><div class="ds-page-hero-copy" style="margin:0 auto;justify-items:center;text-align:center">
    <span class="ds-eyebrow">Eroare 404</span><h1 id="nf-h" class="ds-display">Pagina nu există</h1><p class="ds-lead">Adresa nu mai e valabilă sau a fost scrisă greșit.</p>
    <div class="ds-actions"><a class="ds-btn primary lg" href="/">Înapoi acasă${icon('arrow', 18)}</a><a class="ds-btn secondary lg" href="/servicii">Vezi serviciile</a></div></div></div></section>`});
}
