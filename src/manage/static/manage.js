// /manage — acțiunile panourilor și actualizarea live între utilizatori (SSE). Fără dependențe.
(() => {
  const $ = (s, r = document) => r.querySelector(s), $$ = (s, r = document) => [...r.querySelectorAll(s)];
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;'}[c]));
  const page = (() => { try { return JSON.parse($('#page-data')?.textContent ?? 'null'); } catch { return null; } })();
  const me = document.body.dataset.user;

  async function api(method, url, body) {
    const res = await fetch(`/api/manage${url}`, {method, headers: body ? {'content-type': 'application/json'} : {}, body: body ? JSON.stringify(body) : undefined, credentials: 'same-origin'});
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(out.error ?? `Eroare ${res.status}`), {status: res.status, data: out});
    return out;
  }
  const toast = (msg, ms = 4000) => { const t = document.createElement('div'); t.className = 'toast'; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), ms); };
  // Confirmare în pagină, nu confirm() al browserului: unele browsere (panoul din aplicație, ferestre încorporate) îl blochează
  // și întorc „nu” fără să arate nimic — butonul pare că nu face nimic.
  const ask = (msg, {ok = 'Confirmă', danger = false} = {}) => new Promise(resolve => {
    const d = document.createElement('dialog');
    d.className = 'ask';
    d.innerHTML = `<p></p><div class="ask-actions"><button type="button" class="btn ghost" value="no">Anulează</button><button type="button" class="btn ${danger ? 'danger' : 'primary'}" value="yes"></button></div>`;
    $('p', d).textContent = msg; $('[value=yes]', d).textContent = ok;
    const done = v => { d.close(); d.remove(); resolve(v); };
    d.addEventListener('click', e => { const b = e.target.closest('button'); if (b) done(b.value === 'yes'); else if (e.target === d) done(false); });
    d.addEventListener('cancel', e => { e.preventDefault(); done(false); });
    document.body.append(d); d.showModal(); $('[value=yes]', d).focus();
  });
  const flash = (el, msg, ok = true) => { if (!el) return toast(msg); el.textContent = msg; el.className = `form-msg ${ok ? 'ok' : 'err'}`; };
  const reloadSoon = (ms = 500) => setTimeout(() => location.reload(), ms);
  const fail = (el) => e => {
    flash(el, e.message, false);
    if (e.data?.errors) for (const [f, m] of e.data.errors) { const box = $(`[data-field="${f}"] .field-err`); if (box) box.textContent = m; }
  };

  // ———————————————————————— autentificare
  $('form[data-login]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, msg = $('.msg', f);
    try {
      await api('POST', '/login', {email: f.email.value, password: f.password.value});
      location.href = new URLSearchParams(location.search).get('next') || '/manage/';
    } catch (err) { msg.textContent = err.message; }
  });
  $('[data-logout]')?.addEventListener('click', async () => { await api('POST', '/logout'); location.href = '/manage/login/'; });

  // ———————————————————————— formularul unei entități
  function collect(form) {
    const data = {};
    for (const el of $$('[data-type]', form)) {
      if (el.readOnly) continue;
      const t = el.dataset.type, v = el.value;
      if (t === 'boolean') data[el.name] = el.checked;
      else if (t === 'list') data[el.name] = v.split('\n').map(s => s.trim()).filter(Boolean);
      else if (t === 'links') data[el.name] = v.split('\n').map(s => s.trim()).filter(Boolean).map(line => {
        const [href, label, stil] = line.split('|').map(s => s.trim());
        return Object.fromEntries(Object.entries({href, label: label || undefined, stil: stil || undefined}).filter(([, x]) => x !== undefined));
      });
      else if (t === 'table') { try { data[el.name] = v.trim() ? JSON.parse(v) : null; } catch { throw Object.assign(new Error(`${el.name}: JSON invalid`), {data: {errors: [[el.name, 'JSON invalid']]}}); } }
      else if (['int', 'number', 'money', 'ref', 'image'].includes(t)) data[el.name] = v === '' ? null : Number(v);
      else data[el.name] = v === '' ? null : v;
    }
    return data;
  }

  const form = $('form[data-entity-form]');
  if (form) {
    $('[data-focus]', form)?.scrollIntoView({block: 'center'});
    let publish = false;
    $$('[data-save-publish]', form).forEach(b => b.addEventListener('click', () => { publish = true; }));
    $$('[data-save]', form).forEach(b => b.addEventListener('click', () => { publish = false; }));
    form.addEventListener('submit', async e => {
      e.preventDefault();
      const msg = $('.form-msg', form);
      $$('.field-err', form).forEach(x => { x.textContent = ''; });
      try {
        const data = collect(form);
        if (form.dataset.mode === 'create') {
          const r = await api('POST', `/entities/${page.key}`, {data, publish});
          location.href = `/manage/entitati/${page.key}/${r.id}/prezentare/`;
          return;
        }
        const r = await api('PUT', `/entities/${page.key}/${page.id}`, {data, publish, expectedUpdatedAt: page.updatedAt});
        page.updatedAt = r.record.updated_at;
        const notes = [...(r.observations ?? []).map(o => o.message), ...(r.todo ?? []).map(t => t.title)];
        flash(msg, `${r.draft ? 'Ciornă salvată — site-ul e neschimbat.' : r.changed.length ? 'Salvat și propagat.' : 'Nimic de salvat.'}${notes.length ? ` De văzut: ${notes.slice(0, 3).join(' · ')}` : ''}`);
        if (publish || r.changed.length) reloadSoon(notes.length ? 2500 : 900);
      } catch (err) {
        if (err.status === 409) flash(msg, `${err.message}`, false);
        else fail(msg)(err);
      }
    });
    // duplicate la creare: „Seamănă cu …: deschide / continuă” (§1.7)
    if (page?.create && page.titleField) {
      const input = $(`[name="${page.titleField}"]`, form), box = $('.dup', form);
      let t;
      input?.addEventListener('input', () => {
        clearTimeout(t);
        t = setTimeout(async () => {
          const q = input.value.trim();
          if (q.length < 3) { box.hidden = true; return; }
          const rows = await api('GET', `/entities/${page.key}?q=${encodeURIComponent(q)}`);
          box.hidden = !rows.length;
          box.innerHTML = rows.length ? `Seamănă cu: ${rows.slice(0, 5).map(r => `<a href="/manage/entitati/${page.key}/${r.id}/prezentare/">${esc(r.title)}</a>`).join(', ')} — deschide una sau continuă.` : '';
        }, 300);
      });
    }
    // previzualizarea unei modificări încă nesalvate (§3.6)
    $('[data-preview-unsaved]', form)?.addEventListener('click', async () => {
      try {
        const r = await api('POST', '/preview', {key: page.key, id: page.id, data: collect(form)});
        const w = window.open('', '_blank');
        if (w) { w.document.open(); w.document.write(r.html.replace('<head>', '<head><base href="' + location.origin + '/">')); w.document.close(); }
      } catch (err) { toast(err.message); }
    });
  }

  // ———————————————————————— stare, ciornă, ștergere
  $$('[data-status]').forEach(b => b.addEventListener('click', async () => {
    const s = b.dataset.status;
    if (s !== 'published' && !await ask(s === 'archived' ? 'Arhivezi? Pagina dispare de pe site.' : 'Retragi de pe site? Pagina dispare până la o nouă publicare.')) return;
    try { await api('POST', `/entities/${page.key}/${page.id}/status`, {status: s}); toast('Gata — se propagă.'); reloadSoon(); } catch (e) { toast(e.message); }
  }));
  $('[data-discard]')?.addEventListener('click', async () => {
    if (!await ask('Renunți la ciornă? Rămâne versiunea publicată.')) return;
    try { await api('POST', `/entities/${page.key}/${page.id}/discard-draft`); reloadSoon(0); } catch (e) { toast(e.message); }
  });
  $('[data-delete]')?.addEventListener('click', async () => {
    if (!await ask(`Ștergi „${page.title}”? Rămâne în Istoric.`, {ok: 'Șterge', danger: true})) return;
    try { await api('DELETE', `/entities/${page.key}/${page.id}`); location.href = `/manage/entitati/${page.key}/`; } catch (e) { toast(e.message, 8000); }
  });

  // ———————————————————————— căutare cu sugestii (folosită la relații, inverse, hartă, traseu)
  function suggest(input, typeKey, onPick) {
    const box = input.nextElementSibling;
    let t;
    input.addEventListener('input', () => {
      clearTimeout(t);
      t = setTimeout(async () => {
        const q = input.value.trim();
        if (!q) { box.hidden = true; return; }
        const rows = typeKey ? (await api('GET', `/entities/${typeKey}?q=${encodeURIComponent(q)}`)).slice(0, 12).map(r => ({id: `${typeKey}:${r.id}`, key: typeKey, rid: r.id, title: r.title}))
          : await api('GET', `/graph/search?q=${encodeURIComponent(q)}`);
        box.innerHTML = rows.map(r => `<button type="button" data-id="${esc(r.id)}">${esc(r.title)}<small>${esc(r.typeLabel ?? '')}</small></button>`).join('') || '<div class="muted" style="padding:8px">Nimic.</div>';
        box.hidden = false;
      }, 200);
    });
    box.addEventListener('click', e => {
      const b = e.target.closest('button[data-id]');
      if (!b) return;
      const [key, rid] = b.dataset.id.split(':');
      box.hidden = true; input.value = b.textContent.replace(b.querySelector('small')?.textContent ?? '', '');
      onPick({id: b.dataset.id, key, rid: +rid, title: input.value});
    });
    document.addEventListener('click', e => { if (!box.contains(e.target) && e.target !== input) box.hidden = true; });
  }
  window.brainSuggest = suggest;

  // ———————————————————————— relații: lista din capătul care o deține
  $$('section.rel').forEach(sec => {
    const list = $('ol.links', sec), msg = $('.form-msg', sec);
    sec.addEventListener('click', e => {
      const li = e.target.closest('li');
      if (e.target.matches('[data-remove]')) li.remove();
      if (e.target.matches('[data-up]') && li.previousElementSibling) li.previousElementSibling.before(li);
      if (e.target.matches('[data-down]') && li.nextElementSibling) li.nextElementSibling.after(li);
    });
    sec.addEventListener('change', e => { if (e.target.matches('[data-link-status]')) e.target.closest('li').dataset.status = e.target.value; });
    const search = $('[data-add-search]', sec);
    if (search) suggest(search, search.dataset.addSearch, n => {
      if ($(`li[data-id="${n.rid}"]`, list)) return toast('Legătura există deja.');
      const li = document.createElement('li');
      li.dataset.id = n.rid; li.dataset.status = 'confirmed'; li.dataset.attrs = '{}';
      li.innerHTML = `<span class="grip">${sec.dataset.ordered === '1' ? '<button class="link" data-up>↑</button><button class="link" data-down>↓</button>' : ''}</span>
        <a href="/manage/entitati/${esc(n.key)}/${n.rid}/prezentare/">${esc(n.title)}</a><select data-link-status><option value="confirmed" selected>confirmată</option><option value="inferred">dedusă</option><option value="unverified">neverificată</option></select>
        <span class="badge warn">nouă</span><button class="link danger" data-remove>✕</button>`;
      list.append(li); search.value = '';
    });
    $('[data-save-links]', sec)?.addEventListener('click', async () => {
      const items = $$('li[data-id]', list).map(li => {
        const attrs = JSON.parse(li.dataset.attrs || '{}');
        for (const inp of $$('[data-attr]', li)) attrs[inp.dataset.attr] = inp.value.includes(';') ? inp.value.split(';').map(s => s.trim()).filter(Boolean) : inp.value || undefined;
        return {id: +li.dataset.id, status: $('[data-link-status]', li)?.value ?? li.dataset.status, attrs: Object.keys(attrs).length ? attrs : null};
      });
      try { const r = await api('PUT', `/entities/${page.key}/${page.id}/links/${sec.dataset.rel}`, {items}); flash(msg, r.changed ? 'Salvat — live pe site.' : 'Nicio schimbare.'); if (r.changed) reloadSoon(900); }
      catch (e) { fail(msg)(e); }
    });
  });

  // ———————————————————————— relații: din capătul invers
  $$('section.rel-inv').forEach(sec => {
    const base = `/entities/${page.key}/${page.id}/inverse/${sec.dataset.src}/${sec.dataset.field}`;
    sec.addEventListener('click', async e => {
      const id = e.target.dataset.invRemove;
      if (!id) return;
      try { await api('PUT', base, {remove: +id}); reloadSoon(0); } catch (err) { toast(err.message, 7000); }
    });
    const s = $('[data-inv-search]', sec);
    if (s) suggest(s, s.dataset.invSearch, async n => {
      try { const r = await api('PUT', base, {add: n.rid}); if (r.moved) toast(`Legătura a fost mutată de la #${r.moved}.`); reloadSoon(r.moved ? 1500 : 0); }
      catch (err) { toast(err.message, 7000); }
    });
  });

  // ———————————————————————— surse, istoric, propagare
  $$('[data-confirm-source]').forEach(b => b.addEventListener('click', async () => {
    try { await api('POST', `/provenance/${b.dataset.confirmSource}/confirm`); b.closest('tr').querySelector('.badge').outerHTML = '<span class="badge ok">confirmată</span>'; b.remove(); }
    catch (e) { toast(e.message); }
  }));
  $$('[data-revert]').forEach(b => b.addEventListener('click', async () => {
    if (!await ask('Readu valoarea veche? Se publică imediat.')) return;
    try { await api('POST', `/history/${b.dataset.revert}/revert`, {field: b.dataset.field}); reloadSoon(0); } catch (e) { toast(e.message); }
  }));
  $$('[data-retry]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { const r = await api('POST', `/sync/retry/${b.dataset.retry}`); toast(`Reluat: ${r.rendered ?? 0} pagini refăcute${r.failed ? `, ${r.failed} eșecuri` : ''}.`); reloadSoon(1200); }
    catch (e) { toast(e.message); b.disabled = false; }
  }));
  $$('[data-synclog]').forEach(a => a.addEventListener('click', async e => {
    e.preventDefault();
    const rows = await api('GET', `/sync/${a.dataset.synclog}/log`);
    $('#synclog').innerHTML = `<h2>Evenimentul #${esc(a.dataset.synclog)}: ${rows.length} pagini</h2><table class="tbl compact"><tbody>${rows.map(r =>
      `<tr><td class="mono">${esc(r.path)}</td><td>${esc(r.action)}</td><td><small>${esc(r.detail)}</small></td></tr>`).join('') || '<tr><td class="empty">Nicio pagină afectată.</td></tr>'}</tbody></table>`;
  }));

  // ———————————————————————— legături de verificat: acțiuni în masă
  $$('section.group').forEach(sec => {
    $('[data-all]', sec)?.addEventListener('change', e => $$('[data-pick]', sec).forEach(c => { c.checked = e.target.checked; }));
    $$('[data-bulk]', sec).forEach(b => b.addEventListener('click', async () => {
      const pairs = $$('tr[data-src]', sec).filter(tr => $('[data-pick]', tr)?.checked).map(tr => ({src: +tr.dataset.src, dst: +tr.dataset.dst}));
      if (!pairs.length) return toast('Alege cel puțin o legătură.');
      if (b.dataset.bulk === 'remove' && !await ask(`Scoți ${pairs.length} legături? Nu vor mai fi propuse din aceeași dovadă.`)) return;
      try { const r = await api('POST', `/inferred/${sec.dataset.relation}`, {action: b.dataset.bulk, pairs}); flash($('.form-msg', sec), `${r.changed} legături ${b.dataset.bulk === 'confirm' ? 'confirmate' : 'scoase'} — o singură propagare.`); reloadSoon(1200); }
      catch (e) { fail($('.form-msg', sec))(e); }
    }));
  });

  // ———————————————————————— „Datele sunt corecte” și unirea dublurilor
  $('form[data-validate]')?.addEventListener('submit', async e => {
    e.preventDefault();
    try { await api('POST', `/entities/${page.key}/${page.id}/validate`, {comment: e.target.comment.value || null}); reloadSoon(0); } catch (err) { toast(err.message); }
  });
  $$('[data-merge]').forEach(b => b.addEventListener('click', async () => {
    if (!await ask(`Unești „${b.dataset.mergeTitle}” în „${page.title}”? Tot ce trimitea spre ea va trimite aici, iar ea va fi ștearsă (rămâne în Istoric).`)) return;
    try { const r = await api('POST', `/entities/${page.key}/${page.id}/merge`, {duplicates: [+b.dataset.merge]}); toast(`Unit. ${r.touched.length} înregistrări actualizate — se propagă.`); reloadSoon(1200); }
    catch (err) { toast(err.message, 7000); }
  }));

  // ———————————————————————— biblioteca media
  async function upload(file, url, method = 'POST') {
    const res = await fetch(`/api/manage${url}`, {method, body: file, headers: {'content-type': file.type || 'application/octet-stream'}, credentials: 'same-origin'});
    const out = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(out.error ?? `Eroare ${res.status}`);
    return out;
  }
  const dropzone = (form, onFiles) => {
    const input = $('input[type=file]', form), drop = $('.drop', form);
    input.addEventListener('change', () => onFiles([...input.files]));
    ['dragover', 'dragenter'].forEach(ev => drop.addEventListener(ev, e => { e.preventDefault(); drop.classList.add('over'); }));
    ['dragleave', 'drop'].forEach(ev => drop.addEventListener(ev, () => drop.classList.remove('over')));
    drop.addEventListener('drop', e => { e.preventDefault(); onFiles([...e.dataTransfer.files]); });
  };
  const up = $('form[data-upload]');
  if (up) dropzone(up, async files => {
    const msg = $('.form-msg', up), done = [];
    for (const f of files) {
      flash(msg, `Se încarcă ${f.name}…`);
      try { const r = await upload(f, `/media?name=${encodeURIComponent(f.name)}`); done.push(r.existing ? `${f.name}: există deja (același conținut)` : `${f.name}: încărcat`); }
      catch (e) { done.push(`${f.name}: ${e.message}`); }
    }
    flash(msg, done.join(' · '), !done.some(d => /nepermis|depășește|Eroare/.test(d)));
    reloadSoon(1500);
  });
  const rep = $('form[data-replace]');
  if (rep) dropzone(rep, async ([f]) => {
    const msg = $('.form-msg', rep);
    if (!f) return;
    try { await upload(f, `/media/${page.media}/file`, 'PUT'); flash(msg, 'Înlocuit — ID-ul a rămas, paginile se refac.'); reloadSoon(1200); }
    catch (e) { flash(msg, e.message, false); }
  });
  $('form[data-media-meta]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, msg = $('.form-msg', f);
    try { const r = await api('PUT', `/media/${page.media}`, {alt: f.alt.value, title: f.title.value}); flash(msg, r.changed.length ? 'Salvat — textul alternativ se schimbă peste tot.' : 'Nimic de salvat.'); }
    catch (err) { fail(msg)(err); }
  });
  $('[data-media-delete]')?.addEventListener('click', async () => {
    if (!await ask('Ștergi fișierul din bibliotecă?', {ok: 'Șterge', danger: true})) return;
    try { await api('DELETE', `/media/${page.media}`); location.href = '/manage/media/'; } catch (err) { toast(err.message, 7000); }
  });

  // ———————————————————————— copii de siguranță
  $('form[data-backup-create]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, msg = $('.form-msg', f), btn = $('button', f);
    btn.disabled = true; flash(msg, 'Se creează copia…');
    try { const r = await api('POST', '/backups', {note: f.note.value || null}); flash(msg, `Gata: ${r.file}`); reloadSoon(900); }
    catch (err) { fail(msg)(err); btn.disabled = false; }
  });
  $$('[data-restore]').forEach(b => b.addEventListener('click', async () => {
    if (!await ask(`Restaurezi copia din ${b.dataset.restoreAt}? Conținutul de acum e înlocuit (se face întâi o copie a lui), iar toate paginile se refac.`)) return;
    b.disabled = true; toast('Se restaurează…', 10000);
    try { const r = await api('POST', `/backups/${b.dataset.restore}/restore`, {confirm: true}); toast(`Restaurat (${r.restored} tabele, ${r.media} fișiere). Paginile se refac.`, 6000); reloadSoon(1500); }
    catch (err) { toast(err.message, 8000); b.disabled = false; }
  }));
  const ru = $('form[data-restore-upload]');
  if (ru) dropzone(ru, async ([f]) => {
    const msg = $('.form-msg', ru);
    if (!f) return;
    if (!await ask(`Restaurezi din „${f.name}”? Conținutul de acum e înlocuit (se face întâi o copie a lui).`)) return;
    flash(msg, 'Se încarcă și se verifică…');
    try {
      const res = await fetch('/api/manage/backups/restore-upload?confirm=1', {method: 'POST', body: f, headers: {'content-type': 'application/gzip'}, credentials: 'same-origin'});
      const out = await res.json();
      if (!res.ok) throw new Error(out.error);
      flash(msg, `Restaurat din copia de ${out.from}. Paginile se refac.`); reloadSoon(1500);
    } catch (err) { flash(msg, err.message, false); }
  });

  // ———————————————————————— utilizatori
  $('form[data-new-user]')?.addEventListener('submit', async e => {
    e.preventDefault();
    const f = e.target, msg = $('.form-msg', f);
    try { const r = await api('POST', '/users', {name: f.name.value, email: f.email.value, role: f.role.value}); flash(msg, r.password ? `Creat. Parola (afișată o singură dată): ${r.password}` : 'Creat.'); }
    catch (err) { fail(msg)(err); }
  });
  $$('tr[data-user]').forEach(tr => tr.addEventListener('change', async e => {
    const body = e.target.matches('[data-role]') ? {role: e.target.value} : {active: e.target.checked};
    try { await api('POST', `/users/${tr.dataset.user}`, body); toast('Salvat.'); } catch (err) { toast(err.message); reloadSoon(1500); }
  }));

  // ———————————————————————— modificările live (SSE, §3.11)
  if (!$('form[data-login]') && 'EventSource' in window) {
    const es = new EventSource('/api/manage/events');
    const live = $('#live');
    es.addEventListener('change', ev => {
      const c = JSON.parse(ev.data);
      const mine = c.user_name === me;
      const here = page && ((c.entity === page.key && c.entity_id === page.id) || (c.records ?? []).includes(`${page.key}:${page.id}`));
      if (here && !mine) {
        live.hidden = false;
        live.innerHTML = `<b>S-a modificat de ${esc(c.user_name)}</b> (${esc(c.action)}) — <button class="btn small" type="button" data-reload>Reîncarcă</button>`;
        $('[data-reload]', live).addEventListener('click', () => location.reload());
      } else if (!mine) toast(`${c.user_name}: ${c.action} · ${c.label ?? c.entity ?? ''}`);
    });
    es.addEventListener('sync', ev => {
      const s = JSON.parse(ev.data);
      if (s.failed) toast(`Propagare: ${s.failed} eșecuri. Vezi Panoul.`, 6000);
      // listele și cifrele se reîmprospătează singure pe Panou
      if (location.pathname === '/manage/' && !document.querySelector('input:focus, textarea:focus')) reloadSoon(800);
    });
  }
})();
