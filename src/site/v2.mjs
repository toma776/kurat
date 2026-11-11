// Kurat /v2 — homepage-ul gândit ca un drum de cumpărare: Alegi → Afli prețul → Verifici → Rezervi.
// Aceleași date din Brain ca homepage-ul (secțiunile paginii „/”, serviciile, calculatorul, recenziile), altă ordine și altă interacțiune:
// prețul apare din primul ecran, o singură stare (serviciu, suprafață, mobilier, extra, zi) e împărțită de toată pagina, iar
// rezumatul ei stă mereu la vedere (bara de jos). Textele noi de ghidaj stau aici, în cod, până se decide dacă intră în Brain.
import fs from 'node:fs';
import {esc} from './context.mjs';
import {icon} from './icons.mjs';
import {fmt, jsonLd} from './ui.mjs';
import {stars} from './theme.mjs';
import {footer} from './modern.mjs';
import {sha1} from '../core/util.mjs';
import {WIDTHS, variantUrl} from '../core/images.mjs';

const asset = name => {
  try { return `/static/${name}?v=${sha1(fs.readFileSync(new URL(`./static/${name}`, import.meta.url))).slice(0, 10)}`; }
  catch { return `/static/${name}`; }
};

const img = (f, {eager = false, alt, sizes = '(max-width: 880px) 100vw, 50vw', cls = ''} = {}) => {
  if (!f) return '';
  const photo = /^\/media\/uploads\/[^?]+\.(webp|jpe?g)(\?|$)/i.test(f.src);
  const set = photo ? ` srcset="${WIDTHS.map(w => `${esc(variantUrl(f.src, w))} ${w}w`).join(', ')}" sizes="${esc(sizes)}"` : '';
  return `<img${cls ? ` class="${cls}"` : ''} src="${esc(f.src)}"${set} alt="${esc(alt ?? f.alt)}" ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
};
const initials = name => (name ?? '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
const STEPS = [['alege', 'Alegi serviciul'], ['calculator', 'Afli prețul'], ['incredere', 'Verifici'], ['rezerva', 'Rezervi']];

export function v2Page(ctx, page, {head = ''} = {}) {
  const sections = ctx.links('pagini', page.id, 'sectiuni', {reason: 'secțiunile homepage-ului'});
  const S = Object.fromEntries(sections.map(s => [s.kind, s]));
  const f = ctx.firma();
  const tel = ctx.href('tel:{telefon}'), phone = ctx.text('{telefon}');
  const wa = f.whatsapp ? ctx.href('https://wa.me/{whatsapp}') : null;
  const google = ['google_rating', 'google_recenzii', 'google_url'].every(k => ctx.claim('firma', f, k).state === 'ok');
  const rating = google ? f.google_rating : f.rating;
  const ratingText = rating == null ? '' : Number(rating).toFixed(1).replace('.', ',');

  // ——— configurația comună (aceeași formulă ca la calculatorul de pe homepage)
  const calc = ctx.one('calculator', {reason: 'prețul minim și multiplicatorii'});
  const services = ctx.query('servicii', {where: r => r.tarif_mp != null, fields: ['tarif_mp', 'status'], order: (a, b) => a.id - b.id, reason: 'tipurile de curățenie din configurator'});
  const extras = ctx.query('extra', {where: r => r.in_calculator, fields: ['in_calculator', 'status'], order: (a, b) => a.id - b.id, reason: 'serviciile suplimentare din configurator'});
  const cfg = {min: calc?.pret_minim ?? 0, mult: calc?.multiplicatori ?? [],
    services: services.map(x => ({id: x.id, name: x.calc_eticheta ?? x.nume_scurt ?? x.nume, desc: x.calc_descriere ?? x.descriere ?? '', rate: x.tarif_mp, color: x.culoare ?? '#0f69f5', slug: x.slug})),
    extras: extras.map(x => ({id: x.id, name: x.nume, price: x.pret}))};
  const defSvc = (cfg.services.find(s => /general/i.test(s.slug ?? s.name)) ?? cfg.services[0])?.id;

  const parts = [
    heroBlock(ctx, S.hero, {f, cfg, defSvc, google, ratingText, rating}),
    proofStrip(ctx, f),
    servicesBlock(ctx, S.servicii, cfg),
    configurator(ctx, S.calculator, cfg, {tel, phone}),
    processBlock(),
    trustBlock(ctx, {avantaje: S.avantaje, garantie: S.garantie, testimoniale: S.testimoniale}, {f, google, ratingText, rating}),
    faqBlock(ctx, S.faq, {tel, phone, wa}),
    bookBlock(ctx, {tel, phone, wa, f})
  ];

  const css = [asset('base.css'), asset('site.css'), asset('ds.css'), asset('v2.css')], js = asset('v2.js');
  // titlul și descrierea vin din Brain (pagina „/”), ca la orice pagină
  const title = page.meta_title ?? page.titlu ?? f.nume;
  const fullTitle = title.includes(f.nume) ? title : `${title} — ${f.nume}`;
  const desc = page.meta_description;
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(fullTitle)}</title>${desc ? `<meta name="description" content="${esc(desc)}">` : ''}
${process.env.BRAIN_INDEXING === '1' ? '' : '<meta name="robots" content="noindex, nofollow, noarchive">\n'}<link rel="canonical" href="https://kurat.ro/">
<meta property="og:title" content="${esc(fullTitle)}">${desc ? `<meta property="og:description" content="${esc(desc)}">` : ''}<meta property="og:locale" content="ro_RO">
<meta name="color-scheme" content="light dark"><meta name="theme-color" content="#0a54d1">
<link rel="icon" href="/static/favicon.ico" sizes="48x48"><link rel="icon" href="/static/favicon.svg" type="image/svg+xml"><link rel="apple-touch-icon" href="/static/apple-touch-icon.png"><link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
${css.map(h => `<link rel="stylesheet" href="${h}">`).join('')}${head}${faqLd(ctx, S.faq)}
<script type="application/json" id="v2-cfg">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script></head>
<body class="ds v2" data-default-svc="${defSvc ?? ''}">${ctx.preview ? '<div class="preview-bar">Previzualizare — conținut nepublicat</div>' : ''}<a class="skip" href="#main">Sari la conținut</a>
${headerV2(ctx, {tel, phone})}
<main id="main">${parts.join('\n')}</main>
${footer(ctx)}
${dock({tel, wa})}
<script src="${js}" defer></script></body></html>`;
}

// ———————————————————————————————————————————— antet cu firul drumului

// Linkurile din meniul principal, fără Magazin cât timp nu are produse (aceeași regulă ca în antetul celorlalte pagini).
function mainMenu(ctx) {
  const menu = ctx.query('meniuri', {where: m => m.cheie === 'principal', fields: ['cheie'], reason: 'meniul principal'})[0];
  const shop = ctx.pageAt('/shop', {reason: 'Magazinul apare în meniu doar cu produse'});
  const empty = shop && !ctx.query('produse', {fields: ['status'], reason: 'Magazinul apare în meniu doar cu produse'}).length;
  return (menu?.linkuri ?? []).map(i => ctx.link(i)).filter(l => l && !(empty && l.href === shop.href));
}

function headerV2(ctx, {tel, phone}) {
  return ctx.layout('Antet homepage', () => {
  const items = mainMenu(ctx);
  return `<header class="v2-head" data-head><div class="v2-wrap v2-head-in">
    ${items.length ? `<details class="v2-menu" data-menu><summary aria-label="Meniu">${icon('menu', 20)}</summary><nav aria-label="Principal">${items.map(l => `<a href="${esc(l.href)}">${ctx.text(l.label)}${icon('arrow', 16)}</a>`).join('')}</nav></details>` : ''}
    <a class="v2-logo" href="/" aria-label="Kurat — acasă"><span class="v2-mark">${icon('logo-mark', 20)}</span>${icon('logo-word', 20, 'display:block')}</a>
    <nav class="v2-rail" aria-label="Pașii rezervării"><ol>${STEPS.map(([id, label], i) => `<li><a href="#${id}" data-rail="${id}"><span class="n">${i + 1}</span><span class="t">${label}</span></a></li>`).join('')}</ol>
      <span class="v2-rail-bar" aria-hidden="true"><span data-rail-fill></span></span></nav>
    <div class="v2-head-act"><a class="v2-icon-btn" href="${esc(tel)}" aria-label="Sună-ne: ${esc(phone)}">${icon('phone', 18)}<span class="lbl">${esc(phone)}</span></a>
      <a class="v2-btn primary sm" href="#rezerva" data-go-book>Rezervă</a></div></div></header>`;
  });
}

function faqLd(ctx, s) {
  if (!s) return '';
  const items = ctx.links('sectiuni', s.id, 'intrebari').filter(q => !ctx.unvalidated(q.raspuns));
  return items.length ? jsonLd({'@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: items.map(q => ({'@type': 'Question', name: q.intrebare,
    acceptedAnswer: {'@type': 'Answer', text: ctx.rich(q.raspuns).replace(/<[^>]+>/g, '')}}))}) : '';
}
// Un număr declarat de Kurat (rating, clienți): pe site ca atare; în previzualizare marcat până are sursă.
const claimed = (ctx, c, html) => c.state === 'ok' || !ctx.preview ? html : ctx.proof(c, html);

// ———————————————————————————————————————————— 1. hero: intenția și prețul din primul ecran

function heroBlock(ctx, s, {f, cfg, defSvc, google, ratingText, rating}) {
  const pic = s && ctx.media(s.imagine_id, {reason: 'imaginea din hero'});
  const svcBtn = x => `<button type="button" class="v2-pick" data-svc="${x.id}" aria-pressed="${x.id === defSvc}" style="--c:${esc(x.color)}"><span class="dot" aria-hidden="true"></span>${esc(x.name)}<small>${fmt(x.rate)} lei/mp</small></button>`;
  return `<section class="v2-hero" aria-labelledby="v2-h1"><div class="v2-aurora" aria-hidden="true"></div><div class="v2-wrap v2-hero-grid">
    <div class="v2-hero-copy">
      ${s?.insigna ? `<span class="v2-pill">${icon('shield', 14)}${ctx.text(s.insigna)}</span>` : ''}
      <h1 id="v2-h1" class="v2-display">Curățenie profesională, <span class="grad">cu prețul știut din prima.</span></h1>
      <p class="v2-lead">Spune-ne ce spațiu e, vezi estimarea pe loc și alegi ziua. Echipa vine echipată, iar tu plătești după ce verifici rezultatul.</p>

      <div class="v2-quick" data-quick id="alege-rapid">
        <label class="v2-ask" for="v2-ask"><span class="ico">${icon('sparkle', 18)}</span>
          <input id="v2-ask" type="text" autocomplete="off" data-ask placeholder="ex: apartament 3 camere, după renovare" aria-describedby="v2-ask-hint">
          <button type="button" class="v2-btn primary sm" data-ask-go>Estimează</button></label>
        <p id="v2-ask-hint" class="v2-ask-hint" data-ask-out>Scrie liber, ca într-un mesaj, sau alege mai jos.</p>
        <div class="v2-picks" role="group" aria-label="Tipul de curățenie">${cfg.services.map(svcBtn).join('')}</div>
        <div class="v2-quick-row">
          <label class="v2-area"><span>Suprafață</span><input type="range" min="10" max="300" step="5" value="60" data-area aria-label="Suprafața în metri pătrați"><output data-area-out>60 mp</output></label>
          <div class="v2-quick-price"><span>Estimare</span><strong data-total aria-live="polite">—</strong></div>
        </div>
        <div class="v2-quick-cta"><a class="v2-btn primary lg" href="#rezerva" data-go-book>Rezervă la acest preț${icon('arrow', 18)}</a>
          <a class="v2-link" href="#calculator">Ajustează detaliile${icon('chevron', 14)}</a></div>
      </div>
    </div>
    ${pic ? `<div class="v2-hero-media"><div class="v2-photo">${img(pic, {eager: true})}</div>
      ${ratingText ? claimed(ctx, google ? {state: 'ok'} : ctx.claim('firma', f, 'rating'), `<${google ? `a href="${esc(f.google_url)}" target="_blank" rel="noopener"` : 'div'} class="v2-glass g1"><strong>${ratingText}/5</strong><span>${stars(rating, 14)}<small>${google ? `${fmt(f.google_recenzii)} recenzii Google` : 'rating clienți'}</small></span></${google ? 'a' : 'div'}>`) : ''}
      ${s?.card_titlu ? `<div class="v2-glass g2"><span class="v2-badge ok">${icon('shield', 16)}</span><span><strong>${ctx.text(s.card_titlu)}</strong>${s.card_text ? `<small>${ctx.text(s.card_text)}</small>` : ''}</span></div>` : ''}
      <div class="v2-glass g3"><span class="v2-live" aria-hidden="true"></span><span><strong>Răspundem azi</strong><small>confirmare telefonică, fără vizită obligatorie</small></span></div>
    </div>` : ''}
  </div>${!google && rating != null ? `<div class="v2-wrap">${ctx.gap('rating verificabil', 'Ratingul nu are sursă: fără număr de recenzii și fără link. Când adaugi în Date firmă profilul Google, ratingul și numărul de recenzii, apar aici cu link, iar Google îl primește și în datele structurate.')}</div>` : ''}</section>`;
}

function proofStrip(ctx, f) {
  const logos = ctx.query('clienti', {where: c => c.in_portofoliu && c.logo_id && c.in_banda !== 0 && c.in_banda !== false, fields: ['in_portofoliu', 'logo_id', 'in_banda', 'status'], order: (a, b) => (a.ordine ?? 99) - (b.ordine ?? 99), reason: 'logo-urile din /v2'})
    .map(c => ({c, m: ctx.media(c.logo_id, {reason: 'logo-ul clientului'})})).filter(x => x.m);
  const stat = (k, label) => {
    const c = ctx.claim('firma', f, k);
    return c.value == null ? '' : claimed(ctx, c, `<div class="v2-stat"><strong>${fmt(c.value)}+</strong><span>${label}</span></div>`);
  };
  return `<section class="v2-proof" aria-label="Dovezi"><div class="v2-wrap">
    <div class="v2-stats">${stat('clienti_multumiti', 'clienți mulțumiți')}${stat('locuinte_curatate', 'locuințe curățate')}${stat('birouri_curatate', 'birouri curățate')}</div>
    ${logos.length ? `<div class="v2-marquee" aria-label="Clienți Kurat"><div class="v2-marquee-track">${[0, 1].map(d => `<ul${d ? ' aria-hidden="true"' : ''}>${logos.map(({c, m}) => `<li>${img(m, {alt: d ? '' : c.nume})}</li>`).join('')}</ul>`).join('')}</div></div>` : ''}
  </div></section>`;
}

// ———————————————————————————————————————————— 2. alegi: bento cu filtru casă / firmă

function servicesBlock(ctx, s, cfg) {
  if (!s) return '';
  const fallback = ctx.pageAt('/servicii', {reason: 'cardurile fără pagină proprie'});
  const cards = [];
  for (const [field, aud] of [['servicii_persoane', 'casa'], ['servicii_companii', 'firma']]) {
    for (const svc of ctx.links('sectiuni', s.id, field, {reason: 'cardurile de servicii din /v2'})) {
      const a = svc._link.attrs ?? {};
      const from = ctx.query('tarife', {scope: `servicii:${svc.id}`, where: t => t.serviciu_id === svc.id && t.pret != null, reason: `„de la” pentru ${svc.nume}`})
        .reduce((m, t) => m == null || t.pret < m ? t.pret : m, null);
      const n = ctx.count('servicii', svc.id, 'sarcini');
      const calcable = cfg.services.some(x => x.id === svc.id);
      cards.push({svc, a, aud, from, n, calcable, pic: ctx.media(a.imagine ?? svc.imagine_id, {reason: 'imaginea cardului'}),
        to: svc.pagina ? ctx.href(`ref:servicii:${svc.id}`) : fallback?.href});
    }
  }
  const card = ({svc, a, aud, from, n, calcable, pic, to}, i) => `<article class="v2-bento-card${i === 0 ? ' big' : ''}" data-aud="${aud}" data-reveal>
    <div class="media">${img(pic, {sizes: '(max-width: 700px) 100vw, 40vw'})}</div>
    <div class="body"><span class="v2-tag">${icon(a.icon ?? svc.icon ?? 'sparkle', 16)}${aud === 'casa' ? 'Pentru casă' : 'Pentru firmă'}</span>
      <h3>${esc(a.titlu ?? svc.nume)}</h3><p>${esc(a.text ?? svc.descriere ?? '')}</p>
      ${(a.puncte ?? []).length ? `<ul class="v2-ticks">${a.puncte.slice(0, 3).map(p => `<li>${icon('check', 14)}${esc(p)}</li>`).join('')}</ul>` : ''}
      <div class="foot">${from != null ? `<span class="from">de la <strong>${fmt(from)} lei</strong></span>` : svc.tarif_mp ? `<span class="from"><strong>${fmt(svc.tarif_mp)} lei</strong>/mp</span>` : `<span class="from">preț la evaluare</span>`}
        ${n ? `<span class="n">${n} operațiuni incluse</span>` : ''}</div>
      <div class="acts">${calcable ? `<button type="button" class="v2-btn primary sm" data-pick-svc="${svc.id}">Vezi prețul${icon('arrow', 16)}</button>` : `<a class="v2-btn primary sm" href="#rezerva" data-go-book data-note="${esc(a.titlu ?? svc.nume)}">Cere ofertă${icon('arrow', 16)}</a>`}
        ${to ? `<a class="v2-link" href="${esc(to)}">Ce includem${icon('chevron', 14)}</a>` : ''}</div></div></article>`;
  return `<section id="alege" class="v2-sec" aria-labelledby="alege-h"><div class="v2-wrap">
    <div class="v2-sec-head" data-reveal><span class="v2-step">Pasul 1</span><h2 id="alege-h" class="v2-h2">Ce curățăm?</h2>
      <p class="v2-lead">${ctx.text(s.intro ?? '')}</p></div>
    <div class="v2-seg" role="tablist" aria-label="Pentru cine" data-seg>
      <button type="button" role="tab" aria-selected="true" data-aud-f="*">Toate</button><button type="button" role="tab" aria-selected="false" data-aud-f="casa">${icon('home', 16)}Casă</button><button type="button" role="tab" aria-selected="false" data-aud-f="firma">${icon('building', 16)}Firmă</button><span class="pill" aria-hidden="true"></span></div>
    <div class="v2-bento" data-bento>${cards.map(card).join('')}</div>
  </div></section>`;
}

// ———————————————————————————————————————————— 3. afli prețul: configurator pe un singur ecran, cu bon live

function configurator(ctx, s, cfg, {tel, phone}) {
  if (!cfg.services.length) return '';
  return `<section id="calculator" class="v2-sec soft" aria-labelledby="pret-h"><div class="v2-wrap">
    <div class="v2-sec-head" data-reveal><span class="v2-step">Pasul 2</span><h2 id="pret-h" class="v2-h2">${ctx.text(s?.titlu ?? 'Prețul tău, pe loc')}</h2>
      <p class="v2-lead">Fiecare alegere actualizează prețul imediat. Nimic nu se trimite până nu apeși „Rezervă”.</p></div>
    <div class="v2-conf" data-reveal>
      <div class="v2-conf-main">
        <fieldset class="v2-field"><legend><span class="i">1</span>Tipul de curățenie</legend>
          <div class="v2-cards" data-svc-cards>${cfg.services.map(x => `<button type="button" class="v2-opt" data-svc="${x.id}" aria-pressed="false" style="--c:${esc(x.color)}"><strong>${esc(x.name)}</strong><span>${esc(x.desc)}</span><em>${fmt(x.rate)} lei/mp</em></button>`).join('')}</div></fieldset>
        <fieldset class="v2-field"><legend><span class="i">2</span>Suprafața</legend>
          <div class="v2-area-big"><button type="button" class="v2-step-btn" data-area-step="-5" aria-label="Minus 5 mp">−</button>
            <label><input type="number" min="10" max="5000" step="5" value="60" data-area inputmode="numeric" aria-label="Suprafața în mp"><span>mp</span></label>
            <button type="button" class="v2-step-btn" data-area-step="5" aria-label="Plus 5 mp">+</button></div>
          <input type="range" class="v2-range" min="10" max="300" step="5" value="60" data-area aria-label="Suprafața (glisor)">
          <div class="v2-presets" role="group" aria-label="Repere rapide">${[['Garsonieră', 35], ['2 camere', 55], ['3 camere', 75], ['Casă', 140], ['Birou mic', 100]].map(([l, v]) => `<button type="button" data-area-set="${v}">${l}<small>${v} mp</small></button>`).join('')}</div></fieldset>
        ${cfg.mult.length ? `<fieldset class="v2-field"><legend><span class="i">3</span>Cât de mobilat e</legend>
          <div class="v2-seg small" data-mult-seg>${cfg.mult.map((m, i) => `<button type="button" data-mult="${esc(m.nivel)}" aria-pressed="${i === 0}">${esc(m.eticheta ?? m.nivel)}${m.multiplicator !== 1 ? `<small>+${Math.round((m.multiplicator - 1) * 100)}%</small>` : ''}</button>`).join('')}<span class="pill" aria-hidden="true"></span></div></fieldset>` : ''}
        ${cfg.extras.length ? `<fieldset class="v2-field"><legend><span class="i">4</span>Extra, dacă vrei</legend>
          <div class="v2-toggles">${cfg.extras.map(x => `<label class="v2-toggle"><input type="checkbox" data-extra="${x.id}"><span class="sw" aria-hidden="true"></span><span class="t">${esc(x.name)}</span><strong>+${fmt(x.price)} lei</strong></label>`).join('')}</div></fieldset>` : ''}
      </div>
      <aside class="v2-receipt" aria-label="Estimarea ta" data-receipt>
        <div class="v2-receipt-in"><span class="v2-eyebrow">Estimarea ta</span>
          <ul class="lines" data-lines></ul>
          <div class="total"><span>Total estimat</span><strong data-total aria-live="polite">—</strong></div>
          <p class="fine">Preț orientativ, minim ${fmt(cfg.min)} lei. Îl confirmăm la telefon înainte de programare — fără costuri ascunse.</p>
          <a class="v2-btn primary lg block" href="#rezerva" data-go-book>Continuă la rezervare${icon('arrow', 18)}</a>
          <a class="v2-call" href="${esc(tel)}">${icon('phone', 16)}Preferi să vorbim? ${esc(phone)}</a>
          <ul class="v2-assure">${(s?.puncte ?? []).map(p => `<li>${icon('check-circle', 16)}${esc(p)}</li>`).join('')}</ul></div>
      </aside>
    </div></div></section>`;
}

// ———————————————————————————————————————————— cum decurge, spus sincer (estimare online → confirmare → echipă → plată)

function processBlock() {
  const steps = [
    ['calculator', 'Estimezi online', 'Prețul orientativ, în mai puțin de un minut. Fără cont, fără obligații.', 'acum'],
    ['phone', 'Confirmăm la telefon', 'Te sunăm în aceeași zi lucrătoare, clarificăm detaliile și fixăm ora.', 'aceeași zi'],
    ['truck', 'Echipa vine echipată', 'Produse profesionale, sigure pentru copii și animale. Tu nu pregătești nimic.', 'ziua aleasă'],
    ['check-circle', 'Verifici, apoi plătești', 'Plătești după ce verifici. Ai 48 de ore să ne semnalezi orice.', 'după']
  ];
  return `<section class="v2-sec" aria-labelledby="cum-h"><div class="v2-wrap">
    <div class="v2-sec-head" data-reveal><span class="v2-eyebrow">Ce urmează după ce rezervi</span><h2 id="cum-h" class="v2-h2">Patru momente, zero surprize</h2></div>
    <ol class="v2-timeline">${steps.map(([ic, t, d, when], i) => `<li data-reveal style="--i:${i}"><span class="v2-tl-ico">${icon(ic, 22)}</span><span class="v2-tl-when">${when}</span><h3>${t}</h3><p>${d}</p></li>`).join('')}</ol>
  </div></section>`;
}

// ———————————————————————————————————————————— 3. verifici: garanție, comparație, recenzii

function trustBlock(ctx, {avantaje, garantie, testimoniale}, {f, google, ratingText, rating}) {
  const g = ctx.one('garantie', {reason: 'politica de garanție'});
  const useG = g && ctx.claim('garantie', g, 'rezumat').state === 'ok' && ctx.claim('garantie', g, 'titlu').state === 'ok';
  const gTitle = useG ? g.titlu : garantie?.titlu, gText = useG ? g.rezumat : garantie?.intro;
  const adv = avantaje ? ctx.links('sectiuni', avantaje.id, 'avantaje') : [];
  const reviews = testimoniale ? ctx.links('sectiuni', testimoniale.id, 'testimoniale') : [];
  const review = t => {
    const c = ctx.get('clienti', t.client_id, {reason: 'autorul testimonialului'});
    const logo = c?.logo_id && ctx.media(c.logo_id, {reason: 'logo-ul clientului'});
    const who = [t.autor, t.functie].filter(Boolean).map(esc).join(', ');
    const when = t.data ? esc(new Date(t.data).toLocaleDateString('ro-RO', {month: 'long', year: 'numeric'})) : '';
    const missing = !t.autor && ctx.preview ? '<span class="gap-inline">lipsește persoana și funcția</span>' : '';
    return `<figure class="v2-review"><div class="top">${logo ? `<span class="logo">${img(logo, {alt: c.nume, sizes: '120px'})}</span>` : `<span class="ava" style="background:${esc(c?.culoare ?? '#0a54d1')}">${esc(initials(c?.nume))}</span>`}<span class="st">${stars(t.stele ?? 5, 15)}</span></div>
      <blockquote>„${esc(t.text)}”</blockquote><figcaption><strong>${esc(c?.nume ?? 'Client Kurat')}</strong><span>${who || 'Client Kurat'}${when ? ` · ${when}` : ''}</span>${missing}</figcaption></figure>`;
  };
  return `<section id="incredere" class="v2-sec" aria-labelledby="inc-h"><div class="v2-wrap">
    <div class="v2-sec-head" data-reveal><span class="v2-step">Pasul 3</span><h2 id="inc-h" class="v2-h2">Verifică înainte să decizi</h2>
      <p class="v2-lead">Garanția, diferența față de „merge și așa” și ce spun clienții — toate într-un loc.</p></div>

    <div class="v2-trust-grid">
      <div class="v2-guarantee" data-reveal><span class="v2-tag light">${icon('shield', 15)}Garanția Kurat</span>
        <h3>${ctx.text(gTitle ?? '')}</h3><p>${ctx.text(gText ?? '')}</p>
        ${useG ? '<ol class="v2-g-flow" aria-label="Cum funcționează garanția"><li><strong>0 h</strong><span>Terminăm și verifici</span></li><li><strong>≤ 48 h</strong><span>Ne semnalezi ce nu e ok</span></li><li><strong>Revenim</strong><span>Refacem gratuit</span></li><li><strong>Sau</strong><span>Banii înapoi</span></li></ol>' : ''}
        ${garantie?.puncte?.length ? `<ul class="v2-g-points">${garantie.puncte.map(p => `<li>${icon('check-circle', 16)}${esc(p)}</li>`).join('')}</ul>` : ''}</div>

      ${ratingText ? claimed(ctx, google ? {state: 'ok'} : ctx.claim('firma', f, 'rating'), `<${google ? `a href="${esc(f.google_url)}" target="_blank" rel="noopener"` : 'div'} class="v2-score" data-reveal><strong>${ratingText}</strong><span>${stars(rating, 20)}</span><small>${google ? `${fmt(f.google_recenzii)} recenzii verificate pe Google ${icon('external', 13)}` : f.clienti_multumiti ? `${fmt(f.clienti_multumiti)}+ clienți mulțumiți` : 'din 5'}</small></${google ? 'a' : 'div'}>`) : ''}

      ${adv.length ? `<div class="v2-compare" data-compare data-reveal><div class="v2-compare-head"><h3>Cu Kurat sau pe cont propriu?</h3>
          <div class="v2-switch" role="group" aria-label="Compară"><button type="button" aria-pressed="true" data-side="yes">Cu Kurat</button><button type="button" aria-pressed="false" data-side="no">Fără</button><span class="pill" aria-hidden="true"></span></div></div>
        <ul>${adv.map(a => `<li><span class="cat">${esc(a.categorie ?? '')}</span><div class="yes"><span class="v2-badge ok">${icon('check', 14)}</span><div><strong>${esc(a.titlu)}</strong><p>${ctx.text(a.text)}</p></div></div>
          <div class="no"><span class="v2-badge no">${icon('x', 12)}</span><div><strong>${esc(a.risc_titlu ?? '')}</strong><p>${ctx.text(a.risc_text ?? '')}</p></div></div></li>`).join('')}</ul></div>` : ''}
    </div>

    ${reviews.length ? `<div class="v2-reviews" data-reveal><div class="v2-reviews-head"><h3>${ctx.text(testimoniale.titlu ?? 'Ce spun clienții')}</h3>
      <div class="v2-arrows"><button type="button" data-rev="-1" aria-label="Recenzia anterioară">${icon('arrow', 18)}</button><button type="button" data-rev="1" aria-label="Recenzia următoare">${icon('arrow', 18)}</button></div></div>
      <div class="v2-reviews-track" data-rev-track tabindex="0" aria-label="Recenzii">${reviews.map(review).join('')}</div></div>` : ''}
    ${useG ? '' : ctx.gap('o singură formulare a garanției', 'Garanția apare în mai multe forme pe site. Politica unică e pregătită în Brain, la Garanție; după ce o confirmi și o publici, apare aici.')}
    ${reviews.some(t => !t.autor) ? ctx.gap('cine vorbește în fiecare testimonial', 'Un citat cu nume, funcție și dată e mult mai credibil decât „Client Kurat”. Se completează la Testimoniale → Cine vorbește / Funcția / Data.') : ''}
  </div></section>`;
}

// ———————————————————————————————————————————— întrebări, cu căutare

function faqBlock(ctx, s, {tel, phone, wa}) {
  if (!s) return '';
  const items = ctx.links('sectiuni', s.id, 'intrebari').filter(q => !ctx.unvalidated(q.raspuns));
  return `<section class="v2-sec soft" aria-labelledby="faq-h"><div class="v2-wrap v2-faq">
    <div class="v2-faq-side" data-reveal><span class="v2-eyebrow">${ctx.text(s.eticheta ?? 'Întrebări')}</span><h2 id="faq-h" class="v2-h2">Încă te întrebi ceva?</h2>
      <label class="v2-search">${icon('search', 18)}<input type="search" placeholder="Caută: garanție, produse, recurent…" data-faq-q aria-label="Caută în întrebări"></label>
      <p class="v2-muted" data-faq-empty hidden>Nu găsim asta aici. <a href="${esc(tel)}">Sună-ne la ${esc(phone)}</a>${wa ? ` sau <a href="${esc(wa)}" target="_blank" rel="noopener">scrie pe WhatsApp</a>` : ''}.</p></div>
    <div class="v2-faq-list" data-reveal>${items.map((q, i) => `<details${i === 0 ? ' open' : ''} data-faq><summary>${esc(q.intrebare)}<span class="chev" aria-hidden="true">${icon('chevron', 16)}</span></summary><div class="ans">${ctx.rich(q.raspuns)}</div></details>`).join('')}</div>
  </div></section>`;
}

// ———————————————————————————————————————————— 4. rezervi: rezumat + zi + date de contact

function bookBlock(ctx, {tel, phone, wa, f}) {
  return `<section id="rezerva" class="v2-sec v2-book-sec" aria-labelledby="rez-h"><div class="v2-wrap">
    <div class="v2-book" data-reveal>
      <div class="v2-book-side"><span class="v2-step light">Pasul 4</span><h2 id="rez-h" class="v2-h2">Rezervă în 30 de secunde</h2>
        <p>Alegi ziua, ne lași un telefon și te sunăm să confirmăm prețul și ora. Nu plătești nimic acum.</p>
        <div class="v2-sum" data-summary aria-live="polite"></div>
        <div class="v2-alt"><a href="${esc(tel)}">${icon('phone', 16)}${esc(phone)}</a>${wa ? `<a href="${esc(wa)}" target="_blank" rel="noopener">${icon('whatsapp', 16)}WhatsApp</a>` : ''}<a href="mailto:${esc(f.email)}">${icon('mail', 16)}Email</a></div></div>
      <form class="v2-form" data-book novalidate>
        <fieldset class="v2-field"><legend>Ce zi ți se potrivește?</legend><div class="v2-days" data-days role="group" aria-label="Ziua dorită"></div>
          <div class="v2-seg small" data-slot-seg><button type="button" data-slot="dimineața" aria-pressed="true">Dimineața<small>8–12</small></button><button type="button" data-slot="după-amiaza" aria-pressed="false">După-amiaza<small>12–17</small></button><button type="button" data-slot="oricând" aria-pressed="false">Oricând</button><span class="pill" aria-hidden="true"></span></div></fieldset>
        <div class="v2-two"><label class="v2-in"><span>Nume</span><input name="nume" autocomplete="name" required maxlength="120"></label>
          <label class="v2-in"><span>Telefon</span><input name="contact" type="tel" autocomplete="tel" inputmode="tel" required maxlength="160" placeholder="07xx xxx xxx"></label></div>
        <label class="v2-in"><span>Adresa sau zona <em>(opțional)</em></span><input name="zona" autocomplete="street-address" maxlength="200" placeholder="ex: Sector 3, București"></label>
        <label class="v2-in"><span>Ceva ce trebuie să știm? <em>(opțional)</em></span><textarea name="mesaj" rows="2" maxlength="1500" data-note-field placeholder="Acces, animale, zone cu atenție specială…"></textarea></label>
        <button type="submit" class="v2-btn primary lg block" data-submit>Trimite rezervarea${icon('send', 18)}</button>
        <p class="v2-fine">Te contactăm doar pentru această cerere. Prin trimitere ești de acord să fii sunat pentru confirmare.</p>
        <p class="v2-msg" role="status" data-msg></p>
      </form>
      <div class="v2-done" data-done hidden><span class="v2-badge ok big">${icon('check', 28)}</span><h3>Gata, am primit rezervarea!</h3><p data-done-text>Te sunăm în cel mai scurt timp pentru confirmare.</p><a class="v2-link" href="/v2">Înapoi la început</a></div>
    </div></div></section>`;
}

function dock({tel, wa}) {
  return `<div class="v2-dock" data-dock aria-label="Estimarea ta"><div class="v2-dock-in">
    <div class="v2-dock-sum"><span data-dock-svc>Alege un serviciu</span><strong data-total>—</strong></div>
    <a class="v2-dock-ico" href="${esc(tel)}" aria-label="Sună">${icon('phone', 18)}</a>${wa ? `<a class="v2-dock-ico wa" href="${esc(wa)}" target="_blank" rel="noopener" aria-label="WhatsApp">${icon('whatsapp', 18)}</a>` : ''}
    <a class="v2-btn primary" href="#rezerva" data-go-book>Rezervă${icon('arrow', 16)}</a></div></div>`;
}
