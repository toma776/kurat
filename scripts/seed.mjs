// Copia publică a Brain-ului: conținutul (entități, legături, surse, proveniență, media, istoric), fără date personale.
// Rulare: node scripts/seed.mjs [--from=data/brain.db] [--to=seed/brain.db]
// Depozitul e public: din copie lipsesc utilizatorii, sesiunile, încercările de autentificare, cererile de ofertă
// (și urmele lor din istoric) și lista copiilor de siguranță locale. Un clone nou pornește din ea (vezi openDb).
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const from = path.resolve(arg('from', 'data/brain.db')), to = path.resolve(arg('to', 'seed/brain.db'));

fs.mkdirSync(path.dirname(to), {recursive: true});
for (const f of [to, `${to}-wal`, `${to}-shm`]) fs.rmSync(f, {force: true});
new DatabaseSync(from).exec(`VACUUM INTO '${to.replace(/'/g, "''")}'`);

const db = new DatabaseSync(to);
const has = t => !!db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
const removed = {};
const wipe = (table, where = '1') => { if (has(table)) removed[table] = Number(db.prepare(`DELETE FROM ${table} WHERE ${where}`).run().changes); };
wipe('sessions'); wipe('login_attempts'); wipe('users'); wipe('leads'); wipe('backups');
for (const t of ['change_events', 'audit_log', 'provenance', 'validations']) if (has(t)) {
  const col = db.prepare(`PRAGMA table_info(${t})`).all().some(c => c.name === 'entity') ? 'entity' : null;
  if (col) { const n = Number(db.prepare(`DELETE FROM ${t} WHERE ${col} = 'cereri'`).run().changes); if (n) removed[`${t} (cereri)`] = n; }
}
db.exec('VACUUM');
db.close();
console.log(`Copia publică: ${path.relative(process.cwd(), to)} (${Math.round(fs.statSync(to).size / 1024)} KB)`);
console.log('Scoase:', Object.entries(removed).filter(([, n]) => n).map(([t, n]) => `${t} ${n}`).join(', ') || 'nimic');
