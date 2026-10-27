// Panourile /manage, randate pe server la fiecare cerere (fără cache), deci arată mereu starea curentă (§3.1).
import fs from 'node:fs';
import {createStore} from '../core/store.mjs';
import {ENTITIES, CATEGORIES, entity, hasEntity, titleOf, pathOf, RELATION_TYPES, inverseRelations} from '../registry/entities.mjs';
import {can, ROLES} from '../auth/auth.mjs';
import {whereUsed, pageCounts} from '../core/whereused.mjs';
import {neighbors, LAYERS} from '../core/graph.mjs';
import {inferredGroups, inferredCount} from '../core/inferred.mjs';
import {todo} from '../core/todo.mjs';
import {syncStatus} from '../core/sync.mjs';
import {sha1, fold} from '../core/util.mjs';
import {findDuplicates} from '../core/duplicates.mjs';
import {validationState, validationSummary} from '../core/validations.mjs';
import {listBackups, AUTO_EVERY_HOURS} from '../core/backup.mjs';
import {icon as siteIcon} from '../site/icons.mjs';

const esc = s => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const asset = name => { try { return `/manage/static/${name}?v=${sha1(fs.readFileSync(new URL(`./static/${name}`, import.meta.url))).slice(0, 10)}`; } catch { return `/manage/static/${name}`; } };
const CSS = asset('manage.css'), JS = asset('manage.js'), MAP = asset('map.js');
const STATUS = {published: ['Publicat', 'ok'], draft: ['Ciornă', 'warn'], archived: ['Arhivat', 'mute']};
const CERT = {confirmed: ['confirmată', 'ok'], inferred: ['dedusă', 'warn'], unverified: ['neverificată', 'bad'], unrecoverable: ['nerecuperabilă', 'bad']};
const badge = ([label, cls]) => `<span class="badge ${cls}">${esc(label)}</span>`;
const statusBadge = (rec, e) => e.noStatus ? '' : badge(STATUS[rec.status] ?? [rec.status, '']) + (rec.draft ? ' ' + badge(['Ciornă nepublicată', 'warn']) : '');
const fmtDate = s => s ? new Date(s).toLocaleString('ro-RO', {dateStyle: 'medium', timeStyle: 'short'}) : '';
const entUrl = (key, id, tab = 'prezentare') => `/manage/entitati/${key}/${id}/${tab}/`;
const KMARK = siteIcon('logo-mark', 22);
const json = obj => `<script type="application/json" id="page-data">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;

// ———————————————————————————————————————————— iconițe (linie, 24×24)

const ICON_PATHS = {
  dashboard: 'M4 13h6V4H4zM14 20h6v-9h-6zM14 4v4h6V4zM4 20h6v-4H4z',
  layers: 'M12 3 3 8l9 5 9-5-9-5zM3 13l9 5 9-5M3 17.5l9 5 9-5',
  network: 'M6 6a2 2 0 1 0 0 .01M18 6a2 2 0 1 0 0 .01M12 18a2 2 0 1 0 0 .01M7.6 7.2l3.2 9M16.4 7.2l-3.2 9M8 6h8',
  history: 'M12 8v4l3 2M3.5 12a8.5 8.5 0 1 0 2.5-6M3 4v4h4',
  images: 'M4 5h16v14H4zM4 15l4-4 4 4 3-3 5 5M15.5 9a1 1 0 1 0 0 .01',
  source: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5M9 13h6M9 17h4',
  'link-check': 'M10 14a4 4 0 0 0 5.6 0l3-3a4 4 0 0 0-5.6-5.6l-1 1M14 10a4 4 0 0 0-5.6 0l-3 3a4 4 0 0 0 5.6 5.6l1-1',
  inbox: 'M4 13h4l2 3h4l2-3h4M5 5h14l1 8v6H4v-6z',
  users: 'M9 11a4 4 0 1 0 0-.01M2 21a7 7 0 0 1 14 0M17 3.5a4 4 0 0 1 0 7.5M22 21a7 7 0 0 0-4-6.3',
  settings: 'M12 15a3 3 0 1 0 0-.01M19.4 15a1.7 1.7 0 0 0 .3 1.8l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.8-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.8.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.8 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.8l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.8.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.8-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.8V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  external: 'M14 4h6v6M20 4l-9 9M18 14v5a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h5',
  building: 'M4 21V5a1 1 0 0 1 1-1h9a1 1 0 0 1 1 1v16M15 9h4a1 1 0 0 1 1 1v11M3 21h18M8 8h3M8 12h3M8 16h3',
  briefcase: 'M4 7h16v12H4zM9 7V5a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2M4 12h16',
  sparkles: 'M12 3l1.8 4.7L18.5 9.5 13.8 11.3 12 16l-1.8-4.7L5.5 9.5l4.7-1.8zM19 15l.7 1.8 1.8.7-1.8.7L19 20l-.7-1.8-1.8-.7 1.8-.7z',
  tag: 'M3 12V4a1 1 0 0 1 1-1h8l9 9-9 9zM8 8a1 1 0 1 0 0 .01',
  check: 'M5 12l5 5 9-10',
  'list-ordered': 'M10 6h11M10 12h11M10 18h11M4 6h1v4M4 10h2M6 18H4c0-1 2-2 2-3s-1-1.5-2-1',
  calculator: 'M6 2h12a1 1 0 0 1 1 1v18a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V3a1 1 0 0 1 1-1zM8 6h8v4H8zM8 14h.01M12 14h.01M16 14h.01M8 18h.01M12 18h.01M16 18h.01',
  plus: 'M12 5v14M5 12h14',
  star: 'M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z',
  quote: 'M7 7h4v4c0 3-1.5 5-4 6M15 7h4v4c0 3-1.5 5-4 6',
  shield: 'M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6z',
  'badge-check': 'M12 2l2.4 1.8 3-.2.9 2.8 2.5 1.7-1 2.9 1 2.8-2.5 1.7-.9 2.9-3-.3L12 22l-2.4-1.8-3 .3-.9-2.9-2.5-1.7 1-2.8-1-2.9L5.7 6.4l.9-2.8 3 .2zM8.5 12l2.5 2.5 4.5-5',
  file: 'M14 3H6a1 1 0 0 0-1 1v16a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V8zM14 3v5h5',
  'thumbs-up': 'M7 10v11M3 11h4v10H3zM7 11l4-8a2 2 0 0 1 3 2l-1 5h6a2 2 0 0 1 2 2.3l-1.3 7A2 2 0 0 1 17.7 21H7',
  help: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18zM9.5 9a2.5 2.5 0 0 1 5 .5c0 1.5-2.5 2-2.5 3.5M12 17h.01',
  layout: 'M4 4h16v16H4zM4 9h16M10 9v11',
  menu: 'M4 6h16M4 12h16M4 18h16',
  'shopping-bag': 'M5 7h14l-1 14H6zM9 7a3 3 0 0 1 6 0',
  logo: 'M5 4v16M5 13l9-9M8.5 10.5 16 20'
};
export const ico = (name, cls = 'i') => ICON_PATHS[name] ? `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true"><path d="${ICON_PATHS[name]}"/></svg>` : '';
const catIcon = k => ENTITIES.find(e => e.category === k && e.icon && ICON_PATHS[e.icon])?.icon ?? 'layers';

// ———————————————————————————————————————————— cadrul paginilor

export function shell(db, user, {title, active = '', body, scripts = [], data = null}) {
  const sync = syncStatus(db);
  const review = inferredCount(db);
  const store = createStore(db);
  const total = ENTITIES.filter(e => !e.operational).reduce((n, e) => n + store.list(e.key).length, 0);
  const newLeads = db.prepare("SELECT COUNT(*) n FROM leads WHERE stare = 'noua'").get().n;
  const item = (href, key, icon, label, extra = '') => `<a href="${href}"${active === key ? ' aria-current="page"' : ''}>${ico(icon)}<span class="lbl">${label}</span>${extra}</a>`;
  const n = v => v ? `<span class="n">${v}</span>` : '';
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} — Brain Kurat</title><meta name="robots" content="noindex"><link rel="icon" href="/static/favicon.ico"><link rel="stylesheet" href="${CSS}"></head>
<body data-user="${esc(user.name)}" data-user-id="${user.id ?? ''}">
<div class="app"><aside class="side"><a class="brand" href="/manage/"><span class="mark">${KMARK}</span><span><b>Kurat</b><small>Brain · administrare</small></span></a>
<nav class="nav" aria-label="Panou">
  <span class="nav-h">Conținut</span>
  ${item('/manage/', 'panou', 'dashboard', 'Panou', sync.failed ? `<b class="pill bad">${sync.failed}</b>` : '')}
  ${item('/manage/entitati/', 'entitati', 'layers', 'Entități', n(total))}
  ${item('/manage/harta/', 'harta', 'network', 'Harta legăturilor')}
  ${item('/manage/modificari/', 'modificari', 'history', 'Modificări')}
  ${can(user, 'media.read') ? item('/manage/media/', 'media', 'images', 'Media') : ''}
  <span class="nav-h">Verificare</span>
  ${item('/manage/surse/', 'surse', 'source', 'Surse')}
  ${item('/manage/surse/legaturi/', 'legaturi', 'link-check', 'Legături de verificat', review ? `<b class="pill warn">${review}</b>` : '')}
  <span class="nav-h">Clienți</span>
  ${item('/manage/entitati/cereri/', 'ent:cereri', 'inbox', 'Cereri de ofertă', newLeads ? `<b class="pill warn">${newLeads}</b>` : '')}
  ${can(user, 'users.write') || can(user, 'backups.create') ? '<span class="nav-h">Administrare</span>' : ''}
  ${can(user, 'users.write') ? item('/manage/utilizatori/', 'utilizatori', 'users', 'Utilizatori') : ''}
  ${can(user, 'backups.create') ? item('/manage/setari/', 'setari', 'settings', 'Setări și copii') : ''}
</nav>
<div class="side-foot"><div class="who"><span class="dot${sync.failed ? ' bad' : ''}"></span>${esc(user.name)} · ${esc(ROLES[user.role]?.label ?? user.role)}</div>
  <div class="foot-row"><a href="/" target="_blank" rel="noopener">Site public ↗</a>${user.dev ? '<span class="muted">local</span>' : '<button type="button" class="link" data-logout>Ieșire</button>'}</div></div>
</aside>
<main class="main"><div id="live" class="live" hidden></div>${body}</main></div>
${data ? json(data) : ''}<script src="${JS}" defer></script>${scripts.map(s => `<script src="${s === 'map' ? MAP : s}" defer></script>`).join('')}</body></html>`;
}

export function loginPage({error = null} = {}) {
  return `<!doctype html><html lang="ro"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Autentificare — Brain Kurat</title>
<meta name="robots" content="noindex"><link rel="stylesheet" href="${CSS}"></head><body class="login-body">
<form class="card login" method="post" action="/api/manage/login" data-login><div class="brand big"><span class="mark">${KMARK}</span><span><b>Kurat</b><small>Brain · administrare</small></span></div>
<label>Email<input name="email" type="email" autocomplete="username" required></label>
<label>Parolă<input name="password" type="password" autocomplete="current-password" required></label>
<button class="btn primary" type="submit">Intră</button><p class="msg" role="status">${error ? esc(error) : ''}</p></form>
<script src="${JS}" defer></script></body></html>`;
}

// ———————————————————————————————————————————— Panou

export function dashboard(db, user) {
  const items = todo(db), sync = syncStatus(db), store = createStore(db);
  const failed = db.prepare("SELECT * FROM change_events WHERE status = 'failed' ORDER BY id DESC").all();
  const recent = db.prepare("SELECT * FROM change_events WHERE user_name != 'Import' ORDER BY id DESC LIMIT 6").all();
  const approvals = ENTITIES.filter(e => e.approval && !e.noStatus).flatMap(e => store.list(e.key)
    .filter(r => r.draft || r.status === 'draft').map(r => ({e, r})));
  const leads = db.prepare("SELECT * FROM leads WHERE stare = 'noua' ORDER BY id DESC LIMIT 6").all();
  const count = i => items.filter(x => x.impact === i).length;
  const n = key => store.list(key).length;
  const stat = (v, label, href, cls = '') => `<a class="stat ${cls}" href="${href}"><b>${v}</b><span>${label}</span></a>`;
  const vs = validationSummary(db).filter(s => s.total);
  const page = db.prepare('SELECT COUNT(*) n FROM page_index WHERE status = 200').get().n;
  const body = `<header class="page-h"><div><div class="crumbs">manage</div><h1>Panou</h1><p class="muted">Ce e de făcut, ce a venit de pe site și ce s-a propagat pe pagini.</p></div></header>
  <div class="stats">
    ${stat(n('servicii'), 'servicii', '/manage/entitati/servicii/')}${stat(n('tarife'), 'tarife', '/manage/entitati/tarife/')}
    ${stat(n('clienti'), 'clienți', '/manage/entitati/clienti/')}${stat(n('testimoniale'), 'testimoniale', '/manage/entitati/testimoniale/')}
    ${stat(leads.length, 'cereri noi', '/manage/entitati/cereri/', leads.length ? 'warn' : '')}${stat(count('mare'), 'de făcut · impact mare', '#de-facut', count('mare') ? 'bad' : 'ok')}
  </div>
  <div class="grid3">
  <section class="card" id="de-facut"><div class="card-h"><h2>De făcut</h2><small class="muted">${items.length}</small></div>
    ${items.length ? `<ul class="todo">${items.slice(0, 7).map(t => `<li><span class="imp ${t.impact}">${t.impact}</span><a href="${esc(t.href ?? '#')}">${esc(t.title)}</a></li>`).join('')}</ul>
    ${items.length > 7 ? `<div class="card-foot"><details><summary class="link">Încă ${items.length - 7}</summary><ul class="todo">${items.slice(7, 80).map(t => `<li><span class="imp ${t.impact}">${t.impact}</span><a href="${esc(t.href ?? '#')}">${esc(t.title)}</a>${t.detail ? `<small>${esc(String(t.detail).slice(0, 160))}</small>` : ''}</li>`).join('')}</ul></details></div>` : ''}`
      : '<p class="empty">Nimic de făcut.</p>'}</section>
  <section class="card"><div class="card-h"><h2><a href="/manage/entitati/cereri/">Cereri noi →</a></h2><small class="muted">${leads.length}</small></div>
    ${leads.length ? `<ul class="mini-list">${leads.map(l => `<li><a href="${entUrl('cereri', l.id)}">${esc(l.nume)}</a> · ${esc(l.contact)}<br><small>${esc(l.sursa)} · ${esc(fmtDate(l.created_at))}</small></li>`).join('')}</ul>`
      : '<p class="empty">Nicio cerere nouă. Cererile din formular și din calculator apar aici.</p>'}</section>
  <section class="card" id="propagare"><div class="card-h"><h2><a href="/manage/modificari/">Propagare →</a></h2>${badge(sync.failed ? [`${sync.failed} eșuate`, 'bad'] : sync.stale ? [`${sync.stale} de refăcut`, 'warn'] : ['la zi', 'ok'])}</div>
    <p class="muted" style="margin:0 0 10px">${page} pagini în index · ${sync.deps} dependențe · ultima: ${esc(fmtDate(sync.last) || '—')}</p>
    ${failed.map(ev => `<div class="alert bad"><b>Eșuat: ${esc(ev.label ?? ev.action)}</b> · ${ev.attempts} încercări<pre>${esc(ev.last_error)}</pre>
      ${can(user, 'content.write') ? `<button class="btn small" data-retry="${ev.id}">Reia</button>` : ''}</div>`).join('')}
    ${recent.length ? `<ul class="mini-list">${recent.map(ev => `<li>${ev.entity && ev.entity_id && hasEntity(ev.entity) ? `<a href="${entUrl(ev.entity, ev.entity_id)}">${esc(ev.label ?? '')}</a>` : esc(ev.label ?? ev.entity ?? '')}
      <br><small>${esc(ev.user_name)} · ${esc(fmtDate(ev.at))}${ev.affected != null ? ` · ${ev.affected} pagini` : ''} · <a href="#" data-synclog="${ev.id}">de ce?</a></small></li>`).join('')}</ul>` : '<p class="empty">Nicio modificare făcută din panou încă.</p>'}
    <div id="synclog"></div></section>
  <section class="card"><div class="card-h"><h2>Datele sunt corecte</h2><small class="muted">validate / total</small></div><div class="bars">
    ${vs.map(s => `<div class="bar-row"><div class="lbl"><a href="/manage/entitati/${s.key}/">${esc(s.label)}</a><span>${s.valid}/${s.total}${s.expired ? ` · ${s.expired} expirate` : ''}</span></div>
      <div class="bar"><i class="${s.valid === s.total ? 'ok' : s.expired ? 'warn' : ''}" style="width:${Math.round(100 * s.valid / s.total)}%"></i></div></div>`).join('')}</div></section>
  <section class="card"><div class="card-h"><h2>Așteaptă aprobare</h2><small class="muted">${approvals.length}</small></div>${approvals.length ? `<ul class="mini-list">${approvals.map(({e, r}) =>
    `<li><a href="${entUrl(e.key, r.id)}">${esc(titleOf(e.key, r))}</a> ${statusBadge(r, e)}<br><small>${esc(e.one)}</small></li>`).join('')}</ul>` : '<p class="empty">Nimic de aprobat.</p>'}</section>
  </div>`;
  return shell(db, user, {title: 'Panou', active: 'panou', body});
}

// ———————————————————————————————————————————— Entități

export function typesIndex(db, user) {
  const store = createStore(db);
  const pathsOf = keys => db.prepare(`SELECT path, COUNT(*) n FROM page_deps WHERE entity IN (${keys.map(() => '?').join(',')}) AND path NOT LIKE '#%' GROUP BY path ORDER BY n DESC LIMIT 4`).all(...keys).map(r => r.path);
  const src = db.prepare('SELECT MAX(fetched_at) at, COUNT(*) n FROM sources').get();
  const cards = Object.entries(CATEGORIES).map(([k, c]) => {
    const types = ENTITIES.filter(e => e.category === k);
    if (!types.length) return '';
    const counts = types.map(e => ({e, n: store.list(e.key).length}));
    const total = counts.reduce((a, x) => a + x.n, 0);
    const first = counts.find(x => x.e.hub !== false) ?? counts[0];
    const paths = pathsOf(types.map(e => e.key));
    return `<article class="cat" style="--c:${c.color}"><div class="cat-top"><span class="cat-ico">${ico(catIcon(k))}</span><span class="cat-n">${total}</span></div>
      <h2>${esc(c.label)}</h2>${c.desc ? `<p>${esc(c.desc)}</p>` : ''}
      ${paths.length ? `<div class="on-site">Pe site: ${paths.map(p => `<code>${esc(p)}</code>`).join('')}</div>` : ''}
      <div class="cat-types">${counts.map(({e, n}) => `<a href="/manage/entitati/${e.key}/">${esc(e.label)}<b>${n}</b></a>`).join('')}</div>
      <a class="open" href="/manage/entitati/${first.e.key}/">Deschide →</a></article>`;
  }).join('');
  const body = `<header class="page-h"><div><div class="crumbs">manage › entități${src?.n ? ` · sursa: kurat.ro${src.at ? ` (${esc(String(src.at).slice(0, 10))})` : ''} · ${src.n} surse citite` : ''}</div><h1>Entitățile Kurat</h1></div></header>
  <div class="cat-grid">${cards}</div>`;
  return shell(db, user, {title: 'Entități', active: 'entitati', body});
}

export function entityList(db, user, key, url) {
  const e = entity(key), store = createStore(db);
  if (e.singleton) { const r = store.singleton(key); if (r) return {redirect: entUrl(key, r.id)}; }
  const q = url.searchParams.get('q') ?? '';
  const counts = pageCounts(db, key);
  const cat = CATEGORIES[e.category];
  const cols = e.fields.filter(f => f.list && f.key !== e.title && !['refs', 'image', 'boolean', 'int'].includes(f.type)).slice(0, 3);
  const imgField = e.fields.find(f => f.type === 'image');
  const rows = store.list(key).filter(r => !q || (r.search ?? '').includes(q.toLowerCase()) || titleOf(key, r).toLowerCase().includes(q.toLowerCase()));
  const val = (f, r) => {
    const v = r[f.key];
    if (v == null || v === '') return '';
    if (f.type === 'select') return f.options.find(([k]) => k === v)?.[1] ?? v;
    if (f.type === 'ref') { const t = store.get(f.target, v); return t ? titleOf(f.target, t) : ''; }
    if (f.type === 'money') return `${v} lei`;
    if (Array.isArray(v)) return v.join(', ');
    return String(v).replace(/<[^>]+>/g, '').slice(0, 90);
  };
  const media = id => id != null ? db.prepare('SELECT path FROM media WHERE id = ?').get(id) : null;
  const ava = r => {
    const m = imgField && media(r[imgField.key]);
    if (m) return `<span class="ava${imgField.key === 'logo_id' ? ' sq' : ''}"><img src="${esc(m.path)}" alt="" loading="lazy"></span>`;
    const t = titleOf(key, r);
    return `<span class="ava" style="--c:${esc(r.culoare ?? e.color ?? cat?.color ?? '#0f69f5')}">${esc(t.split(/\s+/).slice(0, 2).map(w => w[0] ?? '').join('').toUpperCase())}</span>`;
  };
  const siblings = ENTITIES.filter(x => x.category === e.category && x.hub !== false);
  const canAdd = e.creatable !== false && can(user, 'content.write') && !(e.singleton && store.singleton(key));
  const body = `<header class="page-h"><div><div class="crumbs"><a href="/manage/entitati/">← Entități</a> › ${esc(cat?.label ?? '')} › ${esc(e.label)}</div>
      <div class="title-row"><span class="title-ico" style="color:${cat?.color};background:color-mix(in srgb,${cat?.color} 12%,transparent)">${ico(ICON_PATHS[e.icon] ? e.icon : catIcon(e.category))}</span><h1>${esc(e.label)} <small>${rows.length}</small></h1></div>
      ${cat?.desc ? `<p class="muted">${esc(cat.desc)} Click pe un rând îl deschide.</p>` : ''}</div>
    <div class="actions"><form class="search" method="get"><input name="q" value="${esc(q)}" placeholder="Filtrează…" aria-label="Filtrează"></form>
    ${canAdd ? `<a class="btn primary" href="/manage/entitati/${key}/nou/">${ico('plus')}Adaugă ${esc(e.one.toLowerCase())}</a>` : ''}</div></header>
  ${siblings.length > 1 ? `<nav class="chips" aria-label="Tipuri din ${esc(cat?.label ?? '')}">${siblings.map(x => `<a class="chip" href="/manage/entitati/${x.key}/"${x.key === key ? ' aria-current="page"' : ''}>${esc(x.label)} <small>· ${store.list(x.key).length}</small></a>`).join('')}</nav>` : ''}
  <div class="rows">${rows.map(r => {
    const sub = cols.map(f => val(f, r)).filter(Boolean).join(' · ');
    const pages = counts.get(r.id);
    return `<a class="row" href="${entUrl(key, r.id)}">${ava(r)}<span class="txt"><b>${esc(titleOf(key, r).slice(0, 110))}</b>${sub ? `<span>${esc(sub)}</span>` : ''}</span>
      <span class="meta">${e.noStatus ? '' : statusBadge(r, e)}${pages ? `<span title="Pagini publice care o afișează">${pages} ${pages === 1 ? 'pagină' : 'pagini'}</span>` : ''}<span class="when">${esc(fmtDate(r.updated_at))}</span><span class="btn small">Editează</span></span></a>`;
  }).join('') || `<div class="card empty">${q ? 'Nimic nu se potrivește filtrului.' : 'Nicio înregistrare încă.'}</div>`}</div>`;
  return {html: shell(db, user, {title: e.label, active: key === 'cereri' ? 'ent:cereri' : 'entitati', body})};
}

export function changesPage(db, user, url) {
  const all = url.searchParams.get('toate') === '1';
  const events = db.prepare(`SELECT * FROM change_events ${all ? '' : "WHERE user_name != 'Import'"} ORDER BY id DESC LIMIT 200`).all();
  const imported = db.prepare("SELECT COUNT(*) n, MAX(at) at FROM change_events WHERE user_name = 'Import'").get();
  const ACTION = {create: 'Adăugat', update: 'Modificat', delete: 'Șters', links: 'Legături', publish: 'Publicat', status: 'Stare', merge: 'Unit', restore: 'Restaurare', validate: 'Validat', media: 'Media'};
  const tone = ev => ev.status === 'failed' ? 'bad' : ev.status === 'done' ? 'ok' : 'warn';
  let day = '';
  const items = events.map(ev => {
    const d = new Date(ev.at).toLocaleDateString('ro-RO', {day: 'numeric', month: 'long', year: 'numeric'});
    const head = d !== day ? `<div class="tl-day">${esc(d)}</div>` : '';
    day = d;
    const target = ev.entity && ev.entity_id && hasEntity(ev.entity) ? `<a href="${entUrl(ev.entity, ev.entity_id)}">${esc(ev.label ?? '')}</a>` : esc(ev.label ?? ev.entity ?? '');
    return `${head}<div class="tl-item ${tone(ev)}"><div class="tl-head">${badge([ACTION[ev.action] ?? ev.action, 'mute'])}${hasEntity(ev.entity ?? '') ? `<span>${esc(entity(ev.entity).one)}</span>` : ''}
      <span>${esc(new Date(ev.at).toLocaleTimeString('ro-RO', {hour: '2-digit', minute: '2-digit'}))} · ${esc(ev.user_name)}</span>
      ${badge(ev.status === 'done' ? ['propagat', 'ok'] : ev.status === 'failed' ? ['eșuat', 'bad'] : ['în așteptare', 'warn'])}${ev.affected != null ? `<span>${ev.affected} ${ev.affected === 1 ? 'pagină refăcută' : 'pagini refăcute'}</span>` : ''}
      <a href="#" data-synclog="${ev.id}">de ce?</a></div><div class="tl-body">${target}</div>${ev.status === 'failed' && ev.last_error ? `<pre class="alert bad">${esc(ev.last_error)}</pre>` : ''}</div>`;
  }).join('');
  const body = `<header class="page-h"><div><div class="crumbs">manage › modificări</div><h1>Modificări</h1>
    <p class="muted">Tot ce se schimbă din panou, în ordine. Fiecare modificare reface doar paginile care o afișează; „de ce?” arată care și din ce motiv.</p></div>
    <div class="actions">${imported.n ? `<a class="btn" href="/manage/modificari/${all ? '' : '?toate=1'}">${all ? 'Ascunde importul' : `Arată și importul (${imported.n})`}</a>` : ''}</div></header>
  <div id="synclog"></div>
  ${events.length ? `<div class="timeline">${items}</div>` : `<div class="card empty">Nicio modificare făcută din panou încă.${imported.n ? ` Importul inițial (${imported.n} evenimente, ${esc(fmtDate(imported.at))}) e ascuns.` : ''}</div>`}`;
  return shell(db, user, {title: 'Modificări', active: 'modificari', body});
}

// ———————————————————————————————————————————— o entitate: taburi

const TABS = [['prezentare', 'Prezentare'], ['detalii', 'Detalii'], ['relatii', 'Relații'], ['surse', 'Surse'], ['unde-apare', 'Unde apare'], ['istoric', 'Istoric']];

export function entityPage(db, user, key, id, tab, url) {
  const e = entity(key), store = createStore(db), rec = store.get(key, id);
  if (!rec) return null;
  const title = titleOf(key, rec), path = pathOf(key, rec);
  const isPublic = e.noStatus || rec.status === 'published';
  const canPublish = can(user, 'content.publish') && (!e.approval || can(user, 'content.approve'));
  const actions = [];
  if (!e.noStatus && can(user, 'content.publish')) {
    if (rec.status !== 'published' || rec.draft) actions.push(canPublish ? `<button class="btn primary" data-status="published">${rec.draft ? 'Publică ciorna' : 'Publică'}</button>`
      : `<span class="hint">Publicarea cere aprobarea unui administrator.</span>`);
    if (rec.status === 'published' && canPublish) actions.push('<button class="btn" data-status="draft">Retrage de pe site</button>');
    if (rec.status !== 'archived' && canPublish) actions.push('<button class="btn" data-status="archived">Arhivează</button>');
  }
  if (rec.draft && can(user, 'content.write')) actions.push('<button class="btn" data-discard>Renunță la ciornă</button>');
  if (path) actions.push(`<a class="btn" href="/manage/previzualizare${esc(path)}" target="_blank" rel="noopener">Previzualizare</a>`);
  if (path && isPublic) actions.push(`<a class="btn ghost" href="${esc(path)}" target="_blank" rel="noopener">Vezi pe site ↗</a>`);
  if (can(user, 'content.delete') && !e.singleton) actions.push('<button class="btn danger ghost" data-delete>Șterge</button>');

  const cat = CATEGORIES[e.category];
  const body = `<header class="page-h"><div><div class="crumbs"><a href="/manage/entitati/">← Entități</a> › ${e.singleton ? esc(cat?.label ?? '') : `<a href="/manage/entitati/${key}/">${esc(e.label)}</a>`}</div>
    <div class="title-row"><span class="title-ico" style="color:${cat?.color};background:color-mix(in srgb,${cat?.color} 12%,transparent)">${ico(ICON_PATHS[e.icon] ? e.icon : catIcon(e.category))}</span><h1>${esc(title.slice(0, 120))} ${statusBadge(rec, e)}</h1></div>${path ? `<div class="muted mono" style="margin-top:6px">${esc(path)}</div>` : ''}</div><div class="actions">${actions.join('')}</div></header>
  <nav class="tabs">${TABS.map(([t, l]) => `<a href="${entUrl(key, id, t)}"${t === tab ? ' aria-current="page"' : ''}>${l}</a>`).join('')}</nav>
  <div class="tab-body">${(TAB_VIEWS[tab] ?? TAB_VIEWS.prezentare)(db, user, {e, key, id, rec, store, url})}</div>`;
  return shell(db, user, {title, active: `ent:${key}`, body, data: {key, id, updatedAt: rec.updated_at, title, path, approval: !!e.approval, noStatus: !!e.noStatus, status: rec.status ?? null}});
}

// Cum arată pe site: previzualizarea (cu ciorne), micșorată; click o deschide întreagă.
const previewCard = p => p ? `<section class="card"><div class="card-h"><h2>Cum arată pe site</h2><a href="/manage/previzualizare${esc(p)}" target="_blank" rel="noopener">Deschide ${ico('external')}</a></div>
  <div class="preview-frame"><iframe src="/manage/previzualizare${esc(p)}" title="Previzualizare ${esc(p)}" loading="lazy" tabindex="-1"></iframe></div></section>` : '';

const TAB_VIEWS = {
  prezentare(db, user, {e, key, id, rec, store}) {
    const path = pathOf(key, rec);
    const wu = whereUsed(db, key, id);
    const obs = todo(db).filter(t => t.href?.includes(`/entitati/${key}/${id}/`));
    const summary = e.fields.filter(f => !['refs', 'richtext', 'table', 'links'].includes(f.type) && rec[f.key] != null && rec[f.key] !== '' && !f.intern).slice(0, 10);
    const v = validationState(db, key, id);
    const dups = e.duplicates ? findDuplicates(db, key, id) : [];
    const canMerge = can(user, 'content.write') && can(user, 'content.delete') && (!e.approval || can(user, 'content.approve'));
    const validationCard = e.operational ? '' : `<section class="card validation ${v.state}"><div>
      ${v.state === 'valid' ? `${badge(['Datele sunt corecte', 'ok'])} <small>validat de ${esc(v.by)}, ${esc(fmtDate(v.at))}${v.comment ? ` — „${esc(v.comment)}”` : ''}</small>`
        : v.state === 'expired' ? `${badge(['Validarea a expirat', 'warn'])} <small>validat de ${esc(v.by)}, ${esc(fmtDate(v.at))}; înregistrarea s-a modificat de atunci</small>`
        : `${badge(['Neverificat', 'mute'])} <small>nimeni n-a confirmat încă datele</small>`}</div>
      ${can(user, 'content.write') ? `<form class="validate-form" data-validate><input name="comment" placeholder="Notă (opțional)" maxlength="500" aria-label="Notă"><button class="btn small ${v.state === 'valid' ? '' : 'primary'}" type="submit">Datele sunt corecte</button></form>` : ''}</section>`;
    const dupCard = dups.length ? `<section class="card alert warn"><h2>Seamănă cu</h2><ul class="plain">${dups.map(d => `<li><a href="${entUrl(key, d.b.id)}">${esc(d.b.title)}</a> <small>${Math.round(d.score * 100)}%</small>
      ${canMerge ? ` <button class="btn small" data-merge="${d.b.id}" data-merge-title="${esc(d.b.title)}">Unește în aceasta</button>` : ''}</li>`).join('')}</ul>
      <p class="hint">Unirea mută tot ce trimitea spre dublură (legături, linkuri, texte, ciorne, surse) pe această înregistrare și șterge dublura; dublura rămâne în Istoric.</p></section>` : '';
    return `<div class="cols"><div class="stack">
      <section class="card"><div class="impact"><div><b>${wu.impact}</b><span>${wu.impact === 1 ? 'pagină publică' : 'pagini publice'} afișează această înregistrare</span></div>
        <a href="${entUrl(key, id, 'unde-apare')}">Detalii →</a></div>
        ${wu.pages.length ? `<h3 style="margin:14px 0 8px">Apare pe aceste pagini</h3><ul class="pages-list">${wu.pages.slice(0, 8).map(p => `<li><div><b>${esc(p.title)}</b><span>${esc([...new Set(p.uses.map(u => u.component).filter(Boolean))].slice(0, 2).join(' · '))}</span></div><a href="/manage/previzualizare${esc(p.path)}" target="_blank" rel="noopener"><code>${esc(p.path)}</code></a></li>`).join('')}</ul>${wu.pages.length > 8 ? `<p class="muted small">și încă ${wu.pages.length - 8}</p>` : ''}` : ''}</section>
      ${validationCard}${dupCard}
      ${rec.draft ? `<section class="card alert warn"><b>Are o ciornă nepublicată</b>: ${Object.keys(rec.draft).map(k => esc(e.fields.find(f => f.key === k)?.label ?? k)).join(', ')}.
        Site-ul arată încă versiunea publicată.${e.approval ? ' Publicarea cere aprobare.' : ''}</section>` : ''}
      ${obs.length ? `<section class="card"><h2>De făcut aici</h2><ul class="todo">${obs.map(t => `<li><span class="imp ${t.impact}">${t.impact}</span><a href="${esc(t.href)}">${esc(t.title)}</a></li>`).join('')}</ul></section>` : ''}
      <section class="card"><h2>Pe scurt</h2><dl class="kv">${summary.map(f => `<div><dt>${esc(f.label)}</dt><dd>${fieldValue(db, store, f, rec[f.key])}</dd></div>`).join('')}
        <div><dt>Modificat</dt><dd>${esc(fmtDate(rec.updated_at))} · ${esc(rec.updated_by ?? '')}</dd></div><div><dt>Creat</dt><dd>${esc(fmtDate(rec.created_at))} · ${esc(rec.created_by ?? '')}</dd></div>
        ${rec.legacy_ref ? `<div><dt>Cheie din site-ul vechi</dt><dd class="mono">${esc(rec.legacy_ref)}</dd></div>` : ''}</dl></section>
    </div><div class="stack">${previewCard(path ?? wu.pages[0]?.path)}<section class="card"><h2>Mini-hartă</h2>${miniMap(db, `${key}:${id}`)}<p><a href="/manage/harta/?node=${key}:${id}">Deschide pe hartă →</a></p></section></div></div>`;
  },

  detalii(db, user, {e, key, rec, store, url}) {
    const focus = url.searchParams.get('camp');
    const kindOk = f => !f.kinds || f.kinds.includes(rec.kind);
    const fields = e.fields.filter(f => f.type !== 'refs' && kindOk(f));
    const val = k => rec.draft?.[k] !== undefined ? rec.draft[k] : rec[k];
    const published = !e.noStatus && rec.status === 'published';
    const canPublish = can(user, 'content.publish') && (!e.approval || can(user, 'content.approve'));
    return `<form class="card form" data-entity-form data-mode="edit">
      ${published ? `<p class="hint">Înregistrarea e publicată: <b>Salvează</b> scrie o ciornă (site-ul rămâne neschimbat); <b>Salvează și publică</b> o pune pe site.${e.approval && !canPublish ? ' Publicarea cere aprobarea unui administrator: salvează ciorna și anunță-l.' : ''}</p>` : ''}
      ${fields.map(f => fieldInput(db, store, e, f, val(f.key), {focus: focus === f.key, draft: rec.draft?.[f.key] !== undefined})).join('')}
      ${e.fields.some(f => f.type === 'refs' && kindOk(f)) ? `<p class="hint">Legăturile (${e.fields.filter(f => f.type === 'refs' && kindOk(f)).map(f => esc(f.label)).join(', ')}) se editează în tabul <a href="${entUrl(key, rec.id, 'relatii')}">Relații</a>.</p>` : ''}
      <div class="form-actions">${can(user, 'content.write') ? `<button class="btn ${published ? '' : 'primary'}" type="submit" data-save>${published ? 'Salvează ciorna' : 'Salvează'}</button>
        ${published && canPublish ? '<button class="btn primary" type="submit" data-save-publish>Salvează și publică</button>' : ''}
        ${!e.noStatus && !published && canPublish ? '<button class="btn primary" type="submit" data-save-publish>Salvează și publică</button>' : ''}
        ${pathOf(key, rec) ? '<button class="btn ghost" type="button" data-preview-unsaved>Previzualizează nesalvat</button>' : ''}` : '<p class="hint">Ai doar drept de citire.</p>'}</div>
      <div class="form-msg" role="status"></div></form>`;
  },

  relatii(db, user, {e, key, id, rec, store}) {
    const own = e.fields.filter(f => f.type === 'refs' && (!f.kinds || f.kinds.includes(rec.kind)));
    const inv = inverseRelations(key).filter(r => r.source !== 'media');
    const editable = can(user, 'content.write');
    const ownHtml = own.map(f => {
      const links = store.links(key, id, f.key), rel = RELATION_TYPES.find(r => r.id === `${key}.${f.key}`);
      const approval = rel.sensitive || e.approval;
      return `<section class="card rel" data-rel="${f.key}" data-target="${f.target}" data-ordered="${f.ordered ? 1 : 0}"><h2>${esc(f.label)} <small>${esc(f.rel ?? '')} → ${esc(entity(f.target).label)}</small>
        ${rel.sensitive ? '<span class="badge bad" title="Relație sensibilă: schimbarea cere aprobare">🔒 sensibilă</span>' : ''}</h2>
        ${approval && !can(user, 'content.approve') ? '<p class="hint">Schimbările acestor legături cer aprobare.</p>' : ''}
        <p class="hint">Schimbările de legături pe o înregistrare publicată sunt <b>live</b> la salvare: site-ul se reface imediat.</p>
        <ol class="links">${links.map(l => linkRow(store, f, l)).join('')}</ol>
        ${editable ? `<div class="add"><input type="search" placeholder="Adaugă ${esc(entity(f.target).one.toLowerCase())}…" data-add-search="${f.target}" aria-label="Caută țintă">
          <div class="suggest" hidden></div></div><button class="btn primary small" data-save-links>Salvează legăturile</button> <span class="form-msg" role="status"></span>` : ''}
      </section>`;
    }).join('');
    const invHtml = inv.map(r => {
      const src = entity(r.source), f = src.fields.find(x => x.key === r.field);
      const rows = store.usedBy(key, id).filter(u => u.key === r.source && u.field === r.field);
      return `<section class="card rel-inv" data-src="${r.source}" data-field="${r.field}"><h2>${esc(r.inverseLabel)} <small>${esc(src.label)} care ${esc(r.verb)} această înregistrare (${r.cardinality})</small></h2>
        ${r.cardinality === 'N:1' ? `<p class="hint">Relație N:1: adăugarea de aici <b>mută</b> legătura de la ținta veche.${r.required ? ' Fiind obligatorie, nu se poate scoate de aici, doar muta.' : ''}</p>` : ''}
        <ul class="links">${rows.map(u => { const s = store.get(u.key, u.id); return `<li><a href="${entUrl(u.key, u.id)}">${esc(titleOf(u.key, s))}</a>
          ${u.status && u.status !== 'confirmed' ? badge(CERT[u.status]) : ''}${u.owned ? ' <small class="muted">(deținută)</small>' : ''}
          ${editable && !(r.cardinality === 'N:1' && r.required) ? `<button class="link danger" data-inv-remove="${u.id}">scoate</button>` : ''}</li>`; }).join('') || '<li class="muted">Niciuna.</li>'}</ul>
        ${editable ? `<div class="add"><input type="search" placeholder="Adaugă din ${esc(src.label.toLowerCase())}…" data-inv-search="${r.source}" aria-label="Caută sursă"><div class="suggest" hidden></div></div>` : ''}
        ${f.onTargetDelete ? `<p class="hint">La ștergere: ${esc(f.onTargetDelete)}</p>` : ''}</section>`;
    }).join('');
    return `${ownHtml || ''}${invHtml || ''}${!ownHtml && !invHtml ? '<p class="empty card">Tipul nu are relații declarate.</p>' : ''}`;
  },

  surse(db, user, {e, key, id}) {
    const rows = db.prepare(`SELECT p.*, s.url, s.kind skind, s.title stitle, s.snapshot_file, s.fetched_at FROM provenance p JOIN sources s ON s.id = p.source_id
      WHERE p.entity = ? AND p.entity_id = ? ORDER BY p.field, p.id`).all(key, id);
    const label = f => f === '' ? '(întreaga înregistrare)' : f.includes(':') ? `legătura ${f}` : e.fields.find(x => x.key === f)?.label ?? f;
    const canConfirm = can(user, 'content.write') && (!e.approval || can(user, 'content.approve'));
    return `<section class="card flush"><table class="tbl"><thead><tr><th>Câmp</th><th>Sursă</th><th>Fragment</th><th>Metodă</th><th>Certitudine</th><th></th></tr></thead><tbody>
      ${rows.map(p => `<tr><td>${esc(label(p.field))}</td><td>${p.skind === 'manual' ? esc(p.stitle) : `<a href="${esc(p.url)}" target="_blank" rel="noopener noreferrer">${esc(p.url.replace(/^https?:\/\//, '').slice(0, 50))}</a>`}
        <br><small class="muted">${esc(p.skind)}${p.fetched_at ? ` · ${esc(fmtDate(p.fetched_at))}` : ''}</small></td><td><small>${esc(p.excerpt ?? '')}</small></td><td><small>${esc(p.method ?? '')}</small></td>
        <td>${badge(CERT[p.certainty])}${p.confidence != null ? ` <small>${Math.round(p.confidence * 100)}%</small>` : ''}${p.verified_by ? `<br><small>${esc(p.verified_by)}, ${esc(fmtDate(p.verified_at))}</small>` : ''}</td>
        <td>${p.certainty !== 'confirmed' && canConfirm ? `<button class="btn small" data-confirm-source="${p.id}">Confirmă</button>` : ''}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Nicio sursă înregistrată.</td></tr>'}
    </tbody></table></section>`;
  },

  'unde-apare'(db, user, {key, id}) {
    const w = whereUsed(db, key, id);
    const nodeLink = n => n.missing ? esc(n.title) : n.key === 'media' ? esc(n.title) : `<a href="${entUrl(n.key, n.id)}">${esc(n.title)}</a>`;
    return `<p class="lead">Apare în <b>${w.impact}</b> ${w.impact === 1 ? 'pagină publică' : 'pagini publice'}.</p>
    <section class="card"><h2>1. Relații directe <small>legăturile salvate, din ambele capete</small></h2><ul class="plain">${w.direct.map(d =>
      `<li>${d.dir === 'out' ? '→' : '←'} <i>${esc(d.dir === 'out' ? d.verb : d.field)}</i> ${nodeLink(d.node)} ${d.status !== 'confirmed' ? badge(CERT[d.status]) : ''}</li>`).join('') || '<li class="muted">Niciuna.</li>'}</ul></section>
    <section class="card"><h2>2. Utilizări efective în pagini <small>măsurate la randare</small></h2><ul class="plain">${w.pages.map(p =>
      `<li><a href="${esc(p.path)}" target="_blank" rel="noopener">${esc(p.path)}</a> <small class="muted">${esc(p.title)}</small><ul>${p.uses.map(u =>
        `<li>${esc(u.via ? `${u.via} (componentă comună)` : u.component)} — <small>${esc(u.reason || u.kind)}</small></li>`).join('')}</ul>
        ${hasEntity(key) && p.uses.some(u => !u.via) ? `<a class="small" href="${entUrl(key, id, 'detalii')}">Editează</a>` : ''}</li>`).join('') || '<li class="muted">Nu apare în nicio pagină publică.</li>'}</ul></section>
    ${w.pending.length ? `<section class="card"><h2>Legat deja: apare după publicare</h2><ul class="plain">${w.pending.map(p => `<li>${esc(p.path)} — ${p.uses.map(u => esc(u.via ?? u.component)).join(', ')}</li>`).join('')}</ul></section>` : ''}
    <section class="card"><h2>3. Dependențe indirecte <small>listele în care intră sau din care ar ieși</small></h2><ul class="plain">${w.indirect.map(q =>
      `<li>${esc(q.path.startsWith('#layout:') ? q.path.slice(8) + ' (componentă comună)' : q.path)} — ${esc(q.component)}${q.reason ? `: ${esc(q.reason)}` : ''} ${q.scope ? `<small class="mono">${esc(q.scope)}</small>` : q.fields ? `<small>după ${esc(q.fields.join(', '))}</small>` : ''}</li>`).join('') || '<li class="muted">Niciuna.</li>'}</ul></section>
    <section class="card"><h2>4. Detectate, neverificate</h2><ul class="plain">${w.detected.map(d => d.kind === 'sursă nesigură'
      ? `<li>${badge(CERT[d.certainty])} sursă pentru <b>${esc(d.field || 'înregistrare')}</b>: <small>${esc(d.excerpt ?? '')}</small> <a href="${entUrl(key, id, 'surse')}">Surse</a></li>`
      : `<li>${badge([d.kind, 'warn'])} ${d.node ? nodeLink(d.node) : ''} ${d.excerpt ? `<small>„${esc(d.excerpt)}”</small>` : ''}</li>`).join('') || '<li class="muted">Nimic.</li>'}</ul></section>
    ${w.tokens ? `<section class="card"><h2>Se completează automat în</h2><ul class="plain">${w.tokens.map(t => `<li>${nodeLink(t.node)} · ${esc(t.field)} · ${t.tokens.map(x => `<code>{${esc(x)}}</code>`).join(' ')}</li>`).join('')}</ul></section>` : ''}`;
  },

  istoric(db, user, {e, key, id}) {
    const rows = db.prepare('SELECT * FROM audit_log WHERE entity = ? AND entity_id = ? ORDER BY id DESC LIMIT 200').all(key, id);
    const label = k => e.fields.find(f => f.key === k)?.label ?? k;
    const show = v => esc(typeof v === 'string' ? v.slice(0, 200) : JSON.stringify(v)?.slice(0, 200) ?? '—');
    const canRevert = can(user, 'content.write') && (e.noStatus || can(user, 'content.publish')) && (!e.approval || can(user, 'content.approve'));
    return `<section class="card flush"><table class="tbl"><thead><tr><th>Când</th><th>Cine</th><th>Ce</th><th>Modificări</th></tr></thead><tbody>${rows.map(a => {
      const ch = JSON.parse(a.changes ?? '{}');
      return `<tr><td><small>${esc(fmtDate(a.at))}</small></td><td>${esc(a.user_name)}</td><td>${esc(a.action)}${a.reverted_by ? ' <small class="muted">(readus)</small>' : ''}</td><td><ul class="diff">${Object.entries(ch).map(([k, [o, n]]) =>
        `<li><b>${esc(label(k))}</b>: <del>${show(o)}</del> → <ins>${show(n)}</ins>${canRevert && ['update', 'publish', 'draft'].includes(a.action) && e.fields.some(f => f.key === k && f.type !== 'refs') ? ` <button class="link" data-revert="${a.id}" data-field="${esc(k)}">readu</button>` : ''}</li>`).join('')}</ul></td></tr>`;
    }).join('') || '<tr><td colspan="4" class="empty">Fără istoric.</td></tr>'}</tbody></table></section>`;
  }
};

function linkRow(store, f, l) {
  const t = store.get(f.target, l.dst_id);
  const attrs = (f.attrs ?? []).filter(a => a.type !== 'image');
  return `<li data-id="${l.dst_id}" data-status="${l.status}" data-attrs="${esc(JSON.stringify(l.attrs ?? {}))}" data-confidence="${l.confidence ?? ''}">
    <span class="grip">${f.ordered ? '<button class="link" data-up title="Mai sus">↑</button><button class="link" data-down title="Mai jos">↓</button>' : ''}</span>
    <a href="${entUrl(f.target, l.dst_id)}">${esc(t ? titleOf(f.target, t).slice(0, 90) : `#${l.dst_id} (lipsă)`)}</a>
    <select data-link-status aria-label="Starea legăturii"><option value="confirmed"${l.status === 'confirmed' ? ' selected' : ''}>confirmată</option>
      <option value="inferred"${l.status === 'inferred' ? ' selected' : ''}>dedusă</option><option value="unverified"${l.status === 'unverified' ? ' selected' : ''}>neverificată</option></select>
    ${l.confidence != null ? `<small>${Math.round(l.confidence * 100)}%</small>` : ''}
    ${attrs.map(a => `<label class="attr">${esc(a.label ?? a.key)} <input data-attr="${a.key}" value="${esc(Array.isArray(l.attrs?.[a.key]) ? l.attrs[a.key].join('; ') : l.attrs?.[a.key] ?? '')}"></label>`).join('')}
    ${l.note && l.status !== 'confirmed' ? `<small class="muted" title="${esc(l.note)}">dovadă: ${esc(l.note.slice(0, 60))}</small>` : ''}
    <button class="link danger" data-remove title="Scoate legătura">✕</button></li>`;
}

function fieldValue(db, store, f, v) {
  if (f.type === 'ref') { const t = store.get(f.target, v); return t ? `<a href="${entUrl(f.target, v)}">${esc(titleOf(f.target, t))}</a>` : esc(v); }
  if (f.type === 'image') { const m = db.prepare('SELECT path, alt FROM media WHERE id = ?').get(v); return m ? `<img class="thumb" src="${esc(m.path)}" alt="${esc(m.alt ?? '')}">` : ''; }
  if (f.type === 'select') return esc(f.options.find(([k]) => k === v)?.[1] ?? v);
  if (f.type === 'boolean') return v ? 'da' : 'nu';
  if (Array.isArray(v)) return esc(v.join(', '));
  return esc(String(v).slice(0, 200));
}

function fieldInput(db, store, e, f, v, {focus, draft}) {
  const id = `f-${f.key}`, ro = f.readonly ? ' readonly' : '', req = f.required ? ' required' : '';
  const label = `<label for="${id}">${esc(f.label)}${f.required ? ' <b class="req">*</b>' : ''}${draft ? ' <span class="badge warn">ciornă</span>' : ''}${f.intern ? ' <small class="muted">intern</small>' : ''}</label>`;
  const attrs = `id="${id}" name="${f.key}" data-type="${f.type}"${ro}${req}${focus ? ' autofocus data-focus' : ''}`;
  let input;
  switch (f.type) {
    case 'textarea': input = `<textarea ${attrs} rows="3"${f.max ? ` maxlength="${f.max}"` : ''}>${esc(v)}</textarea>`; break;
    case 'richtext': input = `<textarea ${attrs} rows="8" class="mono">${esc(v)}</textarea><small class="muted">HTML simplu: &lt;p&gt;, &lt;h2&gt;–&lt;h4&gt;, &lt;ul&gt;, &lt;a data-ref="tip:id"&gt;, jetoane {telefon}. Restul se curăță la salvare.</small>`; break;
    case 'int': case 'number': case 'money': input = `<input ${attrs} type="number" step="${f.type === 'int' ? 1 : 'any'}" value="${esc(v)}">`; break;
    case 'boolean': input = `<input ${attrs} type="checkbox"${v ? ' checked' : ''}>`; break;
    case 'date': input = `<input ${attrs} type="date" value="${esc(v)}">`; break;
    case 'select': input = `<select ${attrs}><option value=""></option>${f.options.map(([k, l]) => `<option value="${esc(k)}"${k === v ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select>`; break;
    case 'list': input = `<textarea ${attrs} rows="${Math.max(2, (v?.length ?? 0) + 1)}" placeholder="Câte unul pe rând">${esc((v ?? []).join('\n'))}</textarea>`; break;
    case 'links': input = `<textarea ${attrs} rows="${Math.max(2, (v?.length ?? 0) + 1)}" class="mono" placeholder="destinație | etichetă (opțional) | stil — câte unul pe rând">${esc((v ?? []).map(l => [l.href, l.label ?? '', l.stil ?? ''].join(' | ').replace(/( \| )+$/, '')).join('\n'))}</textarea>
      <small class="muted">Destinații: <code>ref:pagini:3</code>, <code>ref:servicii:5</code>, <code>tel:{telefon}</code>, <code>#calculator</code> sau o adresă externă. Fără etichetă se ia numele țintei.</small>`; break;
    case 'table': input = `<textarea ${attrs} rows="5" class="mono">${esc(JSON.stringify(v ?? [], null, 1))}</textarea>`; break;
    case 'ref': {
      const t = entity(f.target);
      const opts = store.list(f.target).filter(r => !f.only || f.only(r));
      input = `<select ${attrs}><option value=""></option>${opts.map(r => `<option value="${r.id}"${r.id === v ? ' selected' : ''}>${esc(titleOf(f.target, r).slice(0, 90))}</option>`).join('')}</select>
        ${v ? `<a class="small" href="${entUrl(f.target, v)}">Deschide ${esc(t.one.toLowerCase())} →</a>` : ''}`;
      break;
    }
    case 'image': {
      const media = db.prepare('SELECT id, path, alt FROM media ORDER BY path').all();
      const cur = media.find(m => m.id === v);
      input = `<div class="img-field">${cur ? `<img class="thumb" src="${esc(cur.path)}" alt="">` : ''}<select ${attrs}><option value=""></option>${media.map(m =>
        `<option value="${m.id}"${m.id === v ? ' selected' : ''}>${esc(m.path.split('/').pop())}${m.alt ? ` — ${esc(m.alt.slice(0, 50))}` : ''}</option>`).join('')}</select></div>`;
      break;
    }
    default: input = `<input ${attrs} type="${f.type === 'email' ? 'email' : f.type === 'url' ? 'text' : f.type === 'phone' ? 'tel' : 'text'}" value="${esc(v)}"${f.max ? ` maxlength="${f.max}"` : ''}>`;
  }
  return `<div class="field${f.type === 'boolean' ? ' check' : ''}${focus ? ' focus' : ''}" data-field="${f.key}">${label}${input}<div class="field-err" role="alert"></div></div>`;
}

export function newEntity(db, user, key) {
  const e = entity(key), store = createStore(db);
  const body = `<header class="page-h"><div><div class="crumbs"><a href="/manage/entitati/">Entități</a> / <a href="/manage/entitati/${key}/">${esc(e.label)}</a></div><h1>${esc(e.one)} nou</h1></div></header>
  <form class="card form" data-entity-form data-mode="create"><div class="dup" hidden></div>
    ${e.fields.filter(f => f.type !== 'refs').map(f => fieldInput(db, store, e, f, f.type === 'boolean' ? false : null, {})).join('')}
    <div class="form-actions"><button class="btn" type="submit" data-save>${e.noStatus ? 'Salvează' : 'Salvează ca ciornă'}</button>
    ${!e.noStatus && can(user, 'content.publish') && (!e.approval || can(user, 'content.approve')) ? '<button class="btn primary" type="submit" data-save-publish>Salvează și publică</button>' : ''}</div>
    <div class="form-msg" role="status"></div></form>`;
  return shell(db, user, {title: `${e.one} nou`, active: `ent:${key}`, body, data: {key, create: true, titleField: e.title}});
}

// ———————————————————————————————————————————— mini-harta radială

function miniMap(db, nid) {
  const n = neighbors(db, nid, {layers: ['relatii', 'calculate', 'texte']});
  if (!n) return '';
  const items = [...n.incoming.map(x => ({...x, dir: 'in'})), ...n.outgoing.map(x => ({...x, dir: 'out'}))];
  const seen = new Set(), list = items.filter(x => !seen.has(x.node.id) && seen.add(x.node.id)).slice(0, 18);
  const W = 420, H = 320, cx = W / 2, cy = H / 2, R = 120;
  const color = k => hasEntity(k) ? entity(k).color ?? CATEGORIES[entity(k).category]?.color : '#94a3b8';
  const pts = list.map((x, i) => { const a = (i / Math.max(1, list.length)) * Math.PI * 2 - Math.PI / 2; return {...x, x: cx + R * Math.cos(a), y: cy + R * Math.sin(a)}; });
  const dash = s => s === 'inferred' ? '6 4' : s === 'unverified' ? '2 4' : '';
  return `<svg class="minimap" viewBox="0 0 ${W} ${H}" role="img" aria-label="Vecinii înregistrării">
    ${pts.map(p => `<line x1="${cx}" y1="${cy}" x2="${p.x}" y2="${p.y}" stroke="${color(p.node.key)}" stroke-opacity=".55" stroke-width="1.6"${dash(p.status) ? ` stroke-dasharray="${dash(p.status)}"` : ''}/>`).join('')}
    ${pts.map(p => `<a href="${p.node.key && hasEntity(p.node.key) ? entUrl(p.node.key, p.node.rid) : '#'}"><circle cx="${p.x}" cy="${p.y}" r="7" fill="${color(p.node.key)}"/>
      <text x="${p.x + (p.x >= cx ? 10 : -10)}" y="${p.y + 4}" text-anchor="${p.x >= cx ? 'start' : 'end'}">${esc(String(p.node.title).slice(0, 22))}</text><title>${esc(p.dir === 'in' ? '← ' : '→ ')}${esc(p.verb)}: ${esc(p.node.title)}</title></a>`).join('')}
    <circle cx="${cx}" cy="${cy}" r="11" fill="${color(n.node.key)}" stroke="#fff" stroke-width="3"/><text class="center" x="${cx}" y="${cy + 28}" text-anchor="middle">${esc(n.node.title.slice(0, 30))}</text>
  </svg>${items.length > list.length ? `<p class="muted small">+ ${items.length - list.length} legături</p>` : ''}`;
}

// ———————————————————————————————————————————— Harta, Surse, Legături de verificat, Utilizatori

export function mapPage(db, user) {
  const body = `<header class="page-h"><div><h1>Harta legăturilor</h1><p class="muted">Tipuri → membri → o entitate. Clic pe o muchie pentru panoul relației.</p></div>
    <div class="actions"><input type="search" id="map-search" placeholder="Caută o entitate…" aria-label="Caută pe hartă"><div class="suggest" hidden></div></div></header>
  <div class="map-toolbar card">
    <nav class="crumbs" id="map-crumbs"></nav>
    <div class="layers">${Object.entries(LAYERS).map(([k, l]) => `<label><input type="checkbox" data-layer="${k}"${['relatii', 'calculate'].includes(k) ? ' checked' : ''}> ${esc(l)}</label>`).join('')}</div>
    <div class="filters"><select id="map-status" aria-label="Starea legăturii"><option value="">Toate stările</option><option value="confirmed">Doar confirmate</option><option value="review">Doar de verificat</option></select>
      <label><input type="checkbox" id="map-pages" checked> Pagini</label></div>
  </div>
  <div class="map-wrap"><div class="card map-stage" id="map-stage"></div><aside class="card map-side" id="map-side"><p class="muted">Selectează un tip, o entitate sau o muchie.</p></aside></div>
  <div class="cols">
    <section class="card"><h2>Traseul dintre două entități</h2><div class="path-form"><input type="search" data-path-end="from" placeholder="De la…"><div class="suggest" hidden></div>
      <input type="search" data-path-end="to" placeholder="Până la…"><div class="suggest" hidden></div><button class="btn primary small" id="path-go">Caută traseul</button></div><div id="path-out"></div></section>
    <section class="card"><h2>Sănătatea hărții</h2><div id="health">Se încarcă…</div></section>
  </div>
  <section class="card flush"><h2 class="pad">Toate legăturile</h2><div class="pad"><input type="search" id="edges-q" placeholder="Filtrează…"> <select id="edges-group"><option value="">Toate grupurile</option>${Object.values(CATEGORIES).map(c => `<option>${esc(c.label)}</option>`).join('')}</select></div><div id="edges"></div></section>`;
  return shell(db, user, {title: 'Harta legăturilor', active: 'harta', body, scripts: ['map']});
}

export function sourcesPage(db, user) {
  const rows = db.prepare(`SELECT s.*, COUNT(p.id) uses, SUM(p.certainty <> 'confirmed') unsure FROM sources s LEFT JOIN provenance p ON p.source_id = s.id GROUP BY s.id ORDER BY unsure DESC, s.kind, s.url`).all();
  const unsure = db.prepare(`SELECT p.*, s.url FROM provenance p JOIN sources s ON s.id = p.source_id WHERE p.certainty <> 'confirmed' ORDER BY p.entity, p.entity_id`).all();
  const st = createStore(db);
  const body = `<header class="page-h"><div><h1>Surse</h1><p class="muted">De unde vine fiecare informație. Site-ul public nu expune nimic de aici.</p></div>
    <div class="actions"><a class="btn" href="/manage/surse/legaturi/">Legături de verificat →</a></div></header>
  <section class="card"><h2>Informații cu sursă nesigură <small>${unsure.length}</small></h2><table class="tbl compact"><thead><tr><th>Înregistrare</th><th>Câmp</th><th>Fragment</th><th>Certitudine</th><th></th></tr></thead><tbody>
  ${unsure.map(p => { const r = hasEntity(p.entity) ? st.get(p.entity, p.entity_id) : null; return `<tr><td>${r ? `<a href="${entUrl(p.entity, p.entity_id, 'surse')}">${esc(entity(p.entity).one)}: ${esc(titleOf(p.entity, r).slice(0, 50))}</a>` : esc(`${p.entity}:${p.entity_id}`)}</td>
    <td>${esc(p.field || '—')}</td><td><small>${esc(p.excerpt ?? '')}</small></td><td>${badge(CERT[p.certainty])}</td>
    <td>${can(user, 'content.write') && (!hasEntity(p.entity) || !entity(p.entity).approval || can(user, 'content.approve')) ? `<button class="btn small" data-confirm-source="${p.id}">Confirmă</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="5" class="empty">Nimic.</td></tr>'}</tbody></table></section>
  <section class="card flush"><h2 class="pad">Toate sursele <small>${rows.length}</small></h2><table class="tbl compact"><thead><tr><th>Sursă</th><th>Tip</th><th>Descărcată</th><th>Folosită</th><th>Nesigure</th></tr></thead><tbody>
  ${rows.map(s => `<tr><td>${s.kind === 'manual' ? esc(s.title) : `<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">${esc(s.url.replace(/^https?:\/\//, '').slice(0, 70))}</a>`}${s.snapshot_file ? `<br><small class="mono muted">${esc(s.snapshot_file)}</small>` : ''}</td>
    <td>${esc(s.kind)}</td><td><small>${esc(fmtDate(s.fetched_at))}</small></td><td>${s.uses}</td><td>${s.unsure ? badge([s.unsure, 'warn']) : ''}</td></tr>`).join('')}</tbody></table></section>`;
  return shell(db, user, {title: 'Surse', active: 'surse', body});
}

export function inferredPage(db, user) {
  const groups = inferredGroups(db);
  const body = `<header class="page-h"><div><h1>Legături de verificat</h1><p class="muted">Relațiile deduse sau neverificate nu apar pe site până nu sunt confirmate. Ce scoți se ține minte și nu mai e propus din aceeași dovadă.</p></div></header>
  ${groups.map(g => {
    const allowed = can(user, 'content.write') && (!(g.sensitive || g.approval) || can(user, 'content.approve'));
    return `<section class="card group" data-relation="${esc(g.relation)}"><h2>${esc(g.sourceLabel)} → ${esc(g.verb)} → ${esc(g.targetLabel)} <small>${g.count}</small></h2>
    <p>Dovadă: <b>${esc(g.evidence)}</b> · Recomandare: ${badge([g.recommendation, g.recommendation === 'confirmă' ? 'ok' : g.recommendation === 'scoate' ? 'bad' : 'warn'])} <small class="muted">(prag ${Math.round(g.threshold * 100)}%)</small>
      ${g.sensitive ? badge(['🔒 sensibilă', 'bad']) : ''}${g.sensitive || g.approval ? ' <small>cere aprobare</small>' : ''}</p>
    <table class="tbl compact"><thead><tr>${allowed ? '<th><input type="checkbox" data-all aria-label="Toate"></th>' : ''}<th>De la</th><th>La</th><th>Încredere</th><th>Dovada</th></tr></thead><tbody>
    ${g.items.map(i => `<tr data-src="${i.src.id}" data-dst="${i.dst.id}">${allowed ? '<td><input type="checkbox" data-pick></td>' : ''}<td><a href="${entUrl(i.src.key, i.src.id, 'relatii')}">${esc(i.src.title.slice(0, 60))}</a>
      ${i.attrs?.titlu ? `<br><small>card „${esc(i.attrs.titlu)}”</small>` : ''}</td><td><a href="${entUrl(i.dst.key, i.dst.id)}">${esc(i.dst.title.slice(0, 60))}</a></td>
      <td>${i.confidence != null ? `${Math.round(i.confidence * 100)}%` : '—'}</td><td><small>${esc(i.note ?? '')}</small>${i.excerpt ? `<br><small class="muted">„${esc(i.excerpt.slice(0, 140))}”</small>` : ''}</td></tr>`).join('')}</tbody></table>
    ${allowed ? `<div class="form-actions"><button class="btn primary small" data-bulk="confirm">Confirmă selectate</button><button class="btn danger small" data-bulk="remove">Scoate selectate</button><span class="form-msg" role="status"></span></div>` : '<p class="hint">Confirmarea cere aprobarea unui administrator.</p>'}
    </section>`;
  }).join('') || '<p class="card empty">Nicio legătură de verificat.</p>'}`;
  return shell(db, user, {title: 'Legături de verificat', active: 'legaturi', body});
}

export function usersPage(db, user) {
  const users = db.prepare('SELECT id, email, name, role, active, created_at FROM users ORDER BY id').all();
  const body = `<header class="page-h"><div><h1>Utilizatori</h1><p class="muted">Administrator: tot. Editor: conținut și ciorne. Vizualizare: citire și previzualizare.</p></div></header>
  <section class="card flush"><table class="tbl"><thead><tr><th>Nume</th><th>Email</th><th>Rol</th><th>Activ</th><th>Creat</th></tr></thead><tbody>
  ${users.map(u => `<tr data-user="${u.id}"><td>${esc(u.name)}</td><td>${esc(u.email)}</td><td><select data-role aria-label="Rol">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === u.role ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select></td>
    <td><input type="checkbox" data-active${u.active ? ' checked' : ''} aria-label="Activ"></td><td><small>${esc(fmtDate(u.created_at))}</small></td></tr>`).join('') || '<tr><td colspan="5" class="empty">Niciun utilizator.</td></tr>'}</tbody></table></section>
  <form class="card form inline" data-new-user><h2>Utilizator nou</h2><label>Nume<input name="name" required></label><label>Email<input name="email" type="email" required></label>
    <label>Rol<select name="role">${Object.entries(ROLES).map(([k, r]) => `<option value="${k}"${k === 'editor' ? ' selected' : ''}>${esc(r.label)}</option>`).join('')}</select></label>
    <button class="btn primary" type="submit">Creează</button><div class="form-msg" role="status"></div></form>`;
  return shell(db, user, {title: 'Utilizatori', active: 'utilizatori', body});
}

// ———————————————————————————————————————————— biblioteca media

export function mediaPage(db, user, url) {
  const q = fold(url.searchParams.get('q') ?? '');
  const counts = new Map(db.prepare("SELECT entity_id, COUNT(DISTINCT path) n FROM page_deps WHERE entity = 'media' AND path NOT LIKE '#layout:%' GROUP BY entity_id").all().map(r => [r.entity_id, r.n]));
  const items = db.prepare('SELECT * FROM media ORDER BY updated_at DESC').all().filter(m => !q || fold(`${m.path} ${m.alt ?? ''}`).includes(q));
  const isImg = m => m.mime?.startsWith('image/');
  const body = `<header class="page-h"><div><h1>Media <small>${items.length}</small></h1><p class="muted">Fișierele se leagă prin ID: textul alternativ editat aici ajunge peste tot; un fișier înlocuit își păstrează ID-ul și adresa.</p></div>
    <div class="actions"><form class="search" method="get"><input name="q" value="${esc(url.searchParams.get('q') ?? '')}" placeholder="Caută…" aria-label="Caută"></form></div></header>
  ${can(user, 'media.write') ? `<form class="card upload" data-upload><label class="drop"><input type="file" name="file" accept="image/webp,image/png,image/jpeg,image/gif,image/avif,application/pdf" multiple>
    <span>Alege sau trage fișiere aici — WebP, PNG, JPEG, GIF, AVIF, PDF, cel mult 15 MB</span></label><div class="form-msg" role="status"></div></form>` : ''}
  <div class="media-grid">${items.map(m => `<a class="card media-item" href="/manage/media/${m.id}/">${isImg(m) ? `<img src="${esc(m.path)}?v=${Date.parse(m.updated_at).toString(36)}" alt="" loading="lazy">` : `<span class="file">${esc(m.mime ?? 'fișier')}</span>`}
    <b>${esc(m.path.split('/').pop())}</b><small>${m.alt ? esc(m.alt.slice(0, 60)) : '<span class="bad-text">fără text alternativ</span>'}</small>
    <small class="muted">${counts.get(m.id) ? `${counts.get(m.id)} pagini` : 'nefolosit'} · ${Math.round((m.size ?? 0) / 1024)} KB</small></a>`).join('') || '<p class="empty">Niciun fișier.</p>'}</div>`;
  return shell(db, user, {title: 'Media', active: 'media', body});
}

export function mediaDetail(db, user, id) {
  const m = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
  if (!m) return null;
  const st = createStore(db), u = st.mediaUsage(id);
  const hist = db.prepare("SELECT * FROM audit_log WHERE entity = 'media' AND entity_id = ? ORDER BY id DESC LIMIT 30").all(id);
  const w = can(user, 'media.write');
  const body = `<header class="page-h"><div><div class="crumbs"><a href="/manage/media/">Media</a></div><h1>${esc(m.path.split('/').pop())}</h1><div class="muted mono">${esc(m.path)} · ${esc(m.mime)} · ${Math.round((m.size ?? 0) / 1024)} KB · SHA-1 ${esc(m.sha1.slice(0, 12))}…</div></div>
    <div class="actions"><a class="btn ghost" href="${esc(m.path)}" target="_blank" rel="noopener">Deschide fișierul ↗</a>${w ? '<button class="btn danger ghost" data-media-delete>Șterge</button>' : ''}</div></header>
  <div class="cols"><div class="stack">
    <section class="card">${m.mime?.startsWith('image/') ? `<img class="media-preview" src="${esc(m.path)}?v=${Date.parse(m.updated_at).toString(36)}" alt="${esc(m.alt ?? '')}">` : `<p>${esc(m.mime)}</p>`}</section>
    ${w ? `<form class="card form" data-media-meta><div class="field"><label for="alt">Text alternativ</label><input id="alt" name="alt" value="${esc(m.alt ?? '')}" maxlength="250">
      <small class="muted">Descrie ce se vede. Se schimbă pe toate paginile care afișează fișierul.</small></div>
      <div class="field"><label for="title">Titlu</label><input id="title" name="title" value="${esc(m.title ?? '')}" maxlength="200"></div>
      <div class="form-actions"><button class="btn primary" type="submit">Salvează</button></div><div class="form-msg" role="status"></div></form>
    <form class="card upload" data-replace><h2>Înlocuiește fișierul</h2><label class="drop"><input type="file" name="file" accept="${esc(m.mime)}"><span>Același tip (${esc(m.mime)}). ID-ul și adresa rămân; <code>?v=</code> se schimbă pe toate paginile.</span></label>
      <div class="form-msg" role="status"></div></form>` : ''}
  </div><div class="stack">
    <section class="card"><h2>Unde e folosit</h2><h3 class="small">Înregistrări</h3><ul class="plain">${u.records.map(r => `<li><a href="${entUrl(r.key, r.id)}">${esc(entity(r.key).one)}: ${esc(titleOf(r.key, st.get(r.key, r.id)))}</a> <small class="muted">${esc(r.field)}</small></li>`).join('') || '<li class="muted">Niciuna.</li>'}</ul>
      <h3 class="small">Pagini publice</h3><ul class="plain">${u.pages.map(p => `<li><a href="${esc(p)}" target="_blank" rel="noopener">${esc(p)}</a></li>`).join('') || '<li class="muted">Niciuna.</li>'}</ul>
      ${u.records.length || u.pages.length ? '<p class="hint">Un fișier folosit nu se poate șterge.</p>' : ''}</section>
    <section class="card"><h2>Istoric</h2><ul class="plain">${hist.map(a => `<li><small>${esc(fmtDate(a.at))}</small> · ${esc(a.user_name)} · ${esc(a.action)}</li>`).join('') || '<li class="muted">Importat din site-ul vechi.</li>'}</ul></section>
  </div></div>`;
  return shell(db, user, {title: m.path.split('/').pop(), active: 'media', body, data: {media: id}});
}

// ———————————————————————————————————————————— Setări și copii de siguranță

const KIND = {auto: ['automată', 'mute'], manual: ['manuală', 'ok'], 'pre-restore': ['înainte de restaurare', 'warn'], upload: ['încărcată', 'warn']};
const size = n => n == null ? '' : n > 1048576 ? `${(n / 1048576).toFixed(1)} MB` : `${Math.round(n / 1024)} KB`;

export function settingsPage(db, user, {backupDir}) {
  const list = listBackups(db, backupDir);
  const lastAuto = list.find(b => b.kind === 'auto' || b.kind === 'manual');
  const next = lastAuto ? new Date(Date.parse(lastAuto.at) + AUTO_EVERY_HOURS * 3600_000) : null;
  const meta = k => { try { return JSON.parse(db.prepare('SELECT value FROM meta WHERE key = ?').get(k)?.value ?? 'null'); } catch { return null; } };
  const restore = meta('last_restore'), lastScan = meta('last_scan'), sync = syncStatus(db);
  const dbSize = db.prepare('SELECT page_count * page_size n FROM pragma_page_count(), pragma_page_size()').get().n;
  const canRestore = can(user, 'backups.restore'), canDl = can(user, 'backups.download');
  const body = `<header class="page-h"><div><h1>Setări și copii de siguranță</h1><p class="muted">O copie automată pe zi (verificată la fiecare oră: se face dacă ultima are peste ${AUTO_EVERY_HOURS} de ore). Copia cuprinde baza și fișierele media.</p></div></header>
  <div class="cols"><section class="card"><h2>Copii de siguranță <small>${list.length}</small></h2>
    <form class="form inline" data-backup-create><label>Notă (opțional)<input name="note" maxlength="200" placeholder="de ex. înainte de schimbarea prețurilor"></label><button class="btn primary" type="submit">Creează o copie acum</button><span class="form-msg" role="status"></span></form>
    <table class="tbl compact"><thead><tr><th>Când</th><th>Fel</th><th>Mărime</th><th>Cine</th><th>Notă</th><th></th></tr></thead><tbody>
    ${list.map(b => `<tr><td>${esc(fmtDate(b.at))}</td><td>${badge(KIND[b.kind] ?? [b.kind, ''])}${b.restored_at ? `<br><small>restaurată ${esc(fmtDate(b.restored_at))} de ${esc(b.restored_by)}</small>` : ''}</td>
      <td>${size(b.size)}${b.media != null ? `<br><small class="muted">${b.media} fișiere media</small>` : ''}</td><td>${esc(b.by ?? '')}</td><td><small>${esc(b.note ?? '')}</small></td>
      <td>${b.exists ? `${canDl ? `<a class="btn small" href="/api/manage/backups/${b.id}/download">Descarcă</a>` : ''} ${canRestore ? `<button class="btn small danger ghost" data-restore="${b.id}" data-restore-at="${esc(fmtDate(b.at))}">Restaurează</button>` : ''}` : '<span class="muted">fișier lipsă</span>'}</td></tr>`).join('')
      || '<tr><td colspan="6" class="empty">Nicio copie încă.</td></tr>'}</tbody></table></section>
  <div class="stack">
    <section class="card"><h2>Stare</h2><dl class="kv">
      <div><dt>Ultima copie</dt><dd>${lastAuto ? esc(fmtDate(lastAuto.at)) : '—'}</dd></div>
      <div><dt>Următoarea automată</dt><dd>${next ? (next <= new Date() ? 'la următoarea verificare orară' : esc(fmtDate(next.toISOString()))) : 'la următoarea verificare orară'}</dd></div>
      <div><dt>Ultima restaurare</dt><dd>${restore ? `${esc(fmtDate(restore.at))}, ${esc(restore.by)} — copia din ${esc(fmtDate(restore.from))}` : '—'}</dd></div>
      <div><dt>Baza de date</dt><dd>${size(dbSize)}</dd></div><div><dt>Pagini în index</dt><dd>${sync.pages}</dd></div>
      <div><dt>Ultima scanare</dt><dd>${lastScan ? `${esc(fmtDate(lastScan.at))} · ${lastScan.pages} pagini` : '—'}</dd></div>
      <div><dt>Directorul copiilor</dt><dd class="mono">${esc(backupDir)}</dd></div></dl></section>
    ${canRestore ? `<form class="card upload" data-restore-upload><h2>Restaurează dintr-un fișier</h2><label class="drop"><input type="file" name="file" accept=".gz,application/gzip">
      <span>O copie descărcată de aici (.tar.gz). Înainte de restaurare se face automat o copie a stării curente.</span></label><div class="form-msg" role="status"></div></form>` : ''}
    <section class="card"><h2>Ce face restaurarea</h2><ul class="plain small">
      <li>Face întâi o copie „înainte de restaurare” a stării curente.</li>
      <li>Readuce conținutul, sursele, istoricul, redirecționările și fișierele media din copie, într-o singură tranzacție.</li>
      <li>Nu atinge conturile, sesiunile și registrul copiilor.</li>
      <li>Emite un eveniment global: toate paginile site-ului se refac singure.</li></ul></section>
  </div></div>`;
  return shell(db, user, {title: 'Setări', active: 'setari', body});
}

export function forbiddenPage(db, user, msg) {
  return shell(db, user, {title: 'Acces interzis', body: `<section class="card"><h1>Acces interzis</h1><p>${esc(msg)}</p></section>`});
}
