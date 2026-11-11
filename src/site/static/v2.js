// Kurat /v2 — o singură stare pentru toată pagina (serviciu, suprafață, mobilier, extra, zi, interval).
// Fiecare control o schimbă, iar render() actualizează tot ce o arată: hero, configurator, bon, bara de jos, rezumatul de rezervare.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const lei = n => `${Math.round(n).toLocaleString('ro-RO')} lei`;
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const cfg = JSON.parse($('#v2-cfg')?.textContent || '{"services":[],"extras":[],"mult":[]}');
  const KEY = 'kurat-v2-estimare';

  const state = {svc: +document.body.dataset.defaultSvc || cfg.services[0]?.id, area: 60, mult: cfg.mult[0]?.nivel ?? null, extras: new Set(), day: null, slot: 'dimineața', note: ''};
  try { // vizitatorul care revine își regăsește estimarea
    const saved = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (saved && cfg.services.some(s => s.id === saved.svc)) Object.assign(state, saved, {extras: new Set(saved.extras ?? [])});
  } catch {}
  const pre = +new URLSearchParams(location.search).get('serviciu');
  if (cfg.services.some(s => s.id === pre)) state.svc = pre;

  const svc = () => cfg.services.find(s => s.id === state.svc);
  const multOf = () => cfg.mult.find(m => m.nivel === state.mult);
  const total = () => {
    const s = svc(); if (!s) return null;
    const extra = cfg.extras.filter(x => state.extras.has(x.id)).reduce((a, x) => a + x.price, 0);
    return Math.max(cfg.min, s.rate * state.area * (multOf()?.multiplicator ?? 1) + extra);
  };

  // ——— numărul care „curge” spre noua valoare
  const shown = new WeakMap();
  const tick = (el, to) => {
    const from = shown.get(el) ?? to; shown.set(el, to);
    if (reduce || document.hidden || from === to) { el.textContent = lei(to); return; }
    const t0 = performance.now(), d = 420;
    const step = now => { const k = Math.min(1, (now - t0) / d), e = 1 - Math.pow(1 - k, 3); el.textContent = lei(from + (to - from) * e); if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
    el.classList.remove('v2-total-bump'); void el.offsetWidth; el.classList.add('v2-total-bump');
  };

  // ——— pastila care alunecă sub butonul ales (segmente și comutatoare)
  const pill = group => {
    const p = $('.pill', group), on = $('[aria-pressed=true],[aria-selected=true]', group);
    if (!p || !on) return;
    p.style.width = `${on.offsetWidth}px`; p.style.transform = `translateX(${on.offsetLeft}px)`;
  };
  const pills = () => $$('.v2-seg,.v2-switch').forEach(pill);

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify({...state, extras: [...state.extras], note: ''})); } catch {} };

  function render(changed = true) {
    const s = svc(), t = total();
    $$('[data-svc]').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.svc === state.svc)));
    $$('[data-mult]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.mult === state.mult)));
    $$('[data-extra]').forEach(i => { i.checked = state.extras.has(+i.dataset.extra); });
    $$('[data-area]').forEach(i => { if (document.activeElement !== i) i.value = i.type === 'range' ? Math.min(state.area, +i.max) : state.area; if (i.type === 'range') i.style.setProperty('--p', `${(Math.min(state.area, +i.max) - i.min) / (i.max - i.min) * 100}%`); });
    $$('[data-area-out]').forEach(o => { o.textContent = `${state.area} mp`; });
    $$('[data-area-set]').forEach(b => b.classList.toggle('on', +b.dataset.areaSet === state.area));
    $$('[data-total]').forEach(el => t == null ? (el.textContent = '—') : tick(el, t));
    const dockSvc = $('[data-dock-svc]'); if (dockSvc) dockSvc.textContent = s ? `${s.name} · ${state.area} mp` : 'Alege un serviciu';
    // bonul: fiecare rând arată de unde vine prețul
    const lines = $('[data-lines]');
    if (lines && s) {
      const m = multOf(), base = s.rate * state.area;
      const rows = [[`${s.name}`, `${state.area} mp × ${s.rate} lei`, base]];
      if (m && m.multiplicator !== 1) rows.push([m.eticheta ?? m.nivel, `+${Math.round((m.multiplicator - 1) * 100)}%`, base * (m.multiplicator - 1)]);
      cfg.extras.filter(x => state.extras.has(x.id)).forEach(x => rows.push([x.name, '', x.price]));
      if (base * (m?.multiplicator ?? 1) + cfg.extras.filter(x => state.extras.has(x.id)).reduce((a, x) => a + x.price, 0) < cfg.min) rows.push(['Ajustare la comanda minimă', '', null]);
      lines.innerHTML = rows.map(([a, b, v]) => `<li><span>${esc(a)}${b ? ` <small>· ${esc(b)}</small>` : ''}</span><b>${v == null ? `min. ${lei(cfg.min)}` : `${v >= 0 ? '' : '−'}${lei(Math.abs(v))}`}</b></li>`).join('');
    }
    // rezumatul din pasul 4
    const sum = $('[data-summary]');
    if (sum) {
      const ex = cfg.extras.filter(x => state.extras.has(x.id)).map(x => x.name);
      const day = state.day ? new Date(state.day).toLocaleDateString('ro-RO', {weekday: 'long', day: 'numeric', month: 'long'}) : 'alegi alături';
      sum.innerHTML = s ? `<div class="row"><span>Serviciu</span><b>${esc(s.name)}</b></div><div class="row"><span>Suprafață</span><b>${state.area} mp${multOf() ? ` · ${esc(multOf().eticheta ?? '')}` : ''}</b></div>
        ${ex.length ? `<div class="row"><span>Extra</span><b>${esc(ex.join(', '))}</b></div>` : ''}<div class="row"><span>Când</span><b>${esc(day)}, ${esc(state.slot)}</b></div>
        ${state.note ? `<div class="row"><span>Cerere</span><b>${esc(state.note)}</b></div>` : ''}
        <div class="tot"><span>Estimare</span><strong>${t == null ? '—' : lei(t)}</strong></div><a class="edit" href="#calculator">Modifică detaliile</a>` : '<p>Alege mai întâi un serviciu.</p>';
    }
    $$('[data-day]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.day === state.day)));
    $$('[data-slot]').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.slot === state.slot)));
    pills();
    if (changed) save();
  }
  // schimbarea serviciului cu tranziție de vizualizare, unde browserul o are
  const vt = run => document.startViewTransition && !reduce && !document.hidden ? document.startViewTransition(run) : run();
  const update = (fn, anim = false) => { const run = () => { fn(); render(); }; anim ? vt(run) : run(); };

  // ——— zilele disponibile: următoarele 10 zile, fără duminică
  const days = $('[data-days]');
  if (days) {
    const out = []; const d = new Date(); d.setHours(12, 0, 0, 0);
    while (out.length < 10) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0) out.push(new Date(d)); }
    days.innerHTML = out.map(x => `<button type="button" data-day="${x.toISOString().slice(0, 10)}" aria-pressed="false" aria-label="${x.toLocaleDateString('ro-RO', {weekday: 'long', day: 'numeric', month: 'long'})}"><small>${x.toLocaleDateString('ro-RO', {weekday: 'short'}).replace('.', '')}</small><strong>${x.getDate()}</strong><small>${x.toLocaleDateString('ro-RO', {month: 'short'}).replace('.', '')}</small></button>`).join('');
    if (!out.some(x => x.toISOString().slice(0, 10) === state.day)) state.day = null;
  }

  // ——— clicuri: un singur ascultător pentru toată pagina
  document.addEventListener('click', e => {
    const b = e.target.closest('button,a');
    if (!b) return;
    if (b.dataset.svc) return update(() => { state.svc = +b.dataset.svc; }, true);
    if (b.dataset.pickSvc) { update(() => { state.svc = +b.dataset.pickSvc; }); return $('#calculator')?.scrollIntoView({behavior: reduce ? 'auto' : 'smooth'}); }
    if (b.dataset.mult) return update(() => { state.mult = b.dataset.mult; });
    if (b.dataset.areaStep) return update(() => { state.area = Math.max(10, Math.min(5000, state.area + +b.dataset.areaStep)); });
    if (b.dataset.areaSet) return update(() => { state.area = +b.dataset.areaSet; });
    if (b.dataset.day) return update(() => { state.day = b.dataset.day; });
    if (b.dataset.slot) return update(() => { state.slot = b.dataset.slot; });
    if ('goBook' in b.dataset && b.dataset.note) { state.note = `Ofertă pentru: ${b.dataset.note}`; const nf = $('[data-note-field]'); if (nf && !nf.value) nf.value = state.note; render(); }
    if (b.dataset.audF) {
      const f = b.dataset.audF, bento = $('[data-bento]');
      $$('[data-aud-f]').forEach(x => x.setAttribute('aria-selected', String(x === b)));
      const apply = () => { $$('[data-aud]', bento).forEach(c => c.classList.toggle('is-hidden', f !== '*' && c.dataset.aud !== f)); bento.classList.toggle('filtered', f !== '*'); };
      vt(apply);
      return pills();
    }
    if (b.dataset.side) {
      const box = b.closest('[data-compare]');
      $$('[data-side]', box).forEach(x => x.setAttribute('aria-pressed', String(x === b)));
      box.classList.toggle('is-no', b.dataset.side === 'no');
      return pill($('.v2-switch', box));
    }
    if (b.dataset.rev) { const tr = $('[data-rev-track]'); tr?.scrollBy({left: +b.dataset.rev * (tr.firstElementChild?.offsetWidth ?? 300) * 1.04, behavior: reduce ? 'auto' : 'smooth'}); }
  });
  document.addEventListener('input', e => {
    const i = e.target;
    if (i.matches('[data-area]')) { const v = +i.value; if (v >= 10) { state.area = Math.min(5000, v); render(); } }
    if (i.matches('[data-extra]')) update(() => { const id = +i.dataset.extra; i.checked ? state.extras.add(id) : state.extras.delete(id); });
    if (i.matches('[data-faq-q]')) faq(i.value);
  });

  // ——— „scrie liber”: înțelegem tipul, suprafața, camerele și mobilarea dintr-o frază
  const ask = $('[data-ask]'), askOut = $('[data-ask-out]');
  const by = re => cfg.services.find(s => re.test(`${s.name} ${s.slug ?? ''}`));
  const RULES = [[/renov|constru|șantier|santier|lucrări|lucrari|zugr/i, /constru/i], [/canap|mochet|covor|tapi|fotol/i, /canap|mochet/i],
    [/mentenan|regulat|săptăm|saptam|lunar|întreți|intreti|recurent|birou/i, /menten/i], [/general|profun|temeinic|mutare|mut |primăvar|primavar|curățenie mare|curatenie mare/i, /general/i]];
  function understand(text) {
    const t = ` ${text.toLowerCase()} `, got = [];
    for (const [re, svcRe] of RULES) if (re.test(t)) { const s = by(svcRe); if (s) { state.svc = s.id; got.push(s.name); break; } }
    const mp = t.match(/(\d{2,4})\s*(mp|m2|m²|metri|mpi)/), cam = t.match(/(\d)\s*(camere|cam\b|camera)/);
    if (mp) state.area = Math.min(5000, Math.max(10, +mp[1]));
    else if (cam) state.area = +cam[1] * 22 + 14;
    else if (/garsonier/.test(t)) state.area = 35;
    else if (/\bcas[aă]\b|vil[aă]/.test(t)) state.area = 140;
    if (mp || cam || /garsonier|\bcas[aă]\b|vil[aă]/.test(t)) got.push(`${state.area} mp`);
    const lv = (re, nivel) => { if (re.test(t) && cfg.mult.some(m => m.nivel === nivel)) { state.mult = nivel; got.push(cfg.mult.find(m => m.nivel === nivel).eticheta ?? nivel); return true; } };
    lv(/nemobil|fără mobil|fara mobil|gol\b|goal/, 'None') || lv(/puțin mobil|putin mobil|parțial|partial/, 'Little') || lv(/mobilat/, 'Full');
    cfg.extras.forEach(x => { const w = x.name.toLowerCase().split(/[\s(]/).filter(z => z.length > 4).pop(); if (w && t.includes(w.slice(0, 5)) && !state.extras.has(x.id)) { state.extras.add(x.id); got.push(x.name); } });
    return got;
  }
  const runAsk = () => {
    if (!ask?.value.trim()) return;
    const got = understand(ask.value);
    update(() => {}, true);
    askOut.innerHTML = got.length ? `Am înțeles: <b>${got.map(esc).join(' · ')}</b>. Ajustează oricând mai jos.` : 'N-am prins detaliile — alege tipul și suprafața mai jos.';
  };
  ask?.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); runAsk(); } });
  $('[data-ask-go]')?.addEventListener('click', runAsk);
  // exemple care se schimbă în câmp, cât timp e gol
  if (ask && !reduce) {
    const ex = ['apartament 3 camere, după renovare', 'birou 120 mp, curățenie săptămânală', 'garsonieră mobilată + interior cuptor', 'casă 160 mp, curățenie generală', 'canapea și mochetă, 40 mp'];
    let k = 0; setInterval(() => { if (document.activeElement !== ask && !ask.value) ask.placeholder = `ex: ${ex[k = (k + 1) % ex.length]}`; }, 3200);
  }

  // ——— FAQ: căutare cu evidențiere
  const faqItems = $$('[data-faq]').map(d => ({d, html: $('.ans', d).innerHTML, sum: $('summary', d).firstChild.textContent}));
  const norm = s => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  function faq(q) {
    const n = norm(q.trim());
    let hits = 0;
    faqItems.forEach(({d, html, sum}) => {
      const hit = !n || norm(sum + ' ' + d.textContent).includes(n);
      d.hidden = !hit; if (hit) hits++;
      $('.ans', d).innerHTML = html;
      if (n && hit) { d.open = true; const re = new RegExp(`(${q.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi'); $('.ans', d).innerHTML = html.replace(/>([^<]+)</g, (m, txt) => `>${txt.replace(re, '<mark>$1</mark>')}<`); }
    });
    const empty = $('[data-faq-empty]'); if (empty) empty.hidden = hits > 0;
  }

  // ——— rezervarea: trimite către același /api/cerere, cu toată estimarea în detalii
  const form = $('[data-book]');
  form?.addEventListener('submit', async e => {
    e.preventDefault();
    const msg = $('[data-msg]', form); msg.className = 'v2-msg';
    if (!form.reportValidity()) return;
    const s = svc(), fd = new FormData(form);
    const when = state.day ? `${new Date(state.day).toLocaleDateString('ro-RO', {weekday: 'long', day: 'numeric', month: 'long'})}, ${state.slot}` : `fără zi aleasă, ${state.slot}`;
    const data = {sursa: 'calculator', nume: fd.get('nume'), contact: fd.get('contact'),
      mesaj: [`Programare dorită: ${when}`, fd.get('zona') ? `Zona: ${fd.get('zona')}` : '', fd.get('mesaj')].filter(Boolean).join('\n'),
      detalii: {pagina: '/v2', serviciu: s?.name, suprafata: state.area, mobilier: state.mult, extra: cfg.extras.filter(x => state.extras.has(x.id)).map(x => x.name), estimare: Math.round(total() ?? 0), zi: state.day, interval: state.slot, zona: fd.get('zona') || null}};
    const btn = $('[data-submit]', form); btn.disabled = true; msg.textContent = 'Se trimite…';
    try {
      const res = await fetch('/api/cerere', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(data)});
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Nu am putut trimite cererea.');
      const book = form.closest('.v2-book'); book.classList.add('is-done'); $('[data-done]', book).hidden = false;
      $('[data-done-text]', book).textContent = `Te sunăm la ${data.contact} ca să confirmăm ${s?.name ?? 'curățenia'} (${when}).`;
      try { localStorage.removeItem(KEY); } catch {}
    } catch (err) { msg.classList.add('err'); msg.textContent = err.message; btn.disabled = false; }
  });

  // ——— antetul, firul drumului și bara de jos după derulare
  const head = $('[data-head]'), dock = $('[data-dock]'), hero = $('.v2-hero'), book = $('#rezerva');
  const rail = $$('[data-rail]'), fill = $('[data-rail-fill]');
  const secs = rail.map(a => document.getElementById(a.dataset.rail)).filter(Boolean);
  let raf = 0;
  const onScroll = () => {
    raf = 0;
    head?.classList.toggle('is-scrolled', scrollY > 8);
    const mid = scrollY + innerHeight * 0.4;
    let cur = -1; secs.forEach((s, i) => { if (s.offsetTop <= mid) cur = i; });
    rail.forEach((a, i) => { a.classList.toggle('on', i === cur); a.classList.toggle('done', i < cur); if (i === cur) a.setAttribute('aria-current', 'step'); else a.removeAttribute('aria-current'); });
    if (fill) fill.style.width = `${Math.min(100, scrollY / (document.documentElement.scrollHeight - innerHeight) * 100)}%`;
    if (dock && hero && book) {
      const past = hero.getBoundingClientRect().bottom < 0, r = book.getBoundingClientRect(), atBook = r.top < innerHeight * 0.85 && r.bottom > 0;
      dock.classList.toggle('is-on', past && !atBook);
    }
  };
  addEventListener('scroll', () => { raf ||= requestAnimationFrame(onScroll); }, {passive: true});
  addEventListener('resize', () => { pills(); onScroll(); });

  // ——— apariție la derulare (doar unde CSS nu are animation-timeline)
  if (!CSS.supports?.('animation-timeline: view()') && 'IntersectionObserver' in window && !reduce) {
    const els = $$('[data-reveal]');
    els.forEach(el => { if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-in'); });
    document.documentElement.classList.add('v2-js');
    const io = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('is-in'); io.unobserve(e.target); } }), {rootMargin: '0px 0px -8% 0px'});
    els.forEach(el => el.classList.contains('is-in') || io.observe(el));
  }

  render(false); onScroll();
  document.fonts?.ready.then(pills);
})();

// meniul principal se închide la clic în afară sau la Escape
(() => {
  const m = document.querySelector('[data-menu]');
  if (!m) return;
  document.addEventListener('click', e => { if (m.open && !m.contains(e.target)) m.open = false; });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && m.open) { m.open = false; m.querySelector('summary').focus(); } });
})();
