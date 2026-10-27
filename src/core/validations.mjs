// „Datele sunt corecte” (§1.8): validarea umană păstrează amprenta înregistrării și expiră singură la orice modificare.
// Amprenta acoperă versiunea publicată: câmpurile și legăturile (ținta, starea, ordinea, atributele). Ciorna nu contează.
// Tipurile `operational` (cereri) nu intră aici.
import {createStore} from './store.mjs';
import {ENTITIES, entity, titleOf} from '../registry/entities.mjs';
import {sha1, stableJson, nowIso} from './util.mjs';

export function fingerprint(db, key, id) {
  const e = entity(key), store = createStore(db), rec = store.get(key, id);
  if (!rec) return null;
  const data = {};
  for (const f of e.fields) {
    if (f.type === 'refs') data[f.key] = store.links(key, id, f.key).map(l => [l.dst_id, l.status, l.position, l.attrs ?? null]);
    else data[f.key] = rec[f.key] ?? null;
  }
  if (!e.noStatus) data.status = rec.status;
  return sha1(stableJson(data));
}

export function validationState(db, key, id) {
  const v = db.prepare('SELECT * FROM validations WHERE entity = ? AND entity_id = ?').get(key, id);
  if (!v) return {state: 'none'};
  const fp = fingerprint(db, key, id);
  return {state: fp === v.fp ? 'valid' : 'expired', by: v.user_name, at: v.at, comment: v.comment};
}

export function validate(db, user, key, id, comment = null) {
  const e = entity(key);
  if (e.operational) throw Object.assign(new Error(`${e.label} sunt date de lucru; nu se validează.`), {status: 422});
  const fp = fingerprint(db, key, id);
  if (!fp) throw Object.assign(new Error(`${key}:${id} nu există`), {status: 404});
  const at = nowIso();
  db.prepare(`INSERT INTO validations (entity, entity_id, fp, user_name, at, comment) VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(entity, entity_id) DO UPDATE SET fp = excluded.fp, user_name = excluded.user_name, at = excluded.at, comment = excluded.comment`)
    .run(key, id, fp, user.name, at, comment ? String(comment).slice(0, 500) : null);
  db.prepare(`INSERT INTO audit_log (at, user_id, user_name, action, entity, entity_id, label, changes) VALUES (?, ?, ?, 'validate', ?, ?, ?, ?)`)
    .run(at, user.id ?? null, user.name, key, id, titleOf(key, createStore(db).get(key, id)), JSON.stringify({validare: [null, comment ?? 'Datele sunt corecte']}));
  return {state: 'valid', by: user.name, at, comment};
}

// Rezumatul pentru Panou: câte înregistrări sunt validate, expirate sau niciodată verificate, pe tip.
export function validationSummary(db) {
  const store = createStore(db);
  const out = [];
  for (const e of ENTITIES.filter(x => !x.operational)) {
    const rows = store.list(e.key).filter(r => r.status !== 'archived');
    if (!rows.length) continue;
    const s = {key: e.key, label: e.label, total: rows.length, valid: 0, expired: 0, none: 0, expiredItems: []};
    for (const r of rows) {
      const st = validationState(db, e.key, r.id).state;
      s[st]++;
      if (st === 'expired') s.expiredItems.push({id: r.id, title: titleOf(e.key, r)});
    }
    out.push(s);
  }
  return out;
}
