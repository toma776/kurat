// „Unde apare” (§2.3): patru niveluri ținute separat, ca nimic nesigur să nu fie prezentat drept fapt.
//  1. relații directe (salvate, din ambele capete, cu starea lor)
//  2. utilizări efective în pagini (din dependențele măsurate)
//  3. dependențe indirecte (listele în care ar intra / din care ar ieși)
//  4. detectate, neverificate (legături deduse, surse nesigure, numele găsit în texte fără legătură salvată)
import {createStore} from './store.mjs';
import {ENTITIES, entity, titleOf, pathOf, relTable, RELATION_TYPES} from '../registry/entities.mjs';
import {findMentions} from './content.mjs';

const TEXTUAL = new Set(['text', 'textarea', 'richtext']);

export function pagesUsing(db, key, id, kinds = ['page', 'direct', 'list', 'link', 'media', 'layout']) {
  const rows = db.prepare(`SELECT path, kind, component, reason FROM page_deps WHERE entity = ? AND entity_id = ? AND kind IN (${kinds.map(() => '?').join(',')})`)
    .all(key, id, ...kinds);
  const byPath = new Map();
  const add = (p, r, via) => { (byPath.get(p) ?? byPath.set(p, []).get(p)).push({kind: r.kind, component: r.component, reason: r.reason, via}); };
  const layoutPages = db.prepare("SELECT DISTINCT path FROM page_deps WHERE kind = 'layout' AND component = ?");
  for (const r of rows) {
    if (r.path.startsWith('#layout:')) for (const p of layoutPages.all(r.path.slice(8))) add(p.path, r, r.path.slice(8));
    else add(r.path, r, null);
  }
  const titles = new Map(db.prepare('SELECT path, title FROM page_index').all().map(r => [r.path, r.title]));
  return [...byPath].map(([path, uses]) => ({path, title: titles.get(path) ?? path, uses})).sort((a, b) => a.path.localeCompare(b.path));
}

export function whereUsed(db, key, id) {
  const store = createStore(db);
  const rec = store.get(key, id);
  if (!rec) return null;
  const e = entity(key);
  const node = (k, i) => { const r = k === 'media' ? db.prepare('SELECT id, path FROM media WHERE id = ?').get(i) : store.get(k, i); return r ? {key: k, id: i, title: k === 'media' ? r.path : titleOf(k, r), status: r.status ?? null} : {key: k, id: i, title: `${k}:${i} (lipsă)`, missing: true}; };

  // 1. relații directe — ieșiri (declarate aici) și intrări (calculate din registru)
  const direct = [];
  for (const f of e.fields) {
    if (f.type === 'ref' && rec[f.key] != null) direct.push({dir: 'out', relation: `${key}.${f.key}`, verb: f.rel ?? f.label, field: f.label, node: node(f.target, rec[f.key]), status: 'confirmed'});
    if (f.type === 'image' && rec[f.key] != null) direct.push({dir: 'out', relation: `${key}.${f.key}`, verb: 'folosește imaginea', field: f.label, node: node('media', rec[f.key]), status: 'confirmed'});
    if (f.type === 'refs') for (const l of store.links(key, id, f.key))
      direct.push({dir: 'out', relation: `${key}.${f.key}`, verb: f.rel ?? f.label, field: f.label, node: node(f.target, l.dst_id), status: l.status, confidence: l.confidence, note: l.note, attrs: l.attrs});
  }
  for (const u of store.usedBy(key, id)) {
    const r = RELATION_TYPES.find(x => x.id === `${u.key}.${u.field}`);
    direct.push({dir: 'in', relation: r.id, verb: r.verb, field: r.inverseLabel, node: node(u.key, u.id), status: u.status ?? 'confirmed', owned: u.owned});
  }

  // 2. utilizări efective în pagini (măsurate la randare)
  const pages = pagesUsing(db, key, id);
  const pending = pagesUsing(db, key, id, ['pending']);

  // 3. dependențe indirecte: listele tipului, cu scope-ul lor
  const s = store.snap(key, rec);
  const indirect = db.prepare("SELECT path, component, scope, fields, reason FROM page_deps WHERE entity = ? AND kind = 'query'").all(key)
    .map(q => ({...q, fields: q.fields ? JSON.parse(q.fields) : null, inScope: q.scope ? s.scopes.includes(q.scope) : null}))
    .filter(q => !q.scope || q.inScope);

  // 4. detectate, neverificate
  const detected = [];
  for (const d of direct.filter(x => x.status !== 'confirmed')) detected.push({kind: 'legătură ' + (d.status === 'inferred' ? 'dedusă' : 'neverificată'), ...d});
  for (const p of db.prepare("SELECT p.*, s.url, s.kind AS source_kind FROM provenance p JOIN sources s ON s.id = p.source_id WHERE p.entity = ? AND p.entity_id = ? AND p.certainty <> 'confirmed'").all(key, id))
    detected.push({kind: 'sursă nesigură', field: p.field, certainty: p.certainty, excerpt: p.excerpt, url: p.url, provenanceId: p.id});
  if (e.mentions) {
    const names = [rec[e.title], rec[e.mentionName ?? 'nume_scurt'], ...(rec[e.aliases] ?? [])].filter(Boolean);
    const linked = new Set(direct.map(d => `${d.node.key}:${d.node.id}`));
    for (const other of ENTITIES) {
      if (other.key === 'cereri') continue;
      const textFields = other.fields.filter(f => TEXTUAL.has(f.type));
      if (!textFields.length) continue;
      for (const r of store.list(other.key)) {
        if (other.key === key && r.id === id) continue;
        if (linked.has(`${other.key}:${r.id}`)) continue;
        for (const f of textFields) {
          const hit = findMentions(r[f.key], [{key, id, names}])[0];
          if (hit) { detected.push({kind: 'numele în text', node: node(other.key, r.id), field: f.label, excerpt: hit.excerpt}); break; }
        }
      }
    }
  }

  // „Se completează automat în”: unde apar valorile legate ({telefon}…) — doar pentru sursa lor
  let tokens = null;
  if (key === 'firma') {
    const tk = e.fields.filter(f => f.token).map(f => f.token);
    tokens = [];
    for (const other of ENTITIES) for (const f of other.fields.filter(x => TEXTUAL.has(x.type) || x.type === 'links')) {
      for (const r of store.list(other.key)) {
        const v = typeof r[f.key] === 'string' ? r[f.key] : JSON.stringify(r[f.key] ?? '');
        const used = tk.filter(t => v.includes(`{${t}}`));
        if (used.length) tokens.push({node: node(other.key, r.id), field: f.label, tokens: used});
      }
    }
  }

  return {
    node: {key, id, title: titleOf(key, rec), status: rec.status ?? null, path: pathOf(key, rec)},
    impact: pages.length, direct, pages, pending, indirect, detected, tokens
  };
}

// Coloana „Apare în” din liste: numărul de pagini pe înregistrare, pentru un tip întreg, dintr-o singură interogare.
export function pageCounts(db, key) {
  const layoutCount = new Map(db.prepare("SELECT component, COUNT(DISTINCT path) n FROM page_deps WHERE kind = 'layout' GROUP BY component").all().map(r => [r.component, r.n]));
  const out = new Map();
  for (const r of db.prepare("SELECT entity_id, path FROM page_deps WHERE entity = ? AND kind IN ('page','direct','list','link','media')").all(key)) {
    const set = out.get(r.entity_id) ?? out.set(r.entity_id, new Set()).get(r.entity_id);
    if (r.path.startsWith('#layout:')) set.add(`${r.path}|${layoutCount.get(r.path.slice(8)) ?? 0}`);
    else set.add(r.path);
  }
  return new Map([...out].map(([id, set]) => {
    let n = 0;
    const plain = [...set].filter(p => !p.startsWith('#layout:'));
    const layouts = [...set].filter(p => p.startsWith('#layout:'));
    n = layouts.length ? Math.max(plain.length, ...layouts.map(l => +l.split('|')[1])) : plain.length;
    return [id, n];
  }));
}

export {relTable};
