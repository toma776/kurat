// Copia publică a Brain-ului (seed/brain.db): conținutul (entități, legături, surse, proveniență, media, istoric), fără date personale.
// Depozitul e public: din copie lipsesc utilizatorii, sesiunile, încercările de autentificare, cererile de ofertă
// (și urmele lor din istoric) și lista copiilor de siguranță locale. Un clone nou pornește din ea (vezi openDb).
import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';

// db: conexiunea deschisă (serverul) sau calea fișierului de lucru; to: unde se scrie copia.
export function makeSeed(db, to = 'seed/brain.db') {
  to = path.resolve(to);
  const tmp = `${to}.tmp`;
  fs.mkdirSync(path.dirname(to), {recursive: true});
  for (const f of [tmp, `${tmp}-wal`, `${tmp}-shm`]) fs.rmSync(f, {force: true});
  const src = typeof db === 'string' ? new DatabaseSync(path.resolve(db)) : db;
  src.exec(`VACUUM INTO '${tmp.replace(/'/g, "''")}'`);
  if (typeof db === 'string') src.close();

  const out = new DatabaseSync(tmp);
  const has = t => !!out.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?").get(t);
  const removed = {};
  const wipe = (table, where = '1') => { if (has(table)) removed[table] = Number(out.prepare(`DELETE FROM ${table} WHERE ${where}`).run().changes); };
  wipe('sessions'); wipe('login_attempts'); wipe('users'); wipe('leads'); wipe('backups');
  for (const t of ['change_events', 'audit_log', 'provenance', 'validations']) {
    if (has(t) && out.prepare(`PRAGMA table_info(${t})`).all().some(c => c.name === 'entity')) {
      const n = Number(out.prepare(`DELETE FROM ${t} WHERE entity = 'cereri'`).run().changes);
      if (n) removed[`${t} (cereri)`] = n;
    }
  }
  out.exec('VACUUM');
  out.close();
  fs.renameSync(tmp, to);
  return {file: to, size: fs.statSync(to).size, removed: Object.fromEntries(Object.entries(removed).filter(([, n]) => n))};
}
