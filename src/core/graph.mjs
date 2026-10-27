// Harta legăturilor (§2.4). Datele vin din registru și din bază; nimic nu e întreținut de mână.
// Indexul se actualizează doar pentru înregistrările din eveniment (NOU), nu se reconstruiește la fiecare modificare.
import {createStore} from './store.mjs';
import {ENTITIES, entity, hasEntity, titleOf, relTable, RELATION_TYPES, CATEGORIES} from '../registry/entities.mjs';
import {fold} from './util.mjs';
import {pagesUsing} from './whereused.mjs';

export const LAYERS = {relatii: 'Relații', imagini: 'Imagini', calculate: 'Calculate (secțiuni, meniuri, butoane)', texte: 'Din texte (linkuri și valori legate)'};
const GRAPH_TYPES = ENTITIES.filter(e => !e.operational);

const indexes = new WeakMap();

function outEdges(store, db, key, rec) {
  const e = entity(key), src = `${key}:${rec.id}`, out = [];
  for (const f of e.fields) {
    if (f.type === 'ref' && rec[f.key] != null) out.push({src, dst: `${f.target}:${rec[f.key]}`, relation: `${key}.${f.key}`, layer: 'relatii', status: 'confirmed'});
    if (f.type === 'image' && rec[f.key] != null) out.push({src, dst: `media:${rec[f.key]}`, relation: `${key}.${f.key}`, layer: 'imagini', status: 'confirmed'});
    if (f.type === 'refs') for (const l of store.links(key, rec.id, f.key)) {
      out.push({src, dst: `${f.target}:${l.dst_id}`, relation: `${key}.${f.key}`, layer: 'relatii', status: l.status, confidence: l.confidence, note: l.note,
        by: l.created_by, sensitive: !!f.sensitive});
      if (l.attrs?.imagine) out.push({src, dst: `media:${l.attrs.imagine}`, relation: `${key}.${f.key}.imagine`, layer: 'imagini', status: 'confirmed'});
    }
    if (f.type === 'links') for (const it of rec[f.key] ?? []) {
      const m = /^ref:(\w+):(\d+)/.exec(it.href ?? '');
      if (m) out.push({src, dst: `${m[1]}:${m[2]}`, relation: `${key}.${f.key}`, layer: 'calculate', status: 'confirmed', computed: true});
    }
    if (['text', 'textarea', 'richtext'].includes(f.type) && typeof rec[f.key] === 'string') {
      for (const m of rec[f.key].matchAll(/data-ref="(\w+):(\d+)"/g)) out.push({src, dst: `${m[1]}:${m[2]}`, relation: `${key}.${f.key}`, layer: 'texte', status: 'confirmed', computed: true});
      for (const m of rec[f.key].matchAll(/data-media="(\d+)"/g)) out.push({src, dst: `media:${m[1]}`, relation: `${key}.${f.key}`, layer: 'imagini', status: 'confirmed', computed: true});
      const firma = store.singleton('firma');
      if (firma && key !== 'firma' && /\{(telefon|email|whatsapp|adresa|email-comenzi|ani)\}/.test(rec[f.key]))
        out.push({src, dst: `firma:${firma.id}`, relation: `${key}.${f.key}.valori`, layer: 'texte', status: 'confirmed', computed: true});
    }
  }
  return out;
}

function build(db) {
  const store = createStore(db);
  const idx = {nodes: new Map(), out: new Map(), version: 0};
  for (const e of GRAPH_TYPES) for (const r of store.list(e.key)) {
    idx.nodes.set(`${e.key}:${r.id}`, {id: `${e.key}:${r.id}`, key: e.key, rid: r.id, title: titleOf(e.key, r), status: r.status ?? null});
    idx.out.set(`${e.key}:${r.id}`, outEdges(store, db, e.key, r));
  }
  for (const m of db.prepare('SELECT id, path, alt FROM media').all())
    idx.nodes.set(`media:${m.id}`, {id: `media:${m.id}`, key: 'media', rid: m.id, title: m.path.split('/').pop(), status: null});
  return idx;
}

export function graphIndex(db) {
  let idx = indexes.get(db);
  if (!idx) indexes.set(db, idx = build(db));
  return idx;
}

// Actualizare incrementală, apelată la fiecare eveniment.
export function refreshGraph(db, ev) {
  const idx = indexes.get(db);
  if (!idx) return;
  const store = createStore(db);
  const payload = typeof ev.payload === 'string' ? JSON.parse(ev.payload) : ev.payload ?? {};
  const ids = ev.entity_id != null ? [`${ev.entity}:${ev.entity_id}`] : payload.records ?? [];
  if (ev.entity === 'media' || !ev.entity) { indexes.delete(db); return; }
  if (ev.entity === 'firma') { indexes.delete(db); return; } // valorile legate leagă multe texte de Date firmă
  for (const nid of ids) {
    const [k, id] = nid.split(':');
    if (!hasEntity(k) || entity(k).operational) continue;
    const r = store.get(k, +id);
    if (!r) { idx.nodes.delete(nid); idx.out.delete(nid); continue; }
    idx.nodes.set(nid, {id: nid, key: k, rid: +id, title: titleOf(k, r), status: r.status ?? null});
    idx.out.set(nid, outEdges(store, db, k, r));
  }
  idx.version++;
}

const allEdges = (idx, layers) => [...idx.out.values()].flat().filter(e => !layers || layers.includes(e.layer));
const inEdges = (idx, nid, layers) => allEdges(idx, layers).filter(e => e.dst === nid);

// ———————————————————————————————————————————— nivelul 1: tipurile

export function overview(db, {layers = ['relatii', 'calculate']} = {}) {
  const idx = graphIndex(db);
  const counts = new Map();
  for (const n of idx.nodes.values()) counts.set(n.key, (counts.get(n.key) ?? 0) + 1);
  const types = GRAPH_TYPES.filter(e => e.hub !== false || counts.get(e.key)).map(e => ({key: e.key, label: e.label, category: e.category,
    categoryLabel: CATEGORIES[e.category]?.label ?? e.category, color: e.color ?? CATEGORIES[e.category]?.color, count: counts.get(e.key) ?? 0, hub: e.hub !== false}));
  if (layers.includes('imagini')) types.push({key: 'media', label: 'Imagini', category: 'media', categoryLabel: 'Media', color: '#94a3b8', count: counts.get('media') ?? 0, hub: true});
  const agg = new Map();
  for (const e of allEdges(idx, layers)) {
    const [s] = e.src.split(':'), [d] = e.dst.split(':');
    const k = `${s}>${d}>${e.relation}`;
    const a = agg.get(k) ?? agg.set(k, {source: s, target: d, relation: e.relation, layer: e.layer, count: 0, statuses: {}}).get(k);
    a.count++; a.statuses[e.status] = (a.statuses[e.status] ?? 0) + 1;
  }
  const links = [...agg.values()].map(a => ({...a, verb: RELATION_TYPES.find(r => r.id === a.relation)?.verb ?? a.relation.split('.').slice(1).join('.'),
    toReview: (a.statuses.inferred ?? 0) + (a.statuses.unverified ?? 0)}));
  // perechi posibile (declarate în registru) dar încă nefolosite: apar punctate
  for (const r of RELATION_TYPES) {
    if (!layers.includes(r.target === 'media' ? 'imagini' : 'relatii')) continue;
    if (!links.some(l => l.relation === r.id)) links.push({source: r.source, target: r.target, relation: r.id, layer: 'relatii', count: 0, statuses: {}, verb: r.verb, possible: true, toReview: 0});
  }
  return {types, links, categories: CATEGORIES, layers: LAYERS};
}

// ———————————————————————————————————————————— nivelul 2: membrii unui tip

export function members(db, key, {q = '', offset = 0, limit = 40, layers} = {}) {
  const idx = graphIndex(db);
  const edges = allEdges(idx, layers);
  const degree = new Map();
  for (const e of edges) { degree.set(e.src, (degree.get(e.src) ?? 0) + 1); degree.set(e.dst, (degree.get(e.dst) ?? 0) + 1); }
  const fq = fold(q);
  const list = [...idx.nodes.values()].filter(n => n.key === key && (!fq || fold(n.title).includes(fq)))
    .map(n => ({...n, degree: degree.get(n.id) ?? 0})).sort((a, b) => b.degree - a.degree || a.title.localeCompare(b.title, 'ro'));
  return {total: list.length, items: list.slice(offset, offset + limit), offset, limit};
}

// ———————————————————————————————————————————— nivelul 3: o entitate

export function neighbors(db, nid, {layers} = {}) {
  const idx = graphIndex(db);
  const node = idx.nodes.get(nid);
  if (!node) return null;
  const decorate = (e, otherId) => {
    const r = RELATION_TYPES.find(x => x.id === e.relation);
    return {...e, verb: r?.verb ?? e.relation.split('.').slice(1).join('.'), inverseLabel: r?.inverseLabel, node: idx.nodes.get(otherId) ?? {id: otherId, title: `${otherId} (lipsă)`, missing: true}};
  };
  const outgoing = (idx.out.get(nid) ?? []).filter(e => !layers || layers.includes(e.layer)).map(e => decorate(e, e.dst));
  const incoming = inEdges(idx, nid, layers).map(e => decorate(e, e.src));
  const [k, id] = nid.split(':');
  const pages = k === 'media' ? pagesUsing(db, 'media', +id) : pagesUsing(db, k, +id);
  const byComponent = new Map();
  for (const p of pages) for (const u of p.uses) {
    const c = u.via ?? u.component;
    const g = byComponent.get(c) ?? byComponent.set(c, {component: c, layout: !!u.via, paths: new Set()}).get(c);
    g.paths.add(p.path);
  }
  return {node, incoming, outgoing, pages: [...byComponent.values()].map(g => ({...g, paths: [...g.paths]}))};
}

export function search(db, q, {limit = 20} = {}) {
  const fq = fold(q).trim();
  if (!fq) return [];
  return [...graphIndex(db).nodes.values()].filter(n => fold(n.title).includes(fq)).slice(0, limit)
    .map(n => ({...n, typeLabel: n.key === 'media' ? 'Imagine' : entity(n.key).one}));
}

// Traseul cel mai scurt între două entități: BFS, cel mult 6 pași, fără media ca intermediar.
export function path(db, from, to, {layers = ['relatii', 'calculate', 'texte'], maxDepth = 6} = {}) {
  const idx = graphIndex(db);
  if (!idx.nodes.has(from) || !idx.nodes.has(to)) return null;
  const adj = new Map();
  const link = (a, b, e, dir) => (adj.get(a) ?? adj.set(a, []).get(a)).push({to: b, e, dir});
  for (const e of allEdges(idx, layers)) { link(e.src, e.dst, e, 'out'); link(e.dst, e.src, e, 'in'); }
  const prev = new Map([[from, null]]);
  let frontier = [from];
  for (let depth = 0; depth < maxDepth && frontier.length && !prev.has(to); depth++) {
    const next = [];
    for (const n of frontier) for (const step of adj.get(n) ?? []) {
      if (prev.has(step.to)) continue;
      if (step.to.startsWith('media:') && step.to !== to) continue;
      prev.set(step.to, {from: n, ...step});
      next.push(step.to);
    }
    frontier = next;
  }
  if (!prev.has(to)) return {found: false, steps: []};
  const steps = [];
  for (let n = to; prev.get(n); n = prev.get(n).from) {
    const p = prev.get(n), r = RELATION_TYPES.find(x => x.id === p.e.relation);
    steps.unshift({from: idx.nodes.get(p.from), to: idx.nodes.get(n), verb: p.dir === 'out' ? r?.verb ?? p.e.relation : r?.inverseLabel ?? p.e.relation, dir: p.dir, status: p.e.status});
  }
  return {found: true, steps};
}

// ———————————————————————————————————————————— sănătatea hărții și tabelul „Toate legăturile”

export function health(db) {
  const idx = graphIndex(db), store = createStore(db);
  const edges = allEdges(idx);
  const touchedTypes = new Set(edges.flatMap(e => [e.src.split(':')[0], e.dst.split(':')[0]]));
  const counts = new Map();
  for (const n of idx.nodes.values()) counts.set(n.key, (counts.get(n.key) ?? 0) + 1);
  const isolatedTypes = GRAPH_TYPES.filter(e => counts.get(e.key) && !touchedTypes.has(e.key) && !e.singleton).map(e => ({key: e.key, label: e.label}));
  const used = new Set(edges.map(e => e.relation));
  const unusedRelations = RELATION_TYPES.filter(r => !used.has(r.id) && counts.get(r.source)).map(r => ({id: r.id, verb: r.verb, source: r.source, target: r.target}));
  const broken = edges.filter(e => !idx.nodes.has(e.dst)).map(e => ({...e, srcTitle: idx.nodes.get(e.src)?.title}));
  const requiredEmpty = [];
  for (const e of GRAPH_TYPES) for (const f of e.fields.filter(x => x.required && (x.type === 'ref' || x.type === 'refs'))) {
    for (const r of store.list(e.key)) {
      const empty = f.type === 'ref' ? r[f.key] == null : !store.links(e.key, r.id, f.key).length;
      if (empty) requiredEmpty.push({key: e.key, id: r.id, title: titleOf(e.key, r), field: f.label});
    }
  }
  const degree = new Set(edges.flatMap(e => [e.src, e.dst]));
  const orphans = [...idx.nodes.values()].filter(n => n.key !== 'media' && !degree.has(n.id) && !entity(n.key).singleton)
    .map(n => ({id: n.id, key: n.key, rid: n.rid, title: n.title}));
  return {isolatedTypes, unusedRelations, broken, requiredEmpty, orphans,
    ok: !broken.length && !requiredEmpty.length};
}

export function edgesTable(db) {
  const idx = graphIndex(db), store = createStore(db);
  const edges = allEdges(idx);
  return RELATION_TYPES.map(r => {
    const mine = edges.filter(e => e.relation === r.id);
    const src = entity(r.source);
    const f = src.fields.find(x => x.key === r.field);
    let requiredEmpty = 0;
    if (r.required) for (const rec of store.list(r.source)) if (r.cardinality === 'N:1' ? rec[r.field] == null : !store.links(r.source, rec.id, r.field).length) requiredEmpty++;
    return {
      ...r, group: CATEGORIES[src.category]?.label ?? src.category, sourceLabel: src.label,
      targetLabel: r.target === 'media' ? 'Media' : entity(r.target).label,
      count: mine.length, sources: new Set(mine.map(e => e.src)).size, targets: new Set(mine.map(e => e.dst)).size,
      broken: mine.filter(e => !idx.nodes.has(e.dst)).length, toReview: mine.filter(e => e.status !== 'confirmed').length, requiredEmpty,
      examples: mine.slice(0, 3).map(e => `${idx.nodes.get(e.src)?.title ?? e.src} → ${idx.nodes.get(e.dst)?.title ?? e.dst}`),
      editedFrom: r.cardinality === 'M:N' ? `${src.one}, câmpul „${f.label}” (și din ${r.target === 'media' ? 'Media' : entity(r.target).one}, tabul Relații)` : `${src.one}, câmpul „${f.label}”`,
      storage: r.cardinality === 'M:N' ? relTable(src, f) : `${src.table}.${r.field}`
    };
  });
}
