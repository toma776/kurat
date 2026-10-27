// Tema Kurat: markup-ul și stilurile site-ului original kurat.ro (design system Kurat: tokeni, componente lk-*/kh-*),
// cu datele din Brain. Valorile de stil sunt cele din original, preluate din snapshot; datele vin toate prin ctx.
import {esc} from './context.mjs';
import {icon} from './icons.mjs';
import {fmt, lei, jsonLd} from './ui.mjs';

// ———————————————————————————————————————————— stilurile componentelor (valorile din original)

const WRAP = 'max-width: var(--container-max); margin: 0 auto; padding: 0 24px;';
const EYEBROW = 'font-size: 12px; font-weight: 800; letter-spacing: 0.14em; color: var(--brand-strong); text-transform: uppercase; margin-bottom: 12px;';
const H2 = (size = 40, mb = 14) => `font-family: var(--font-display); font-size: ${size}px; line-height: 1.1; letter-spacing: -0.02em; color: var(--text-strong); margin: 0 0 ${mb}px; font-weight: 800;`;
const LEAD = 'font-size: 18px; line-height: 1.55; color: var(--text-body); margin: 0;';
const HERO_BG = 'position: absolute; inset: 0; background: radial-gradient(120% 90% at 85% -10%, var(--blue-100) 0%, transparent 55%), var(--surface-page);';
const CARD = (pad = '24px') => `display: flex; flex-direction: column; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); padding: ${pad}; overflow: hidden;`;
const ICON_BOX = (size, radius, bg = 'var(--brand-tint)', color = 'var(--brand-strong)') =>
  `width: ${size}px; height: ${size}px; flex: none; border-radius: ${radius}; background: ${bg}; color: ${color}; display: flex; align-items: center; justify-content: center;`;
const PILL_CHECK = 'display: inline-flex; align-items: center; gap: 6px; height: 26px; padding: 0 11px; border-radius: var(--radius-pill); background: var(--surface-sunken); color: var(--green-600); font-size: 12.5px; font-weight: 700; white-space: nowrap;';
const SECTION = (extra = '') => `padding: 84px 0;${extra}`;
const BAND = ' background: var(--surface-card); border-top: 1px solid var(--border-subtle); border-bottom: 1px solid var(--border-subtle);';
const INVERSE_GLOW = alpha => `position: absolute; inset: 0; background: radial-gradient(80% 120% at 100% 0%, rgba(15, 105, 245, ${alpha}), transparent 60%);`;

const BTN = {
  brand: (h = 56, fs = 17, px = 28) => `display: inline-flex; align-items: center; justify-content: center; gap: 10px; height: ${h}px; padding: 0 ${px}px; border: none; border-radius: var(--radius-pill); background: var(--brand); color: #fff; font-family: var(--font-body); font-weight: 700; font-size: ${fs}px; cursor: pointer; box-shadow: var(--shadow-brand); text-decoration: none;`,
  outline: (h = 56, fs = 17, px = 26) => `display: inline-flex; align-items: center; gap: 10px; height: ${h}px; padding: 0 ${px}px; border: 1.5px solid var(--border-default); border-radius: var(--radius-pill); background: var(--surface-card); color: var(--text-strong); font-weight: 700; font-size: ${fs}px; cursor: pointer; text-decoration: none;`,
  green: (h = 54, fs = 16, px = 26) => `display: inline-flex; align-items: center; gap: 10px; height: ${h}px; padding: 0 ${px}px; border: none; border-radius: var(--radius-pill); background: var(--green-600); color: #fff; font-weight: 800; font-size: ${fs}px; cursor: pointer; text-decoration: none;`,
  soft: () => 'display: inline-flex; align-items: center; justify-content: center; height: 44px; padding: 0 16px; border: 1px solid var(--border-default); border-radius: var(--radius-pill); background: var(--surface-card); color: var(--brand-strong); font-weight: 700; font-size: 14px; cursor: pointer; text-decoration: none; white-space: nowrap;',
  ghostLight: (h = 52, fs = 16) => `display: inline-flex; align-items: center; gap: 9px; height: ${h}px; padding: 0 22px; border: 1.5px solid rgba(255, 255, 255, 0.24); border-radius: var(--radius-pill); color: #fff; font-weight: 700; font-size: ${fs}px; text-decoration: none;`
};
const CLASS = {brand: 'lk-btn-brand', outline: 'lk-btn-outline', green: 'lk-btn-green', soft: 'lk-btn-soft', ghostLight: 'lk-link'};
const KIND_OF = {'btn-brand': 'brand', 'btn-outline': 'outline', 'btn-green': 'green', 'btn-soft': 'soft', link: 'outline'};

// Un buton din Brain ({href, label, stil}) în stilul original: telefonul cu iconița în stânga, restul cu săgeata în dreapta.
export function button(ctx, item, {kind, size = [56, 17], arrow = true} = {}) {
  const l = ctx.link(item);
  if (!l) return '';
  const k = kind ?? KIND_OF[l.stil] ?? 'brand';
  const isTel = l.href.startsWith('tel:'), isWa = l.href.includes('wa.me');
  const style = BTN[k](...size);
  const label = ctx.text(l.label);
  const left = isTel ? icon('phone', size[0] >= 56 ? 20 : 18) : isWa ? icon('whatsapp', 19) : '';
  const right = !isTel && !isWa && arrow && k !== 'soft' ? icon('arrow', size[0] >= 56 ? 20 : 18) : '';
  const ext = /^https?:/.test(l.href) ? ' target="_blank" rel="noopener"' : '';
  return `<a class="${CLASS[k]}" style="${style}" href="${esc(l.href)}"${ext}>${left} ${label} ${right}</a>`;
}
const buttons = (ctx, items, opts = {}, wrap = 'display: flex; gap: 14px; flex-wrap: wrap;') => {
  const list = (items ?? []).map((b, i) => button(ctx, b, {...opts, kind: opts.kinds?.[i] ?? opts.kind})).filter(Boolean);
  return list.length ? `<div style="${wrap}">${list.join('')}</div>` : '';
};

// Steluțele cu umplere parțială (4,9 din 5), ca în componenta originală.
export function stars(rating, size = 17) {
  if (!rating) return '';
  const r = Number(rating);
  return `<span role="img" aria-label="${String(r).replace('.', ',')} din 5 stele" style="display: inline-flex; gap: 1px; line-height: 0;">${[0, 1, 2, 3, 4].map(i => {
    const pct = Math.max(0, Math.min(100, (r - i) * 100));
    return `<span style="position: relative; display: inline-block; width: ${size}px; height: ${size}px;">${icon('star-empty', size)}<span style="position: absolute; top: 0; left: 0; height: ${size}px; overflow: hidden; width: ${pct}%;">${icon('star', size, 'display: block;')}</span></span>`;
  }).join('')}</span>`;
}

const imgFill = (f, {eager = false, fit = 'cover', extra = ''} = {}) => f
  ? `<img src="${esc(f.src)}" alt="${esc(f.alt)}" style="object-fit: ${fit}; position: absolute; width: 100%; height: 100%; inset: 0;${extra}" ${eager ? 'loading="eager" fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : '';

// Titlul unei secțiuni: etichetă, h2, introducere — cu jetoane și cu cuvântul evidențiat, dacă există.
const titleHtml = (ctx, s) => {
  const t = ctx.text(s.titlu ?? '').replace(/\n/g, '<br>');
  return s.accent ? t.replace(esc(s.accent), `<span style="color: var(--brand);">${esc(s.accent)}</span>`) : t;
};
export function sectionHead(ctx, s, {id, size = 40, center = false, maxw = 680, mb = 44} = {}) {
  if (!s.titlu && !s.eticheta && !s.intro) return '';
  const intro = s.intro ? ctx.text(s.intro).replace(/\bKURAT\b/, '<strong>KURAT</strong>') : '';
  return `<div style="max-width: ${maxw}px; margin: 0 ${center ? 'auto' : '0'} ${mb}px;${center ? ' text-align: center;' : ''}">
    ${s.eticheta ? `<div style="${EYEBROW}">${ctx.text(s.eticheta)}</div>` : ''}${s.titlu ? `<h2${id ? ` id="${id}"` : ''} style="${H2(size, intro ? (size < 40 ? 12 : 14) : 0)}">${titleHtml(ctx, s)}</h2>` : ''}
    ${intro ? `<p style="${LEAD}">${intro}</p>` : ''}</div>`;
}

// ———————————————————————————————————————————— antet, subsol, butonul WhatsApp

const logo = (h = 22, white = false) => `<span style="display: inline-flex; align-items: center; gap: 10px;" aria-hidden="true"><span style="background: var(--brand); display: flex; align-items: center; justify-content: center; flex: none; width: ${white ? 36 : 38}px; height: ${white ? 36 : 38}px; border-radius: ${white ? 10 : 11}px;${white ? '' : ' box-shadow: var(--shadow-brand);'}">${icon('logo-mark', white ? 20 : 21)}</span>${icon('logo-word', h, `display: block; color: ${white ? '#fff' : 'var(--brand)'};`)}</span>`;

export function header(ctx) {
  return ctx.layout('Antet', () => {
    const f = ctx.firma();
    const menu = ctx.query('meniuri', {where: m => m.cheie === 'principal', fields: ['cheie'], reason: 'meniul principal'})[0];
    const items = (menu?.linkuri ?? []).map(i => ctx.link(i)).filter(Boolean);
    const cta = ctx.pageAt('/contact', {reason: 'butonul „Cere o ofertă”'});
    const tel = ctx.href('tel:{telefon}'), phone = ctx.text('{telefon}');
    return `<header class="kh-header" data-header style="background: transparent; backdrop-filter: none; -webkit-backdrop-filter: none; border-bottom: 1px solid transparent;"><div class="kh-inner">
      <a aria-label="${esc(f.nume)} — acasă" class="kh-logo" href="/">${logo(22)}</a>
      <nav aria-label="Principal" class="lk-nav kh-desktop-nav">${items.map(l => `<a class="lk-navlink" style="font-size: 15px; text-decoration: none; color: ${l.href === ctx.path ? 'var(--brand-strong)' : 'var(--text-body)'}; font-weight: 600;"${l.href === ctx.path ? ' aria-current="page"' : ''} href="${esc(l.href)}">${ctx.text(l.label)}</a>`).join('')}</nav>
      <div class="kh-actions"><a class="lk-phone lk-link" style="display: flex; align-items: center; gap: 8px; font-weight: 700; font-size: 15px; color: var(--text-strong); text-decoration: none;" href="${esc(tel)}">${icon('phone', 18)} ${phone} </a>
        ${cta ? `<a class="lk-btn-brand kh-cta" style="display: inline-flex; align-items: center; gap: 8px; height: 44px; padding: 0 20px; border-radius: var(--radius-pill); background: var(--brand); color: #fff; font-weight: 700; font-size: 15px; text-decoration: none; box-shadow: var(--shadow-brand);" href="${esc(cta.href)}"> Cere o ofertă </a>` : ''}
        <button type="button" aria-controls="kh-mobile-menu" aria-label="Meniu" class="kh-burger" aria-expanded="false" data-burger>${icon('menu', 24)}</button></div></div>
      <nav id="kh-mobile-menu" class="kh-mobile-menu" aria-label="Meniu mobil" hidden>${items.map(l => `<a class="kh-mobile-link" style="color: var(--text-strong);" href="${esc(l.href)}">${ctx.text(l.label)}</a>`).join('')}
        <a class="kh-mobile-link" style="color: var(--brand-strong);" href="${esc(tel)}">${phone}</a></nav></header>`;
  });
}

export function footer(ctx) {
  return ctx.layout('Subsol', () => {
    const f = ctx.firma();
    const menus = ctx.query('meniuri', {where: m => m.cheie.startsWith('subsol-'), fields: ['cheie'], order: (a, b) => a.cheie < b.cheie ? 1 : -1, reason: 'coloanele din subsol'});
    const LINK = 'color: var(--neutral-300); text-decoration: none; font-size: 14.5px;';
    const HEAD = 'font-family: var(--font-display); font-weight: 700; color: #fff; font-size: 15px; margin-bottom: 14px;';
    const col = (title, links) => `<div><div style="${HEAD}">${esc(title)}</div><div style="display: flex; flex-direction: column; gap: 10px;">${links.join('')}</div></div>`;
    const menuCols = menus.map(m => col(m.titlu.replace(/^Subsol — /, ''), (m.linkuri ?? []).map(i => ctx.link(i)).filter(Boolean)
      .map(l => `<a class="lk-link" style="${LINK}${l.label === 'Toate serviciile' ? ' font-weight: 700;' : ''}" href="${esc(l.href)}">${ctx.text(l.label)}</a>`)));
    const legal = [f.denumire_legala, f.cui ? `CUI ${f.cui}` : null, f.reg_com].filter(Boolean).map(esc).join(' · ');
    return `<footer style="background: var(--surface-inverse); color: var(--neutral-300); padding: 64px 0 36px;"><div style="${WRAP}">
      <div class="lk-foot" style="display: grid; grid-template-columns: 1.4fr repeat(3, 1fr); gap: 40px; padding-bottom: 44px; border-bottom: 1px solid rgba(255, 255, 255, 0.12);">
        <div><div style="margin-bottom: 16px;"><a aria-label="${esc(f.nume)} — acasă" style="display: inline-flex; text-decoration: none;" href="/">${logo(20, true)}</a></div>
          <p style="font-size: 15px; line-height: 1.6; max-width: 280px; margin: 0 0 18px;"> ${ctx.text(f.slogan)} </p>
          <div style="display: flex; gap: 12px; align-items: center; flex-wrap: wrap;">${f.anpc_sal ? `<a target="_blank" rel="noopener" aria-label="ANPC — Soluționarea Alternativă a Litigiilor" href="${esc(f.anpc_sal)}"><img src="/static/badges/sal.webp" width="500" height="124" alt="ANPC SAL" style="width: 150px; height: auto; border-radius: 6px; display: block;" loading="lazy"></a>` : ''}${f.anpc_sol ? `<a target="_blank" rel="noopener" aria-label="Platforma europeană SOL — Soluționarea Online a Litigiilor" href="${esc(f.anpc_sol)}"><img src="/static/badges/sol.webp" width="500" height="124" alt="ANPC SOL" style="width: 150px; height: auto; border-radius: 6px; display: block;" loading="lazy"></a>` : ''}</div></div>
        ${menuCols.join('')}
        ${col('Contact', [`<a class="lk-link" style="${LINK}" href="${esc(ctx.href('tel:{telefon}'))}">${ctx.text('{telefon}')}</a>`, `<a class="lk-link" style="${LINK}" href="mailto:${esc(f.email)}">${esc(f.email)}</a>`])}
      </div>
      <div style="padding-top: 24px; display: flex; justify-content: space-between; flex-wrap: wrap; gap: 10px; font-size: 13.5px; color: var(--neutral-400);"><span>© ${new Date().getFullYear()} ${esc(f.nume)}. Toate drepturile rezervate.${legal ? ` ${legal}.` : ''}</span></div>
      ${!f.cui || !f.reg_com || !f.denumire_legala ? ctx.gap('datele legale ale firmei', 'Denumirea legală, CUI și Nr. Reg. Com. sunt obligatorii pe un site comercial (Legea 365/2002) și cresc încrederea. Se completează în Date firmă.') : ''}
    </div></footer>`;
  });
}

export function whatsappFab(ctx) {
  return ctx.layout('Butonul WhatsApp', () => {
    const f = ctx.firma();
    return f.whatsapp ? `<a target="_blank" rel="noopener" aria-label="Scrie-ne pe WhatsApp" title="Scrie-ne pe WhatsApp" class="kf-fab" href="${esc(ctx.href('https://wa.me/{whatsapp}'))}">${icon('whatsapp-fab', 32)}</a>` : '';
  });
}

// ———————————————————————————————————————————— secțiunile paginilor compuse

const GREEN_BADGE = 'display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 13px; border-radius: var(--radius-pill); background: var(--success-tint); color: var(--green-600); font-size: 13px; font-weight: 700;';

export const SECTIONS = {
  // Hero: pe homepage cu insignă, rating, cifre și cardul peste imagine; pe celelalte pagini, hero-ul simplu al paginii.
  hero(ctx, s, {page, first}) {
    const pic = ctx.media(s.imagine_id, {reason: 'imaginea din hero'});
    const h = first ? 'h1' : 'h2';
    if (page.path !== '/') return pageHero(ctx, s, {h, pic, page});
    const f = ctx.firma();
    const g = ['google_rating', 'google_recenzii', 'google_url'].map(k => ctx.claim('firma', f, k));
    const google = g.every(c => c.state === 'ok');
    const rating = google ? f.google_rating : f.rating;
    const ratingRaw = rating ? `<span style="display: inline-flex; align-items: center; gap: 8px;">${stars(rating)}<span style="font-size: 13.5px; font-weight: 700; color: var(--text-muted);">${String(rating).replace(',', '.')}/5${google ? ` · <a href="${esc(f.google_url)}" target="_blank" rel="noopener" style="color: inherit;">${fmt(f.google_recenzii)} recenzii Google</a>` : ''}</span></span>` : '';
    // ratingul declarat de Kurat rămâne pe site ca în original; în previzualizare e marcat până are o sursă (profilul Google)
    const ratingHtml = google || !ctx.preview || !ratingRaw ? ratingRaw : ctx.proof(ctx.claim('firma', f, 'rating'), ratingRaw);
    const stat = (k, label, strong) => {
      const c = ctx.claim('firma', f, k);
      if (c.value == null) return '';
      const html = `<div><div style="font-family: var(--font-display); font-size: 30px; font-weight: 800; letter-spacing: -0.02em; color: ${strong ? 'var(--brand-strong)' : 'var(--text-strong)'};">${fmt(c.value)}+</div><div style="font-size: 14px; color: var(--text-muted);">${label}</div></div>`;
      return c.state === 'ok' || !ctx.preview ? html : ctx.proof(c, html);
    };
    return `<section id="top" style="position: relative; overflow: hidden;"><div aria-hidden="true" style="${HERO_BG}"></div>
      <div class="lk-hero-grid" style="position: relative; max-width: var(--container-max); margin: 0 auto; padding: 64px 24px 84px; display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 56px; align-items: center;"><div>
        <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 22px; flex-wrap: wrap;">${s.insigna ? `<span style="${GREEN_BADGE}">${icon('shield', 15)} ${ctx.text(s.insigna)} </span>` : ''}${ratingHtml}</div>
        ${!google ? ctx.gap('rating verificabil', 'Ratingul de 4,9/5 nu are sursă: fără număr de recenzii și fără link. Când adaugi în Date firmă profilul Google, ratingul și numărul de recenzii, apar aici cu link, iar Google îl primește și în datele structurate.') : ''}
        <${h} class="lk-h1" style="font-family: var(--font-display); font-size: 60px; line-height: 1.04; letter-spacing: -0.025em; color: var(--text-strong); margin: 0 0 20px; font-weight: 800;"> ${titleHtml(ctx, s)} </${h}>
        ${s.intro ? `<p style="font-size: 20px; line-height: 1.55; color: var(--text-body); margin: 0 0 32px; max-width: 520px;"> ${ctx.text(s.intro)} </p>` : ''}
        ${buttons(ctx, s.butoane, {size: [56, 17]})}
        <div style="display: flex; gap: 36px; margin-top: 44px; flex-wrap: wrap;">${stat('locuinte_curatate', 'locuințe curățate')}${stat('clienti_multumiti', 'clienți mulțumiți')}${stat('birouri_curatate', 'birouri curățate', true)}</div></div>
      ${pic ? `<div class="lk-hero-photo" style="position: relative;"><div style="position: relative; border-radius: var(--radius-2xl); overflow: hidden; aspect-ratio: 4/5; background: linear-gradient(150deg, var(--blue-100), var(--neutral-100)); border: 1px solid var(--border-subtle); box-shadow: var(--shadow-xl);">${imgFill(pic, {eager: first})}</div>
        ${s.card_titlu ? `<div class="lk-float" style="position: absolute; left: -22px; bottom: 34px; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-lg); padding: 14px 16px; display: flex; align-items: center; gap: 12px;"><span aria-hidden="true" style="${ICON_BOX(42, '12px', 'var(--success-tint)', 'var(--green-600)')}">${icon('shield', 22)}</span><div><div style="font-weight: 800; font-size: 15px; color: var(--text-strong);">${ctx.text(s.card_titlu)}</div>${s.card_text ? `<div style="font-size: 12.5px; color: var(--text-muted);">${ctx.text(s.card_text)}</div>` : ''}</div></div>` : ''}</div>` : ''}
      </div></section>`;
  },

  servicii(ctx, s) {
    const contactFallback = ctx.pageAt('/servicii', {reason: 'cardurile fără pagină proprie trimit la Servicii'});
    const group = (field, title, intro, cols) => {
      const items = ctx.links('sectiuni', s.id, field, {reason: `cardurile „${title}”`});
      if (!items.length) return '';
      return `<div style="margin-top: ${field === 'servicii_companii' ? 0 : 52}px;"><div style="display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 22px;"><h3 style="font-family: var(--font-display); font-size: 24px; font-weight: 800; color: var(--text-strong); margin: 0;">${esc(title)}</h3>${intro ? `<p style="font-size: 15px; color: var(--text-muted); margin: 0;">${ctx.text(intro)}</p>` : ''}</div>
        <div style="display: grid; gap: 22px; align-items: stretch;" class="${items.length >= 4 ? 'lk-svc-4' : 'lk-svc-3'} lk-svc-grid">${items.map(svc => {
          const a = svc._link.attrs ?? {}, n = ctx.count('servicii', svc.id, 'sarcini');
          const pic = ctx.media(a.imagine ?? svc.imagine_id, {reason: 'imaginea cardului'});
          const to = svc.pagina ? ctx.href(`ref:servicii:${svc.id}`) : contactFallback?.href;
          const title = a.titlu ?? svc.nume;
          return `<div class="lk-card" style="${CARD()}"><div style="position: relative; margin: -24px -24px 18px; aspect-ratio: 16 / 10; overflow: hidden; background: var(--surface-sunken);">${imgFill(pic)}</div>
            <div style="display: flex; align-items: center; gap: 12px; margin-bottom: 16px;"><span aria-hidden="true" style="${ICON_BOX(52, '14px')}">${icon(a.icon ?? svc.icon ?? 'sparkle', 26)}</span>${n ? `<span style="${PILL_CHECK}">${icon('check', 14)} ${n} servicii incluse </span>` : ''}</div>
            <h4 style="font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--text-strong); margin: 0 0 8px;">${esc(title)}</h4>
            <p style="font-size: 14.5px; line-height: 1.55; color: var(--text-muted); margin: 0 0 16px; min-height: 44px;">${esc(a.text ?? svc.descriere ?? '')}</p>
            <ul style="list-style: none; margin: 0 0 20px; padding: 0; display: flex; flex-wrap: wrap; gap: 8px; flex: 1; align-content: flex-start;">${(a.puncte ?? []).map(p => `<li style="display: inline-flex; align-items: center; gap: 6px; padding: 6px 11px; border-radius: var(--radius-pill); background: var(--surface-sunken); color: var(--text-body); font-size: 12.5px; font-weight: 600; line-height: 1.2;">${icon('check', 13, 'flex: none; color: var(--green-600);')} ${esc(p)} </li>`).join('')}</ul>
            ${to ? `<div class="lk-svc-cta" style="display: flex; flex-direction: column; gap: 10px; margin-top: auto;"><a class="lk-btn-soft" style="${BTN.soft()}" aria-label="Află mai mult despre ${esc(title)}" href="${esc(to)}"> Află mai mult </a></div>` : ''}</div>`;
        }).join('')}</div></div>`;
    };
    return `<section id="servicii" aria-labelledby="servicii-h" style="${SECTION()}"><div style="${WRAP}">${sectionHead(ctx, s, {id: 'servicii-h'})}
      ${group('servicii_companii', 'Pentru companii', s.intro_companii)}${group('servicii_persoane', 'Pentru persoane fizice', s.intro_persoane)}
      ${s.nota ? `<p style="font-size: 16px; line-height: 1.55; color: var(--text-body); margin: 48px auto 0; max-width: 440px; text-align: center;">${ctx.text(s.nota)}</p>` : ''}
      ${buttons(ctx, s.butoane, {size: [54, 16, 30]}, 'display: flex; justify-content: center; margin-top: 48px; gap: 14px; flex-wrap: wrap;')}</div></section>`;
  },

  'servicii-lista'(ctx, s) {
    const items = ctx.query('servicii', {where: r => r.fel === s.filtru && r.pagina, fields: ['fel', 'pagina', 'status'], order: (a, b) => a.id - b.id, reason: `serviciile „${s.filtru}”`});
    return `<section aria-labelledby="svc-${s.filtru}-h" style="padding: ${s.filtru === 'spatiu' ? '72px 0 0' : '56px 0 80px'};"><div style="${WRAP}">
      <div style="display: flex; align-items: baseline; gap: 14px; flex-wrap: wrap; margin-bottom: 24px;"><h2 id="svc-${s.filtru}-h" style="font-family: var(--font-display); font-size: 28px; font-weight: 800; color: var(--text-strong); margin: 0;">${esc(s.titlu)}</h2>${s.intro ? `<p style="font-size: 15px; color: var(--text-muted); margin: 0;">${ctx.text(s.intro)}</p>` : ''}</div>
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(290px, 1fr)); gap: 22px; align-items: stretch;">${items.map(svc => {
        const from = ctx.query('tarife', {scope: `servicii:${svc.id}`, where: t => t.serviciu_id === svc.id && t.pret != null, reason: `„de la” pentru ${svc.nume}`})
          .reduce((min, t) => min == null || t.pret < min.pret ? t : min, null);
        const n = ctx.count('servicii', svc.id, 'sarcini');
        return `<a class="lk-card" style="${CARD('26px')} text-decoration: none; color: inherit;" href="${esc(ctx.href(`ref:servicii:${svc.id}`))}"><div style="position: relative; margin: -26px -26px 20px; aspect-ratio: 16 / 10; overflow: hidden; background: var(--surface-sunken);">${imgFill(ctx.media(svc.imagine_id))}</div>
          <span aria-hidden="true" style="${ICON_BOX(54, '15px')}">${icon(svc.icon ?? 'sparkle', 28)}</span>
          <h3 style="font-family: var(--font-display); font-size: 20px; font-weight: 700; color: var(--text-strong); margin: 18px 0 8px;">${esc(svc.nume)}</h3>
          <p style="font-size: 14.5px; line-height: 1.6; color: var(--text-muted); margin: 0 0 14px; flex: 1;">${esc(svc.descriere ?? '')}</p>
          ${from ? `<div style="font-size: 14px; color: var(--text-body); margin: 0 0 16px;"><span style="color: var(--text-muted);">de la </span><strong style="color: var(--text-strong); font-family: var(--font-display);">${priceHtml(ctx, {...from, pret_max: null})}</strong></div>` : ''}
          <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: auto;">${n ? `<span style="${PILL_CHECK}">${icon('check', 14)} ${n} servicii incluse </span>` : '<span></span>'}<span style="display: inline-flex; align-items: center; gap: 6px; color: var(--brand-strong); font-weight: 700; font-size: 14px;"> Vezi detalii ${icon('arrow', 16)}</span></div></a>`;
      }).join('')}</div></div></section>`;
  },

  avantaje(ctx, s) {
    const items = ctx.links('sectiuni', s.id, 'avantaje');
    return `<section id="deceka" aria-labelledby="deceka-h" style="${SECTION()}"><div style="${WRAP}">${sectionHead(ctx, s, {id: 'deceka-h'})}
      <ul class="lk-svc-grid" style="display: grid; gap: 22px; align-items: stretch; list-style: none; margin: 0; padding: 0;">${items.map(a => `<li class="lk-card" style="${CARD('24px 24px 0')}">
        <div style="display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-bottom: 16px;"><span style="font-size: 11px; font-weight: 800; letter-spacing: 0.12em; text-transform: uppercase; color: var(--text-muted);">${esc(a.categorie ?? '')}</span><span style="display: inline-flex; align-items: center; gap: 6px; height: 24px; padding: 0 10px; border-radius: var(--radius-pill); background: var(--success-tint); color: var(--green-600); font-size: 12px; font-weight: 800; white-space: nowrap;">${icon('check', 13)} Cu Kurat </span></div>
        <div style="display: flex; align-items: center; gap: 14px; margin-bottom: 14px;"><span aria-hidden="true" style="${ICON_BOX(46, '12px', 'var(--success-tint)', 'var(--green-600)')}">${icon(a.icon ?? 'sparkle', 24)}</span><h3 style="font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--text-strong); margin: 0;">${esc(a.titlu)}</h3></div>
        <p style="font-size: 14.5px; line-height: 1.6; color: var(--text-body); margin: 0 0 18px;">${ctx.text(a.text)}</p>
        ${a.risc_titlu ? `<div style="margin: auto -24px 0; background: var(--surface-sunken); border-top: 1px solid var(--border-subtle); padding: 16px 24px; display: flex; gap: 12px; align-items: flex-start;"><span aria-hidden="true" style="width: 24px; height: 24px; flex: none; margin-top: 1px; border-radius: 50%; background: var(--danger-tint); color: var(--red-600); display: flex; align-items: center; justify-content: center;">${icon('x', 13)}</span><div><div style="font-size: 13px; line-height: 1.4; margin-bottom: 3px;"><span style="font-weight: 800; letter-spacing: 0.04em; text-transform: uppercase; font-size: 11px; color: var(--text-muted);">Fără Kurat: </span><span style="color: var(--text-muted); text-decoration: line-through; font-weight: 600;">${esc(a.risc_titlu)}</span></div><p style="font-size: 13px; line-height: 1.55; color: var(--text-muted); margin: 0;">${ctx.text(a.risc_text)}</p></div></div>` : ''}</li>`).join('')}</ul>
      <div style="display: flex; flex-direction: column; align-items: center; gap: 16px; margin-top: 48px; text-align: center;">${s.nota ? `<p style="font-size: 16px; line-height: 1.55; color: var(--text-body); margin: 0; max-width: 440px;">${ctx.text(s.nota)}</p>` : ''}${buttons(ctx, s.butoane, {size: [54, 16, 30]})}</div></div></section>`;
  },

  valori(ctx, s, {page}) {
    const items = ctx.links('sectiuni', s.id, 'valori');
    const home = page.path === '/';
    return `<section id="valori" aria-labelledby="valori-h" style="padding: ${home ? 84 : 80}px 0;${BAND}"><div style="${WRAP}">${sectionHead(ctx, s, {id: 'valori-h', size: home ? 40 : 36, mb: home ? 44 : 40})}
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 20px;">${items.map(v => `<div style="display: flex; flex-direction: column; gap: 12px; background: var(--surface-page); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); padding: 24px;">
        <span aria-hidden="true" style="width: 48px; height: 48px; border-radius: 50%; background: var(--brand); color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-weight: 800; font-size: 22px; box-shadow: var(--shadow-brand);">${esc(v.litera ?? v.titlu[0])}</span>
        <h3 style="font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--text-strong); margin: 0;">${esc(v.titlu)}</h3><p style="font-size: 14px; line-height: 1.6; color: var(--text-body); margin: 0;">${ctx.text(v.text)}</p></div>`).join('')}</div></div></section>`;
  },

  pasi(ctx, s) {
    const items = ctx.links('sectiuni', s.id, 'pasi');
    const proces = items.filter(p => p.grup === 'proces'), etape = items.filter(p => p.grup === 'etape');
    return `<section id="cum" aria-labelledby="cum-h" style="${SECTION(BAND)}"><div style="${WRAP}">${sectionHead(ctx, s, {id: 'cum-h'})}
      <ol class="lk-4" style="list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(4, 1fr); gap: 24px;">${proces.map((p, i) => `<li style="display: flex; flex-direction: column; gap: 14px;"><div style="display: flex; align-items: center; gap: 14px;"><span aria-hidden="true" style="${ICON_BOX(54, '15px')} font-family: var(--font-display); font-weight: 800; font-size: 20px;">${String(i + 1).padStart(2, '0')}</span></div>
        <h3 style="margin: 0; font-family: var(--font-display); font-size: 21px; font-weight: 700; color: var(--text-strong);">${esc(p.titlu)}</h3><p style="margin: 0; font-size: 15px; line-height: 1.6; color: var(--text-body);">${ctx.text(p.text)}</p></li>`).join('')}</ol>
      ${etape.length ? `<div style="margin-top: 56px;"><h3 id="etape-h" style="font-family: var(--font-display); font-size: 24px; font-weight: 800; color: var(--text-strong); margin: 0 0 22px;">Etapele fiecărei curățenii</h3><div aria-labelledby="etape-h" class="lk-3" style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 22px;">${etape.map((p, i) => `<div style="display: flex; flex-direction: column; gap: 10px; background: var(--surface-sunken); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px;">
        <span style="font-family: var(--font-display); font-size: 14px; font-weight: 800; color: var(--brand-strong); letter-spacing: 0.08em;">Etapa ${i + 1}</span><h4 style="font-family: var(--font-display); font-size: 19px; font-weight: 700; color: var(--text-strong); margin: 0; text-transform: uppercase; letter-spacing: 0.02em;">${esc(p.titlu)}</h4><p style="margin: 0; font-size: 14.5px; line-height: 1.6; color: var(--text-body);">${ctx.text(p.text)}</p></div>`).join('')}</div></div>` : ''}
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
    return `<section id="calculator" aria-labelledby="calc-heading" style="padding: 84px 0; position: relative; overflow: hidden;"><div aria-hidden="true" style="position: absolute; inset: 0; background: radial-gradient(90% 70% at 15% 0%, var(--blue-100) 0%, transparent 50%);"></div>
      <div style="position: relative; ${WRAP}"><div class="lk-2" style="display: grid; grid-template-columns: 0.9fr 1.1fr; gap: 48px; align-items: start;"><div style="position: sticky; top: 96px;">
        ${s.eticheta ? `<div style="${EYEBROW}"> ${ctx.text(s.eticheta)} </div>` : ''}<h2 id="calc-heading" style="font-family: var(--font-display); font-size: 40px; line-height: 1.08; letter-spacing: -0.02em; color: var(--text-strong); margin: 0 0 16px; font-weight: 800;"> ${ctx.text(s.titlu)} </h2>
        ${s.intro ? `<p style="font-size: 18px; line-height: 1.6; color: var(--text-body); margin: 0 0 28px;"> ${ctx.text(s.intro)} </p>` : ''}
        ${s.puncte?.length ? `<ul style="list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: 14px;">${s.puncte.map(p => `<li style="display: flex; align-items: center; gap: 12px; font-size: 15.5px; font-weight: 600; color: var(--text-strong);"><span aria-hidden="true" style="${ICON_BOX(34, '10px', 'var(--success-tint)', 'var(--green-600)')}">${icon('check-bold', 18)}</span> ${esc(p)} </li>`).join('')}</ul>` : ''}
        <div style="margin-top: 30px; display: flex; align-items: center; gap: 12px; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); padding: 14px 16px;"><span aria-hidden="true" style="${ICON_BOX(44, '50%')}">${icon('phone', 22)}</span><div><div style="font-size: 13px; color: var(--text-muted);">Preferi să vorbești cu noi?</div><a class="lk-link" style="font-family: var(--font-display); font-weight: 800; font-size: 19px; color: var(--text-strong); text-decoration: none;" href="${esc(ctx.href('tel:{telefon}'))}">${ctx.text('{telefon}')}</a></div></div></div>
        <form data-calc novalidate style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-2xl); box-shadow: var(--shadow-xl); overflow: hidden;"><script type="application/json">${JSON.stringify(cfg).replace(/</g, '\\u003c')}</script>
          <noscript><p style="padding: 28px;">Calculatorul are nevoie de JavaScript. Ne poți suna la ${ctx.text('{telefon}')}.</p></noscript></form>
      </div></div></section>`;
  },

  garantie(ctx, s) {
    // o singură formulare a garanției: politica din Brain (Garanție), odată publicată și confirmată; până atunci, textul secțiunii
    const g = ctx.one('garantie', {reason: 'politica de garanție'});
    const use = g && ctx.claim('garantie', g, 'rezumat').state === 'ok' && ctx.claim('garantie', g, 'titlu').state === 'ok';
    const title = use ? g.titlu : s.titlu, intro = use ? g.rezumat : s.intro;
    const btn = (s.butoane ?? [])[0] && ctx.link(s.butoane[0]);
    return `<section aria-labelledby="garantie-h" style="padding: 40px 0 84px;"><div style="${WRAP}"><div class="lk-guarantee" style="border-radius: var(--radius-2xl); background: var(--surface-inverse); color: #fff; padding: 56px; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 48px; align-items: center; position: relative; overflow: hidden;"><div aria-hidden="true" style="${INVERSE_GLOW(0.45)}"></div>
      <div style="position: relative;"><span style="display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 14px; border-radius: var(--radius-pill); background: var(--green-600); color: #fff; font-size: 13px; font-weight: 800;">${icon('shield', 15)} ${ctx.text(s.eticheta ?? 'Garanția Kurat')} </span>
        <h2 id="garantie-h" style="font-family: var(--font-display); font-size: 38px; line-height: 1.12; letter-spacing: -0.02em; margin: 18px 0 14px; font-weight: 800; color: #fff;">${ctx.text(title)}</h2>
        ${intro ? `<p style="font-size: 18px; line-height: 1.6; color: var(--neutral-300); margin: 0 0 28px; max-width: 460px;">${ctx.text(intro)}</p>` : ''}
        ${btn ? `<a class="lk-btn-green" style="${BTN.green()}" href="${esc(btn.href)}">${icon('shield', 20)} ${ctx.text(btn.label)} </a>` : ''}</div>
      ${s.puncte?.length ? `<ul style="position: relative; display: grid; gap: 14px; list-style: none; margin: 0; padding: 0;">${s.puncte.map(p => `<li style="display: flex; align-items: center; gap: 14px; background: rgba(255, 255, 255, 0.06); border: 1px solid rgba(255, 255, 255, 0.12); border-radius: var(--radius-md); padding: 16px 18px;">${icon('check-circle', 22, 'flex: none; color: var(--green-500);')}<span style="font-size: 15.5px; font-weight: 600; color: #fff;">${esc(p)}</span></li>`).join('')}</ul>` : ''}
      </div>${use ? '' : ctx.gap('o singură formulare a garanției', 'Garanția apare în trei forme diferite: aici („ne întoarcem și refacem gratuit”), în hero („banii înapoi”) și în întrebările frecvente („48 de ore, refacem sau banii înapoi”). Politica unică e pregătită în Brain, la Garanție; după ce o confirmi și o publici, apare aici.')}</div></section>`;
  },

  testimoniale(ctx, s, {page}) {
    const items = ctx.links('sectiuni', s.id, 'testimoniale');
    const portfolio = page.path !== '/';
    const quote = t => {
      const c = ctx.get('clienti', t.client_id, {reason: 'autorul testimonialului'});
      const who = [t.autor, t.functie].filter(Boolean).map(esc).join(', ');
      const when = t.data ? esc(new Date(t.data).toLocaleDateString('ro-RO', {month: 'long', year: 'numeric'})) : '';
      const sub = `${who || 'Client Kurat'}${when ? ` · ${when}` : ''}`;
      const missing = !t.autor && ctx.preview ? '<span class="gap-inline" style="display: block; font-size: 12px;">lipsește persoana și funcția</span>' : '';
      if (portfolio) {
        const logo = c && ctx.media(c.logo_id, {reason: 'logo-ul clientului'});
        return `<figure style="display: flex; flex-direction: column; gap: 16px; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); padding: 26px; margin: 0;"><div style="display: flex; align-items: center; justify-content: space-between; gap: 16px;"><span style="position: relative; width: 110px; height: 40px; flex: none;">${logo ? imgFill({...logo, alt: c.nume}, {fit: 'contain', extra: ' object-position: left center;'}) : ''}</span>${stars(t.stele ?? 5)}</div>
          <blockquote style="margin: 0; font-size: 15.5px; line-height: 1.65; color: var(--text-strong); font-weight: 500;">“${esc(t.text)}”</blockquote><figcaption style="margin-top: auto; font-size: 13.5px; font-weight: 700; color: var(--text-muted);">${esc(c?.nume ?? '')}${who || when ? ` · <span style="font-weight: 600;">${sub}</span>` : ''}${missing}</figcaption></figure>`;
      }
      const initials = (c?.nume ?? '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
      return `<figure style="display: flex; flex-direction: column; gap: 16px; background: var(--surface-page); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); padding: 24px; margin: 0;">${stars(t.stele ?? 5)}
        <blockquote style="margin: 0; font-size: 16px; line-height: 1.6; color: var(--text-strong); font-weight: 500;">“${esc(t.text)}”</blockquote>
        <figcaption style="display: flex; align-items: center; gap: 12px; margin-top: auto;"><span aria-hidden="true" style="width: 44px; height: 44px; flex: none; border-radius: 50%; color: #fff; display: flex; align-items: center; justify-content: center; font-family: var(--font-display); font-weight: 800; font-size: 15px; background: ${esc(c?.culoare ?? '#0a54d1')};">${esc(initials)}</span><span><span style="display: block; font-weight: 700; color: var(--text-strong); font-size: 15px;">${esc(c?.nume ?? '')}</span><span style="display: block; font-size: 13.5px; color: var(--text-muted);">${sub}</span>${missing}</span></figcaption></figure>`;
    };
    const gapAuthors = items.some(t => !t.autor) ? ctx.gap('cine vorbește în fiecare testimonial', 'Un citat cu nume, funcție și dată e mult mai credibil decât „Client Kurat”. Se completează la Testimoniale → Cine vorbește / Funcția / Data.') : '';
    if (portfolio) return `<section aria-labelledby="pf-rev-h" style="padding: 72px 0 80px;"><div style="${WRAP}">${sectionHead(ctx, s, {id: 'pf-rev-h', size: 36, mb: 40})}
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(min(100%, 330px), 1fr)); gap: 22px;">${items.map(quote).join('')}</div>${gapAuthors}</div></section>`;
    return `<section id="recenzii" aria-labelledby="recenzii-h" style="${SECTION(BAND)}"><div style="${WRAP}">${sectionHead(ctx, s, {id: 'recenzii-h'})}
      <div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 22px;">${items.map(quote).join('')}</div>${gapAuthors}</div></section>`;
  },

  clienti(ctx, s) {
    const items = ctx.links('sectiuni', s.id, 'clienti');
    return `<section aria-labelledby="pf-logos-h" style="padding: 56px 0; background: var(--surface-card); border-bottom: 1px solid var(--border-subtle);"><div style="${WRAP}">
      <h2 id="pf-logos-h" style="text-align: center; font-size: 13px; font-weight: 800; letter-spacing: 0.12em; color: var(--text-muted); text-transform: uppercase; margin: 0 0 32px;">${esc(s.titlu ?? 'Au avut încredere în noi')}</h2>
      <ul style="list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fill, minmax(150px, 1fr)); gap: 22px; align-items: center; justify-items: center;">${items.map(c => {
        const l = ctx.media(c.logo_id);
        return `<li style="position: relative; width: 100%; height: 64px;">${l ? imgFill({...l, alt: `${c.nume} — client Kurat`}, {fit: 'contain', extra: ' filter: grayscale(1); opacity: 0.85;'}) : esc(c.nume)}</li>`;
      }).join('')}</ul></div></section>`;
  },

  faq(ctx, s, {extra}) {
    // un răspuns încă nevalidat nu apare pe site; în previzualizare apare, marcat
    const items = ctx.links('sectiuni', s.id, 'intrebari').filter(q => ctx.preview || !ctx.unvalidated(q.raspuns));
    // datele structurate FAQ o singură dată pe pagină, cu toate întrebările validate
    if (extra.faqAt == null) { extra.faqItems = []; extra.faqAt = extra.push('') - 1; }
    for (const q of items) if (!ctx.unvalidated(q.raspuns) && !extra.faqItems.some(x => x.id === q.id)) extra.faqItems.push(q);
    extra[extra.faqAt] = jsonLd({'@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: extra.faqItems.map(q => ({'@type': 'Question', name: q.intrebare,
      acceptedAnswer: {'@type': 'Answer', text: ctx.rich(q.raspuns).replace(/<[^>]+>/g, '')}}))});
    return `<section aria-labelledby="faq-h" style="${SECTION()}"><div style="max-width: 760px; margin: 0 auto; padding: 0 24px;">${sectionHead(ctx, s, {id: 'faq-h', mb: 36})}
      <div style="display: flex; flex-direction: column; gap: 10px;">${items.map((q, i) => `<details class="k-faq"${i === 0 ? ' open' : ''} style="background: var(--surface-card); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); overflow: hidden; border: 1px solid var(--border-subtle);">
        <summary style="display: flex; align-items: center; gap: 14px; padding: 20px 22px; cursor: pointer; list-style: none;"><span style="flex: 1; font-family: var(--font-display); font-weight: 700; font-size: 17px; color: var(--text-strong);">${esc(q.intrebare)}</span><span aria-hidden="true" class="k-faq-chev" style="flex: none; width: 28px; height: 28px; border-radius: 50%; background: var(--surface-sunken); color: var(--brand-strong); display: flex; align-items: center; justify-content: center; transition: transform 0.2s var(--ease-out);">${icon('chevron', 16)}</span></summary>
        <div style="padding: 0 22px 22px; font-size: 15.5px; line-height: 1.6; color: var(--text-body);">${ctx.rich(q.raspuns).replace(/^<p>|<\/p>$/g, '')}</div></details>`).join('')}</div></div></section>`;
  },

  contact(ctx, s) {
    const f = ctx.firma();
    const addr = [f.adresa, [f.cod_postal, f.oras].filter(Boolean).join(' '), f.tara].filter(Boolean).join(', ');
    const row = (ic, label, value, href) => `<${href ? `a class="lk-link" href="${esc(href)}"` : 'div'} style="display: flex; align-items: ${href ? 'center' : 'flex-start'}; gap: 14px; text-decoration: none; color: var(--text-strong);"><span aria-hidden="true" style="${ICON_BOX(46, '12px')}">${icon(ic, 22)}</span><span><span style="display: block; font-size: 12.5px; color: var(--text-muted);">${label}</span><span style="${href ? 'font-family: var(--font-display); font-weight: 800; font-size: 18px;' : 'font-weight: 700; font-size: 15px; line-height: 1.4; color: var(--text-strong);'}">${value}</span></span></${href ? 'a' : 'div'}>`;
    const calcBtn = (s.butoane ?? [])[0] && ctx.link(s.butoane[0]);
    return `<section id="contact" aria-labelledby="contact-h" style="padding: 0 0 84px;"><div style="${WRAP}"><div class="lk-contact" style="display: grid; grid-template-columns: 1fr 1fr; gap: 24px; align-items: stretch;">
      <div style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-2xl); box-shadow: var(--shadow-sm); padding: 40px;">${s.eticheta ? `<div style="${EYEBROW}">${ctx.text(s.eticheta)}</div>` : ''}
        <h2 id="contact-h" style="font-family: var(--font-display); font-size: 32px; line-height: 1.1; letter-spacing: -0.02em; color: var(--text-strong); margin: 0 0 22px; font-weight: 800;">${ctx.text(s.titlu)}</h2>
        <div style="display: flex; flex-direction: column; gap: 18px;">${row('phone', 'Telefon', ctx.text('{telefon}'), ctx.href('tel:{telefon}'))}${row('mail', 'Email', esc(f.email), `mailto:${f.email}`)}${addr ? row('pin', 'Adresă', esc(addr)) : ''}</div>
        <div style="display: flex; flex-wrap: wrap; gap: 12px; margin-top: 26px;">${f.whatsapp ? `<a target="_blank" rel="noopener" class="lk-btn-green" style="${BTN.green(50, 15, 22)} gap: 9px;" href="${esc(ctx.href('https://wa.me/{whatsapp}'))}">${icon('whatsapp', 19)} Scrie-ne pe WhatsApp </a>` : ''}
          ${calcBtn ? `<a class="lk-btn-brand" style="${BTN.brand(50, 15, 22)} gap: 9px; font-weight: 800;" href="${esc(calcBtn.href)}">${icon('calculator', 19)} ${ctx.text(calcBtn.label)} </a>` : ''}</div></div>
      ${addr ? `<div style="border-radius: var(--radius-2xl); overflow: hidden; min-height: 360px; position: relative; background: var(--surface-sunken); border: 1px solid var(--border-subtle); box-shadow: var(--shadow-sm); line-height: 0;">${mapFrame(f)}</div>` : ''}
    </div></div></section>`;
  },

  harta(ctx) {
    const f = ctx.firma();
    return f.adresa ? `<section aria-label="Locația biroului Kurat" style="padding: 0 0 84px;"><div style="${WRAP}"><div style="border-radius: var(--radius-2xl); overflow: hidden; height: 420px; position: relative; background: var(--surface-sunken); border: 1px solid var(--border-subtle); box-shadow: var(--shadow-sm); line-height: 0;">${mapFrame(f)}</div></div></section>` : '';
  },

  formular(ctx, s) {
    const f = ctx.firma();
    const card = (ic, label, value, href, green) => `<${href ? `a class="lk-card${green ? '' : ' lk-link'}"${href.startsWith('http') ? ' target="_blank" rel="noopener"' : ''} href="${esc(href)}"` : 'div class="lk-card"'} style="display: flex; align-items: ${href ? 'center' : 'flex-start'}; gap: 14px; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); padding: 20px; text-decoration: none; color: var(--text-strong);"><span aria-hidden="true" style="${green ? ICON_BOX(46, '12px', 'var(--success-tint)', 'var(--green-600)') : ICON_BOX(46, '12px')}">${icon(ic, 22)}</span><span><span style="display: block; font-size: 12.5px; color: var(--text-muted);">${label}</span><span style="${href ? 'font-family: var(--font-display); font-weight: 800; font-size: 18px;' : 'font-weight: 700; font-size: 15px; line-height: 1.45; color: var(--text-strong);'}">${value}</span></span></${href ? 'a' : 'div'}>`;
    const addr = [f.adresa, [f.cod_postal, f.oras].filter(Boolean).join(' '), f.tara].filter(Boolean).join(', ');
    const LABEL = 'display: block; font-size: 13.5px; font-weight: 700; color: var(--text-strong); margin-bottom: 7px;';
    const INPUT = 'width: 100%; height: 48px; padding: 0 14px; border: 1.5px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-card); color: var(--text-strong); font-family: var(--font-body); font-size: 15px;';
    const req = '<span aria-hidden="true" style="color: var(--red-600);">*</span>';
    return `<section aria-labelledby="ct-form-h" style="padding: 64px 0;"><div style="${WRAP}"><div class="lk-contact" style="display: grid; grid-template-columns: 0.85fr 1.15fr; gap: 28px; align-items: start;">
      <div style="display: flex; flex-direction: column; gap: 14px;">${card('phone', 'Telefon', ctx.text('{telefon}'), ctx.href('tel:{telefon}'))}${f.whatsapp ? card('whatsapp', 'WhatsApp', 'Scrie-ne pe WhatsApp', ctx.href('https://wa.me/{whatsapp}'), true) : ''}${card('mail', 'Email', esc(f.email), `mailto:${f.email}`)}${addr ? card('pin', 'Adresă', esc(addr)) : ''}</div>
      <div style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-2xl); box-shadow: var(--shadow-sm); padding: 32px;"><h2 id="ct-form-h" style="font-family: var(--font-display); font-size: 24px; font-weight: 800; color: var(--text-strong); margin: 0 0 6px;">${ctx.text(s.titlu)}</h2>
        <p style="font-size: 14.5px; color: var(--text-muted); margin: 0 0 24px;">Completează datele și te contactăm cu o ofertă personalizată.</p>
        <form method="post" action="/api/cerere" data-lead novalidate style="display: flex; flex-direction: column; gap: 18px;"><input type="hidden" name="sursa" value="formular">
          <div><label for="ct-name" style="${LABEL}">Nume ${req}</label><input id="ct-name" name="nume" type="text" autocomplete="name" required maxlength="120" class="lk-input" style="${INPUT}"></div>
          <div><label for="ct-contact" style="${LABEL}">Telefon sau email ${req}</label><input id="ct-contact" name="contact" type="text" autocomplete="tel" required maxlength="160" class="lk-input" style="${INPUT}"></div>
          <div><label for="ct-msg" style="${LABEL}">Mesaj</label><textarea id="ct-msg" name="mesaj" rows="5" maxlength="4000" class="lk-input" style="${INPUT} height: auto; padding: 12px 14px; line-height: 1.5; resize: vertical;"></textarea></div>
          <div><label style="display: flex; align-items: flex-start; gap: 10px; font-size: 14px; line-height: 1.5; color: var(--text-body); cursor: pointer;"><input id="ct-agree" name="acord" value="1" type="checkbox" required style="width: 20px; height: 20px; flex: none; margin-top: 1px; accent-color: var(--brand);"><span>Sunt de acord să fiu contactat în legătură cu cererea mea.</span></label></div>
          <button type="submit" class="lk-btn-brand" style="${BTN.brand(52, 16, 26)}"> Trimite mesajul ${icon('send', 19)}</button><p class="form-msg" role="status" style="margin: 0; font-weight: 700;"></p></form></div>
    </div></div></section>`;
  },

  cifre(ctx) {
    const f = ctx.firma();
    const item = (k, l) => { const c = ctx.claim('firma', f, k); if (c.value == null) return '';
      const h = `<div style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); padding: 30px; text-align: center;"><div style="font-family: var(--font-display); font-size: 40px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-strong);">${fmt(c.value)}+</div><div style="font-size: 15px; color: var(--text-muted); margin-top: 6px;">${l}</div></div>`;
      return c.state === 'ok' || !ctx.preview ? h : ctx.proof(c, h); };
    return `<section aria-label="Cifrele Kurat" style="padding: 64px 0;"><div style="${WRAP}"><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 22px;">${item('locuinte_curatate', 'locuințe curățate')}${item('clienti_multumiti', 'clienți mulțumiți')}${item('birouri_curatate', 'birouri curățate')}</div></div></section>`;
  },

  produse(ctx, s) {
    const items = ctx.query('produse', {fields: ['status', 'nume', 'pret'], order: (a, b) => a.nume.localeCompare(b.nume, 'ro'), reason: 'toate produsele'});
    return `<section style="max-width: var(--container-max); margin: 0 auto; padding: 32px 24px 80px;"><div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-bottom: 20px;"><h2 style="font-family: var(--font-display); font-size: 24px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-strong); margin: 0;">${esc(s.titlu ?? 'Toate produsele')}</h2><span style="font-size: 14px; font-weight: 600; color: var(--text-muted);">${items.length} ${items.length === 1 ? 'produs' : 'produse'}</span></div>
      ${items.length ? `<div class="mg-grid" style="display: grid; grid-template-columns: repeat(4, 1fr); gap: 20px;">${items.map(p => `<a class="lk-card" style="${CARD('18px')} text-decoration: none; color: inherit;" href="${esc(ctx.href(`ref:produse:${p.id}`))}"><div style="position: relative; margin: -18px -18px 14px; aspect-ratio: 1; background: var(--surface-sunken);">${imgFill(ctx.media(p.imagine_id), {fit: 'contain'})}</div><h3 style="font-family: var(--font-display); font-size: 16px; font-weight: 700; color: var(--text-strong); margin: 0 0 6px;">${esc(p.nume)}</h3><div style="font-family: var(--font-display); font-weight: 800; color: var(--brand-strong);">${lei(p.pret)}</div></a>`).join('')}</div>`
        : `<div style="text-align: center; padding: 80px 20px; display: flex; flex-direction: column; align-items: center; gap: 14px;"><span aria-hidden="true" style="width: 64px; height: 64px; border-radius: 50%; background: var(--surface-sunken); color: var(--text-faint); display: flex; align-items: center; justify-content: center;">${icon('search', 28)}</span><div style="font-family: var(--font-display); font-size: 20px; font-weight: 800; color: var(--text-strong);">Niciun produs găsit</div><p style="font-size: 15px; color: var(--text-muted); margin: 0;">Momentan nu sunt produse disponibile. Revino curând.</p></div>`}</section>`;
  },

  text(ctx, s, {page}) {
    // povestea (Despre noi) și benzile de final (CTA) din paginile interioare
    if (s.butoane?.some(b => b.href?.startsWith('tel:'))) return ctaBand(ctx, {...s, intro: s.intro ?? (s.continut ?? '').replace(/<[^>]+>/g, '').trim()}, {page});
    const paras = (s.continut ?? '').match(/<p>[\s\S]*?<\/p>/g) ?? [];
    const link = (s.butoane ?? [])[0] && ctx.link(s.butoane[0]);
    return `<section aria-labelledby="ab-story-h" style="padding: 80px 0;${BAND}"><div style="max-width: 820px; margin: 0 auto; padding: 0 24px;"><h2 id="ab-story-h" style="font-family: var(--font-display); font-size: 34px; line-height: 1.1; letter-spacing: -0.02em; color: var(--text-strong); margin: 0 0 24px; font-weight: 800;">${ctx.text(s.titlu)}</h2>
      <div style="display: flex; flex-direction: column; gap: 18px;">${paras.map(p => `<p style="font-size: 17.5px; line-height: 1.7; color: var(--text-body); margin: 0;">${ctx.rich(p).replace(/^<p>|<\/p>$/g, '')}</p>`).join('')}</div>
      ${link ? `<a target="_blank" rel="noopener" class="lk-link" style="display: inline-flex; align-items: center; gap: 9px; margin-top: 28px; font-weight: 700; font-size: 16px; color: var(--brand-strong); text-decoration: none;" href="${esc(link.href)}">${icon('external', 19)} ${ctx.text(link.label)} </a>` : ''}</div></section>`;
  }
};

const mapFrame = f => `<iframe title="Hartă — sediul ${esc(f.nume)}, ${esc(f.adresa)}, ${esc(f.oras ?? '')}" loading="lazy" referrerpolicy="no-referrer-when-downgrade" style="border: 0; position: absolute; inset: 0; width: 100%; height: 100%; display: block;" src="https://maps.google.com/maps?width=100%25&amp;height=100%25&amp;hl=ro&amp;q=${encodeURIComponent(`${f.adresa} ${f.oras ?? ''}`)}&amp;t=&amp;z=14&amp;ie=UTF8&amp;iwloc=B&amp;output=embed"></iframe>`;

// Hero-ul paginilor interioare (Servicii, Despre noi, Portofoliu, Contact, Magazin), ca în original.
function pageHero(ctx, s, {h, pic, page}) {
  const H1 = `font-family: var(--font-display); font-size: ${page.path === '/shop' ? 50 : 48}px; line-height: 1.06; letter-spacing: -0.025em; color: var(--text-strong); margin: 0 0 ${page.path === '/despre-noi' ? 18 : 16}px; font-weight: 800;`;
  const intro = s.intro ? `<p style="font-size: 19px; line-height: ${page.path === '/despre-noi' ? 1.6 : 1.55}; color: var(--text-body); margin: 0 0 ${s.butoane?.length || page.path === '/shop' ? 28 : 0}px; max-width: 560px;">${ctx.text(s.intro)}</p>` : '';
  const btns = buttons(ctx, s.butoane, {size: [52, 16, 26], arrow: true});
  if (page.path === '/portofoliu') {
    const f = ctx.firma();
    const stat = (k, l) => { const c = ctx.claim('firma', f, k); return c.value == null ? '' : `<div><div style="font-family: var(--font-display); font-size: 30px; font-weight: 800; letter-spacing: -0.02em; color: var(--text-strong);">${fmt(c.value)}+</div><div style="font-size: 14px; color: var(--text-muted);">${l}</div></div>`; };
    return `<section aria-labelledby="pf-h" style="position: relative; overflow: hidden; border-bottom: 1px solid var(--border-subtle);"><div aria-hidden="true" style="${HERO_BG}"></div><div style="position: relative; max-width: var(--container-max); margin: 0 auto; padding: 64px 24px 56px;"><div style="max-width: 760px;">
      ${s.eticheta ? `<div style="${EYEBROW}">${ctx.text(s.eticheta)}</div>` : ''}<${h} id="pf-h" style="${H1}">${titleHtml(ctx, s)}</${h}>${intro.replace('margin: 0 0 0px', 'margin: 0 0 32px')}
      <div style="display: flex; gap: 36px; flex-wrap: wrap;">${stat('locuinte_curatate', 'locuințe curățate')}${stat('clienti_multumiti', 'clienți mulțumiți')}${stat('birouri_curatate', 'birouri curățate')}</div></div></div></section>`;
  }
  if (pic && page.path === '/shop') {
    return `<section style="position: relative; overflow: hidden; border-bottom: 1px solid var(--border-subtle);"><div aria-hidden="true" style="position: absolute; inset: 0; background: radial-gradient(110% 90% at 88% -20%, var(--blue-100) 0%, transparent 55%), var(--surface-card);"></div>
      <div class="mg-hero" style="position: relative; max-width: var(--container-max); margin: 0 auto; padding: 52px 24px 56px; display: grid; grid-template-columns: 1.1fr 0.9fr; gap: 48px; align-items: center;"><div>
        ${s.eticheta ? `<span style="display: inline-flex; align-items: center; gap: 7px; height: 30px; padding: 0 13px; border-radius: var(--radius-pill); background: var(--brand-tint); color: var(--brand-strong); font-size: 13px; font-weight: 800; letter-spacing: 0.02em;">${icon('spark', 15)}${ctx.text(s.eticheta)}</span>` : ''}
        <${h} class="mg-h1" style="${H1.replace('margin: 0 0 16px', 'margin: 18px 0 16px')}">${titleHtml(ctx, s)}</${h}>${intro}
        ${s.puncte?.length ? `<div style="display: flex; gap: 22px; flex-wrap: wrap;">${s.puncte.map((p, i) => `<div style="display: flex; align-items: center; gap: 10px; font-size: 14.5px; font-weight: 600; color: var(--text-strong);"><span aria-hidden="true" style="${i ? ICON_BOX(32, '9px') : ICON_BOX(32, '9px', 'var(--success-tint)', 'var(--green-600)')}">${icon(i ? 'shield' : 'truck', 17)}</span>${esc(p)}</div>`).join('')}</div>` : ''}</div>
      <div class="mg-hero-art" style="position: relative; aspect-ratio: 1454 / 1082; border-radius: var(--radius-2xl); background: linear-gradient(150deg, var(--blue-100), var(--neutral-100)); border: 1px solid var(--border-subtle); box-shadow: var(--shadow-xl); overflow: hidden;">${imgFill(pic, {eager: true})}</div></div></section>`;
  }
  if (pic) {
    return `<section aria-labelledby="ab-h" style="position: relative; overflow: hidden;"><div aria-hidden="true" style="${HERO_BG}"></div><div class="lk-hero-grid" style="position: relative; max-width: var(--container-max); margin: 0 auto; padding: 64px 24px 72px; display: grid; grid-template-columns: 1.05fr 0.95fr; gap: 56px; align-items: center;"><div>
      ${s.eticheta ? `<div style="${EYEBROW}">${ctx.text(s.eticheta)}</div>` : ''}<${h} id="ab-h" style="${H1}">${titleHtml(ctx, s)}</${h}>${intro.replace('max-width: 560px', 'max-width: 520px')}${btns}</div>
      <div style="position: relative;"><img src="${esc(pic.src)}" alt="${esc(pic.alt)}" style="width: 100%; height: auto; border-radius: var(--radius-2xl); border: 1px solid var(--border-subtle); box-shadow: var(--shadow-xl); display: block;" loading="eager" fetchpriority="high"></div></div></section>`;
  }
  return `<section aria-labelledby="pg-h" style="position: relative; overflow: hidden; border-bottom: 1px solid var(--border-subtle);"><div aria-hidden="true" style="${HERO_BG}"></div><div style="position: relative; max-width: var(--container-max); margin: 0 auto; padding: 64px 24px ${btns ? 56 : 48}px;"><div style="max-width: 720px;">
    ${s.eticheta ? `<div style="${EYEBROW}">${ctx.text(s.eticheta)}</div>` : ''}<${h} id="pg-h" style="${H1}">${titleHtml(ctx, s)}</${h}>${intro}${btns}</div></div></section>`;
}

// Banda închisă la culoare de la finalul paginilor (Despre noi, Portofoliu, Servicii, pagina unui serviciu).
export function ctaBand(ctx, s, {page = {path: ''}, maxw = null} = {}) {
  const narrow = maxw ?? (page.path.startsWith('/servicii/') ? 1000 : null);
  const btns = (s.butoane ?? []).map(b => ctx.link(b)).filter(Boolean);
  const btnHtml = btns.map(l => l.href.startsWith('tel:')
    ? `<a class="lk-link" style="${BTN.ghostLight(narrow ? 52 : 54)}" href="${esc(l.href)}">${icon('phone', 18)} ${ctx.text(l.label)} </a>`
    : `<a class="lk-btn-brand" style="display: inline-flex; align-items: center; gap: 10px; height: ${narrow ? 52 : 54}px; padding: 0 ${narrow ? 24 : 26}px; border-radius: var(--radius-pill); background: var(--brand); color: #fff; font-weight: 800; font-size: 16px; text-decoration: none; box-shadow: var(--shadow-brand);" href="${esc(l.href)}">${narrow ? ctx.text(l.label) : ` ${ctx.text(l.label)} ${icon('arrow', 18)}`}</a>`).join('');
  // spațiul de deasupra: după o secțiune cu fundal propriu (Despre noi, după valori) banda are aer deasupra; altfel stă lipită de grila anterioară
  const pad = narrow ? '64px 0 84px' : page.path === '/despre-noi' ? '72px 0 84px' : '0 0 84px';
  return `<section aria-labelledby="cta-${s.id ?? 'band'}" style="padding: ${pad};"><div style="${narrow ? `max-width: ${narrow}px; margin: 0 auto; padding: 0 24px;` : WRAP}"><div class="lk-cta-band" style="border-radius: var(--radius-2xl); background: var(--surface-inverse); color: #fff; padding: ${narrow ? '44px 48px' : '48px 56px'}; display: flex; align-items: center; justify-content: space-between; gap: ${narrow ? 28 : 32}px; flex-wrap: wrap; position: relative; overflow: hidden;"><div aria-hidden="true" style="${INVERSE_GLOW(0.4)}"></div>
    <div style="position: relative; max-width: ${narrow ? 520 : 560}px;"><h2 id="cta-${s.id ?? 'band'}" style="font-family: var(--font-display); font-size: ${narrow ? 27 : 30}px; line-height: 1.14; letter-spacing: -0.02em; margin: 0 0 12px; font-weight: 800; color: #fff;">${ctx.text(s.titlu)}</h2>${s.intro ? `<p style="font-size: ${narrow ? 16 : 17}px; line-height: 1.6; color: var(--neutral-300); margin: 0;">${ctx.text(s.intro)}</p>` : ''}</div>
    <div style="position: relative; display: flex; align-items: center; gap: 14px; flex-wrap: wrap;">${btnHtml}</div></div></div></section>`;
}

// ———————————————————————————————————————————— prețurile (TVA inclus pentru persoane fizice, din cota confirmată)

export function priceHtml(ctx, t) {
  const net = t.pret_max ? `${fmt(t.pret)}–${lei(t.pret_max)}` : lei(t.pret);
  if (!t.plus_tva) return net;
  const c = ctx.claim('firma', ctx.firma(), 'cota_tva');
  if (c.state !== 'ok') return `${net} + TVA`;
  const gross = v => Math.round(v * (1 + Number(c.value) / 100));
  return `${t.pret_max ? `${fmt(gross(t.pret))}–${lei(gross(t.pret_max))}` : lei(gross(t.pret))} <small class="vat">TVA inclus</small><span class="net">${net} + TVA pentru firme</span>`;
}
export const vatGap = ctx => ctx.claim('firma', ctx.firma(), 'cota_tva').state === 'ok' ? ''
  : ctx.gap('prețul final pentru persoane fizice', 'Persoanele fizice trebuie să vadă prețul cu TVA inclus. Prețul se calculează singur din cota TVA din Date firmă, după ce e confirmată în Surse; până atunci rămâne „+ TVA”.');

// ———————————————————————————————————————————— pagina unui serviciu, ca în original

export function servicePageBody(ctx, svc) {
  const hub = ctx.pageAt('/servicii', {reason: 'firul de navigare'});
  const contact = ctx.pageAt('/contact', {reason: 'butonul „Cere o ofertă”'});
  const pic = ctx.media(svc.imagine_id, {reason: 'imaginea serviciului'});
  const W = 'max-width: 1000px; margin: 0 auto; padding: 0 24px;';
  const H2S = (mb = 28) => `font-family: var(--font-display); font-size: 30px; line-height: 1.1; letter-spacing: -0.02em; color: var(--text-strong); margin: 0 0 ${mb}px; font-weight: 800;`;
  const parts = [];
  parts.push(`<section aria-labelledby="sd-h" style="position: relative; overflow: hidden; border-bottom: 1px solid var(--border-subtle);"><div aria-hidden="true" style="${HERO_BG}"></div><div style="position: relative; max-width: var(--container-max); margin: 0 auto; padding: 40px 24px 56px;">
    ${hub ? `<nav aria-label="Breadcrumb" style="margin-bottom: 20px;"><ol style="list-style: none; margin: 0; padding: 0; display: flex; align-items: center; gap: 8px; font-size: 14px; font-weight: 600; color: var(--text-muted);"><li><a class="lk-link" style="color: var(--text-muted); text-decoration: none;" href="${esc(hub.href)}">${ctx.text(hub.label)}</a></li><li aria-hidden="true">/</li><li><span aria-current="page" style="color: var(--text-strong);">${esc(svc.nume)}</span></li></ol></nav>` : ''}
    <div class="sd-hero-split"><div><div style="display: flex; align-items: flex-start; gap: 18px; flex-wrap: wrap; max-width: 760px;"><span aria-hidden="true" style="${ICON_BOX(60, '16px')}">${icon(svc.icon ?? 'sparkle', 30)}</span><div style="flex: 1; min-width: 260px;">
      <h1 id="sd-h" style="font-family: var(--font-display); font-size: 40px; line-height: 1.08; letter-spacing: -0.02em; color: var(--text-strong); margin: 0 0 12px; font-weight: 800;">${esc(svc.nume)}</h1>${svc.descriere ? `<p style="font-size: 18px; line-height: 1.55; color: var(--text-body); margin: 0;">${ctx.text(svc.descriere)}</p>` : ''}</div></div>
      <div style="display: flex; gap: 14px; flex-wrap: wrap; margin-top: 28px;">${contact ? `<a class="lk-btn-brand" style="${BTN.brand(52, 16, 26)}" href="${esc(contact.href)}"> Cere o ofertă ${icon('arrow', 18)}</a>` : ''}<a class="lk-btn-outline" style="${BTN.outline(52, 16, 24)}" href="${esc(ctx.href('tel:{telefon}'))}">${icon('phone', 18)} ${ctx.text('{telefon}')} </a></div>
      ${svc.acopera?.length ? `<div style="display: flex; flex-wrap: wrap; gap: 8px; align-items: center; margin-top: 24px;"><span style="font-size: 13px; font-weight: 700; color: var(--text-muted);">Acoperim:</span>${svc.acopera.map(a => `<span style="display: inline-flex; align-items: center; height: 30px; padding: 0 12px; border-radius: var(--radius-pill); background: var(--surface-card); border: 1px solid var(--border-subtle); font-size: 13px; font-weight: 700; color: var(--text-strong);">${esc(a)}</span>`).join('')}</div>` : ''}</div>
      ${pic ? `<div class="sd-hero-photo" style="position: relative; aspect-ratio: 4 / 3; border-radius: var(--radius-2xl); overflow: hidden; border: 1px solid var(--border-subtle); box-shadow: var(--shadow-xl);">${imgFill(pic, {eager: true})}</div>` : ''}</div></div></section>`);

  const tasks = ctx.within('Ce includem', 'operațiunile serviciului', () => ctx.links('servicii', svc.id, 'sarcini'));
  if (tasks.length) {
    const groups = [];
    for (const t of tasks) { const g = t._link.attrs?.grup ?? ''; (groups.find(x => x.g === g) ?? groups[groups.push({g, items: []}) - 1]).items.push(t); }
    const li = t => `<li style="display: flex; gap: 12px; font-size: 17px; line-height: 1.55; color: var(--text-body);">${icon('check', 20, 'flex: none; margin-top: 3px; color: var(--green-600);')}<span>${esc(t.text)}</span></li>`;
    parts.push(`<section aria-labelledby="sd-include-h" style="padding: 64px 0 0;"><div style="${W}"><h2 id="sd-include-h" style="${H2S()}">Ce includem</h2>${groups.map(g => `<div style="margin-top: ${g.g ? 28 : 0}px;">${g.g ? `<h3 style="font-family: var(--font-display); font-size: 19px; font-weight: 800; color: var(--text-strong); margin: 0 0 14px;">${esc(g.g)}</h3>` : ''}
      <ul style="list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(300px, 1fr)); gap: 12px 28px;">${g.items.map(li).join('')}</ul></div>`).join('')}</div></section>`);
  }

  const prices = ctx.within('Prețuri orientative', 'tarifele serviciului', () =>
    ctx.query('tarife', {scope: `servicii:${svc.id}`, where: t => t.serviciu_id === svc.id, order: (a, b) => (a.ordine ?? 0) - (b.ordine ?? 0)}));
  const extras = ctx.within('Servicii suplimentare', 'extra la serviciu', () => ctx.links('servicii', svc.id, 'extra'));
  if (prices.length || extras.length) {
    parts.push(`<section aria-labelledby="sd-price-h" style="padding: 64px 0 0;"><div style="${W}"><h2 id="sd-price-h" style="${H2S(8)}">Prețuri orientative</h2><p style="font-size: 15px; color: var(--text-muted); margin: 0 0 24px;">Oferta finală se confirmă după o scurtă evaluare a spațiului.</p>
      ${prices.length ? `<div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(200px, 1fr)); gap: 16px;">${prices.map(t => `<div style="background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); box-shadow: var(--shadow-xs); padding: 22px;"><div style="font-size: 14px; font-weight: 700; color: var(--text-muted); margin-bottom: 8px;">${esc(t.eticheta)}</div><div style="font-family: var(--font-display); font-size: 22px; font-weight: 800; color: var(--text-strong);">${t.la_cerere ? 'La cerere' : priceHtml(ctx, t)}</div></div>`).join('')}</div>${prices.some(t => t.plus_tva) ? vatGap(ctx) : ''}` : ''}
      ${extras.length ? `<div style="margin-top: 26px; background: var(--surface-sunken); border: 1px solid var(--border-subtle); border-radius: var(--radius-lg); padding: 24px;"><div style="font-size: 12px; font-weight: 800; letter-spacing: 0.1em; color: var(--text-muted); text-transform: uppercase; margin-bottom: 14px;">Servicii suplimentare</div><ul style="list-style: none; margin: 0; padding: 0; display: grid; grid-template-columns: repeat(auto-fit, minmax(280px, 1fr)); gap: 10px 28px;">${extras.map(x => `<li style="display: flex; align-items: center; justify-content: space-between; gap: 16px; font-size: 14.5px; color: var(--text-body); border-bottom: 1px solid var(--border-subtle); padding-bottom: 8px;"><span>${esc(x.nume)}</span><strong style="color: var(--brand-strong); white-space: nowrap; font-family: var(--font-display);">+${lei(x.pret)}${x.unitate ? ` / ${esc(x.unitate)}` : ''}</strong></li>`).join('')}</ul></div>` : ''}</div></section>`);
  }

  // Afișare prin regulă: toate celelalte servicii cu pagină; contează doar numele, iconița și adresa lor (link).
  const others = ctx.within('Alte servicii', 'celelalte servicii cu pagină', () =>
    ctx.query('servicii', {where: r => r.pagina && r.id !== svc.id, fields: ['pagina', 'status'], order: (a, b) => a.id - b.id, as: 'link'}));
  if (others.length) parts.push(`<section aria-labelledby="sd-other-h" style="padding: 64px 0 0;"><div style="${W}"><h2 id="sd-other-h" style="font-family: var(--font-display); font-size: 24px; font-weight: 800; color: var(--text-strong); margin: 0 0 22px;">Alte servicii</h2><div style="display: grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 16px;">${others.map(o =>
    `<a class="lk-card" style="display: flex; align-items: center; gap: 14px; background: var(--surface-card); border: 1px solid var(--border-subtle); border-radius: var(--radius-md); box-shadow: var(--shadow-xs); padding: 16px; text-decoration: none; color: inherit;" href="${esc(ctx.href(`ref:servicii:${o.id}`))}"><span aria-hidden="true" style="${ICON_BOX(42, '11px')}">${icon(o.icon ?? 'sparkle', 22)}</span><span style="font-weight: 700; font-size: 14.5px; color: var(--text-strong); line-height: 1.3;">${esc(o.nume)}</span></a>`).join('')}</div></div></section>`);

  parts.push(ctaBand(ctx, {id: 'sd', titlu: 'Programează acest serviciu', intro: 'Sună-ne sau scrie-ne și primești o ofertă personalizată, fără obligații.',
    butoane: [...(contact ? [{href: contact.href, label: 'Contactează-ne'}] : []), {href: 'tel:{telefon}', label: '{telefon}'}]}, {maxw: 1000}));
  return parts.join('\n');
}
