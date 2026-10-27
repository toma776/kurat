// Contextul urmărit (§3.1, §3.2). Pagina nu citește baza direct: fiecare citire trece pe aici și devine o dependență.
// Regulile de publicare stau într-un singur loc, aici:
//  - pe site există doar ce e publicat;
//  - legăturile sunt doar cele confirmate;
//  - un link spre ceva nepublicat devine text (și lasă o dependență `pending`, ca pagina să se refacă la publicare).
import {createStore} from '../core/store.mjs';
import {entity, pathOf, titleOf, field as fieldDef} from '../registry/entities.mjs';
import {displayValue, phoneIntl, phoneKey} from '../core/content.mjs';

export const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// overlay: {key, id, data} — previzualizarea unei modificări încă nesalvate, din editor (§3.6).
export function createContext(db, {path = '', preview = false, overlay = null} = {}) {
  const store = createStore(db);
  const deps = [], layouts = new Map();
  let target = deps, frame = {component: 'Pagina', reason: ''};

  const dep = (entityKey, id, kind, extra = {}) => target.push({
    entity: entityKey, entity_id: id ?? null, kind,
    component: extra.component ?? frame.component, reason: extra.reason ?? frame.reason,
    scope: extra.scope ?? '', fields: extra.fields ? JSON.stringify([...extra.fields].sort()) : null
  });

  const visible = (key, rec) => {
    if (!rec) return null;
    const e = entity(key);
    if (preview && rec.draft) rec = {...rec, ...rec.draft, _draft: true};
    if (overlay && overlay.key === key && overlay.id === rec.id) rec = {...rec, ...overlay.data, _draft: true};
    if (e.noStatus || rec.status === 'published' || (preview && rec.status === 'draft')) return rec;
    return null;
  };

  // Citire directă. Ce nu e publicat nu există pe site, dar pagina așteaptă publicarea lui.
  function get(key, id, {kind = 'direct', reason} = {}) {
    if (id == null) return null;
    const raw = store.get(key, id), v = visible(key, raw);
    if (!v) { if (raw) dep(key, id, 'pending', {reason: reason ?? 'așteaptă publicarea'}); return null; }
    dep(key, id, kind, {reason});
    return v;
  }

  function one(key, {reason} = {}) {
    const raw = store.singleton(key);
    // încă nu există: pagina trebuie să afle când apare (creare = intrare în lista tipului)
    if (!raw) { dep(key, null, 'query', {fields: ['status'], reason: reason ?? 'înregistrarea unică, încă necreată'}); return null; }
    const rec = visible(key, raw);
    // o înregistrare unică încă în ciornă (de ex. Garanția) nu apare pe site, dar pagina așteaptă publicarea ei
    dep(key, raw.id, rec ? 'direct' : 'pending', {reason});
    return rec;
  }

  // Legăturile unui câmp `refs`: doar cele confirmate, doar spre ținte publicate, în ordinea salvată.
  // as: 'list' (pagina afișează conținutul țintei) sau 'link' (doar numele și adresa).
  function links(key, id, fieldKey, {as = 'list', reason} = {}) {
    const f = fieldDef(key, fieldKey);
    const out = [];
    for (const l of store.links(key, id, fieldKey)) {
      if (l.status !== 'confirmed') continue;
      const raw = store.get(f.target, l.dst_id), v = visible(f.target, raw);
      if (!v) { if (raw) dep(f.target, l.dst_id, 'pending', {reason: reason ?? 'legat, apare după publicare'}); continue; }
      dep(f.target, l.dst_id, as, {reason});
      out.push({...v, _link: {attrs: l.attrs ?? {}, position: l.position}});
    }
    return out;
  }

  // O listă a tuturor înregistrărilor unui tip trebuie să-și declare scope-ul sau câmpurile după care filtrează (§3.2 NOU).
  function query(key, {where = () => true, scope = null, fields = null, order = null, as = 'list', reason} = {}) {
    if (!scope && !fields?.length) throw new Error(`ctx.query('${key}') fără scope și fără fields: ar reface pagina la orice modificare de ${key}.`);
    dep(key, null, 'query', {scope: scope ?? '', fields: scope ? null : fields, reason});
    let rows = store.list(key).map(r => visible(key, r)).filter(Boolean).filter(where);
    if (order) rows = rows.sort(order);
    for (const r of rows) dep(key, r.id, as, {reason});
    return rows;
  }

  // ———————————————————————————— valori legate (jetoane)

  let firmaRec;
  const firma = () => firmaRec ??= one('firma', {reason: 'valori legate'});
  const tokenValue = name => {
    const t = store.tokens().find(x => x.token === name);
    if (!t) return null;
    firma();
    return t;
  };
  const hasTokens = s => /\{[a-z][\w-]*\}/.test(String(s ?? ''));
  // Texte propuse, marcate [[de-validat:notă]] (§1.8): în previzualizare apar cu eticheta „De validat”;
  // pe site, un text nevalidat nu apare deloc.
  const DV = /\[\[de-validat(?::([^\]]*))?\]\]/g;
  const unvalidated = s => typeof s === 'string' && s.includes('[[de-validat');
  const markers = s => s.replace(DV, (m, note) => preview ? `<mark class="de-validat" title="${esc(note ?? 'De validat')}">De validat${note ? `: ${esc(note)}` : ''}</mark>` : '');
  // Text simplu cu jetoane: scăpat de HTML, apoi completat.
  const text = s => {
    if (s == null) return '';
    if (unvalidated(s) && !preview) return '';
    const out = markers(esc(s));
    return hasTokens(out) ? out.replace(/\{([a-z][\w-]*)\}/g, (m, k) => { const t = tokenValue(k); return t ? esc(displayValue(t)) : m; }) : out;
  };

  // ———————————————————————————— linkuri și fișiere

  // Adresa unei destinații: ref:<tip>:<id>, tel:{telefon}, mailto:{email}, https://wa.me/{whatsapp}, ancoră sau adresă externă.
  function href(h, {reason} = {}) {
    if (!h) return null;
    const m = /^ref:(\w+):(\d+)(\?[^#]*)?(#.*)?$/.exec(h);
    if (m) {
      const [, key, id, qs = '', hash = ''] = m;
      const raw = store.get(key, +id), v = visible(key, raw);
      if (!v) { if (raw) dep(key, +id, 'pending', {reason: reason ?? 'link spre o ciornă'}); return null; }
      dep(key, +id, 'link', {reason});
      const p = pathOf(key, v);
      return p ? p + qs + hash : null;
    }
    if (h.includes('{')) {
      return h.replace(/\{([a-z][\w-]*)\}/g, (all, k) => {
        const t = tokenValue(k);
        if (!t) return all;
        if (t.kind === 'phone') return h.startsWith('tel:') ? phoneIntl(t.value) : phoneIntl(t.value).replace('+', '');
        return displayValue(t);
      });
    }
    return h;
  }

  const shortName = (key, rec) => rec.nume_scurt || rec.nume || titleOf(key, rec);

  // {href, label} pentru un element de meniu sau un buton; eticheta implicită vine din țintă (trimitem, nu copiem).
  function link(item, {reason} = {}) {
    const h = item?.href;
    if (!h) return null;
    const m = /^ref:(\w+):(\d+)/.exec(h);
    const url = href(h, {reason});
    if (!url) return null;
    const label = item.label ?? (m ? shortName(m[1], store.get(m[1], +m[2])) : url);
    return {href: url, label, stil: item.stil ?? null};
  }

  // Pagina compusă cu adresa dată (pentru butoane fixe din machetă, de exemplu „Cere o ofertă” → /contact).
  function pageAt(p, {reason} = {}) {
    const rec = store.list('pagini', {where: 'path = ?', params: [p]})[0];
    if (!rec) return null;
    return link({href: `ref:pagini:${rec.id}`}, {reason});
  }

  function media(id, {reason} = {}) {
    if (id == null) return null;
    const m = db.prepare('SELECT id, path, alt, updated_at FROM media WHERE id = ?').get(id);
    if (!m) return null;
    dep('media', m.id, 'media', {reason});
    return {src: `${m.path}?v=${Date.parse(m.updated_at).toString(36)}`, alt: m.alt ?? ''};
  }

  // Text bogat: jetoane, <a data-ref>, <img|video data-media>. Un link spre ceva nepublicat lasă doar textul; un fișier șters dispare.
  function rich(html) {
    if (!html) return '';
    if (unvalidated(html) && !preview) return '';
    let out = markers(String(html))
      .replace(/<a([^>]*?)\sdata-ref="(\w+):(\d+)"([^>]*)>([\s\S]*?)<\/a>/g, (m, a, key, id, b, inner) => {
        const url = href(`ref:${key}:${id}`);
        return url ? `<a${a} href="${esc(url)}"${b}>${inner}</a>` : inner;
      })
      .replace(/<(img|video)([^>]*?)\sdata-media="(\d+)"([^>]*)>/g, (m, tag, a, id, b) => {
        const f = media(+id);
        return f ? `<${tag}${a} src="${esc(f.src)}"${b}>` : '';
      });
    if (hasTokens(out)) out = out.replace(/\{([a-z][\w-]*)\}/g, (m, k) => { const t = tokenValue(k); return t ? esc(displayValue(t)) : m; });
    return out;
  }

  // ———————————————————————————— dovezi: doar ce are sursa confirmată ajunge pe site (§0.4)

  // Starea unei afirmații: 'ok' (sursă confirmată), 'neconfirmat', 'de-validat' (text propus) sau 'lipsa'.
  // Sursa câmpului are prioritate; fără ea, contează sursa înregistrării. Fără nicio sursă: neconfirmat.
  function claim(key, rec, field) {
    const v = rec?.[field];
    if (v == null || v === '' || (Array.isArray(v) && !v.length)) return {state: 'lipsa', value: null};
    if (unvalidated(typeof v === 'string' ? v : JSON.stringify(v))) return {state: 'de-validat', value: v};
    const rows = db.prepare(`SELECT field, certainty, excerpt FROM provenance WHERE entity = ? AND entity_id = ? AND field IN (?, '')`).all(key, rec.id, field);
    const own = rows.filter(r => r.field === field), use = own.length ? own : rows;
    const ok = use.length > 0 && use.every(r => r.certainty === 'confirmed');
    return {state: ok ? 'ok' : 'neconfirmat', value: v, note: use.find(r => r.certainty !== 'confirmed')?.excerpt ?? null};
  }
  // Afișarea unei dovezi după starea ei: pe site doar cele confirmate; în previzualizare și restul, marcate.
  function proof(c, html) {
    if (c.state === 'ok') return html;
    if (!preview || c.state === 'lipsa') return '';
    const label = c.state === 'de-validat' ? 'De validat' : 'Sursă neconfirmată';
    return `<span class="unconfirmed" title="${esc(c.note ?? label)}">${html}<mark class="de-validat">${label}</mark></span>`;
  }
  // Un gol: ce ar trebui să fie aici și lipsește. Doar în previzualizare.
  const gap = (title, detail = '') => preview ? `<div class="gap" role="note"><b>Lipsește: ${esc(title)}</b>${detail ? `<span>${esc(detail)}</span>` : ''}</div>` : '';

  // ———————————————————————————— componente și motive

  function within(component, reason, fn) {
    const prev = frame;
    frame = {component, reason};
    try { return fn(); } finally { frame = prev; }
  }

  // Componentele comune își scriu dependențele o singură dată, sub #layout:<componentă>; pagina are un singur rând spre ea.
  function layout(name, fn) {
    const prevTarget = target, prevFrame = frame, prevFirma = firmaRec;
    const own = [];
    target = own; frame = {component: name, reason: ''}; firmaRec = undefined;
    try { return fn(); } finally {
      target = prevTarget; frame = prevFrame; firmaRec = prevFirma;
      layouts.set(name, own);
      dep('#layout', null, 'layout', {component: name, reason: 'componentă comună'});
    }
  }

  return {
    path, preview, deps, layouts, db,
    get, page: (key, id) => get(key, id, {kind: 'page', reason: 'pagina proprie'}), one, links, query,
    text, rich, href, link, pageAt, media, within, layout, firma, shortName, claim, proof, gap, unvalidated,
    // citiri fără dependență: doar pentru numărători a căror schimbare emite deja un eveniment pe proprietar
    count: (key, id, fieldKey) => store.links(key, id, fieldKey).filter(l => l.status === 'confirmed').length,
    phoneKey
  };
}
