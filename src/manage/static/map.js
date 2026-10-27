// Harta legăturilor (§2.4): tipuri → membri → o entitate. Datele vin din /api/manage/graph/*, la cerere.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const get = url => fetch(`/api/manage${url}`, {credentials: 'same-origin'}).then(r => r.ok ? r.json() : r.json().then(e => Promise.reject(new Error(e.error))));
  const stage = $('#map-stage'), side = $('#map-side'), crumbs = $('#map-crumbs');
  const state = {level: 'types', type: null, node: null, layers: $$('[data-layer]').filter(c => c.checked).map(c => c.dataset.layer), status: '', pages: true};
  let overview = null, edges = null;
  const ent = (key, rid, tab = 'prezentare') => `/manage/entitati/${key}/${rid}/${tab}/`;
  const STATUS = {confirmed: 'confirmată', inferred: 'dedusă', unverified: 'neverificată'};
  const layersQ = () => `layers=${state.layers.join(',')}`;

  // „Drumul tău”: ultimele entități deschise (doar în acest browser)
  const trail = {
    read() { try { return JSON.parse(localStorage.getItem('brain-trail') ?? '[]'); } catch { return []; } },
    push(n) { try { const t = [n, ...this.read().filter(x => x.id !== n.id)].slice(0, 8); localStorage.setItem('brain-trail', JSON.stringify(t)); } catch { /* fără stocare */ } }
  };

  function setCrumbs() {
    const parts = [`<button data-go="types">Tipuri</button>`];
    if (state.type) parts.push(`<button data-go="members">${esc(overview?.types.find(t => t.key === state.type)?.label ?? state.type)}</button>`);
    if (state.level === 'node' && state.node) parts.push(`<b>${esc(state.node.title)}</b>`);
    const t = trail.read();
    crumbs.innerHTML = parts.join(' › ') + (t.length ? ` <span class="muted">· Drumul tău: ${t.map(n => `<button data-node="${esc(n.id)}">${esc(n.title.slice(0, 24))}</button>`).join(', ')}</span>` : '');
  }
  crumbs.addEventListener('click', e => {
    if (e.target.dataset.go === 'types') showTypes();
    if (e.target.dataset.go === 'members') showMembers(state.type);
    if (e.target.dataset.node) showNode(e.target.dataset.node);
  });

  // ———————————————————————— nivelul 1: tipurile
  async function showTypes() {
    state.level = 'types'; state.type = null; state.node = null; setCrumbs();
    overview = await get(`/graph/overview?${layersQ()}`);
    const cats = [...new Set(overview.types.map(t => t.category))];
    const colW = 230, rowH = 62, boxW = 170, boxH = 42, top = 34;
    const pos = new Map();
    cats.forEach((c, ci) => overview.types.filter(t => t.category === c).forEach((t, ri) => pos.set(t.key, {x: 20 + ci * colW, y: top + ri * rowH, t})));
    const W = 40 + cats.length * colW, H = top + Math.max(...cats.map(c => overview.types.filter(t => t.category === c).length)) * rowH + 30;
    const links = overview.links.filter(l => pos.has(l.source) && pos.has(l.target))
      .filter(l => state.status !== 'review' || l.toReview).filter(l => state.status !== 'confirmed' || (l.statuses.confirmed ?? 0) || l.possible);
    const path = l => {
      const a = pos.get(l.source), b = pos.get(l.target);
      if (a === b) return `M${a.x + boxW},${a.y + 14} C${a.x + boxW + 50},${a.y - 10} ${a.x + boxW + 50},${a.y + boxH + 10} ${a.x + boxW},${a.y + boxH - 14}`;
      if (a.x === b.x) { // aceeași coloană: arc pe dreapta
        const ya = a.y + boxH / 2, yb = b.y + boxH / 2, bend = 30 + Math.abs(yb - ya) / 4;
        return `M${a.x + boxW},${ya} C${a.x + boxW + bend},${ya} ${a.x + boxW + bend},${yb} ${a.x + boxW},${yb}`;
      }
      const x1 = a.x + (b.x >= a.x ? boxW : 0), y1 = a.y + boxH / 2, x2 = b.x + (b.x >= a.x ? 0 : boxW), y2 = b.y + boxH / 2, dx = Math.max(40, Math.abs(x2 - x1) / 2);
      return `M${x1},${y1} C${x1 + (b.x >= a.x ? dx : -dx)},${y1} ${x2 + (b.x >= a.x ? -dx : dx)},${y2} ${x2},${y2}`;
    };
    stage.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Harta tipurilor">
      ${cats.map((c, ci) => `<text class="col-h" x="${20 + ci * colW}" y="18">${esc(overview.types.find(t => t.category === c).categoryLabel)}</text>`).join('')}
      ${links.map((l, i) => `<path class="edge${l.possible ? ' possible' : ''}" data-i="${i}" d="${path(l)}" stroke="${pos.get(l.source).t.color}" stroke-opacity=".55"
        stroke-width="${l.possible ? 1 : 1 + 2 * Math.sqrt(l.count)}"><title>${esc(l.source)} ${esc(l.verb)} ${esc(l.target)}: ${l.count}${l.toReview ? ` (${l.toReview} de verificat)` : ''}</title></path>`).join('')}
      ${links.filter(l => l.toReview).map(l => { const a = pos.get(l.source), b = pos.get(l.target); return `<circle cx="${(a.x + b.x) / 2 + boxW / 2}" cy="${(a.y + b.y) / 2 + boxH / 2}" r="4" fill="#b42318"><title>${l.toReview} de verificat</title></circle>`; }).join('')}
      ${[...pos.values()].map(({x, y, t}) => `<g class="tnode" data-type="${t.key}" transform="translate(${x},${y})"><rect width="${boxW}" height="${boxH}" rx="8" stroke="${t.color}"/>
        <circle cx="14" cy="${boxH / 2}" r="5" fill="${t.color}"/><text x="26" y="${boxH / 2 + 4}">${esc(t.label)}</text><text class="cnt" x="${boxW - 10}" y="${boxH / 2 + 4}" text-anchor="end">${t.count}</text></g>`).join('')}
    </svg>`;
    const paths = $$('path.edge', stage);
    $$('.tnode', stage).forEach(g => {
      const k = g.dataset.type;
      g.addEventListener('mouseenter', () => paths.forEach(p => { const l = links[p.dataset.i]; p.classList.toggle('dim', l.source !== k && l.target !== k); }));
      g.addEventListener('mouseleave', () => paths.forEach(p => p.classList.remove('dim')));
      g.addEventListener('click', () => showMembers(k));
    });
    paths.forEach(p => p.addEventListener('click', () => relationPanel(links[p.dataset.i])));
    side.innerHTML = `<h2>Legendă</h2><p class="small">Grosimea liniei ∝ √(numărul legăturilor). Linie punctată: pereche posibilă (declarată în registru), încă nefolosită. <span class="dot"></span> = legături de verificat.</p>
      <p class="small">Clic pe un tip pentru membrii lui, pe o muchie pentru panoul relației.</p>`;
  }

  async function relationPanel(l) {
    edges ??= await get('/graph/edges');
    const r = edges.find(x => x.id === l.relation);
    side.innerHTML = r ? `<h2>${esc(r.sourceLabel)} → ${esc(r.verb)} → ${esc(r.targetLabel)}</h2>
      <dl class="kv"><div><dt>Stocare</dt><dd class="mono">${esc(r.storage)}</dd></div><div><dt>Cardinalitate</dt><dd>${esc(r.cardinality)}${r.required ? ' · obligatorie' : ''}${r.ordered ? ' · ordonată' : ''}</dd></div>
      <div><dt>Verb / invers</dt><dd>${esc(r.verb)} / ${esc(r.inverseLabel)}</dd></div><div><dt>Legături</dt><dd>${r.count} (${r.sources} surse → ${r.targets} ținte)</dd></div>
      <div><dt>De verificat</dt><dd>${r.toReview}</dd></div><div><dt>Rupte</dt><dd>${r.broken}</dd></div><div><dt>Obligatorie goală</dt><dd>${r.requiredEmpty}</dd></div>
      <div><dt>Exemple</dt><dd>${r.examples.map(esc).join('<br>') || '—'}</dd></div><div><dt>Se editează din</dt><dd>${esc(r.editedFrom)}</dd></div><div><dt>La ștergere</dt><dd>${esc(r.onTargetDelete)}</dd></div>
      ${r.sensitive ? '<div><dt>Sensibilă</dt><dd>🔒 schimbarea cere aprobare</dd></div>' : ''}</dl>`
      : `<h2>${esc(l.relation)}</h2><p class="small">Legătură calculată (${esc(l.layer)}): ${l.count}.</p>`;
  }

  // ———————————————————————— nivelul 2: membrii unui tip
  async function showMembers(type, q = '', offset = 0) {
    state.level = 'members'; state.type = type; setCrumbs();
    const m = await get(`/graph/members?type=${encodeURIComponent(type)}&q=${encodeURIComponent(q)}&offset=${offset}&${layersQ()}`);
    stage.innerHTML = `<div class="pad"><input type="search" id="members-q" value="${esc(q)}" placeholder="Filtrează…"> <span class="muted">${m.total} înregistrări, cele mai conectate primele</span></div>
      <ul class="mlist">${m.items.map(n => `<li data-node="${esc(n.id)}"><span>${esc(n.title)}</span><span class="muted">${n.degree} legături</span></li>`).join('')}</ul>
      <div class="pad">${offset > 0 ? `<button class="btn small" data-off="${offset - m.limit}">← Înapoi</button>` : ''} ${offset + m.limit < m.total ? `<button class="btn small" data-off="${offset + m.limit}">Mai departe →</button>` : ''}</div>`;
    const qi = $('#members-q');
    let t; qi.addEventListener('input', () => { clearTimeout(t); t = setTimeout(() => showMembers(type, qi.value, 0), 250); });
    $$('[data-node]', stage).forEach(li => li.addEventListener('click', () => showNode(li.dataset.node)));
    $$('[data-off]', stage).forEach(b => b.addEventListener('click', () => showMembers(type, qi.value, +b.dataset.off)));
  }

  // ———————————————————————— nivelul 3: o entitate
  async function showNode(id) {
    const n = await get(`/graph/neighbors?node=${encodeURIComponent(id)}&${layersQ()}`);
    state.level = 'node'; state.node = n.node; state.type = n.node.key; trail.push({id: n.node.id, title: n.node.title}); setCrumbs();
    history.replaceState(null, '', `?node=${encodeURIComponent(id)}`);
    const ok = e => !state.status || (state.status === 'confirmed' ? e.status === 'confirmed' : e.status !== 'confirmed');
    const group = (list, dir) => {
      const by = new Map();
      for (const e of list.filter(ok)) (by.get(e.node.key ?? '?') ?? by.set(e.node.key ?? '?', []).get(e.node.key ?? '?')).push(e);
      return [...by].map(([k, items]) => `<div class="ngroup"><h3>${esc(overview?.types.find(t => t.key === k)?.label ?? k)} · ${items.length}</h3>${items.map(e =>
        `<div class="nitem ${e.status}" data-node="${esc(e.node.id)}" title="${esc(STATUS[e.status] ?? e.status)}${e.note ? ` — ${esc(e.note)}` : ''}${e.by ? ` · ${esc(e.by)}` : ''}">
          ${e.status !== 'confirmed' ? '<span class="dot"></span>' : ''}${e.sensitive ? '🔒' : ''}<span>${esc(e.node.title)}</span><span class="verb">${esc(dir === 'in' ? e.verb : e.verb)}${e.layer !== 'relatii' ? ` · ${esc(e.layer)}` : ''}</span></div>`).join('')}</div>`).join('') || '<p class="muted">—</p>';
    };
    const [key, rid] = n.node.id.split(':');
    stage.innerHTML = `<div class="nview"><div><h3 class="muted">Intrări ← ${n.incoming.length}</h3>${group(n.incoming, 'in')}</div>
      <div class="center"><div class="muted small">${esc(overview?.types.find(t => t.key === key)?.label ?? key)}</div><h2>${esc(n.node.title)}</h2>
        ${key !== 'media' ? `<p class="small"><a href="${ent(key, rid)}">Deschide</a> · <a href="${ent(key, rid, 'relatii')}">Relații</a> · <a href="${ent(key, rid, 'unde-apare')}">Unde apare</a> · <a href="${ent(key, rid, 'surse')}">Surse</a></p>` : ''}</div>
      <div><h3 class="muted">Ieșiri → ${n.outgoing.length}</h3>${group(n.outgoing, 'out')}</div></div>
      ${state.pages ? `<h3>Pagini care o afișează</h3>${n.pages.length ? `<ul class="plain">${n.pages.map(g => `<li><b>${esc(g.component)}</b>${g.layout ? ' <small class="muted">componentă comună</small>' : ''}: ${g.paths.slice(0, 12).map(p => `<a href="${esc(p)}" target="_blank" rel="noopener">${esc(p)}</a>`).join(', ')}${g.paths.length > 12 ? ` și încă ${g.paths.length - 12}` : ''}</li>`).join('')}</ul>` : '<p class="muted">Nu apare în nicio pagină publică.</p>'}` : ''}`;
    $$('[data-node]', stage).forEach(el => el.addEventListener('click', () => showNode(el.dataset.node)));
    side.innerHTML = `<h2>${esc(n.node.title)}</h2><p class="small">${n.incoming.length} intrări, ${n.outgoing.length} ieșiri, ${n.pages.reduce((a, g) => a + g.paths.length, 0)} afișări în pagini.</p>
      <p class="small">Linie plină = confirmată · întreruptă = dedusă · punctată = neverificată. Clic pe un vecin mută harta pe el.</p>`;
  }

  // ———————————————————————— filtre, straturi, căutare
  $$('[data-layer]').forEach(c => c.addEventListener('change', () => { state.layers = $$('[data-layer]').filter(x => x.checked).map(x => x.dataset.layer); edges = null; rerender(); }));
  $('#map-status').addEventListener('change', e => { state.status = e.target.value; rerender(); });
  $('#map-pages').addEventListener('change', e => { state.pages = e.target.checked; rerender(); });
  const rerender = () => state.level === 'types' ? showTypes() : state.level === 'members' ? showMembers(state.type) : showNode(state.node.id);
  const searchInput = $('#map-search');
  window.brainSuggest(searchInput, null, n => showNode(n.id));

  // ———————————————————————— traseul
  const ends = {};
  $$('[data-path-end]').forEach(inp => window.brainSuggest(inp, null, n => { ends[inp.dataset.pathEnd] = n.id; }));
  $('#path-go').addEventListener('click', async () => {
    const out = $('#path-out');
    if (!ends.from || !ends.to) { out.innerHTML = '<p class="muted">Alege ambele capete din sugestii.</p>'; return; }
    const r = await get(`/graph/path?from=${encodeURIComponent(ends.from)}&to=${encodeURIComponent(ends.to)}&layers=relatii,calculate,texte`);
    out.innerHTML = !r?.found ? '<p class="muted">Niciun traseu în cel mult 6 pași (fără imagini ca intermediar).</p>'
      : `<p>${r.steps.length} ${r.steps.length === 1 ? 'pas' : 'pași'}:</p><ol class="steps">${r.steps.map(s => `<li><a href="#" data-node="${esc(s.from.id)}">${esc(s.from.title)}</a> <i>${s.dir === 'out' ? '→' : '←'} ${esc(s.verb)}</i> <a href="#" data-node="${esc(s.to.id)}">${esc(s.to.title)}</a> ${s.status !== 'confirmed' ? `<span class="badge warn">${esc(STATUS[s.status])}</span>` : ''}</li>`).join('')}</ol>`;
    $$('[data-node]', out).forEach(a => a.addEventListener('click', e => { e.preventDefault(); showNode(a.dataset.node); }));
  });

  // ———————————————————————— sănătatea hărții și „Toate legăturile”
  get('/graph/health').then(h => {
    const li = (arr, f) => arr.length ? `<ul class="plain">${arr.slice(0, 15).map(f).join('')}</ul>${arr.length > 15 ? `<p class="muted small">și încă ${arr.length - 15}</p>` : ''}` : '<p class="muted small">Nimic.</p>';
    $('#health').innerHTML = `<p>${h.ok ? '<span class="badge ok">0 trimiteri rupte · 0 relații obligatorii goale</span>' : '<span class="badge bad">Are probleme</span>'}</p>
      <h3 class="small">Tipuri izolate</h3>${li(h.isolatedTypes, t => `<li>${esc(t.label)}</li>`)}
      <h3 class="small">Relații declarate, dar nefolosite</h3>${li(h.unusedRelations, r => `<li class="mono">${esc(r.id)}</li>`)}
      <h3 class="small">Trimiteri spre înregistrări care nu mai există</h3>${li(h.broken, b => `<li>${esc(b.srcTitle)} → ${esc(b.dst)}</li>`)}
      <h3 class="small">Relații obligatorii goale</h3>${li(h.requiredEmpty, r => `<li><a href="${ent(r.key, r.id, 'relatii')}">${esc(r.title)}</a>: ${esc(r.field)}</li>`)}
      <h3 class="small">Înregistrări orfane</h3>${li(h.orphans, o => `<li><a href="${ent(o.key, o.rid)}">${esc(o.title)}</a> <small class="muted">${esc(o.key)}</small></li>`)}`;
  });
  async function edgesTable() {
    edges ??= await get('/graph/edges');
    const q = $('#edges-q').value.toLowerCase(), g = $('#edges-group').value;
    const rows = edges.filter(r => (!g || r.group === g) && (!q || `${r.id} ${r.verb} ${r.sourceLabel} ${r.targetLabel}`.toLowerCase().includes(q)));
    $('#edges').innerHTML = `<table class="tbl compact"><thead><tr><th>Relație</th><th>Grup</th><th>Cardinalitate</th><th>Legături</th><th>De verificat</th><th>Rupte</th><th>Stocare</th></tr></thead><tbody>${rows.map(r =>
      `<tr><td>${esc(r.sourceLabel)} <i>${esc(r.verb)}</i> ${esc(r.targetLabel)}${r.sensitive ? ' 🔒' : ''}</td><td>${esc(r.group)}</td><td>${esc(r.cardinality)}${r.required ? ' · oblig.' : ''}</td>
        <td>${r.count}</td><td>${r.toReview || ''}</td><td>${r.broken ? `<span class="badge bad">${r.broken}</span>` : ''}</td><td class="mono">${esc(r.storage)}</td></tr>`).join('')}</tbody></table>`;
  }
  $('#edges-q').addEventListener('input', edgesTable); $('#edges-group').addEventListener('change', edgesTable);
  edgesTable();

  // pornire: ?node= sau ?type=
  const params = new URLSearchParams(location.search);
  showTypes().then(() => { if (params.get('node')) showNode(params.get('node')); else if (params.get('type')) showMembers(params.get('type')); });
})();
