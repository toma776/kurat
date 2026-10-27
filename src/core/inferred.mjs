// „Legături de verificat” (§2.5): relațiile deduse sau neverificate, grupate pe relație și pe dovadă,
// ordonate după scorul de încredere, cu o recomandare pe grup.
import {createStore} from './store.mjs';
import {entity, relTable, titleOf, RELATION_TYPES} from '../registry/entities.mjs';

export const DEFAULT_THRESHOLD = 0.9;

const evidenceKind = note => {
  const n = note ?? '';
  if (/^regulă/i.test(n)) return n.split(' — ')[0];
  if (/link/i.test(n)) return 'link în text';
  if (/nume/i.test(n)) return 'numele în text';
  if (/mențiune|fragment/i.test(n)) return 'mențiune extrasă la import';
  return n.split(' — ')[0] || 'fără dovadă înregistrată';
};

export function inferredGroups(db) {
  const store = createStore(db), groups = new Map();
  const excerpt = db.prepare('SELECT excerpt, method, confidence FROM provenance WHERE entity = ? AND entity_id = ? AND field = ? ORDER BY id DESC');
  for (const r of RELATION_TYPES.filter(x => x.cardinality === 'M:N')) {
    const src = entity(r.source), f = src.fields.find(x => x.key === r.field);
    const rows = db.prepare(`SELECT * FROM ${relTable(src, f)} WHERE status <> 'confirmed'`).all();
    for (const row of rows) {
      const ev = evidenceKind(row.note);
      const k = `${r.id}|${ev}`;
      const g = groups.get(k) ?? groups.set(k, {relation: r.id, verb: r.verb, sourceLabel: src.label, targetLabel: entity(r.target).label,
        evidence: ev, threshold: f.threshold ?? DEFAULT_THRESHOLD, sensitive: r.sensitive, approval: !!src.approval, items: []}).get(k);
      const s = store.get(r.source, row.src_id), d = store.get(r.target, row.dst_id);
      const p = excerpt.get(r.source, row.src_id, `${r.field}:${row.dst_id}`);
      g.items.push({src: {key: r.source, id: row.src_id, title: s ? titleOf(r.source, s) : '?'}, dst: {key: r.target, id: row.dst_id, title: d ? titleOf(r.target, d) : '?'},
        status: row.status, confidence: row.confidence ?? p?.confidence ?? null, note: row.note, excerpt: p?.excerpt ?? null, attrs: row.attrs ? JSON.parse(row.attrs) : null});
    }
  }
  return [...groups.values()].map(g => {
    g.items.sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0));
    const cs = g.items.map(i => i.confidence ?? 0);
    g.recommendation = Math.min(...cs) >= g.threshold ? 'confirmă' : Math.max(...cs) < 0.4 ? 'scoate' : 'una câte una';
    g.count = g.items.length;
    return g;
  }).sort((a, b) => a.relation.localeCompare(b.relation));
}

export const inferredCount = db => RELATION_TYPES.filter(r => r.cardinality === 'M:N').reduce((n, r) => {
  const src = entity(r.source), f = src.fields.find(x => x.key === r.field);
  return n + db.prepare(`SELECT COUNT(*) n FROM ${relTable(src, f)} WHERE status <> 'confirmed'`).get().n;
}, 0);
