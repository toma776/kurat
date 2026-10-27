// Rulare: node scripts/import.mjs [--db=data/brain.db] [--analysis=reference/analysis] [--snapshot=reference/snapshot]
//                                 [--media=media] [--overwrite-edits]
import fs from 'node:fs';
import path from 'node:path';
import {openDb} from '../src/core/db.mjs';
import {runImport, ImportRefused} from '../src/core/import.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const dbFile = arg('db', process.env.BRAIN_DB ?? 'data/brain.db');
const db = openDb(dbFile);

try {
  const r = runImport(db, {
    analysisDir: arg('analysis', 'reference/analysis'),
    snapshotDir: arg('snapshot', 'reference/snapshot'),
    mediaDir: arg('media', 'media'),
    overwriteEdits: process.argv.includes('--overwrite-edits')
  });
  const keys = [...new Set([...Object.keys(r.created), ...Object.keys(r.updated), ...Object.keys(r.unchanged)])];
  console.table(Object.fromEntries(keys.map(k => [k, {create: r.created[k] ?? 0, actualizate: r.updated[k] ?? 0, neschimbate: r.unchanged[k] ?? 0}])));
  console.log(`Proveniență: ${r.provenance} rânduri · legături: ${r.links.confirmed} confirmate, ${r.links.inferred} deduse, ${r.links.kept} decizii păstrate, ${r.links.dismissed} respinse ignorate · fișiere media copiate: ${r.mediaFiles}`);
  console.log(`Verificare dus-întors: ${r.roundTrip.checked - r.roundTrip.failed.length}/${r.roundTrip.checked} câmpuri identice`);
  for (const f of r.roundTrip.failed) console.log(`  ✗ ${f.ref}.${f.field} (${f.url})\n    sursă:   ${f.source}\n    stocat:  ${f.stored}`);
  if (r.observations.length) { console.log('Observații:'); for (const o of r.observations) console.log(`  • [${o.impact}] ${o.entity ? `${o.entity}:${o.id}.${o.field} — ` : ''}${o.message}`); }
  fs.mkdirSync(path.dirname(path.resolve(dbFile)), {recursive: true});
  fs.writeFileSync(path.join(path.dirname(path.resolve(dbFile)), 'import-report.json'), JSON.stringify(r, null, 2));
  console.log('Pasul următor: scan (randarea paginilor publice) — marcat în meta.scan_needed.');
  if (r.roundTrip.failed.length) process.exitCode = 2;
} catch (err) {
  if (err instanceof ImportRefused) { console.error(err.message); process.exitCode = 3; }
  else throw err;
} finally {
  db.close();
}
