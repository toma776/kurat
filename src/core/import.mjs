// Etapa 3 a importului (§1.3): rapoartele din reference/analysis/ → Brain.
//  - o singură tranzacție;
//  - ID-uri deterministe: cheia naturală din analiză stă în legacy_ref, reimportul actualizează, nu dublează;
//  - fiecare câmp importat își scrie sursa (provenance);
//  - verificare dus-întors: textul stocat, citit înapoi, dă aceleași blocuri ca sursa;
//  - refuză să suprascrie modificările făcute de oameni fără --overwrite-edits;
//  - legăturile deduse rămân deduse; decizia omului și respingerile nu se suprascriu (§1.5).
import fs from 'node:fs';
import path from 'node:path';
import {tx, afterCommit} from './db.mjs';
import {createStore} from './store.mjs';
import {entity, fieldsOf, relation} from '../registry/entities.mjs';
import {blocks, expandTokens, canonValues} from './content.mjs';
import {nowIso, same} from './util.mjs';

export const IMPORT_USER = {name: 'Import', system: true};

export class ImportRefused extends Error {
  constructor(edits) {
    super(`Importul refuză să suprascrie ${edits.length} înregistrări modificate de oameni (folosește --overwrite-edits):\n`
      + edits.map(e => `  - ${e.key}:${e.id} „${e.title}” — modificat de ${e.by} la ${e.at}`).join('\n'));
    this.edits = edits;
  }
}

const loadAnalysis = dir => {
  const index = JSON.parse(fs.readFileSync(path.join(dir, 'index.json'), 'utf8'));
  const data = Object.fromEntries(index.order.map(k => [k, JSON.parse(fs.readFileSync(path.join(dir, `${k}.json`), 'utf8'))]));
  return {index, data};
};

const ORDER = ['firma', 'sarcini', 'extra', 'servicii', 'tarife', 'clienti', 'testimoniale', 'valori', 'avantaje', 'pasi',
  'intrebari', 'calculator', 'pagini', 'meniuri', 'sectiuni'];

export function runImport(db, {analysisDir = 'reference/analysis', snapshotDir = 'reference/snapshot', mediaDir = 'media',
  overwriteEdits = false, log = () => {}} = {}) {
  const {index, data} = loadAnalysis(analysisDir);
  const manifest = JSON.parse(fs.readFileSync(path.join(snapshotDir, 'manifest.json'), 'utf8'));
  const fetched = new Map(manifest.items.map(i => [i.url, i]));
  const store = createStore(db, {user: IMPORT_USER});
  const report = {at: nowIso(), created: {}, updated: {}, unchanged: {}, provenance: 0, links: {confirmed: 0, inferred: 0, kept: 0, dismissed: 0},
    roundTrip: {checked: 0, failed: []}, observations: [], mediaFiles: 0};
  const bump = (bucket, key) => { report[bucket][key] = (report[bucket][key] ?? 0) + 1; };

  // ———————————————————————————— 0. nimic modificat de oameni nu se suprascrie fără acord
  const edits = [];
  for (const key of ['media', ...ORDER]) {
    const table = key === 'media' ? 'media' : entity(key).table;
    const refs = (data[key] ?? []).map(i => i.ref);
    for (const ref of refs) {
      const row = db.prepare(`SELECT id, updated_by, updated_at FROM ${table} WHERE legacy_ref = ?`).get(ref);
      if (row && row.updated_by && row.updated_by !== IMPORT_USER.name)
        edits.push({key, id: row.id, by: row.updated_by, at: row.updated_at, title: ref});
    }
  }
  if (edits.length && !overwriteEdits) throw new ImportRefused(edits);
  report.overwritten = edits.length ? edits : undefined;

  const ids = new Map(); // ref natural → id
  const resolve = ref => {
    if (ref == null) return null;
    const id = ids.get(ref);
    if (id == null) throw new Error(`Trimitere nerezolvată în analiză: ${ref}`);
    return id;
  };

  return tx(db, () => {
    // ———————————————————————————— 1. surse
    const sourceIds = new Map();
    const sourceOf = s => {
      if (!s?.url) return null;
      if (sourceIds.has(s.url)) return sourceIds.get(s.url);
      const m = fetched.get(s.url);
      const id = store.source({kind: s.kind === 'endpoint' || m?.kind === 'api' ? 'endpoint' : 'site', url: s.url,
        title: s.method ?? null, fetched_at: m?.fetched_at ?? null, method: 'crawl', snapshot_file: s.file ?? m?.file ?? null, status: m?.status ?? null});
      sourceIds.set(s.url, id);
      return id;
    };
    const prov = (key, id, field, s, defaults = {}) => {
      if (!s) return;
      store.provenance({entity: key, id, field, source_id: sourceOf(s), excerpt: s.note ? `${s.excerpt ?? ''} — ${s.note}` : s.excerpt,
        method: s.method, certainty: s.certainty ?? defaults.certainty ?? 'confirmed', confidence: s.confidence ?? defaults.confidence ?? null});
      report.provenance++;
      if (s.confirmedBy) prov(key, id, field, {...s.confirmedBy, certainty: s.certainty});
      if (s.conflictsWith) prov(key, id, field, {...s.conflictsWith, certainty: 'unverified'});
    };

    // ———————————————————————————— 2. media (amprenta = cheia naturală; fișierele se scriu după COMMIT, §3.9)
    const toCopy = [];
    const usedNames = new Set(db.prepare('SELECT path FROM media').all().map(r => r.path));
    for (const m of data.media ?? []) {
      const f = m.fields, existing = db.prepare('SELECT * FROM media WHERE legacy_ref = ? OR sha1 = ?').get(m.ref, f.sha1);
      if (existing) {
        if (existing.alt !== f.alt && f.alt) db.prepare('UPDATE media SET alt = ?, updated_at = ?, updated_by = ? WHERE id = ?').run(f.alt, nowIso(), IMPORT_USER.name, existing.id);
        ids.set(m.ref, existing.id); bump(existing.alt === f.alt ? 'unchanged' : 'updated', 'media');
        continue;
      }
      let name = path.basename(f.path), n = 1;
      const base = name.replace(/(\.[^.]+)$/, ''), ext = path.extname(name);
      while (usedNames.has(`/media/uploads/${name}`)) name = `${base}-${++n}${ext}`;
      const p = `/media/uploads/${name}`;
      usedNames.add(p);
      const now = nowIso();
      const {lastInsertRowid} = db.prepare(`INSERT INTO media (path, sha1, mime, size, alt, original_url, legacy_ref, created_at, updated_at, created_by, updated_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(p, f.sha1, f.mime, f.size, f.alt, f.original_url, m.ref, now, now, IMPORT_USER.name, IMPORT_USER.name);
      ids.set(m.ref, Number(lastInsertRowid));
      prov('media', Number(lastInsertRowid), '', m.prov['']);
      toCopy.push({from: path.join(snapshotDir, f.file), to: path.join(mediaDir, 'uploads', name)});
      bump('created', 'media');
    }
    afterCommit(db, () => {
      for (const c of toCopy) { fs.mkdirSync(path.dirname(c.to), {recursive: true}); fs.copyFileSync(c.from, c.to); report.mediaFiles++; }
    });

    // ———————————————————————————— 3. entitățile, în ordinea dependențelor
    const encodeRefs = (key, fields) => {
      const out = {};
      for (const f of fieldsOf(key)) {
        if (!(f.key in fields) || f.type === 'refs') continue;
        let v = fields[f.key];
        if ((f.type === 'ref' || f.type === 'image') && typeof v === 'string') v = resolve(v);
        if (f.type === 'links' && Array.isArray(v)) v = v.map(l => ({...l, href: resolveHref(l.href)}));
        out[f.key] = v;
      }
      return out;
    };
    const resolveHref = h => {
      const m = /^ref:(\w+):(.+)$/.exec(h ?? '');
      if (!m) return h;
      const id = ids.get(`${m[1]}:${m[2]}`);
      if (id == null) { report.observations.push({impact: 'mediu', message: `Link spre o pagină care nu există în Brain: ${h}`}); return h; }
      return `ref:${m[1]}:${id}`;
    };

    for (const key of ORDER) {
      for (const item of data[key] ?? []) {
        const fields = encodeRefs(key, item.fields);
        const existing = store.byLegacy(key, item.ref);
        let id;
        if (existing) {
          id = existing.id;
          const r = store.update(key, id, fields, {publish: true});
          bump(r.changed.length ? 'updated' : 'unchanged', key);
        } else {
          id = store.create(key, fields, {legacy_ref: item.ref, publish: true});
          bump('created', key);
        }
        ids.set(item.ref, id);
        // fiecare câmp importat își scrie sursa: cea proprie sau, în lipsă, sursa înregistrării
        prov(key, id, '', item.prov['']);
        for (const f of fieldsOf(key)) {
          if (f.type === 'refs' || item.fields[f.key] == null) continue;
          prov(key, id, f.key, item.prov[f.key] ?? item.prov['']);
        }
        roundTrip(key, id, item);
      }
    }

    // ———————————————————————————— 4. legăturile (după ce există toate capetele)
    for (const key of ORDER) {
      for (const item of data[key] ?? []) {
        const id = ids.get(item.ref);
        for (const [fieldKey, list] of Object.entries(item.links ?? {})) {
          const f = fieldsOf(key).find(x => x.key === fieldKey), relId = `${key}.${fieldKey}`;
          const current = new Map(store.links(key, id, fieldKey).map(l => [l.dst_id, l]));
          const next = [];
          for (const l of list) {
            const dst = resolve(l.ref);
            if (store.isDismissed(relId, id, dst)) { report.links.dismissed++; continue; } // respingerile se țin minte
            const cur = current.get(dst);
            // decizia omului nu se suprascrie: ce e confirmat rămâne confirmat
            const status = cur && cur.status !== l.status && cur.created_by !== IMPORT_USER.name ? cur.status
              : cur?.status === 'confirmed' ? 'confirmed' : l.status ?? 'confirmed';
            if (cur && status !== (l.status ?? 'confirmed')) report.links.kept++;
            const attrs = l.attrs ? Object.fromEntries(Object.entries(l.attrs).map(([k, v]) => [k, typeof v === 'string' && v.startsWith('media:') ? resolve(v) : v])) : null;
            next.push({id: dst, status, confidence: l.confidence ?? null, source_id: sourceOf(l.evidence ?? item.prov['']),
              note: status === 'confirmed' ? null : l.evidence?.method ?? null, attrs});
            report.links[status === 'confirmed' ? 'confirmed' : 'inferred']++;
          }
          // legăturile adăugate de oameni rămân, la coadă
          for (const [dst, cur] of current) if (cur.created_by !== IMPORT_USER.name && !next.some(n => n.id === dst))
            next.push({id: dst, status: cur.status, confidence: cur.confidence, source_id: cur.source_id, note: cur.note, attrs: cur.attrs});
          store.setLinks(key, id, fieldKey, next);
          for (const l of list.filter(x => x.status && x.status !== 'confirmed')) {
            const dst = resolve(l.ref);
            prov(key, id, `${fieldKey}:${dst}`, l.evidence, {certainty: 'inferred', confidence: l.confidence});
          }
          if (!relation(relId)) throw new Error(`Relație nedeclarată în registru: ${relId}`);
          void f;
        }
      }
    }

    // ———————————————————————————— 5. evenimentele importului: rezolvate, scanarea le acoperă (§1.3 pas 4)
    db.prepare(`UPDATE change_events SET status = 'done', processed_at = ?, last_error = NULL
      WHERE status = 'pending' AND user_name = ?`).run(nowIso(), IMPORT_USER.name);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('scan_needed', '1') ON CONFLICT(key) DO UPDATE SET value = '1'`).run();

    report.observations.push(...store.observations);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('last_import', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify({at: report.at, analysis: index.crawled_at, created: report.created, updated: report.updated}));
    return report;
  });

  // Verificarea dus-întors (§1.3): textul convertit, citit înapoi, trebuie să dea exact aceleași blocuri.
  function roundTrip(key, id, item) {
    const rec = store.get(key, id), toks = store.tokens();
    for (const f of fieldsOf(key)) {
      if (!['text', 'textarea', 'richtext'].includes(f.type) || item.fields[f.key] == null) continue;
      report.roundTrip.checked++;
      const stored = expandTokens(rec[f.key], toks);
      const ok = f.type === 'richtext'
        ? same(blocks(canonValues(stored)), blocks(canonValues(item.fields[f.key])))
        : canonValues(decodeEntities(stored)) === canonValues(item.fields[f.key]);
      if (!ok) report.roundTrip.failed.push({ref: item.ref, field: f.key, url: item.prov['']?.url, source: String(item.fields[f.key]).slice(0, 160), stored: String(stored).slice(0, 160)});
    }
  }
}

const decodeEntities = s => String(s).replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
