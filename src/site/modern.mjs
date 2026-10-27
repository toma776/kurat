// Kurat DS 2: antetul, subsolul și secțiunile homepage-ului pe sistemul de design din static/ds.css.
// Aceeași structură și aceleași date ca site-ul original (theme.mjs); se schimbă doar prezentarea: aer, ierarhie, componente .ds-*.
import {esc} from './context.mjs';
import {icon} from './icons.mjs';
import {fmt, jsonLd} from './ui.mjs';
import {stars, priceHtml, vatGap} from './theme.mjs';
import {WIDTHS, variantUrl} from '../core/images.mjs';

const TONE = {'btn-brand': 'primary', 'btn-outline': 'secondary', 'btn-green': 'green', 'btn-soft': 'secondary', link: 'secondary'};

// Un buton din Brain ({href, label, stil}): telefonul și WhatsApp cu iconița în față, restul cu săgeată.
function btn(ctx, item, {tone, size = '', arrow = true} = {}) {
  const l = ctx.link(item);
  if (!l) return '';
  const isTel = l.href.startsWith('tel:'), isWa = l.href.includes('wa.me');
  const t = tone ?? TONE[l.stil] ?? 'primary';
  const ext = /^https?:/.test(l.href) ? ' target="_blank" rel="noopener"' : '';
  const lead = isTel ? icon('phone', 18) : isWa ? icon('whatsapp', 18) : '';
  const tail = !isTel && !isWa && arrow ? icon('arrow', 18) : '';
  return `<a class="ds-btn ${t}${size ? ` ${size}` : ''}" href="${esc(l.href)}"${ext}>${lead}${ctx.text(l.label)}${tail}</a>`;
}
const actions = (ctx, items, opts = {}) => {
  const list = (items ?? []).map(b => btn(ctx, b, opts)).filter(Boolean);
  return list.length ? `<div class="ds-actions">${list.join('')}</div>` : '';
};

const titleHtml = (ctx, s, cls = '') => {
  const t = ctx.text(s.titlu ?? '').replace(/\n/g, '<br>');
  return s.accent ? t.replace(esc(s.accent), `<span class="ds-accent${cls}">${esc(s.accent)}</span>`) : t;
};
function head(ctx, s, {id, center = false, split = false, h = 'h2'} = {}) {
  if (!s.titlu && !s.eticheta && !s.intro) return '';
  const eyebrow = s.eticheta ? `<span class="ds-eyebrow">${ctx.text(s.eticheta)}</span>` : '';
  const title = s.titlu ? `<${h}${id ? ` id="${id}"` : ''} class="ds-h2">${titleHtml(ctx, s)}</${h}>` : '';
  const intro = s.intro ? `<p class="ds-lead">${ctx.text(s.intro)}</p>` : '';
  if (split) return `<div class="ds-head split" data-reveal><div>${eyebrow}${title}</div>${intro}</div>`;
  return `<div class="ds-head${center ? ' center' : ''}" data-reveal>${eyebrow}${title}${intro}</div>`;
}
// fotografiile (nu logo-urile PNG) vin în trei mărimi; browserul o alege după ecran (sizes = cât ocupă imaginea în pagină)
const PHOTO_SIZES = '(max-width: 880px) 100vw, 50vw';
const img = (f, {eager = false, alt, sizes = PHOTO_SIZES} = {}) => {
  if (!f) return '';
  const photo = /^\/media\/uploads\/[^?]+\.(webp|jpe?g)(\?|$)/i.test(f.src);
  const set = photo ? ` srcset="${WIDTHS.map(w => `${esc(variantUrl(f.src, w))} ${w}w`).join(', ')}" sizes="${esc(sizes)}"` : '';
  return `<img src="${esc(f.src)}"${set} alt="${esc(alt ?? f.alt)}" ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async">`;
};
const CARD_SIZES = '(max-width: 600px) 100vw, (max-width: 1080px) 50vw, 380px';
const logoMark = (size = 38) => `<span class="mark" style="width:${size}px;height:${size}px">${icon('logo-mark', Math.round(size * .55))}</span>`;
const logo = (h = 22, size = 38) => `<span class="ds-logo" aria-hidden="true">${logoMark(size)}${icon('logo-word', h, 'display: block;')}</span>`;
// Linkurile din meniuri, fără Magazin cât timp nu are niciun produs publicat (revine singur la primul produs).
function menuLinks(ctx, linkuri) {
  const shop = ctx.pageAt('/shop', {reason: 'Magazinul apare în meniu doar cu produse'});
  const empty = shop && !ctx.query('produse', {fields: ['status'], reason: 'Magazinul apare în meniu doar cu produse'}).length;
  return (linkuri ?? []).map(i => ctx.link(i)).filter(l => l && !(empty && l.href === shop.href));
}
// Ratingul afișat: cel de pe Google când e confirmat (cu număr de recenzii și link), altfel cel declarat; mereu cu o zecimală (5,0).
function ratingOf(ctx, f) {
  const google = ['google_rating', 'google_recenzii', 'google_url'].every(k => ctx.claim('firma', f, k).state === 'ok');
  const value = google ? f.google_rating : f.rating;
  return {google, value, text: value == null ? '' : Number(value).toFixed(1).replace('.', ','), claim: google ? {state: 'ok'} : ctx.claim('firma', f, 'rating')};
}
const initials = name => (name ?? '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();

// Un număr declarat de Kurat (rating, clienți): pe site ca în original; în previzualizare marcat până are sursă.
const claimed = (ctx, c, html) => c.state === 'ok' || !ctx.preview ? html : ctx.proof(c, html);

// ———————————————————————————————————————————— antet, subsol, bara de pe mobil

export function header(ctx) {
  return ctx.layout('Antet', () => {
    const f = ctx.firma();
    const menu = ctx.query('meniuri', {where: m => m.cheie === 'principal', fields: ['cheie'], reason: 'meniul principal'})[0];
    const items = menuLinks(ctx, menu?.linkuri);
    const cta = ctx.pageAt('/contact', {reason: 'butonul „Cere o ofertă”'});
    const tel = ctx.href('tel:{telefon}'), phone = ctx.text('{telefon}');
    const cur = l => l.href === ctx.path ? ' aria-current="page"' : '';
    return `<header class="ds-header" data-header><div class="ds-wrap wide ds-header-in">
      <a class="ds-logo-link" href="/" aria-label="${esc(f.nume)} — acasă" style="text-decoration:none">${logo()}</a>
      <nav class="ds-nav" aria-label="Principal">${items.map(l => `<a href="${esc(l.href)}"${cur(l)}>${ctx.text(l.label)}</a>`).join('')}</nav>
      <div class="ds-header-act"><a class="ds-phone" href="${esc(tel)}" aria-label="Sună-ne: ${phone}"><span class="ico">${icon('phone', 16)}</span><span class="num">${phone}</span></a>
        ${cta ? `<a class="ds-btn primary sm" href="${esc(cta.href)}">Cere o ofertă</a>` : ''}
        <button type="button" class="ds-burger" aria-controls="ds-mmenu" aria-expanded="false" aria-label="Meniu" data-burger><span class="i-open">${icon('menu', 22)}</span><span class="i-close">${icon('x', 20)}</span></button></div></div></header>
      <nav id="ds-mmenu" class="ds-mmenu" aria-label="Meniu mobil" hidden><a href="/"${ctx.path === '/' ? ' aria-current="page"' : ''}>Acasă${icon('arrow', 18)}</a>${items.map(l => `<a href="${esc(l.href)}"${cur(l)}>${ctx.text(l.label)}${icon('arrow', 18)}</a>`).join('')}
        <div class="ds-mmenu-foot">${cta ? `<a class="ds-btn primary lg" href="${esc(cta.href)}">Cere o ofertă${icon('arrow', 18)}</a>` : ''}<a class="ds-btn secondary lg" href="${esc(tel)}">${icon('phone', 18)}Sună: ${phone}</a>
          ${f.whatsapp ? `<a class="ds-mmenu-wa" target="_blank" rel="noopener" href="${esc(ctx.href('https://wa.me/{whatsapp}'))}">${icon('whatsapp', 18)}Scrie-ne pe WhatsApp</a>` : ''}</div></nav>`;
  });
}

export function mobileBar(ctx) {
  return ctx.layout('Bara de acțiuni pe mobil', () => {
    const calc = ctx.path === '/' ? '#calculator' : ctx.pageAt('/contact', {reason: 'butonul „Cere o ofertă”'})?.href;
    const f = ctx.firma();
    // pe mobil, WhatsApp stă în bară (butonul plutitor se ascunde), ca să nu fie trei acțiuni care plutesc peste conținut
    return `<div class="ds-mbar" data-mbar aria-label="Acțiuni rapide"><a class="ds-btn ghost-light" href="${esc(ctx.href('tel:{telefon}'))}">${icon('phone', 18)}Sună</a>
      ${f.whatsapp ? `<a class="ds-btn wa" target="_blank" rel="noopener" aria-label="Scrie-ne pe WhatsApp" href="${esc(ctx.href('https://wa.me/{whatsapp}'))}">${icon('whatsapp-fab', 24)}</a>` : ''}
      ${calc ? `<a class="ds-btn primary" href="${esc(calc)}">${ctx.path === '/' ? 'Calculează prețul' : 'Cere o ofertă'}</a>` : ''}</div>`;
  });
}

export function footer(ctx) {
  return ctx.layout('Subsol', () => {
    const f = ctx.firma();
    const menus = ctx.query('meniuri', {where: m => m.cheie.startsWith('subsol-'), fields: ['cheie'], order: (a, b) => a.cheie < b.cheie ? 1 : -1, reason: 'coloanele din subsol'});
    const col = (title, links) => `<div><h3>${esc(title)}</h3><nav aria-label="${esc(title)}">${links.join('')}</nav></div>`;
    const legal = [f.denumire_legala, f.cui ? `CUI ${f.cui}` : null, f.reg_com].filter(Boolean).map(esc).join(' · ');
    return `<footer class="ds-footer"><div class="ds-wrap wide">
      <div class="ds-footer-grid"><div><a href="/" aria-label="${esc(f.nume)} — acasă" style="text-decoration:none">${logo(20, 36)}</a><p>${ctx.text(f.slogan)}</p>
        <div class="ds-badges">${f.anpc_sal ? `<a target="_blank" rel="noopener" aria-label="ANPC — Soluționarea Alternativă a Litigiilor" href="${esc(f.anpc_sal)}"><img src="/static/badges/sal.webp" width="500" height="124" alt="ANPC SAL" loading="lazy"></a>` : ''}${f.anpc_sol ? `<a target="_blank" rel="noopener" aria-label="Platforma europeană SOL" href="${esc(f.anpc_sol)}"><img src="/static/badges/sol.webp" width="500" height="124" alt="ANPC SOL" loading="lazy"></a>` : ''}</div></div>
        ${menus.map(m => col(m.titlu.replace(/^Subsol — /, ''), menuLinks(ctx, m.linkuri).map(l => `<a href="${esc(l.href)}">${ctx.text(l.label)}</a>`))).join('')}
        ${col('Contact', [`<a href="${esc(ctx.href('tel:{telefon}'))}">${ctx.text('{telefon}')}</a>`, `<a href="mailto:${esc(f.email)}">${esc(f.email)}</a>`])}</div>
      <div class="ds-footer-bottom"><span>© ${new Date().getFullYear()} ${esc(f.nume)}. Toate drepturile rezervate.${legal ? ` ${legal}.` : ''}</span></div>
      ${!f.cui || !f.reg_com || !f.denumire_legala ? ctx.gap('datele legale ale firmei', 'Denumirea legală, CUI și Nr. Reg. Com. sunt obligatorii pe un site comercial (Legea 365/2002) și cresc încrederea. Se completează în Date firmă.') : ''}
    </div></footer>`;
  });
}

// ———————————————————————————————————————————— secțiunile homepage-ului

function homeHero(ctx, s, {first}) {
  {
    const f = ctx.firma();
    const pic = ctx.media(s.imagine_id, {reason: 'imaginea din hero'});
    const h = first ? 'h1' : 'h2';
    const g = ['google_rating', 'google_recenzii', 'google_url'].map(k => ctx.claim('firma', f, k));
    const google = g.every(c => c.state === 'ok');
    const rating = google ? f.google_rating : f.rating;
    const r = ratingOf(ctx, f).text;
    const ratingItem = rating ? claimed(ctx, google ? {state: 'ok'} : ctx.claim('firma', f, 'rating'), `<div class="ds-trust-item"><div class="row">${stars(rating, 16)}<strong style="font-size:1.05rem">${r}/5</strong></div><span>${google ? `<a href="${esc(f.google_url)}" target="_blank" rel="noopener">${fmt(f.google_recenzii)} recenzii Google</a>` : 'rating clienți'}</span></div>`) : '';
    const stat = (k, label) => {
      const c = ctx.claim('firma', f, k);
      return c.value == null ? '' : claimed(ctx, c, `<div class="ds-trust-item"><strong>${fmt(c.value)}+</strong><span>${label}</span></div>`);
    };
    const trust = [ratingItem, stat('clienti_multumiti', 'clienți mulțumiți'), stat('locuinte_curatate', 'locuințe curățate'), stat('birouri_curatate', 'birouri curățate')].filter(Boolean);
    // banda de sub hero: clienții din portofoliu marcați pentru bandă (Clienți → „Apare în banda de logo-uri”; gol = da)
    const logos = ctx.query('clienti', {where: c => c.in_portofoliu && c.logo_id && c.in_banda !== 0 && c.in_banda !== false, fields: ['in_portofoliu', 'logo_id', 'in_banda', 'status'], order: (a, b) => (a.ordine ?? 99) - (b.ordine ?? 99), reason: 'logo-urile de sub hero'})
      .map(c => ({c, m: ctx.media(c.logo_id, {reason: 'logo-ul clientului'})})).filter(x => x.m);
    return `<section class="ds-hero" aria-labelledby="hero-h"><div class="ds-wrap wide"><div class="ds-hero-grid">
      <div class="ds-hero-copy">${s.insigna ? `<span class="ds-pill"><span class="ico">${icon('shield', 13)}</span>${ctx.text(s.insigna)}</span>` : ''}
        <${h} id="hero-h" class="ds-display">${titleHtml(ctx, s)}</${h}>
        ${s.intro ? `<p class="ds-lead">${ctx.text(s.intro)}</p>` : ''}
        ${actions(ctx, s.butoane, {size: 'lg'})}
        ${trust.length ? `<div class="ds-trust">${trust.join('<span class="ds-divider" aria-hidden="true"></span>')}</div>` : ''}
        ${!google ? ctx.gap('rating verificabil', 'Ratingul de 4,9/5 nu are sursă: fără număr de recenzii și fără link. Când adaugi în Date firmă profilul Google, ratingul și numărul de recenzii, apar aici cu link, iar Google îl primește și în datele structurate.') : ''}</div>
      ${pic ? `<div class="ds-hero-media"><div class="ds-hero-photo">${img(pic, {eager: first})}</div>
        ${s.card_titlu ? `<div class="ds-float bl"><span class="ds-icon ok sm">${icon('shield', 18)}</span><div><strong>${ctx.text(s.card_titlu)}</strong>${s.card_text ? `<span>${ctx.text(s.card_text)}</span>` : ''}</div></div>` : ''}
        </div>` : ''}
      </div>
      ${logos.length ? `<div class="ds-logos" aria-label="Clienți Kurat"><p>Au avut încredere în noi</p><div class="ds-logos-track"><ul>${logos.map(({c, m}) => `<li>${img(m, {alt: c.nume})}</li>`).join('')}</ul>
        <ul class="dup" aria-hidden="true">${logos.map(({m}) => `<li>${img(m, {alt: ''})}</li>`).join('')}</ul></div></div>` : ''}
    </div></section>`;
  }
}

const HOME = {

  servicii(ctx, s) {
    const fallback = ctx.pageAt('/servicii', {reason: 'cardurile fără pagină proprie trimit la Servicii'});
    const group = (field, title, intro) => {
      const items = ctx.links('sectiuni', s.id, field, {reason: `cardurile „${title}”`});
      if (!items.length) return '';
      return `<div class="ds-svc-group"><div class="ds-tabs-label" data-reveal><h3>${esc(title)}</h3>${intro ? `<p>${ctx.text(intro)}</p>` : ''}</div>
        <div class="ds-grid ${items.length >= 4 ? 'c4' : 'c3'}">${items.map(svc => {
          const a = svc._link.attrs ?? {}, n = ctx.count('servicii', svc.id, 'sarcini');
          const pic = ctx.media(a.imagine ?? svc.imagine_id, {reason: 'imaginea cardului'});
          const to = svc.pagina ? ctx.href(`ref:servicii:${svc.id}`) : fallback?.href;
          const title = a.titlu ?? svc.nume;
          const tag = to ? 'a' : 'div';
          return `<${tag} class="ds-card ds-svc"${to ? ` href="${esc(to)}" aria-label="${esc(title)} — află mai mult"` : ''} data-reveal><div class="ds-svc-media">${img(pic, {sizes: CARD_SIZES})}${n ? `<span class="ds-chip">${icon('check', 13)}${n} servicii incluse</span>` : ''}</div>
            <div class="ds-svc-body"><span class="ds-icon">${icon(a.icon ?? svc.icon ?? 'sparkle', 26)}</span><h4 class="ds-h3">${esc(title)}</h4><p>${esc(a.text ?? svc.descriere ?? '')}</p>
              ${(a.puncte ?? []).length ? `<ul class="ds-checks">${a.puncte.slice(0, 3).map(p => `<li>${icon('check', 15)}${esc(p)}</li>`).join('')}</ul>` : ''}
              <div class="ds-svc-foot">${to ? `<span class="ds-link">Află mai mult${icon('arrow', 16)}</span>` : ''}</div></div></${tag}>`;
        }).join('')}</div></div>`;
    };
    return `<section id="servicii" class="ds-section" aria-labelledby="servicii-h"><div class="ds-wrap">${head(ctx, s, {id: 'servicii-h', split: true})}
      ${group('servicii_companii', 'Pentru companii', s.intro_companii)}${group('servicii_persoane', 'Pentru persoane fizice', s.intro_persoane)}
      ${(s.butoane ?? []).length ? `<div class="ds-center-cta">${actions(ctx, s.butoane, {size: 'lg'})}</div>` : ''}</div></section>`;
  },

  avantaje(ctx, s) {
    const items = ctx.links('sectiuni', s.id, 'avantaje');
    return `<section id="deceka" class="ds-section soft" aria-labelledby="deceka-h"><div class="ds-wrap">${head(ctx, s, {id: 'deceka-h', split: true})}
      <div class="ds-compare"><div class="ds-compare-head" aria-hidden="true"><span>Cu Kurat</span><span>Fără un partener de încredere</span></div>
      ${items.map(a => `<div class="ds-card ds-compare-row" data-reveal><div class="yes"><span class="ds-icon ok">${icon(a.icon ?? 'sparkle', 22)}</span><div><span class="cat">${esc(a.categorie ?? '')}</span><h3>${esc(a.titlu)}</h3><p>${ctx.text(a.text)}</p></div></div>
        ${a.risc_titlu ? `<div class="no"><span class="ds-icon no sm">${icon('x', 14)}</span><div><strong>${esc(a.risc_titlu)}</strong><p>${ctx.text(a.risc_text)}</p></div></div>` : '<div class="no"></div>'}</div>`).join('')}</div>
      <div class="ds-note" data-reveal>${s.nota ? `<p class="ds-lead">${ctx.text(s.nota)}</p>` : ''}${actions(ctx, s.butoane, {size: 'lg'})}</div></div></section>`;
  },

  valori(ctx, s, {page}) {
    const items = ctx.links('sectiuni', s.id, 'valori');
    return `<section id="valori" class="ds-section${page.path === '/' ? '' : ' soft'}" aria-labelledby="valori-h"><div class="ds-wrap">${head(ctx, s, {id: 'valori-h', center: true})}
      <div class="ds-grid c5 ds-values">${items.map(v => `<div class="ds-card ds-value" data-reveal><span class="letter" aria-hidden="true">${esc(v.litera ?? v.titlu[0])}</span><h3>${esc(v.titlu)}</h3><p>${ctx.text(v.text)}</p></div>`).join('')}</div></div></section>`;
  },

  pasi(ctx, s) {
    const items = ctx.links('sectiuni', s.id, 'pasi');
    const proces = items.filter(p => p.grup === 'proces'), etape = items.filter(p => p.grup === 'etape');
    return `<section id="cum" class="ds-section soft" aria-labelledby="cum-h"><div class="ds-wrap">${head(ctx, s, {id: 'cum-h', split: true})}
      <ol class="ds-steps">${proces.map((p, i) => `<li class="ds-step" data-reveal><span class="num" aria-hidden="true">${String(i + 1).padStart(2, '0')}</span><h3>${esc(p.titlu)}</h3><p>${ctx.text(p.text)}</p></li>`).join('')}</ol>
      ${etape.length ? `<div class="ds-stages" data-reveal><h3 id="etape-h">Etapele fiecărei curățenii</h3><ol aria-labelledby="etape-h">${etape.map((p, i) => `<li><span>Etapa ${i + 1}</span><strong>${esc(p.titlu)}</strong><p>${ctx.text(p.text)}</p></li>`).join('')}</ol></div>` : ''}
    </div></section>`;
  },

  calculator(ctx, s) {
    const calc = ctx.one('calculator', {reason: 'prețul minim și multiplicatorii'});
    const services = ctx.query('servicii', {where: r => r.tarif_mp != null, fields: ['tarif_mp', 'status'], order: (a, b) => a.id - b.id, reason: 'tipurile de curățenie din calculator'});
    const extras = ctx.query('extra', {where: r => r.in_calculator, fields: ['in_calculator', 'status'], order: (a, b) => a.id - b.id, reason: 'serviciile suplimentare din calculator'});
    if (!calc || !services.length) return '';
    const cfg = {min: calc.pret_minim, mult: calc.multiplicatori ?? [],
      services: services.map(x => ({id: x.id, name: x.calc_eticheta ?? x.nume_scurt ?? x.nume, desc: x.calc_descriere ?? x.descriere, rate: x.tarif_mp, color: x.culoare ?? '#0f69f5', icon: icon(x.icon ?? 'sparkle', 26)})),
      extras: extras.map(x => ({id: x.id, name: x.nume, price: x.pret, unit: x.unitate}))};
    return `<section id="calculator" class="ds-section" aria-labelledby="calc-heading"><div class="ds-wrap"><div class="ds-calc">
      <div class="ds-calc-side" data-reveal>${s.eticheta ? `<span class="ds-eyebrow">${ctx.text(s.eticheta)}</span>` : ''}<h2 id="calc-heading" class="ds-h2">${ctx.text(s.titlu)}</h2>
        ${s.intro ? `<p class="ds-lead">${ctx.text(s.intro)}</p>` : ''}
        ${s.puncte?.length ? `<ul class="ds-checks">${s.puncte.map(p => `<li>${icon('check-circle', 20)}${esc(p)}</li>`).join('')}</ul>` : ''}
        <div class="ds-callcard"><span class="ds-icon sm">${icon('phone', 18)}</span><div><span class="ds-muted" style="display:block;font-size:.85rem">Preferi să vorbești cu noi?</span><a href="${esc(ctx.href('tel:{telefon}'))}">${ctx.text('{telefon}')}</a></div></div></div>
      <form data-calc novalidate style="background: var(--surface-card); border: 1px solid var(--border-subtle); overflow: hidden;"><script type="application/json">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>
        <noscript><p style="padding: 28px;">Calculatorul are nevoie de JavaScript. Ne poți suna la ${ctx.text('{telefon}')}.</p></noscript></form>
    </div></div></section>`;
  },

  garantie(ctx, s) {
    const g = ctx.one('garantie', {reason: 'politica de garanție'});
    const use = g && ctx.claim('garantie', g, 'rezumat').state === 'ok' && ctx.claim('garantie', g, 'titlu').state === 'ok';
    const title = use ? g.titlu : s.titlu, intro = use ? g.rezumat : s.intro;
    const b = (s.butoane ?? [])[0] && ctx.link(s.butoane[0]);
    return `<section class="ds-section tight" aria-labelledby="garantie-h"><div class="ds-wrap wide"><div class="ds-guarantee" data-reveal>
      <div class="ds-guarantee-copy"><span class="badge">${icon('shield', 15)}${ctx.text(s.eticheta ?? 'Garanția Kurat')}</span><h2 id="garantie-h" class="ds-h2">${ctx.text(title)}</h2>
        ${intro ? `<p class="ds-lead">${ctx.text(intro)}</p>` : ''}${b ? `<a class="ds-btn green lg" href="${esc(b.href)}">${icon('shield', 18)}${ctx.text(b.label)}</a>` : ''}</div>
      ${s.puncte?.length ? `<ul>${s.puncte.map(p => `<li>${icon('check-circle', 22)}${esc(p)}</li>`).join('')}</ul>` : ''}
    </div>${use ? '' : ctx.gap('o singură formulare a garanției', 'Garanția apare în trei forme diferite: aici („ne întoarcem și refacem gratuit”), în hero („banii înapoi”) și în întrebările frecvente („48 de ore, refacem sau banii înapoi”). Politica unică e pregătită în Brain, la Garanție; după ce o confirmi și o publici, apare aici.')}</div></section>`;
  },

  testimoniale(ctx, s, {page}) {
    const items = ctx.links('sectiuni', s.id, 'testimoniale');
    const f = ctx.firma();
    const home = page.path === '/';
    const card = (t, i) => {
      const c = ctx.get('clienti', t.client_id, {reason: 'autorul testimonialului'});
      const who = [t.autor, t.functie].filter(Boolean).map(esc).join(', ');
      const when = t.data ? esc(new Date(t.data).toLocaleDateString('ro-RO', {month: 'long', year: 'numeric'})) : '';
      const missing = !t.autor && ctx.preview ? '<span class="gap-inline">lipsește persoana și funcția</span>' : '';
      // în portofoliu, fiecare recenzie poartă logo-ul clientului
      const logo = !home && c?.logo_id && ctx.media(c.logo_id, {reason: 'logo-ul clientului'});
      const rating = `<span class="ds-stars">${stars(t.stele ?? 5, i === 0 ? 20 : 16)}</span>`;
      return `<figure class="ds-card ds-review${i === 0 ? ' featured' : ''}" data-reveal style="margin:0">${logo ? `<div class="top"><span class="logo">${img(logo, {alt: c.nume})}</span>${rating}</div>` : rating}
        <blockquote>„${esc(t.text)}”</blockquote>
        <figcaption class="who"><span class="ava" aria-hidden="true" style="background:${esc(c?.culoare ?? '#0a54d1')}">${esc(initials(c?.nume))}</span><span><strong>${esc(c?.nume ?? '')}</strong><span>${who || 'Client Kurat'}${when ? ` · ${when}` : ''}</span>${missing}</span></figcaption></figure>`;
    };
    const rt = ratingOf(ctx, f);
    const score = home && rt.value ? claimed(ctx, rt.claim, `<div class="ds-score"><strong>${rt.text}</strong><div><span class="ds-stars">${stars(rt.value, 18)}</span><span>${rt.google ? `<a href="${esc(f.google_url)}" target="_blank" rel="noopener">${fmt(f.google_recenzii)} recenzii pe Google</a>` : f.clienti_multumiti ? `${fmt(f.clienti_multumiti)}+ clienți mulțumiți` : 'din 5'}</span></div></div>`) : '';
    return `<section id="recenzii" class="ds-section${home ? ' soft' : ''}" aria-labelledby="recenzii-h"><div class="ds-wrap"><div class="ds-head split" data-reveal><div>${s.eticheta ? `<span class="ds-eyebrow">${ctx.text(s.eticheta)}</span>` : ''}<h2 id="recenzii-h" class="ds-h2">${titleHtml(ctx, s)}</h2>${s.intro ? `<p class="ds-lead">${ctx.text(s.intro)}</p>` : ''}</div>${score}</div>
      <div class="ds-reviews">${items.map(card).join('')}</div>
      ${items.some(t => !t.autor) ? ctx.gap('cine vorbește în fiecare testimonial', 'Un citat cu nume, funcție și dată e mult mai credibil decât „Client Kurat”. Se completează la Testimoniale → Cine vorbește / Funcția / Data.') : ''}</div></section>`;
  },

  faq(ctx, s, {extra}) {
    // un răspuns încă nevalidat nu apare pe site; în previzualizare apare, marcat
    const items = ctx.links('sectiuni', s.id, 'intrebari').filter(q => ctx.preview || !ctx.unvalidated(q.raspuns));
    if (extra.faqAt == null) { extra.faqItems = []; extra.faqAt = extra.push('') - 1; }
    for (const q of items) if (!ctx.unvalidated(q.raspuns) && !extra.faqItems.some(x => x.id === q.id)) extra.faqItems.push(q);
    extra[extra.faqAt] = jsonLd({'@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: extra.faqItems.map(q => ({'@type': 'Question', name: q.intrebare,
      acceptedAnswer: {'@type': 'Answer', text: ctx.rich(q.raspuns).replace(/<[^>]+>/g, '')}}))});
    const f = ctx.firma();
    return `<section id="intrebari" class="ds-section" aria-labelledby="faq-h"><div class="ds-wrap"><div class="ds-faq">
      <div class="ds-faq-side" data-reveal>${s.eticheta ? `<span class="ds-eyebrow">${ctx.text(s.eticheta)}</span>` : ''}<h2 id="faq-h" class="ds-h2">${ctx.text(s.titlu)}</h2>
        ${s.intro ? `<p class="ds-lead">${ctx.text(s.intro)}</p>` : ''}
        <div class="ds-callcard"><span class="ds-icon sm">${icon('phone', 18)}</span><div><span class="ds-muted" style="display:block;font-size:.85rem">Nu găsești răspunsul? Sună-ne</span><a href="${esc(ctx.href('tel:{telefon}'))}">${ctx.text('{telefon}')}</a></div></div>
        ${f.whatsapp ? `<a class="ds-link" target="_blank" rel="noopener" href="${esc(ctx.href('https://wa.me/{whatsapp}'))}">${icon('whatsapp', 18)}sau scrie-ne pe WhatsApp</a>` : ''}</div>
      <div class="ds-faq-list">${items.map((q, i) => `<details${i === 0 ? ' open' : ''} data-reveal><summary>${esc(q.intrebare)}<span class="chev" aria-hidden="true">${icon('chevron', 16)}</span></summary><div class="ans">${ctx.rich(q.raspuns)}</div></details>`).join('')}</div>
    </div></div></section>`;
  },

  contact(ctx, s) {
    const f = ctx.firma();
    const addr = [f.adresa, [f.cod_postal, f.oras].filter(Boolean).join(' '), f.tara].filter(Boolean).join(', ');
    const row = (ic, label, value, href) => `<${href ? `a class="ds-contact-row" href="${esc(href)}"` : 'div class="ds-contact-row"'}><span class="ds-icon">${icon(ic, 22)}</span><span><small>${label}</small><strong>${value}</strong></span></${href ? 'a' : 'div'}>`;
    const calcBtn = (s.butoane ?? [])[0] && ctx.link(s.butoane[0]);
    return `<section id="contact" class="ds-section soft" aria-labelledby="contact-h"><div class="ds-wrap"><div class="ds-contact">
      <div class="ds-card ds-contact-card" data-reveal><div style="display:grid;gap:var(--ds-4)">${s.eticheta ? `<span class="ds-eyebrow">${ctx.text(s.eticheta)}</span>` : ''}<h2 id="contact-h" class="ds-h2">${ctx.text(s.titlu)}</h2></div>
        <div class="ds-contact-rows">${row('phone', 'Telefon', ctx.text('{telefon}'), ctx.href('tel:{telefon}'))}${row('mail', 'Email', esc(f.email), `mailto:${f.email}`)}${addr ? row('pin', 'Adresă', esc(addr)) : ''}</div>
        <div class="ds-actions">${calcBtn ? `<a class="ds-btn primary" href="${esc(calcBtn.href)}">${icon('calculator', 18)}${ctx.text(calcBtn.label)}</a>` : ''}${f.whatsapp ? `<a class="ds-btn secondary" target="_blank" rel="noopener" href="${esc(ctx.href('https://wa.me/{whatsapp}'))}">${icon('whatsapp', 18)}WhatsApp</a>` : ''}</div></div>
      ${addr ? `<div class="ds-map" data-reveal>${mapFrame(f)}</div>` : ''}
    </div></div></section>`;
  }
};

const mapFrame = f => `<iframe title="Hartă — sediul ${esc(f.nume)}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" src="https://maps.google.com/maps?hl=ro&amp;q=${encodeURIComponent(`${f.adresa} ${f.oras ?? ''}`)}&amp;z=14&amp;output=embed"></iframe>`;
const addressOf = f => [f.adresa, [f.cod_postal, f.oras].filter(Boolean).join(' '), f.tara].filter(Boolean).join(', ');

// ———————————————————————————————————————————— paginile interioare

// Hero-ul unei pagini: simplu (titlu, introducere, acțiuni); cu imagine alături (Despre noi, Magazin); cu cifre (Portofoliu).
function pageHero(ctx, s, {page, first}) {
  const h = first ? 'h1' : 'h2';
  const pic = ctx.media(s.imagine_id, {reason: 'imaginea din hero'});
  const copy = `<div class="ds-page-hero-copy">${s.eticheta ? `<span class="ds-eyebrow">${ctx.text(s.eticheta)}</span>` : ''}
    <${h} id="pg-h" class="ds-display">${titleHtml(ctx, s)}</${h}>${s.intro ? `<p class="ds-lead">${ctx.text(s.intro)}</p>` : ''}
    ${actions(ctx, s.butoane, {size: 'lg'})}</div>`;
  // fără imagine, partea dreaptă primește dovezile (rating Google, cifre) și drumul spre calculator
  const side = pic ? `<div class="ds-page-media">${img(pic, {eager: first})}</div>` : proofPanel(ctx);
  return `<section class="ds-page-hero split" aria-labelledby="pg-h"><div class="ds-wrap"><div class="ds-split">${copy}${side}</div></div></section>`;
}

function proofPanel(ctx) {
  const f = ctx.firma();
  const google = ['google_rating', 'google_recenzii', 'google_url'].every(k => ctx.claim('firma', f, k).state === 'ok');
  const stat = (k, label) => {
    const c = ctx.claim('firma', f, k);
    return c.value == null ? '' : claimed(ctx, c, `<div><strong>${fmt(c.value)}+</strong><span>${label}</span></div>`);
  };
  const stats = [stat('clienti_multumiti', 'clienți mulțumiți'), stat('locuinte_curatate', 'locuințe curățate'), stat('birouri_curatate', 'birouri curățate')].filter(Boolean);
  if (!google && !stats.length) return '';
  return `<aside class="ds-proof" aria-label="De ce Kurat">
    ${google ? `<a class="ds-proof-rating" href="${esc(f.google_url)}" target="_blank" rel="noopener"><span class="score">${ratingOf(ctx, f).text}</span><span><span class="ds-stars">${stars(f.google_rating, 18)}</span><span class="src">${fmt(f.google_recenzii)} recenzii pe Google ${icon('external', 14)}</span></span></a>` : ''}
    ${stats.length ? `<div class="ds-proof-stats">${stats.join('')}</div>` : ''}
    <a class="ds-btn primary" href="/#calculator">${icon('calculator', 18)}Află prețul în 60 de secunde</a></aside>`;
}

// Banda de final, închisă la culoare: titlu, o frază, butonul principal și telefonul.
export function ctaBand(ctx, s) {
  const text = s.intro ?? (s.continut ?? '').replace(/<[^>]+>/g, '').trim();
  const btns = (s.butoane ?? []).map(b => ctx.link(b)).filter(Boolean).map(l => l.href.startsWith('tel:')
    ? `<a class="ds-btn ghost-light lg" href="${esc(l.href)}">${icon('phone', 18)}${ctx.text(l.label)}</a>`
    : `<a class="ds-btn primary lg" href="${esc(l.href)}">${ctx.text(l.label)}${icon('arrow', 18)}</a>`);
  return `<section class="ds-section tight" aria-labelledby="cta-${s.id ?? 'band'}"><div class="ds-wrap"><div class="ds-cta" data-reveal>
    <div><h2 id="cta-${s.id ?? 'band'}">${ctx.text(s.titlu)}</h2>${text ? `<p>${ctx.text(text)}</p>` : ''}</div>
    ${btns.length ? `<div class="ds-actions">${btns.join('')}</div>` : ''}</div></div></section>`;
}

const INNER = {
  'servicii-lista'(ctx, s) {
    const items = ctx.query('servicii', {where: r => r.fel === s.filtru && r.pagina, fields: ['fel', 'pagina', 'status'], order: (a, b) => a.id - b.id, reason: `serviciile „${s.filtru}”`});
    const tint = s.filtru !== 'spatiu';
    return `<section class="ds-section${tint ? ' soft' : ''}" aria-labelledby="svc-${s.filtru}-h"><div class="ds-wrap">
      <div class="ds-svc-list-head" data-reveal><h2 id="svc-${s.filtru}-h">${esc(s.titlu)}</h2>${s.intro ? `<p>${ctx.text(s.intro)}</p>` : ''}</div>
      <div class="ds-grid c3">${items.map(svc => {
        const from = ctx.query('tarife', {scope: `servicii:${svc.id}`, where: t => t.serviciu_id === svc.id && t.pret != null, reason: `„de la” pentru ${svc.nume}`})
          .reduce((min, t) => min == null || t.pret < min.pret ? t : min, null);
        const n = ctx.count('servicii', svc.id, 'sarcini');
        return `<a class="ds-card ds-svc" href="${esc(ctx.href(`ref:servicii:${svc.id}`))}" data-reveal><div class="ds-svc-media">${img(ctx.media(svc.imagine_id), {sizes: CARD_SIZES})}${n ? `<span class="ds-chip">${icon('check', 13)}${n} servicii incluse</span>` : ''}</div>
          <div class="ds-svc-body"><span class="ds-icon">${icon(svc.icon ?? 'sparkle', 26)}</span><h3 class="ds-h3">${esc(svc.nume)}</h3><p>${esc(svc.descriere ?? '')}</p>
            ${from ? `<div class="ds-from"><span>de la </span><strong>${priceHtml(ctx, {...from, pret_max: null})}</strong></div>` : ''}
            <div class="ds-svc-foot"><span class="ds-link">Vezi detalii${icon('arrow', 16)}</span></div></div></a>`;
      }).join('')}</div></div></section>`;
  },

  text(ctx, s, {page}) {
    // benzile de final au telefonul printre butoane; restul e text lung (Povestea noastră)
    if (s.butoane?.some(b => b.href?.startsWith('tel:'))) return ctaBand(ctx, s);
    const paras = (s.continut ?? '').match(/<p>[\s\S]*?<\/p>/g) ?? [];
    const link = (s.butoane ?? [])[0] && ctx.link(s.butoane[0]);
    return `<section class="ds-section soft" aria-labelledby="txt-${s.id}"><div class="ds-wrap"><div class="ds-prose" data-reveal>
      <h2 id="txt-${s.id}" class="ds-h2">${ctx.text(s.titlu)}</h2>
      ${paras.map(p => `<p>${ctx.rich(p).replace(/^<p>|<\/p>$/g, '')}</p>`).join('')}
      ${link ? `<a class="ds-link" target="_blank" rel="noopener" href="${esc(link.href)}">${icon('external', 18)}${ctx.text(link.label)}</a>` : ''}</div></div></section>`;
  },

  cifre(ctx) {
    const f = ctx.firma();
    const item = (k, label) => {
      const c = ctx.claim('firma', f, k);
      return c.value == null ? '' : claimed(ctx, c, `<div class="ds-stat" data-reveal><strong>${fmt(c.value)}+</strong><span>${label}</span></div>`);
    };
    return `<section class="ds-section tight" aria-label="Cifrele Kurat"><div class="ds-wrap"><div class="ds-stats">${item('clienti_multumiti', 'clienți mulțumiți')}${item('locuinte_curatate', 'locuințe curățate')}${item('birouri_curatate', 'birouri curățate')}</div></div></section>`;
  },

  clienti(ctx, s) {
    const items = ctx.links('sectiuni', s.id, 'clienti');
    return `<section class="ds-section tight soft" aria-labelledby="logos-h"><div class="ds-wrap"><div class="ds-head center" data-reveal style="margin-bottom:var(--ds-6)"><h2 id="logos-h" class="ds-eyebrow">${esc(s.titlu ?? 'Au avut încredere în noi')}</h2></div>
      <ul class="ds-logo-wall">${items.map(c => {
        const l = ctx.media(c.logo_id);
        return `<li data-reveal>${l ? img(l, {alt: `${c.nume} — client Kurat`}) : `<strong>${esc(c.nume)}</strong>`}</li>`;
      }).join('')}</ul></div></section>`;
  },

  formular(ctx, s) {
    const f = ctx.firma();
    const addr = addressOf(f);
    const row = (ic, label, value, href, cls = '') => `<${href ? `a class="ds-contact-row${cls}" href="${esc(href)}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''}` : `div class="ds-contact-row${cls}"`}><span class="ds-icon">${icon(ic, 22)}</span><span><small>${label}</small><strong>${value}</strong></span></${href ? 'a' : 'div'}>`;
    const req = '<span class="req" aria-hidden="true">*</span>';
    return `<section class="ds-section tight" aria-labelledby="ct-form-h" style="padding-top:0"><div class="ds-wrap"><div class="ds-contact-page">
      <div class="ds-contact-rows" data-reveal>${row('phone', 'Telefon', ctx.text('{telefon}'), ctx.href('tel:{telefon}'))}${f.whatsapp ? row('whatsapp', 'WhatsApp', 'Scrie-ne pe WhatsApp', ctx.href('https://wa.me/{whatsapp}'), ' wa') : ''}${row('mail', 'Email', esc(f.email), `mailto:${f.email}`)}${addr ? row('pin', 'Adresă', esc(addr)) : ''}</div>
      <div id="formular" class="ds-card" data-reveal style="padding:clamp(28px,4vw,44px)"><h2 id="ct-form-h" class="ds-h3" style="font-size:1.5rem;font-weight:800">${ctx.text(s.titlu)}</h2>
        <p class="ds-muted" style="margin:8px 0 var(--ds-6)">Completează datele și te contactăm cu o ofertă personalizată.</p>
        <form method="post" action="/api/cerere" data-lead novalidate class="ds-form"><input type="hidden" name="sursa" value="formular">
          <div class="ds-grid c2"><div class="ds-field"><label for="ct-name">Nume ${req}</label><input id="ct-name" name="nume" type="text" autocomplete="name" required maxlength="120" class="ds-input"></div>
          <div class="ds-field"><label for="ct-contact">Telefon sau email ${req}</label><input id="ct-contact" name="contact" type="text" autocomplete="tel" required maxlength="160" class="ds-input"></div></div>
          <div class="ds-field"><label for="ct-msg">Mesaj</label><textarea id="ct-msg" name="mesaj" rows="5" maxlength="4000" class="ds-input" placeholder="Ce spațiu, ce suprafață, când ai nevoie…"></textarea></div>
          <label class="ds-check"><input id="ct-agree" name="acord" value="1" type="checkbox" required><span>Sunt de acord să fiu contactat în legătură cu cererea mea.</span></label>
          <div class="ds-actions"><button type="submit" class="ds-btn primary lg">Trimite mesajul${icon('send', 18)}</button></div><p class="form-msg" role="status"></p></form></div>
    </div></div></section>`;
  },

  harta(ctx) {
    const f = ctx.firma();
    return f.adresa ? `<section class="ds-section tight" aria-label="Locația biroului Kurat" style="padding-top:0"><div class="ds-wrap"><div class="ds-map tall" data-reveal>${mapFrame(f)}</div></div></section>` : '';
  },

  produse(ctx, s) {
    const items = ctx.query('produse', {fields: ['status', 'nume', 'pret'], order: (a, b) => a.nume.localeCompare(b.nume, 'ro'), reason: 'toate produsele'});
    return `<section class="ds-section tight" aria-labelledby="prod-h" style="padding-top:0"><div class="ds-wrap"><div class="ds-shop-bar"><h2 id="prod-h">${esc(s.titlu ?? 'Toate produsele')}</h2><span class="ds-muted">${items.length} ${items.length === 1 ? 'produs' : 'produse'}</span></div>
      ${items.length ? `<div class="ds-grid c4">${items.map(p => `<a class="ds-card ds-svc ds-product" href="${esc(ctx.href(`ref:produse:${p.id}`))}" data-reveal><div class="ds-svc-media">${img(ctx.media(p.imagine_id))}</div>
        <div class="ds-svc-body" style="padding-top:var(--ds-5)"><h3 class="ds-h3">${esc(p.nume)}</h3><span class="ds-price-tag">${esc(String(p.pret ?? ''))} lei</span></div></a>`).join('')}</div>`
        : `<div class="ds-empty"><span class="ds-icon">${icon('store', 28)}</span><strong>Niciun produs găsit</strong><p class="ds-muted">${ctx.text(s.intro ?? 'Momentan nu sunt produse disponibile. Revino curând.')}</p></div>`}
    </div></section>`;
  }
};

// ———————————————————————————————————————————— „Ce includem”, cameră cu cameră
// Planul unei locuințe sau al unui birou (după publicul serviciului). Camera unei operațiuni vine din câmpul „Grup” al legăturii
// (Baie, Bucătărie…; mai multe, separate prin virgulă). Operațiunile fără cameră, sau cu o cameră care nu e pe plan, se fac peste tot.

const PLANS = {
  casa: {all: 'Toată locuința', label: 'Planul unei locuințe', doors: [[340, 198, 340, 224], [362, 190, 392, 190], [480, 300, 480, 328], [340, 300, 340, 328], [150, 230, 182, 230], [396, 370, 440, 370]], rooms: [
    {key: 'living', name: 'Living', match: /living|sufragerie/i, r: [10, 10, 330, 220],
      f: '<rect x="40" y="150" width="150" height="46" rx="12"/><rect x="40" y="132" width="150" height="22" rx="8"/><rect x="230" y="70" width="70" height="44" rx="6"/>'},
    {key: 'dormitor', name: 'Dormitor', match: /dormitor/i, r: [340, 10, 250, 180],
      f: '<rect x="440" y="62" width="120" height="96" rx="10"/><rect x="450" y="70" width="44" height="22" rx="6"/><rect x="506" y="70" width="44" height="22" rx="6"/>'},
    {key: 'bucatarie', name: 'Bucătărie', match: /bucăt|bucat|oficiu/i, r: [10, 230, 200, 140], wet: true,
      f: '<rect x="22" y="300" width="176" height="30" rx="4"/><circle cx="62" cy="315" r="8"/><circle cx="90" cy="315" r="8"/><rect x="140" y="304" width="40" height="22" rx="4"/>'},
    {key: 'baie', name: 'Baie', match: /baie|băi|sanitar/i, r: [210, 230, 130, 140], wet: true,
      f: '<rect x="222" y="292" width="62" height="64" rx="16"/><circle cx="314" cy="316" r="13"/>'},
    {key: 'hol', name: 'Hol', match: /hol|intrare/i, r: [340, 190, 140, 180],
      f: '<rect x="372" y="250" width="76" height="46" rx="8"/>'},
    {key: 'balcon', name: 'Balcon', match: /balcon|teras/i, r: [480, 190, 110, 180],
      f: '<circle cx="535" cy="300" r="18"/><circle cx="535" cy="300" r="7"/>'}
  ]},
  firma: {all: 'Tot spațiul', label: 'Planul unui birou', doors: [[360, 182, 360, 210], [440, 250, 476, 250], [360, 290, 360, 318], [150, 240, 184, 240], [520, 160, 552, 160], [500, 370, 546, 370]], rooms: [
    {key: 'open', name: 'Open space', match: /birou|open|spațiu de lucru/i, r: [10, 10, 350, 230],
      f: '<rect x="40" y="80" width="120" height="46" rx="6"/><rect x="200" y="80" width="120" height="46" rx="6"/><rect x="40" y="160" width="120" height="46" rx="6"/><rect x="200" y="160" width="120" height="46" rx="6"/>'},
    {key: 'sedinte', name: 'Sală de ședințe', match: /ședinț|sedint|sală/i, r: [360, 10, 230, 150],
      f: '<rect x="432" y="92" width="124" height="46" rx="23"/>'},
    {key: 'receptie', name: 'Recepție', match: /recep/i, r: [360, 160, 230, 90],
      f: '<rect x="420" y="212" width="110" height="22" rx="11"/>'},
    {key: 'oficiu', name: 'Oficiu', match: /bucăt|bucat|oficiu/i, r: [10, 240, 200, 130], wet: true,
      f: '<rect x="22" y="306" width="176" height="28" rx="4"/><rect x="150" y="310" width="34" height="20" rx="4"/>'},
    {key: 'sanitar', name: 'Grup sanitar', match: /baie|băi|sanitar/i, r: [210, 240, 150, 130], wet: true,
      f: '<circle cx="290" cy="340" r="14"/><circle cx="330" cy="340" r="14"/>'},
    {key: 'hol', name: 'Hol și acces', match: /hol|intrare|acces/i, r: [360, 250, 230, 120],
      f: '<rect x="430" y="296" width="96" height="34" rx="8"/>'}
  ]}
};

function roomsSection(ctx, svc, tasks, toneCls) {
  const plan = PLANS[svc.public === 'firma' ? 'firma' : 'casa'];
  const rows = tasks.map(t => {
    const grup = t._link.attrs?.grup ?? '';
    const own = grup ? plan.rooms.filter(z => z.match.test(grup)) : [];
    return {t, own};
  });
  const applies = (row, z) => !row.own.length || row.own.includes(z);
  const count = z => rows.filter(row => applies(row, z)).length;
  // pereți interiori subțiri, conturul exterior gros și rotunjit, goluri pentru uși, gresie fină în camerele umede
  const svg = `<svg class="ds-plan" viewBox="0 0 600 380" aria-hidden="true"><defs>
    <clipPath id="ds-plan-clip"><rect x="10" y="10" width="580" height="360" rx="18"/></clipPath>
    <pattern id="ds-plan-tile" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16"/></pattern></defs>
    <g clip-path="url(#ds-plan-clip)">${plan.rooms.map(z => {
    const [x, y, w, h] = z.r;
    // numărul stă lângă nume când încape, altfel dedesubt
    const [bx, by] = 16 + z.name.length * 8.6 + 12 > w - 40 ? [x + 30, y + 54] : [x + w - 26, y + 26];
    return `<g class="ds-plan-room" data-room="${z.key}"><rect class="w" x="${x}" y="${y}" width="${w}" height="${h}"/>${z.wet ? `<rect class="t" x="${x}" y="${y}" width="${w}" height="${h}"/>` : ''}<g class="f">${z.f}</g>
      <text x="${x + 16}" y="${y + 30}">${esc(z.name)}</text><circle class="b" cx="${bx}" cy="${by}" r="13"/><text class="n" x="${bx}" y="${by + 4.5}">${count(z)}</text></g>`;
  }).join('')}</g><rect class="ds-plan-shell" x="10" y="10" width="580" height="360" rx="18"/>
    ${plan.doors.map(([x1, y1, x2, y2], i) => `<line class="ds-plan-door${i === plan.doors.length - 1 ? ' in' : ''}" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>`).join('')}</svg>`;
  const chip = (key, name, n, on) => `<button type="button" class="ds-room-chip" data-room="${key}" aria-pressed="${on}">${esc(name)}<span>${n}</span></button>`;
  const li = ({t, own}) => `<li data-in="${own.length ? own.map(z => z.key).join(' ') : '*'}">${icon('check-circle', 18)}<span>${esc(t.text)}${own.length ? `<em class="ds-room-tag">${esc(own.map(z => z.name).join(' · '))}</em>` : ''}</span></li>`;
  return `<section class="ds-section${toneCls}" aria-labelledby="sd-include-h"><div class="ds-wrap">
    <div class="ds-head split" data-reveal><div><span class="ds-eyebrow">${tasks.length} operațiuni incluse</span><h2 id="sd-include-h" class="ds-h2">Ce includem, cameră cu cameră</h2></div>
      <p class="ds-lead">Alege o cameră din plan și vezi exact ce curățăm acolo.</p></div>
    <div class="ds-rooms" data-rooms data-all="${esc(plan.all)}" data-reveal>
      <div class="ds-card ds-rooms-plan">${svg}
        <div class="ds-room-chips" role="group" aria-label="${esc(plan.label)}">${chip('*', plan.all, tasks.length, true)}${plan.rooms.map(z => chip(z.key, z.name, count(z), false)).join('')}</div></div>
      <div class="ds-card ds-rooms-list" aria-live="polite"><div class="ds-rooms-head"><h3 data-room-title>${esc(plan.all)}</h3><span data-room-count>${tasks.length} operațiuni</span></div>
        <ul class="ds-checks">${rows.map(li).join('')}</ul>
        <p class="ds-rooms-note">${icon('sparkle', 16)}Operațiunile fără cameră se fac în fiecare încăpere.</p></div>
    </div></div></section>`;
}

// ———————————————————————————————————————————— pagina unui serviciu

export function servicePageBody(ctx, svc) {
  const hub = ctx.pageAt('/servicii', {reason: 'firul de navigare'});
  const contact = ctx.pageAt('/contact', {reason: 'butonul „Cere o ofertă”'});
  const media = ctx.media(svc.imagine_id, {reason: 'imaginea serviciului'});
  // imaginea-substitut („Imagine în curând”) nu ține locul unei fotografii: până vine una, în dreapta stau dovezile
  const pic = media && !/placeholder/i.test(media.src) ? media : null;
  const parts = [];
  let tint = false;
  const tone = () => (tint = !tint) ? ' soft' : '';
  parts.push(`<section class="ds-page-hero split" aria-labelledby="sd-h"><div class="ds-wrap wide">
    ${hub ? `<nav aria-label="Breadcrumb"><ol class="ds-crumbs"><li><a href="/">Acasă</a></li><li aria-hidden="true">/</li><li><a href="${esc(hub.href)}">${ctx.text(hub.label)}</a></li><li aria-hidden="true">/</li><li><span aria-current="page">${esc(svc.nume)}</span></li></ol></nav>` : ''}
    <div class="ds-split"><div class="ds-page-hero-copy"><div class="ds-svc-hero-title"><span class="ds-icon">${icon(svc.icon ?? 'sparkle', 30)}</span><div>
      <h1 id="sd-h" class="ds-display">${esc(svc.nume)}</h1>${svc.descriere ? `<p class="ds-lead">${ctx.text(svc.descriere)}</p>` : ''}</div></div>
      <div class="ds-actions"><a class="ds-btn primary lg" href="${svc.tarif_mp != null ? `/?serviciu=${svc.id}#calculator` : '/#calculator'}">${icon('calculator', 18)}Calculează prețul</a>${contact ? `<a class="ds-btn secondary lg" href="${esc(contact.href)}">Cere o ofertă${icon('arrow', 18)}</a>` : ''}</div>
      ${svc.acopera?.length ? `<div class="ds-chips"><span>Acoperim:</span>${svc.acopera.map(a => `<span class="ds-chip">${esc(a)}</span>`).join('')}</div>` : ''}</div>
      ${pic ? `<div class="ds-page-media" style="aspect-ratio:4/3">${img(pic, {eager: true})}</div>` : proofPanel(ctx)}</div></div></section>`);

  const tasks = ctx.within('Ce includem', 'operațiunile serviciului', () => ctx.links('servicii', svc.id, 'sarcini'));
  if (tasks.length) parts.push(roomsSection(ctx, svc, tasks, tone()));

  const prices = ctx.within('Prețuri orientative', 'tarifele serviciului', () =>
    ctx.query('tarife', {scope: `servicii:${svc.id}`, where: t => t.serviciu_id === svc.id, order: (a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)}));
  const extras = ctx.within('Servicii suplimentare', 'extra la serviciu', () => ctx.links('servicii', svc.id, 'extra'));
  if (prices.length || extras.length) {
    parts.push(`<section class="ds-section${tone()}" aria-labelledby="sd-price-h"><div class="ds-wrap"><div class="ds-head split" data-reveal><div><span class="ds-eyebrow">Prețuri</span><h2 id="sd-price-h" class="ds-h2">Prețuri orientative</h2></div><p class="ds-lead">Oferta finală se confirmă după o scurtă evaluare a spațiului.</p></div>
      ${prices.length ? `<div class="ds-prices">${prices.map(t => `<div class="ds-card ds-price" data-reveal><span>${esc(t.eticheta)}</span><strong>${t.la_cerere ? 'La cerere' : priceHtml(ctx, t)}</strong></div>`).join('')}</div>${prices.some(t => t.plus_tva) ? vatGap(ctx) : ''}` : ''}
      ${extras.length ? `<div class="ds-extras" data-reveal><h3>Servicii suplimentare</h3><ul>${extras.map(x => `<li><span>${esc(x.nume)}</span><strong>+${esc(String(x.pret))} lei${x.unitate ? ` / ${esc(x.unitate)}` : ''}</strong></li>`).join('')}</ul></div>` : ''}</div></section>`);
  }

  // Afișare prin regulă: toate celelalte servicii cu pagină; contează doar numele, iconița și adresa lor (link).
  const others = ctx.within('Alte servicii', 'celelalte servicii cu pagină', () =>
    ctx.query('servicii', {where: r => r.pagina && r.id !== svc.id, fields: ['pagina', 'status'], order: (a, b) => a.id - b.id, as: 'link'}));
  if (others.length) parts.push(`<section class="ds-section${tone()}" aria-labelledby="sd-other-h"><div class="ds-wrap"><h2 id="sd-other-h" class="ds-sub-h" data-reveal>Alte servicii</h2>
    <div class="ds-others">${others.map(o => `<a class="ds-card ds-other" href="${esc(ctx.href(`ref:servicii:${o.id}`))}" data-reveal><span class="ds-icon sm">${icon(o.icon ?? 'sparkle', 20)}</span><strong>${esc(o.nume)}</strong>${icon('arrow', 16)}</a>`).join('')}</div></div></section>`);

  parts.push(ctaBand(ctx, {id: 'sd', titlu: 'Programează acest serviciu', intro: 'Sună-ne sau scrie-ne și primești o ofertă personalizată, fără obligații.',
    butoane: [...(contact ? [{href: contact.href, label: 'Contactează-ne'}] : []), {href: 'tel:{telefon}', label: '{telefon}'}]}));
  return parts.join('\n');
}

export const SECTIONS = {
  ...HOME,
  ...INNER,
  hero: (ctx, s, opts) => opts.page.path === '/' ? homeHero(ctx, s, opts) : pageHero(ctx, s, opts)
};
