import path from 'node:path';
import {tx, afterCommit} from './db.mjs';
import {ENTITIES, entity, fieldsOf, titleOf, pathOf, relTable, RESERVED} from '../registry/entities.mjs';
import {nowIso, slugify, fold, same, sha1} from './util.mjs';
import {sanitizeContent, tokenizeValues, valueTokens} from './content.mjs';

const JSON_TYPES = new Set(['list', 'links', 'texts', 'table', 'multiselect']);
const TEXTUAL = new Set(['text', 'textarea', 'richtext']);
const SYSTEM_COLS = ['id', 'status', 'draft', 'published_at', 'search', 'legacy_ref', 'created_at', 'updated_at', 'created_by', 'updated_by'];

export class ValidationError extends Error {
  constructor(errors) { super(errors.map(([f, m]) => `${f}: ${m}`).join('; ')); this.errors = errors; this.status = 422; }
}

export const MEDIA_TYPES = {'image/webp': 'webp', 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/avif': 'avif', 'application/pdf': 'pdf'};
// Tipul unui fișier se verifică după conținut, nu după ce declară clientul (SVG nu e acceptat: poate conține scripturi).
export const sniffMime = b => b.subarray(0, 4).toString('hex') === '89504e47' ? 'image/png'
  : b.subarray(0, 3).toString('hex') === 'ffd8ff' ? 'image/jpeg'
  : b.subarray(0, 4).toString('ascii') === 'RIFF' && b.subarray(8, 12).toString('ascii') === 'WEBP' ? 'image/webp'
  : b.subarray(0, 4).toString('ascii') === 'GIF8' ? 'image/gif'
  : b.subarray(4, 12).toString('ascii').startsWith('ftypavi') ? 'image/avif'
  : b.subarray(0, 5).toString('ascii') === '%PDF-' ? 'application/pdf' : null;

const listeners = new Set();
export const onChange = fn => (listeners.add(fn), () => listeners.delete(fn));

export function createStore(db, {user = {name: 'Sistem'}} = {}) {
  const observations = [];
  let tokensCache = null;

  // ———————————————————————————— citire

  const decode = (key, row) => {
    if (!row) return null;
    const rec = {...row};
    for (const f of fieldsOf(key)) {
      if (JSON_TYPES.has(f.type) && typeof rec[f.key] === 'string') rec[f.key] = JSON.parse(rec[f.key]);
      if (f.type === 'boolean' && rec[f.key] != null) rec[f.key] = !!rec[f.key];
    }
    if (typeof rec.draft === 'string') rec.draft = JSON.parse(rec.draft);
    return rec;
  };

  const get = (key, id) => decode(key, db.prepare(`SELECT * FROM ${entity(key).table} WHERE id = ?`).get(id));
  const byLegacy = (key, ref) => decode(key, db.prepare(`SELECT * FROM ${entity(key).table} WHERE legacy_ref = ?`).get(ref));
  const list = (key, {where = '', params = [], order = 'id'} = {}) =>
    db.prepare(`SELECT * FROM ${entity(key).table} ${where ? `WHERE ${where}` : ''} ORDER BY ${order}`).all(...params).map(r => decode(key, r));
  const singleton = key => list(key)[0] ?? null;

  const links = (key, id, fieldKey) => {
    const f = fieldsOf(key).find(x => x.key === fieldKey);
    return db.prepare(`SELECT * FROM ${relTable(entity(key), f)} WHERE src_id = ? ORDER BY position, dst_id`).all(id)
      .map(l => ({...l, attrs: l.attrs ? JSON.parse(l.attrs) : null}));
  };

  // ———————————————————————————— instantaneul pentru evenimente (§3.3)

  const snap = (key, rec) => {
    if (!rec) return null;
    const e = entity(key), scopes = [];
    for (const f of e.fields) {
      if (f.type === 'ref' && rec[f.key] != null) scopes.push(`${f.target}:${rec[f.key]}`);
      if (f.type === 'refs') for (const l of links(key, rec.id, f.key)) if (l.status === 'confirmed') scopes.push(`${f.target}:${l.dst_id}`);
    }
    const p = pathOf(key, rec);
    return {
      status: e.noStatus ? 'published' : rec.status,
      paths: p ? [p] : [],
      scopes: [...new Set(scopes)].sort(),
      title: titleOf(key, rec),
      linkFields: Object.fromEntries((e.linkFields ?? []).map(k => [k, rec[k] ?? null])),
      // valorile câmpurilor simple: affected() le compară pentru listele care își declară `fields`
      values: Object.fromEntries(e.fields.filter(f => !['refs', 'richtext'].includes(f.type)).map(f => [f.key, rec[f.key] ?? null]))
    };
  };

  function emit(action, key, id, before, after, extra = {}) {
    const label = (after ?? before)?.title ?? null;
    const {lastInsertRowid} = db.prepare(`INSERT INTO change_events (at, user_name, action, entity, entity_id, label, payload)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(nowIso(), user.name, action, key, id, label, JSON.stringify({before, after, ...extra}));
    const ev = {eventId: Number(lastInsertRowid), key, id, action, user: user.name, label};
    afterCommit(db, () => { for (const fn of listeners) fn(ev); });
  }

  function audit(action, key, id, label, changes) {
    db.prepare(`INSERT INTO audit_log (at, user_id, user_name, action, entity, entity_id, label, changes)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(nowIso(), user.id ?? null, user.name, action, key, id, label, JSON.stringify(changes));
  }

  // ———————————————————————————— proveniență (§1.4)

  function source({kind, url, title = null, fetched_at = null, method = null, snapshot_file = null, status = null, note = null}) {
    db.prepare(`INSERT INTO sources (kind, url, title, fetched_at, method, snapshot_file, status, note, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(url) DO UPDATE SET title = excluded.title, fetched_at = excluded.fetched_at, method = excluded.method,
        snapshot_file = excluded.snapshot_file, status = excluded.status, note = excluded.note`)
      .run(kind, url, title, fetched_at, method, snapshot_file, status, note, nowIso());
    return db.prepare('SELECT id FROM sources WHERE url = ?').get(url).id;
  }

  function provenance({entity: key, id, field = '', source_id, excerpt = null, method = null, certainty = 'confirmed', confidence = null, verified_by = null}) {
    db.prepare(`INSERT INTO provenance (entity, entity_id, field, source_id, excerpt, method, certainty, confidence, verified_at, verified_by, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(entity, entity_id, field, source_id) DO UPDATE SET excerpt = excluded.excerpt, method = excluded.method,
        certainty = excluded.certainty, confidence = excluded.confidence, verified_at = excluded.verified_at, verified_by = excluded.verified_by`)
      .run(key, id, field, source_id, excerpt == null ? null : String(excerpt).slice(0, 500), method, certainty, confidence,
        verified_by ? nowIso() : null, verified_by, nowIso());
  }

  // O editare manuală își scrie sursa (NOU, §1.4): înlocuiește sursele vechi ale câmpului, nu doar le șterge.
  function manualProvenance(key, id, fieldKeys) {
    if (user.system || !fieldKeys.length) return;
    const sid = source({kind: 'manual', url: `manual:${user.email ?? user.name}`, title: `Introducere manuală — ${user.name}`});
    for (const f of fieldKeys) {
      db.prepare('DELETE FROM provenance WHERE entity = ? AND entity_id = ? AND field = ?').run(key, id, f);
      provenance({entity: key, id, field: f, source_id: sid, method: 'manual', certainty: 'confirmed', verified_by: user.name});
    }
  }

  // ———————————————————————————— codare și validare (§1.8)

  const tokens = () => tokensCache ??= valueTokens(singleton('firma'), fieldsOf('firma'));

  function encodeField(e, f, v, errors, id) {
    if (v === undefined) return undefined;
    if (v === '' || v === null) return null;
    if (JSON_TYPES.has(f.type) && Array.isArray(v) && !v.length) return null; // listă goală = nimic (nu o modificare)
    switch (f.type) {
      case 'int': { const n = Number(v); if (!Number.isInteger(n)) errors.push([f.key, 'Trebuie să fie un număr întreg.']); return n; }
      case 'number': case 'money': { const n = Number(String(v).replace(',', '.')); if (!Number.isFinite(n)) errors.push([f.key, 'Trebuie să fie un număr.']); return n; }
      case 'boolean': return v ? 1 : 0;
      case 'select': if (!f.options.some(([k]) => k === v)) errors.push([f.key, `Valoare nepermisă: ${v}`]); return v;
      case 'email': if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) errors.push([f.key, 'Email invalid.']); return String(v).trim().toLowerCase();
      case 'url': if (!/^(https?:\/\/|\/|ref:)/.test(v)) errors.push([f.key, 'Adresă invalidă.']); return String(v).trim();
      case 'phone': if (String(v).replace(/\D/g, '').length < 9) errors.push([f.key, 'Telefon invalid.']); return String(v).trim();
      case 'slug': {
        const s = slugify(v);
        if (RESERVED.has(s)) errors.push([f.key, `„${s}” e un cuvânt rezervat.`]);
        return s;
      }
      case 'ref': {
        const t = get(f.target, Number(v));
        if (!t) errors.push([f.key, `Ținta ${f.target}:${v} nu există.`]);
        else if (f.only && !f.only(t)) errors.push([f.key, `${titleOf(f.target, t)} nu e o țintă permisă.`]);
        return Number(v);
      }
      case 'image': {
        if (!db.prepare('SELECT 1 FROM media WHERE id = ?').get(Number(v))) errors.push([f.key, `Fișierul media ${v} nu există.`]);
        return Number(v);
      }
      case 'richtext': return sanitizeContent(String(v));
      default:
        if (JSON_TYPES.has(f.type)) return JSON.stringify(v);
        if (f.max && String(v).length > f.max) errors.push([f.key, `Cel mult ${f.max} caractere.`]);
        return String(v);
    }
  }

  function prepare(key, data, current, errors) {
    const e = entity(key), cols = {};
    for (const f of e.fields) {
      if (f.type === 'refs' || !(f.key in data)) continue;
      let v = encodeField(e, f, data[f.key], errors, current?.id);
      if (v != null && TEXTUAL.has(f.type) && e.tokenize !== false) {
        const r = tokenizeValues(v, tokens());
        v = r.text;
        for (const c of r.conflicts) observations.push({entity: key, id: current?.id ?? null, field: f.key, impact: 'mare',
          message: `Valoare scrisă de mână care contrazice Date firmă: ${c.value} (în Date firmă: ${c.expected})`});
      }
      if (v != null && f.type === 'links' && e.tokenize !== false) // etichetele butoanelor: „0742 293 391” → {telefon}
        v = JSON.stringify(JSON.parse(v).map(l => l.label ? {...l, label: tokenizeValues(l.label, tokens()).text} : l));
      cols[f.key] = v;
    }
    // slug din titlu, unic în tabel, cu sufix -2, -3 (§1.2)
    for (const f of e.fields.filter(x => x.type === 'slug')) {
      const wants = cols[f.key] ?? (current?.[f.key] ? undefined : (data[f.from] ?? current?.[f.from]) && slugify(data[f.from] ?? current?.[f.from]));
      if (!wants) continue;
      let s = wants, n = 1;
      while (db.prepare(`SELECT 1 FROM ${e.table} WHERE "${f.key}" = ? AND id IS NOT ?`).get(s, current?.id ?? null)) s = `${wants}-${++n}`;
      cols[f.key] = s;
    }
    const merged = decode(key, {...(current ?? {}), ...cols});
    for (const f of e.fields) {
      if (!f.required || f.type === 'refs') continue;
      const v = merged[f.key];
      if (v == null || v === '' || (Array.isArray(v) && !v.length)) errors.push([f.key, `${f.label} e obligatoriu.`]);
    }
    for (const err of e.validate?.(merged) ?? []) errors.push(err);
    // adresa publică e unică între toate tipurile (§1.2)
    const p = pathOf(key, merged);
    if (p) {
      const owner = pathOwner(p);
      if (owner && !(owner.key === key && owner.id === current?.id)) errors.push(['path', `Adresa ${p} e deja folosită de ${owner.key}:${owner.id}.`]);
    }
    const search = fold([titleOf(key, merged), ...e.fields.filter(f => f.list && TEXTUAL.has(f.type)).map(f => merged[f.key])].filter(Boolean).join(' '));
    return {cols, merged, search};
  }

  function pathOwner(p) {
    for (const e of ENTITIES) {
      if (!e.public) continue;
      for (const r of list(e.key)) if (pathOf(e.key, r) === p) return {key: e.key, id: r.id};
    }
    return null;
  }

  // ———————————————————————————— scriere

  function create(key, data, {legacy_ref = null, publish = true} = {}) {
    const e = entity(key);
    if (e.singleton && singleton(key)) throw new ValidationError([['', `${e.one} există deja (o singură înregistrare).`]]);
    return tx(db, () => {
      const errors = [], obsFrom = observations.length;
      const {cols, merged, search} = prepare(key, data, null, errors);
      if (errors.length) throw new ValidationError(errors);
      const now = nowIso();
      const sys = {search, legacy_ref, created_at: now, updated_at: now, created_by: user.name, updated_by: user.name};
      if (!e.noStatus) Object.assign(sys, {status: publish ? 'published' : 'draft', published_at: publish ? now : null});
      const all = {...sys, ...cols}, names = Object.keys(all);
      const {lastInsertRowid} = db.prepare(`INSERT INTO ${e.table} (${names.map(n => `"${n}"`).join(', ')}) VALUES (${names.map(() => '?').join(', ')})`)
        .run(...names.map(n => all[n]));
      const id = Number(lastInsertRowid);
      for (const o of observations.slice(obsFrom)) o.id = id;
      if (key === 'firma') tokensCache = null;
      const after = get(key, id);
      audit('create', key, id, titleOf(key, after), Object.fromEntries(Object.keys(cols).map(k => [k, [null, after[k]]])));
      manualProvenance(key, id, Object.keys(cols));
      if (e.noStatus || after.status === 'published') emit('create', key, id, null, snap(key, after));
      return id;
    });
  }

  function update(key, id, data, {publish = false, expectedUpdatedAt = null} = {}) {
    const e = entity(key);
    return tx(db, () => {
      const current = get(key, id);
      if (!current) throw Object.assign(new Error(`${key}:${id} nu există`), {status: 404});
      // blocare optimistă (§1.8)
      if (expectedUpdatedAt && expectedUpdatedAt !== current.updated_at)
        throw Object.assign(new Error('Înregistrarea a fost modificată între timp.'), {status: 409, current});
      const errors = [];
      const {cols, search} = prepare(key, data, current, errors);
      if (errors.length) throw new ValidationError(errors);
      const changed = Object.keys(cols).filter(k => !same(decode(key, {[k]: cols[k]})[k], current[k]));

      // Pe o înregistrare publicată, „Salvează” scrie ciorna; site-ul rămâne neschimbat și nu se emite nimic (§3.3, §3.6).
      if (!e.noStatus && current.status === 'published' && !publish) {
        if (!changed.length) return {changed, draft: true};
        const draft = {...(current.draft ?? {}), ...Object.fromEntries(changed.map(k => [k, decode(key, {[k]: cols[k]})[k]]))};
        db.prepare(`UPDATE ${e.table} SET draft = ?, updated_at = ?, updated_by = ? WHERE id = ?`).run(JSON.stringify(draft), nowIso(), user.name, id);
        audit('draft', key, id, titleOf(key, current), Object.fromEntries(changed.map(k => [k, [current[k], draft[k]]])));
        return {changed, draft: true};
      }

      const before = snap(key, current);
      const set = {...Object.fromEntries(changed.map(k => [k, cols[k]])), search, updated_at: nowIso(), updated_by: user.name};
      if (publish && !e.noStatus) Object.assign(set, {draft: null, status: 'published', published_at: current.published_at ?? nowIso()});
      db.prepare(`UPDATE ${e.table} SET ${Object.keys(set).map(k => `"${k}" = ?`).join(', ')} WHERE id = ?`).run(...Object.values(set), id);
      if (key === 'firma') tokensCache = null;
      const after = get(key, id);
      if (changed.length || (publish && current.status !== 'published')) {
        audit(publish && current.status !== 'published' ? 'publish' : 'update', key, id, titleOf(key, after),
          Object.fromEntries(changed.map(k => [k, [current[k], after[k]]])));
        manualProvenance(key, id, changed);
        const a = snap(key, after);
        if (before.status === 'published' && before.paths[0] && a.paths[0] && a.paths[0] !== before.paths[0])
          autoRedirect(before.paths[0], a.paths[0], key, id);
        if (e.noStatus || before.status === 'published' || a.status === 'published') emit('update', key, id, before, a);
      }
      return {changed, draft: false};
    });
  }

  // Legăturile unui câmp `refs`, din capătul care le deține (§2.2).
  // links: [{id, status?, confidence?, source_id?, note?, attrs?}] — ordinea din listă devine `position`.
  function setLinks(key, id, fieldKey, items, {replace = true} = {}) {
    const e = entity(key), f = e.fields.find(x => x.key === fieldKey);
    if (f?.type !== 'refs') throw new Error(`${key}.${fieldKey} nu e o relație multiplă`);
    return tx(db, () => {
      const current = get(key, id);
      if (!current) throw Object.assign(new Error(`${key}:${id} nu există`), {status: 404});
      const t = relTable(e, f), old = links(key, id, fieldKey), before = snap(key, current);
      if (f.max && items.length > f.max) throw new ValidationError([[fieldKey, `Cel mult ${f.max} legături.`]]);
      for (const it of items) {
        const target = get(f.target, it.id);
        if (!target) throw new ValidationError([[fieldKey, `Ținta ${f.target}:${it.id} nu există.`]]);
        if (f.only && !f.only(target)) throw new ValidationError([[fieldKey, `${titleOf(f.target, target)} nu e o țintă permisă.`]]);
      }
      const oldBy = new Map(old.map(l => [l.dst_id, l]));
      if (replace) db.prepare(`DELETE FROM ${t} WHERE src_id = ?`).run(id);
      const start = replace ? 0 : old.length;
      const ins = db.prepare(`INSERT OR REPLACE INTO ${t} (src_id, dst_id, position, status, confidence, source_id, note, attrs, created_at, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      items.forEach((it, i) => {
        const prev = oldBy.get(it.id);
        ins.run(id, it.id, start + i, it.status ?? prev?.status ?? 'confirmed', it.confidence ?? null, it.source_id ?? prev?.source_id ?? null,
          it.note ?? prev?.note ?? null, it.attrs ? JSON.stringify(it.attrs) : null, prev?.created_at ?? nowIso(), prev?.created_by ?? user.name);
      });
      const now = links(key, id, fieldKey);
      const sig = l => [l.dst_id, l.position, l.status, JSON.stringify(l.attrs ?? null)].join('|');
      if (old.map(sig).join() === now.map(sig).join()) return {changed: false, live: true};
      db.prepare(`UPDATE ${e.table} SET updated_at = ?, updated_by = ? WHERE id = ?`).run(nowIso(), user.name, id);
      audit('links', key, id, titleOf(key, current), {[fieldKey]: [old.map(l => `${l.dst_id}:${l.status}`), now.map(l => `${l.dst_id}:${l.status}`)]});
      manualProvenance(key, id, [fieldKey]);
      const touched = [...new Set([...old, ...now].map(l => `${f.target}:${l.dst_id}`))].sort();
      // Pe o înregistrare publicată, schimbarea legăturilor e live: o spunem explicit (§2.2).
      if (e.noStatus || current.status === 'published') emit('links', key, id, before, snap(key, get(key, id)), {field: fieldKey, touched});
      return {changed: true, live: true};
    });
  }

  // Schimbarea adresei unei pagini publicate creează un 301 (§3.8). Destinația e entitatea (NOU), deci rezistă
  // la schimbările următoare de adresă: fără lanțuri. Adresa nouă nu poate fi ea însăși redirecționată: fără bucle.
  function autoRedirect(oldPath, newPath, key, id) {
    const now = nowIso(), ref = `ref:${key}:${id}`;
    db.prepare('DELETE FROM redirects WHERE from_path = ?').run(newPath);
    db.prepare('UPDATE redirects SET to_path = NULL, to_ref = ?, updated_at = ? WHERE to_path = ?').run(ref, now, oldPath);
    db.prepare(`INSERT INTO redirects (from_path, to_path, to_ref, code, auto, created_at, updated_at, created_by)
      VALUES (?, NULL, ?, 301, 1, ?, ?, ?)
      ON CONFLICT(from_path) DO UPDATE SET to_path = NULL, to_ref = excluded.to_ref, code = 301, auto = 1, updated_at = excluded.updated_at`)
      .run(oldPath, ref, now, now, user.name);
  }

  // Înlocuirea unui fișier păstrează ID-ul (§3.9). Fișierul nou se scrie după COMMIT; ?v= se schimbă singur (updated_at).
  function replaceMedia(id, {buffer, mime, mediaDir, writeFile}) {
    return tx(db, () => {
      const m = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
      if (!m) throw Object.assign(new Error(`media:${id} nu există`), {status: 404});
      const hash = sha1(buffer);
      const dup = db.prepare('SELECT id FROM media WHERE sha1 = ? AND id <> ?').get(hash, id);
      if (dup) throw new ValidationError([['fisier', `Același fișier există deja în bibliotecă (media:${dup.id}).`]]);
      const now = nowIso();
      db.prepare('UPDATE media SET sha1 = ?, size = ?, mime = ?, updated_at = ?, updated_by = ? WHERE id = ?')
        .run(hash, buffer.length, mime ?? m.mime, now, user.name, id);
      audit('media-replace', 'media', id, m.path, {sha1: [m.sha1, hash]});
      const s = {status: 'published', paths: [], scopes: [], title: m.path, linkFields: {}, values: {}};
      emit('media-replace', 'media', id, s, {...s, values: {sha1: hash}});
      afterCommit(db, () => writeFile(path.join(mediaDir, m.path.replace(/^\/media\//, '')), buffer));
      return {id, sha1: hash};
    });
  }

  // ———————————————————————————— stare, ștergere, legături din capătul invers, acțiuni în masă

  // Publicare (aplică ciorna), retragere (înapoi la ciornă) sau arhivare. Toate scot sau pun pagina pe site.
  function setStatus(key, id, status) {
    const e = entity(key);
    if (e.noStatus) throw new ValidationError([['status', `${e.label} nu are ciornă/publicare.`]]);
    if (!['published', 'draft', 'archived'].includes(status)) throw new ValidationError([['status', `Stare necunoscută: ${status}`]]);
    if (status === 'published') return update(key, id, get(key, id)?.draft ?? {}, {publish: true});
    return tx(db, () => {
      const current = get(key, id);
      if (!current) throw Object.assign(new Error(`${key}:${id} nu există`), {status: 404});
      if (current.status === status) return {changed: []};
      const before = snap(key, current);
      db.prepare(`UPDATE ${e.table} SET status = ?, updated_at = ?, updated_by = ? WHERE id = ?`).run(status, nowIso(), user.name, id);
      audit(status === 'archived' ? 'archive' : 'unpublish', key, id, titleOf(key, current), {status: [current.status, status]});
      emit(status === 'archived' ? 'archive' : 'unpublish', key, id, before, snap(key, get(key, id)));
      return {changed: ['status']};
    });
  }

  function discardDraft(key, id) {
    return tx(db, () => {
      const current = get(key, id);
      if (!current?.draft) return {changed: []};
      db.prepare(`UPDATE ${entity(key).table} SET draft = NULL, updated_at = ?, updated_by = ? WHERE id = ?`).run(nowIso(), user.name, id);
      audit('draft-discard', key, id, titleOf(key, current), {draft: [current.draft, null]});
      return {changed: ['draft']};
    });
  }

  // Cine trimite spre o înregistrare (relațiile inverse), fără legăturile deținute (`owned`).
  function usedBy(key, id) {
    const out = [];
    for (const e of ENTITIES) for (const f of e.fields) {
      if (f.target !== key) continue;
      if (f.type === 'ref') for (const r of db.prepare(`SELECT id FROM ${e.table} WHERE "${f.key}" = ?`).all(id))
        out.push({key: e.key, id: r.id, field: f.key, required: !!f.required, owned: false});
      if (f.type === 'refs') for (const r of db.prepare(`SELECT src_id, status FROM ${relTable(e, f)} WHERE dst_id = ?`).all(id))
        out.push({key: e.key, id: r.src_id, field: f.key, status: r.status, owned: !!f.owned});
    }
    return out;
  }

  // Ce e folosit nu se șterge (§2.3); ștergerea rămâne în Istoric, cu instantaneul pentru revenire.
  function remove(key, id) {
    const e = entity(key);
    return tx(db, () => {
      const current = get(key, id);
      if (!current) throw Object.assign(new Error(`${key}:${id} nu există`), {status: 404});
      const blockers = usedBy(key, id).filter(u => !u.owned);
      const onPages = db.prepare(`SELECT COUNT(DISTINCT path) n FROM page_deps WHERE entity = ? AND entity_id = ? AND kind IN ('page','direct','list','link')`).get(key, id).n;
      if (blockers.length) throw Object.assign(new ValidationError([['', `E folosit de ${blockers.length} înregistrări (${blockers.slice(0, 3).map(b => `${b.key}:${b.id}`).join(', ')}…). Scoate întâi legăturile.`]]), {blockers});
      const before = snap(key, current);
      const linkSnap = Object.fromEntries(e.fields.filter(f => f.type === 'refs').map(f => [f.key, links(key, id, f.key)]));
      audit('delete', key, id, titleOf(key, current), {snapshot: [current, null], links: [linkSnap, null], onPages: [onPages, 0]});
      db.prepare(`DELETE FROM ${e.table} WHERE id = ?`).run(id);
      db.prepare('DELETE FROM provenance WHERE entity = ? AND entity_id = ?').run(key, id);
      if (e.noStatus || current.status === 'published') emit('delete', key, id, before, null);
      return {deleted: true};
    });
  }
  // Editarea din capătul invers (§2.2): adaugă sau scoate această înregistrare din câmpul `field` al lui `srcKey:srcId`.
  // Pentru o relație N:1, adăugarea MUTĂ legătura de la ținta veche; o legătură obligatorie nu se poate scoate de aici.
  function setInverse(key, id, srcKey, fieldKey, {add = null, remove: rm = null, status = 'confirmed'} = {}) {
    const f = fieldsOf(srcKey).find(x => x.key === fieldKey);
    if (!f || f.target !== key) throw new ValidationError([[fieldKey, `${srcKey}.${fieldKey} nu trimite la ${key}.`]]);
    return tx(db, () => {
      const srcId = add ?? rm;
      if (f.type === 'ref') {
        const src = get(srcKey, srcId);
        if (!src) throw Object.assign(new Error(`${srcKey}:${srcId} nu există`), {status: 404});
        if (rm != null && f.required) throw new ValidationError([[fieldKey, `${f.label} e obligatoriu: legătura se poate doar muta, din ${entity(srcKey).one}.`]]);
        const moved = add != null && src[fieldKey] != null && src[fieldKey] !== id ? src[fieldKey] : null;
        update(srcKey, srcId, {[fieldKey]: add != null ? id : null}, {publish: true});
        return {moved};
      }
      const cur = links(srcKey, srcId, fieldKey);
      const next = cur.filter(l => l.dst_id !== id).map(l => ({id: l.dst_id, status: l.status, confidence: l.confidence, source_id: l.source_id, note: l.note, attrs: l.attrs}));
      if (add != null) next.push({id, status});
      return setLinks(srcKey, srcId, fieldKey, next);
    });
  }

  // Confirmarea sau scoaterea în masă (§2.5): o singură tranzacție, istoricul fiecărei înregistrări, UN singur eveniment.
  function bulkLinks(relationId, pairs, action) {
    const [srcKey, fieldKey] = relationId.split('.');
    const e = entity(srcKey), f = e.fields.find(x => x.key === fieldKey);
    if (f?.type !== 'refs') throw new ValidationError([['', `${relationId} nu e o relație multiplă.`]]);
    if (pairs.length > 5000) throw new ValidationError([['', 'Cel mult 5.000 de perechi într-o acțiune.']]);
    if (!['confirm', 'remove'].includes(action)) throw new ValidationError([['', `Acțiune necunoscută: ${action}`]]);
    const t = relTable(e, f);
    return tx(db, () => {
      const bySrc = new Map();
      for (const {src, dst} of pairs) {
        const row = db.prepare(`SELECT * FROM ${t} WHERE src_id = ? AND dst_id = ?`).get(src, dst);
        if (!row) continue;
        if (action === 'confirm') db.prepare(`UPDATE ${t} SET status = 'confirmed', note = NULL WHERE src_id = ? AND dst_id = ?`).run(src, dst);
        else {
          db.prepare(`DELETE FROM ${t} WHERE src_id = ? AND dst_id = ?`).run(src, dst);
          // ce se scoate se ține minte: nu mai e propus din aceeași dovadă
          db.prepare(`INSERT OR REPLACE INTO link_dismissals (relation, src_id, dst_id, evidence, at, by) VALUES (?, ?, ?, ?, ?, ?)`)
            .run(relationId, src, dst, row.note, nowIso(), user.name);
        }
        (bySrc.get(src) ?? bySrc.set(src, []).get(src)).push(`${dst}:${row.status}→${action === 'confirm' ? 'confirmed' : 'scoasă'}`);
      }
      for (const [src, changes] of bySrc) {
        db.prepare(`UPDATE ${e.table} SET updated_at = ?, updated_by = ? WHERE id = ?`).run(nowIso(), user.name, src);
        audit(`links-${action}`, srcKey, src, titleOf(srcKey, get(srcKey, src)), {[fieldKey]: [null, changes]});
      }
      if (bySrc.size) emit(`links-${action}`, srcKey, null, null, null, {
        bulk: true, relation: relationId,
        records: [...bySrc.keys()].map(s => `${srcKey}:${s}`),
        touched: [...new Set(pairs.map(p => `${f.target}:${p.dst}`))].sort()
      });
      return {changed: [...bySrc.values()].reduce((a, c) => a + c.length, 0), records: bySrc.size};
    });
  }

  // Confirmarea unei surse: certitudinea devine „confirmată”, cu cine și când (§1.4).
  function confirmProvenance(provId) {
    return tx(db, () => {
      const p = db.prepare('SELECT * FROM provenance WHERE id = ?').get(provId);
      if (!p) throw Object.assign(new Error(`Sursa ${provId} nu există`), {status: 404});
      db.prepare(`UPDATE provenance SET certainty = 'confirmed', verified_at = ?, verified_by = ? WHERE id = ?`).run(nowIso(), user.name, provId);
      audit('source-confirm', p.entity, p.entity_id, null, {[p.field || '(înregistrare)']: [p.certainty, 'confirmed']});
      // o dovadă confirmată poate apărea acum pe site: paginile care citesc înregistrarea se refac
      const rec = p.entity !== 'media' && ENTITIES.some(e => e.key === p.entity) ? get(p.entity, p.entity_id) : null;
      if (rec) { const s = snap(p.entity, rec); emit('source-confirm', p.entity, p.entity_id, s, s, {field: p.field}); }
      return {confirmed: true, entity: p.entity, id: p.entity_id};
    });
  }

  // Revenire din Istoric: pe un câmp sau pe toate câmpurile unei modificări. Revenirea e tot o modificare, cu eveniment.
  function revert(auditId, fieldKey = null) {
    const a = db.prepare('SELECT * FROM audit_log WHERE id = ?').get(auditId);
    if (!a) throw Object.assign(new Error(`Intrarea ${auditId} nu există în istoric`), {status: 404});
    const changes = JSON.parse(a.changes ?? '{}');
    const keys = fieldsOf(a.entity).filter(f => f.type !== 'refs').map(f => f.key);
    const data = Object.fromEntries(Object.entries(changes).filter(([k]) => keys.includes(k) && (!fieldKey || k === fieldKey)).map(([k, [old]]) => [k, old]));
    if (!Object.keys(data).length) throw new ValidationError([['', 'Nu e nimic de readus din această intrare.']]);
    return tx(db, () => {
      const r = update(a.entity, a.entity_id, data, {publish: true});
      db.prepare('UPDATE audit_log SET reverted_by = (SELECT MAX(id) FROM audit_log) WHERE id = ?').run(auditId);
      return r;
    });
  }

  // ———————————————————————————— unirea dublurilor (§1.7)

  const TEXT_COLS = new Set(['text', 'textarea', 'richtext', 'links']);

  function merge(key, keepId, dupIds) {
    const e = entity(key);
    dupIds = [...new Set(dupIds.map(Number))].filter(d => d !== keepId);
    if (!dupIds.length) throw new ValidationError([['', 'Alege cel puțin o dublură.']]);
    if (e.singleton) throw new ValidationError([['', `${e.label} are o singură înregistrare.`]]);
    return tx(db, () => {
      const keep = get(key, keepId);
      if (!keep) throw Object.assign(new Error(`${key}:${keepId} nu există`), {status: 404});
      const dups = dupIds.map(id => get(key, id) ?? (() => { throw Object.assign(new Error(`${key}:${id} nu există`), {status: 404}); })());
      const touched = new Map(); // `tip:id` → instantaneul de dinainte
      const touch = (k, id) => { const n = `${k}:${id}`; if (!touched.has(n)) touched.set(n, snap(k, get(k, id))); };
      const now = nowIso();
      const bump = (k, id) => db.prepare(`UPDATE ${entity(k).table} SET updated_at = ?, updated_by = ? WHERE id = ?`).run(now, user.name, id);
      touch(key, keepId);

      for (const dup of dups) {
        // 1. cheile străine și legăturile multiple care trimiteau spre dublură
        for (const other of ENTITIES) for (const f of other.fields) {
          if (f.target !== key) continue;
          if (f.type === 'ref') for (const r of db.prepare(`SELECT id FROM ${other.table} WHERE "${f.key}" = ?`).all(dup.id)) {
            touch(other.key, r.id);
            db.prepare(`UPDATE ${other.table} SET "${f.key}" = ? WHERE id = ?`).run(keepId, r.id);
            bump(other.key, r.id);
          }
          if (f.type === 'refs') {
            const t = relTable(other, f);
            for (const r of db.prepare(`SELECT * FROM ${t} WHERE dst_id = ?`).all(dup.id)) {
              touch(other.key, r.src_id);
              if (other.key === key && r.src_id === keepId) { db.prepare(`DELETE FROM ${t} WHERE src_id = ? AND dst_id = ?`).run(r.src_id, dup.id); continue; }
              const existing = db.prepare(`SELECT status FROM ${t} WHERE src_id = ? AND dst_id = ?`).get(r.src_id, keepId);
              if (existing) {
                // păstrăm legătura existentă; o confirmare de pe dublură nu se pierde
                if (r.status === 'confirmed' && existing.status !== 'confirmed') db.prepare(`UPDATE ${t} SET status = 'confirmed' WHERE src_id = ? AND dst_id = ?`).run(r.src_id, keepId);
                db.prepare(`DELETE FROM ${t} WHERE src_id = ? AND dst_id = ?`).run(r.src_id, dup.id);
              } else db.prepare(`UPDATE ${t} SET dst_id = ? WHERE src_id = ? AND dst_id = ?`).run(keepId, r.src_id, dup.id);
              bump(other.key, r.src_id);
            }
          }
        }
        // 2. legăturile proprii ale dublurii trec pe înregistrarea păstrată (reuniune)
        for (const f of e.fields.filter(x => x.type === 'refs')) {
          const t = relTable(e, f);
          const max = db.prepare(`SELECT COALESCE(MAX(position), -1) m FROM ${t} WHERE src_id = ?`).get(keepId).m;
          db.prepare(`INSERT OR IGNORE INTO ${t} (src_id, dst_id, position, status, confidence, source_id, note, attrs, created_at, created_by)
            SELECT ?, dst_id, position + ? + 1, status, confidence, source_id, note, attrs, created_at, created_by FROM ${t} WHERE src_id = ? AND dst_id <> ?`)
            .run(keepId, max, dup.id, keepId);
        }
        // 3. linkurile `ref:` și `data-ref` din texte, butoane și meniuri — inclusiv din ciorne
        // în ciorne textul e stocat ca JSON, deci ghilimelele pot apărea escapate: data-ref=\"tip:id\"
        const refRe = new RegExp(`ref:${key}:${dup.id}(?=\\\\?["?#\\s|]|$)`, 'g'), dataRe = new RegExp(`data-ref=(\\\\?")${key}:${dup.id}\\1`, 'g');
        const rewrite = s => s.replace(refRe, `ref:${key}:${keepId}`).replace(dataRe, `data-ref=$1${key}:${keepId}$1`);
        for (const other of ENTITIES) {
          const cols = other.fields.filter(f => TEXT_COLS.has(f.type)).map(f => f.key);
          if (!other.noStatus) cols.push('draft');
          for (const r of db.prepare(`SELECT id, ${cols.map(c => `"${c}"`).join(', ')} FROM ${other.table}`).all()) {
            const set = {};
            for (const c of cols) if (typeof r[c] === 'string') { const v = rewrite(r[c]); if (v !== r[c]) set[c] = v; }
            if (!Object.keys(set).length) continue;
            touch(other.key, r.id);
            db.prepare(`UPDATE ${other.table} SET ${Object.keys(set).map(c => `"${c}" = ?`).join(', ')} WHERE id = ?`).run(...Object.values(set), r.id);
            bump(other.key, r.id);
          }
        }
        db.prepare('UPDATE redirects SET to_ref = ?, updated_at = ? WHERE to_ref = ?').run(`ref:${key}:${keepId}`, now, `ref:${key}:${dup.id}`);
        // 4. sursele trec pe înregistrarea păstrată; aliasurile la fel
        db.prepare('UPDATE OR IGNORE provenance SET entity_id = ? WHERE entity = ? AND entity_id = ?').run(keepId, key, dup.id);
        db.prepare('DELETE FROM provenance WHERE entity = ? AND entity_id = ?').run(key, dup.id);
        db.prepare('UPDATE OR IGNORE aliases SET entity_id = ? WHERE entity = ? AND entity_id = ?').run(keepId, key, dup.id);
        db.prepare('DELETE FROM validations WHERE entity = ? AND entity_id = ?').run(key, dup.id);
        // 5. adresa publică a dublurii duce la cea păstrată
        const dupPath = pathOf(key, dup), keepPath = pathOf(key, keep);
        if (dupPath && keepPath && dupPath !== keepPath && (e.noStatus || dup.status === 'published')) autoRedirect(dupPath, keepPath, key, keepId);
        // 6. dublura dispare, dar rămâne în Istoric (instantaneu complet, pentru revenire)
        const before = snap(key, dup);
        audit('merge-delete', key, dup.id, titleOf(key, dup), {snapshot: [dup, null], mergedInto: [null, keepId]});
        db.prepare(`DELETE FROM ${e.table} WHERE id = ?`).run(dup.id);
        touched.delete(`${key}:${dup.id}`);
        if (e.noStatus || dup.status === 'published') emit('delete', key, dup.id, before, null, {mergedInto: keepId});
      }
      bump(key, keepId);
      audit('merge', key, keepId, titleOf(key, keep), {merged: [null, dups.map(d => ({id: d.id, title: titleOf(key, d)}))]});
      // 7. fiecare înregistrare atinsă primește un eveniment, deci paginile ei se refac singure
      for (const [n, before] of touched) {
        const [k, id] = n.split(':');
        const rec = get(k, +id);
        if (!rec) continue;
        if (n !== `${key}:${keepId}`) audit('merge-relink', k, +id, titleOf(k, rec), {[`${key}`]: [dups.map(d => d.id), keepId]});
        if (entity(k).noStatus || rec.status === 'published' || before?.status === 'published')
          emit('merge', k, +id, before, snap(k, rec), {merged: dups.map(d => `${key}:${d.id}`), into: `${key}:${keepId}`});
      }
      return {kept: keepId, merged: dups.map(d => d.id), touched: [...touched.keys()]};
    });
  }

  // ———————————————————————————— biblioteca media (§3.9)

  const sniff = sniffMime;

  function createMedia({buffer, name, alt = null, title = null, mediaDir, writeFile}) {
    const mime = sniff(buffer);
    if (!mime) throw new ValidationError([['fisier', 'Tip de fișier nepermis. Sunt acceptate: WebP, PNG, JPEG, GIF, AVIF, PDF.']]);
    if (buffer.length > 15 * 1024 * 1024) throw new ValidationError([['fisier', 'Fișierul depășește 15 MB.']]);
    const hash = sha1(buffer);
    // același conținut nu se încarcă de două ori
    const dup = db.prepare('SELECT id, path FROM media WHERE sha1 = ?').get(hash);
    if (dup) return {id: dup.id, existing: true, path: dup.path};
    return tx(db, () => {
      const base = slugify(String(name ?? 'fisier').replace(/\.[^.]+$/, '')) || 'fisier', ext = MEDIA_TYPES[mime];
      let file = `${base}.${ext}`, n = 1;
      while (db.prepare('SELECT 1 FROM media WHERE path = ?').get(`/media/uploads/${file}`)) file = `${base}-${++n}.${ext}`;
      const now = nowIso(), p = `/media/uploads/${file}`;
      const {lastInsertRowid} = db.prepare(`INSERT INTO media (path, sha1, mime, size, alt, title, created_at, updated_at, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p, hash, mime, buffer.length, alt, title, now, now, user.name, user.name);
      const id = Number(lastInsertRowid);
      audit('media-create', 'media', id, p, {path: [null, p], size: [null, buffer.length]});
      manualProvenanceMedia(id);
      afterCommit(db, () => writeFile(path.join(mediaDir, p.replace(/^\/media\//, '')), buffer));
      return {id, existing: false, path: p};
    });
  }
  function manualProvenanceMedia(id) {
    if (user.system) return;
    const sid = source({kind: 'manual', url: `manual:${user.email ?? user.name}`, title: `Introducere manuală — ${user.name}`});
    provenance({entity: 'media', id, field: '', source_id: sid, method: 'încărcare', certainty: 'confirmed', verified_by: user.name});
  }

  // Textul alternativ editat în bibliotecă ajunge peste tot (imaginile se leagă prin ID, §2.1).
  function updateMedia(id, {alt, title}) {
    return tx(db, () => {
      const m = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
      if (!m) throw Object.assign(new Error(`media:${id} nu există`), {status: 404});
      const next = {alt: alt === undefined ? m.alt : (alt || null), title: title === undefined ? m.title : (title || null)};
      if (next.alt === m.alt && next.title === m.title) return {changed: []};
      db.prepare('UPDATE media SET alt = ?, title = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(next.alt, next.title, nowIso(), user.name, id);
      audit('media-update', 'media', id, m.path, {alt: [m.alt, next.alt], title: [m.title, next.title]});
      const s = v => ({status: 'published', paths: [], scopes: [], title: m.path, linkFields: {}, values: v});
      emit('media-update', 'media', id, s({alt: m.alt}), s({alt: next.alt}));
      return {changed: ['alt']};
    });
  }

  // Unde e folosit un fișier: câmpuri de imagine, atribute de legătură, texte (data-media) și pagini măsurate.
  function mediaUsage(id) {
    const out = [];
    for (const e of ENTITIES) for (const f of e.fields) {
      if (f.type === 'image') for (const r of db.prepare(`SELECT id FROM ${e.table} WHERE "${f.key}" = ?`).all(id)) out.push({key: e.key, id: r.id, field: f.label});
      if (f.type === 'refs' && f.attrs?.some(a => a.type === 'image'))
        for (const r of db.prepare(`SELECT src_id FROM ${relTable(e, f)} WHERE json_extract(attrs, '$.imagine') = ?`).all(id)) out.push({key: e.key, id: r.src_id, field: `${f.label} (card)`});
      if (['richtext', 'text', 'textarea'].includes(f.type))
        for (const r of db.prepare(`SELECT id FROM ${e.table} WHERE "${f.key}" LIKE ?`).all(`%data-media="${id}"%`)) out.push({key: e.key, id: r.id, field: `${f.label} (în text)`});
    }
    const pages = db.prepare("SELECT DISTINCT path FROM page_deps WHERE entity = 'media' AND entity_id = ? AND path NOT LIKE '#layout:%'").all(id).map(r => r.path);
    return {records: out, pages};
  }

  // Un fișier folosit nu se poate șterge (§3.9).
  function deleteMedia(id) {
    return tx(db, () => {
      const m = db.prepare('SELECT * FROM media WHERE id = ?').get(id);
      if (!m) throw Object.assign(new Error(`media:${id} nu există`), {status: 404});
      const u = mediaUsage(id);
      if (u.records.length || u.pages.length) throw Object.assign(new ValidationError([['', `Fișierul e folosit de ${u.records.length} înregistrări și ${u.pages.length} pagini.`]]), {usage: u});
      audit('media-delete', 'media', id, m.path, {snapshot: [m, null]});
      db.prepare('DELETE FROM media WHERE id = ?').run(id);
      db.prepare("DELETE FROM provenance WHERE entity = 'media' AND entity_id = ?").run(id);
      // fișierul de pe disc rămâne: înregistrarea se poate readuce din Istoric
      return {deleted: true};
    });
  }

  // Modificare globală (restaurare, setări fără entitate): istoric + eveniment fără entitate → toate paginile se refac (§3.4 pasul 1).
  function globalEvent(action, label, changes = {}) {
    return tx(db, () => {
      audit(action, null, null, label, changes);
      emit(action, null, null, null, {status: 'published', paths: [], scopes: [], title: label, linkFields: {}, values: {}}, {global: true});
    });
  }

  const isDismissed = (relationId, src, dst) =>
    !!db.prepare('SELECT 1 FROM link_dismissals WHERE relation = ? AND src_id = ? AND dst_id = ?').get(relationId, src, dst);

  return {
    db, user, observations,
    get, byLegacy, list, singleton, links, snap,
    create, update, setLinks, replaceMedia, source, provenance, isDismissed,
    setStatus, discardDraft, usedBy, remove, setInverse, bulkLinks, confirmProvenance, revert,
    merge, createMedia, updateMedia, mediaUsage, deleteMedia, globalEvent,
    tokens: () => tokens(),
    resetTokens: () => { tokensCache = null; },
    systemCols: SYSTEM_COLS
  };
}
