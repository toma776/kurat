// kurat.ro — antetul la derulare, meniul mobil, calculatorul de preț și trimiterea cererilor. Fără dependențe.
// Calculatorul folosește componentele originale Kurat (lk-choice, antet cu gradient, bară de progres din 5 segmente).
(() => {
  const $ = (s, r = document) => r.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const lei = n => `${Math.round(n).toLocaleString('ro-RO')} lei`;

  // antetul: transparent sus, cu fundal după derulare
  const hd = $('[data-header]');
  if (hd) {
    const onScroll = () => hd.classList.toggle('is-scrolled', window.scrollY > 8);
    onScroll();
    addEventListener('scroll', onScroll, {passive: true});
  }

  // meniul mobil
  // apariția la derulare: doar elementele încă nevăzute pornesc ascunse, deci nimic din primul ecran nu „clipește”
  const reveal = [...document.querySelectorAll('[data-reveal]')];
  if (reveal.length && 'IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    reveal.forEach(el => { if (el.getBoundingClientRect().top < innerHeight) el.classList.add('is-in'); });
    document.documentElement.classList.add('ds-js');
    const io = new IntersectionObserver(entries => entries.forEach(e => {
      if (!e.isIntersecting) return;
      // elementele din același rând apar unul după altul, discret
      const row = reveal.filter(x => !x.classList.contains('is-in') && Math.abs(x.getBoundingClientRect().top - e.boundingClientRect.top) < 4);
      row.forEach((x, i) => { x.style.transitionDelay = `${i * 70}ms`; x.classList.add('is-in'); io.unobserve(x); });
    }), {rootMargin: '0px 0px -8% 0px'});
    reveal.forEach(el => el.classList.contains('is-in') || io.observe(el));
  }

  // bara de acțiuni de pe mobil apare după primul ecran
  const mbar = $('[data-mbar]');
  if (mbar) {
    const onBar = () => mbar.classList.toggle('is-on', window.scrollY > innerHeight * 0.6);
    onBar();
    addEventListener('scroll', onBar, {passive: true});
  }

  const burger = $('[data-burger]'), menu = $('#ds-mmenu') ?? $('#kh-mobile-menu');
  // meniul de pe mobil ocupă tot ecranul: pagina din spate nu se mai derulează, iar butoanele plutitoare se ascund
  const setMenu = open => {
    menu.hidden = !open;
    burger.setAttribute('aria-expanded', String(open));
    burger.setAttribute('aria-label', open ? 'Închide meniul' : 'Meniu');
    document.body.classList.toggle('menu-open', open);
    hd?.classList.toggle('is-scrolled', open || window.scrollY > 8);
  };
  burger?.addEventListener('click', () => setMenu(menu.hidden));
  menu?.addEventListener('click', e => { if (e.target.closest('a')) setMenu(false); });
  addEventListener('keydown', e => { if (e.key === 'Escape' && menu && !menu.hidden) { setMenu(false); burger.focus(); } });
  addEventListener('resize', () => { if (menu && !menu.hidden && innerWidth > 1080) setMenu(false); });

  // trimiterea unei cereri (formularul de contact și calculatorul)
  async function sendLead(data, msgEl) {
    msgEl.className = 'form-msg';
    msgEl.textContent = 'Se trimite…';
    try {
      const res = await fetch('/api/cerere', {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify(data)});
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || 'Nu am putut trimite cererea.');
      msgEl.classList.add('ok');
      msgEl.textContent = 'Mulțumim! Te contactăm în cel mai scurt timp.';
      return true;
    } catch (e) {
      msgEl.classList.add('err');
      msgEl.textContent = e.message;
      return false;
    }
  }

  document.querySelectorAll('form[data-lead]').forEach(form => form.addEventListener('submit', async e => {
    e.preventDefault();
    if (!form.reportValidity()) return;
    const data = Object.fromEntries(new FormData(form));
    if (await sendLead(data, $('.form-msg', form))) form.reset();
  }));

  // ——— calculatorul: configurația vine din Brain, în <script type="application/json"> din formular
  const CHECK = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
  const choice = ({pressed, data, color, iconHtml, title, sub}) => `<button type="button" class="lk-choice" ${data} aria-pressed="${pressed}" style="display: flex; align-items: center; gap: 14px; text-align: start; padding: 15px 16px; border-radius: var(--radius-md); cursor: pointer; width: 100%; border: 2px solid ${pressed ? 'var(--brand)' : 'var(--border-subtle)'}; background: ${pressed ? 'var(--brand-tint)' : 'var(--surface-card)'};">
    ${iconHtml ? `<span aria-hidden="true" style="width: 44px; height: 44px; flex: none; border-radius: 12px; display: flex; align-items: center; justify-content: center; background: ${pressed ? color : 'var(--surface-sunken)'}; color: ${pressed ? '#fff' : color};">${iconHtml}</span>` : ''}
    <span style="flex: 1; min-width: 0;"><span style="display: block; font-weight: 800; font-size: 16px; color: var(--text-strong);">${esc(title)}</span>${sub ? `<span style="display: block; font-size: 13px; color: var(--text-muted); margin-top: 2px;">${sub}</span>` : ''}</span>
    ${pressed ? `<span aria-hidden="true" style="width: 26px; height: 26px; flex: none; border-radius: 50%; background: var(--brand); display: flex; align-items: center; justify-content: center;">${CHECK}</span>` : ''}</button>`;
  const BTN = 'height: 52px; border-radius: var(--radius-md); font-weight: 800; font-size: 16px; cursor: pointer; font-family: var(--font-body);';
  const INPUT = 'width: 100%; height: 48px; padding: 0 14px; border: 1.5px solid var(--border-default); border-radius: var(--radius-md); background: var(--surface-card); color: var(--text-strong); font-family: var(--font-body); font-size: 15px; box-sizing: border-box;';
  const LABEL = 'display: block; font-size: 13.5px; font-weight: 700; color: var(--text-strong); margin-bottom: 7px;';

  document.querySelectorAll('form[data-calc]').forEach(form => {
    const cfg = JSON.parse($('script[type="application/json"]', form).textContent);
    const labels = {None: 'Fără mobilă', Little: 'Puțin mobilat', Full: 'Complet mobilat'};
    const state = {step: 0, service: null, area: 60, mult: cfg.mult[0]?.nivel ?? null, extras: new Set()};
    // venit de pe pagina unui serviciu (/?serviciu=ID#calculator): serviciul e deja ales, pornim de la suprafață
    const pre = +new URLSearchParams(location.search).get('serviciu');
    if (cfg.services.some(x => x.id === pre)) { state.service = pre; state.step = 1; requestAnimationFrame(() => form.scrollIntoView({block: 'start'})); }
    const total = () => {
      const s = cfg.services.find(x => x.id === state.service);
      if (!s) return null;
      const m = cfg.mult.find(x => x.nivel === state.mult)?.multiplicator ?? 1;
      const extra = cfg.extras.filter(x => state.extras.has(x.id)).reduce((a, x) => a + x.price, 0);
      return Math.max(cfg.min, s.rate * state.area * m + extra);
    };
    const estimate = t => t == null ? '' : `<div style="display: flex; align-items: baseline; justify-content: space-between; gap: 12px; margin-top: 22px; padding: 16px 18px; border-radius: var(--radius-md); background: var(--surface-sunken);"><span style="font-size: 13px; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: var(--text-muted);">Estimare</span><strong data-total style="font-family: var(--font-display); font-size: 26px; font-weight: 800; color: var(--brand-strong);">${lei(t)}</strong></div>`;
    const group = (label, html) => `<div role="group" aria-label="${label}" style="display: flex; flex-direction: column; gap: 10px;">${html}</div>`;
    const steps = [
      ['Ce tip de curățenie?', () => group('Tipul de curățenie', cfg.services.map(s => choice({pressed: state.service === s.id, data: `data-svc="${s.id}"`, color: s.color, iconHtml: s.icon, title: s.name, sub: esc(s.desc ?? '')})).join('')), () => state.service != null],
      ['Cât de mare e spațiul?', () => `<label class="k-calc-field">Suprafață (mp)<input type="number" min="10" max="5000" step="5" value="${state.area}" data-area inputmode="numeric"></label>
        <input class="k-calc-range" type="range" min="10" max="500" step="5" value="${Math.min(state.area, 500)}" data-area aria-label="Suprafață (mp)"><div class="k-calc-hints"><span>10 mp</span><span>500+ mp</span></div>`, () => state.area >= 10],
      ['Cât de mobilat e?', () => group('Gradul de mobilare', cfg.mult.map(m => choice({pressed: state.mult === m.nivel, data: `data-mult="${esc(m.nivel)}"`, title: m.eticheta || labels[m.nivel] || m.nivel})).join('')), () => !!state.mult],
      ['Servicii suplimentare', () => cfg.extras.length ? group('Servicii suplimentare', cfg.extras.map(x => choice({pressed: state.extras.has(x.id), data: `data-extra="${x.id}"`, title: x.name, sub: `+${lei(x.price)}${x.unit ? ` / ${esc(x.unit)}` : ''}`})).join(''))
        : '<p style="margin: 0; color: var(--text-muted);">Nu sunt servicii suplimentare.</p>', () => true],
      ['Unde îți trimitem oferta?', () => `<div style="display: flex; flex-direction: column; gap: 16px;"><div><label for="calc-name" style="${LABEL}">Nume</label><input id="calc-name" class="lk-input" name="nume" autocomplete="name" required maxlength="120" style="${INPUT}"></div>
        <div><label for="calc-contact" style="${LABEL}">Telefon sau email</label><input id="calc-contact" class="lk-input" name="contact" autocomplete="tel" required maxlength="160" style="${INPUT}"></div>
        <p style="margin: 0; font-size: 13.5px; line-height: 1.5; color: var(--text-muted);">Prețul e orientativ; oferta finală se confirmă după o scurtă evaluare a spațiului. Minim ${lei(cfg.min)}.</p></div>`, () => true]
    ];
    const view = document.createElement('div');
    form.append(view);
    const render = () => {
      const [title, body] = steps[state.step], last = state.step === steps.length - 1, n = steps.length;
      view.innerHTML = `<div style="background: linear-gradient(160deg, var(--blue-600), var(--blue-500)); padding: 22px 28px; color: #fff;"><div style="display: flex; align-items: center; justify-content: space-between; gap: 12px;"><div style="font-family: var(--font-display); font-weight: 800; font-size: 18px;"> ${esc(title)} </div><div style="font-size: 12px; font-weight: 800; letter-spacing: 0.08em; opacity: 0.85; text-transform: uppercase; white-space: nowrap;"> Pasul ${state.step + 1} / ${n} </div></div>
        <div role="progressbar" aria-label="Progres calculator" aria-valuemin="1" aria-valuemax="${n}" aria-valuenow="${state.step + 1}" style="display: flex; gap: 6px; margin-top: 16px;">${steps.map((_, i) => `<div style="flex: 1; height: 4px; border-radius: 999px; background: ${i <= state.step ? '#fff' : 'rgba(255,255,255,0.28)'};"></div>`).join('')}</div></div>
        <div class="k-calc-body">${body()}${state.step ? estimate(total()) : ''}
          <div style="display: flex; gap: 10px; margin-top: 24px;">${state.step ? `<button type="button" class="lk-btn-outline" data-back style="${BTN} padding: 0 20px; border: 1.5px solid var(--border-default); background: var(--surface-card); color: var(--text-strong);">← Înapoi</button>` : ''}
            <button type="${last ? 'submit' : 'button'}" class="lk-btn-brand" data-next style="flex: 1; ${BTN} border: none; background: var(--brand); color: #fff; box-shadow: var(--shadow-brand);"> ${last ? 'Trimite cererea' : 'Continuă →'} </button></div>
          <p class="form-msg" role="status" style="margin: 12px 0 0; font-weight: 700;"></p></div>`;
    };
    // după schimbarea pasului, calculatorul rămâne la vedere (pe mobil, pasul nou poate începe deasupra ecranului)
    let shown = state.step;
    const go = () => { render(); if (state.step === shown) return; shown = state.step; const top = form.getBoundingClientRect().top; if (top < 0 || top > innerHeight * 0.6) form.scrollIntoView({block: 'start'}); };
    view.addEventListener('click', e => {
      const b = e.target.closest('button');
      if (!b) return;
      // o alegere unică (serviciul, gradul de mobilare) trece singură la pasul următor
      if (b.dataset.svc) { state.service = +b.dataset.svc; state.step = 1; return go(); }
      if (b.dataset.mult) { state.mult = b.dataset.mult; state.step = 3; return go(); }
      if (b.dataset.extra) { const id = +b.dataset.extra; state.extras.has(id) ? state.extras.delete(id) : state.extras.add(id); }
      if ('back' in b.dataset) state.step--;
      if ('next' in b.dataset && b.type === 'button') {
        if (!steps[state.step][2]()) { $('.form-msg', view).textContent = state.step === 0 ? 'Alege tipul de curățenie.' : 'Completează pasul ca să continui.'; return; }
        state.step++;
      }
      if (b.type !== 'submit') go();
    });
    view.addEventListener('input', e => {
      if (!e.target.matches('[data-area]')) return;
      state.area = +e.target.value || 0;
      view.querySelectorAll('[data-area]').forEach(el => { if (el !== e.target) el.value = el.type === 'range' ? Math.min(state.area, 500) : state.area; });
      const t = total(), el = $('[data-total]', view);
      if (el && t != null) el.textContent = lei(t);
    });
    form.addEventListener('submit', async e => {
      e.preventDefault();
      if (!form.reportValidity()) return;
      const s = cfg.services.find(x => x.id === state.service);
      const data = {sursa: 'calculator', nume: $('[name=nume]', form).value, contact: $('[name=contact]', form).value,
        detalii: {serviciu: s?.name, suprafata: state.area, mobilier: state.mult, extra: cfg.extras.filter(x => state.extras.has(x.id)).map(x => x.name), estimare: Math.round(total())}};
      if (await sendLead(data, $('.form-msg', view))) { $('[data-next]', view).disabled = true; }
    });
    render();
  });

  // „Ce includem, cameră cu cameră”: un clic pe o cameră (din plan sau din butoane) arată doar ce se face acolo; încă un clic, tot spațiul.
  document.querySelectorAll('[data-rooms]').forEach(box => {
    const list = $('.ds-checks', box), items = [...list.children];
    const chips = [...box.querySelectorAll('.ds-room-chip')], rooms = [...box.querySelectorAll('.ds-plan-room')];
    let active = '*';
    const set = key => {
      active = key === active && key !== '*' ? '*' : key;
      const chip = chips.find(c => c.dataset.room === active);
      chips.forEach(c => c.setAttribute('aria-pressed', String(c === chip)));
      const row = chip.parentElement; // pe telefon butoanele stau pe un rând care se derulează: camera aleasă intră în vedere
      if (row.scrollWidth > row.clientWidth) row.scrollTo({left: chip.offsetLeft - row.offsetLeft - 16, behavior: 'smooth'});
      rooms.forEach(r => r.classList.toggle('on', r.dataset.room === active));
      box.classList.toggle('filtered', active !== '*');
      let n = 0;
      items.forEach(li => {
        const own = li.dataset.in.split(' '), show = active === '*' || li.dataset.in === '*' || own.includes(active);
        li.hidden = !show; li.classList.toggle('own', active !== '*' && own.includes(active)); if (show) n++;
      });
      $('[data-room-title]', box).textContent = active === '*' ? box.dataset.all : chip.firstChild.textContent;
      $('[data-room-count]', box).textContent = `${n} ${n === 1 ? 'operațiune' : 'operațiuni'}`;
      list.classList.remove('swap'); void list.offsetWidth; list.classList.add('swap');
    };
    chips.forEach(c => c.addEventListener('click', () => set(c.dataset.room)));
    rooms.forEach(r => r.addEventListener('click', () => set(r.dataset.room)));
  });
})();
