import fs from 'node:fs';
import path from 'node:path';
import {DatabaseSync} from 'node:sqlite';
import {ENTITIES, relTable, entity, checkRegistry} from '../registry/entities.mjs';

// Schema sistemului (Anexa B). Tabelele entităților se generează din registru în migrate().
const SYSTEM = `
CREATE TABLE IF NOT EXISTS sources (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  kind TEXT NOT NULL CHECK (kind IN ('site','endpoint','repo','document','manual')),
  url TEXT NOT NULL UNIQUE, title TEXT, fetched_at TEXT, method TEXT, snapshot_file TEXT, status INTEGER, note TEXT,
  created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS provenance (
  id INTEGER PRIMARY KEY AUTOINCREMENT, entity TEXT NOT NULL, entity_id INTEGER NOT NULL, field TEXT NOT NULL DEFAULT '',
  source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE, excerpt TEXT, method TEXT,
  certainty TEXT NOT NULL DEFAULT 'confirmed' CHECK (certainty IN ('confirmed','inferred','unverified','unrecoverable')),
  confidence REAL, verified_at TEXT, verified_by TEXT, created_at TEXT NOT NULL,
  UNIQUE (entity, entity_id, field, source_id));
CREATE INDEX IF NOT EXISTS provenance_entity ON provenance(entity, entity_id);

CREATE TABLE IF NOT EXISTS link_dismissals (
  relation TEXT NOT NULL, src_id INTEGER NOT NULL, dst_id INTEGER NOT NULL, evidence TEXT,
  at TEXT NOT NULL, by TEXT, PRIMARY KEY (relation, src_id, dst_id));
CREATE TABLE IF NOT EXISTS aliases (
  entity TEXT NOT NULL, entity_id INTEGER NOT NULL, alias TEXT NOT NULL, learned_from TEXT, at TEXT NOT NULL,
  PRIMARY KEY (entity, alias));

CREATE TABLE IF NOT EXISTS media (
  id INTEGER PRIMARY KEY AUTOINCREMENT, path TEXT NOT NULL UNIQUE, sha1 TEXT NOT NULL UNIQUE, mime TEXT, size INTEGER,
  alt TEXT, title TEXT, original_url TEXT, legacy_ref TEXT UNIQUE,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT, updated_by TEXT);
CREATE TABLE IF NOT EXISTS redirects (
  id INTEGER PRIMARY KEY AUTOINCREMENT, from_path TEXT NOT NULL UNIQUE, to_path TEXT, to_ref TEXT,
  code INTEGER NOT NULL DEFAULT 301, auto INTEGER NOT NULL DEFAULT 0, note TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL, created_by TEXT,
  CHECK (to_path IS NOT NULL OR to_ref IS NOT NULL));

CREATE TABLE IF NOT EXISTS page_index (
  path TEXT PRIMARY KEY, owner_entity TEXT, owner_id INTEGER, title TEXT, status INTEGER, rendered_at TEXT,
  hash TEXT, deps INTEGER, error TEXT, stale INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS page_deps (
  path TEXT NOT NULL, entity TEXT NOT NULL, entity_id INTEGER,
  kind TEXT NOT NULL CHECK (kind IN ('page','direct','list','query','link','media','layout','pending')),
  component TEXT NOT NULL DEFAULT '', scope TEXT NOT NULL DEFAULT '', fields TEXT, reason TEXT);
CREATE INDEX IF NOT EXISTS page_deps_entity ON page_deps(entity, entity_id);
CREATE INDEX IF NOT EXISTS page_deps_path ON page_deps(path);

CREATE TABLE IF NOT EXISTS change_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT, at TEXT NOT NULL, user_name TEXT, action TEXT NOT NULL, entity TEXT, entity_id INTEGER,
  label TEXT, payload TEXT,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','done','failed')),
  attempts INTEGER NOT NULL DEFAULT 0, last_error TEXT, processed_at TEXT, affected INTEGER,
  retry_at TEXT);  -- NOU: următoarea reîncercare a unui eveniment eșuat (30 s × 2ⁿ)
CREATE INDEX IF NOT EXISTS change_events_status ON change_events(status, id);
CREATE TABLE IF NOT EXISTS sync_log (
  id INTEGER PRIMARY KEY, event_id INTEGER REFERENCES change_events(id) ON DELETE CASCADE, at TEXT NOT NULL,
  path TEXT, action TEXT NOT NULL, detail TEXT);

CREATE TABLE IF NOT EXISTS audit_log (id INTEGER PRIMARY KEY, at TEXT NOT NULL, user_id INTEGER, user_name TEXT,
  action TEXT NOT NULL, entity TEXT, entity_id INTEGER, label TEXT, changes TEXT, reverted_by INTEGER);
CREATE INDEX IF NOT EXISTS audit_entity ON audit_log(entity, entity_id);
CREATE TABLE IF NOT EXISTS validations (entity TEXT NOT NULL, entity_id INTEGER NOT NULL, fp TEXT NOT NULL, user_name TEXT,
  at TEXT NOT NULL, comment TEXT, PRIMARY KEY (entity, entity_id));
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT, updated_at TEXT, updated_by TEXT);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'editor' CHECK (role IN ('admin','editor','viewer')),
  password_hash TEXT, active INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL);
CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- amprenta SHA-256 a jetonului din cookie; jetonul nu se păstrează
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TEXT NOT NULL, expires_at TEXT NOT NULL, ip TEXT, user_agent TEXT);
CREATE TABLE IF NOT EXISTS backups (
  id INTEGER PRIMARY KEY AUTOINCREMENT, file TEXT NOT NULL UNIQUE, at TEXT NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('auto','manual','pre-restore','upload')),
  size INTEGER, sha1 TEXT, by TEXT, note TEXT, media INTEGER, restored_at TEXT, restored_by TEXT);
CREATE TABLE IF NOT EXISTS login_attempts (ip TEXT NOT NULL, email TEXT, at TEXT NOT NULL, ok INTEGER NOT NULL);
CREATE INDEX IF NOT EXISTS login_attempts_ip ON login_attempts(ip, at);
`;

const SQL_TYPE = {int: 'INTEGER', boolean: 'INTEGER', ref: 'INTEGER', image: 'INTEGER', number: 'REAL', money: 'REAL'};

function columnsOf(e) {
  const cols = [
    ['id', 'INTEGER PRIMARY KEY AUTOINCREMENT'],
    ...(e.noStatus ? [] : [
      ['status', `TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived'))`],
      ['draft', 'TEXT'], ['published_at', 'TEXT']]),
    ['search', 'TEXT'], ['legacy_ref', 'TEXT'],
    ['created_at', 'TEXT NOT NULL'], ['updated_at', 'TEXT NOT NULL'], ['created_by', 'TEXT'], ['updated_by', 'TEXT']
  ];
  for (const f of e.fields) {
    if (f.type === 'refs') continue;
    let def = SQL_TYPE[f.type] ?? 'TEXT';
    if (f.type === 'ref') def += ` REFERENCES ${entity(f.target).table}(id) ON DELETE ${f.required ? 'RESTRICT' : 'SET NULL'}`;
    if (f.type === 'image') def += ' REFERENCES media(id) ON DELETE SET NULL';
    cols.push([f.key, def]);
  }
  return cols;
}

export function migrate(db) {
  const errors = checkRegistry();
  if (errors.length) throw new Error(`Registrul are erori:\n- ${errors.join('\n- ')}`);
  db.exec(SYSTEM);
  // coloanele adăugate în timp la tabelele sistemului (migrarea doar adaugă)
  for (const [table, col, def] of [['change_events', 'retry_at', 'TEXT']]) {
    if (!db.prepare(`PRAGMA table_info(${table})`).all().some(c => c.name === col)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${def}`);
  }
  for (const e of ENTITIES) {
    const cols = columnsOf(e);
    db.exec(`CREATE TABLE IF NOT EXISTS ${e.table} (${cols.map(([c, d]) => `"${c}" ${d}`).join(', ')})`);
    // Migrarea doar adaugă (§1.1): coloanele noi din registru apar la pornire.
    const have = new Set(db.prepare(`PRAGMA table_info(${e.table})`).all().map(c => c.name));
    for (const [c, d] of cols) if (!have.has(c)) db.exec(`ALTER TABLE ${e.table} ADD COLUMN "${c}" ${d.replace(/ NOT NULL.*$/, '')}`);
    db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${e.table}_legacy ON ${e.table}(legacy_ref)`);
    for (const f of e.fields) {
      if (f.type === 'slug' || f.unique) db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS ${e.table}_${f.key}_u ON ${e.table}("${f.key}")`);
      if (f.type === 'ref' || f.type === 'image') db.exec(`CREATE INDEX IF NOT EXISTS ${e.table}_${f.key}_i ON ${e.table}("${f.key}")`);
      if (f.type !== 'refs') continue;
      const t = relTable(e, f), target = entity(f.target).table;
      db.exec(`CREATE TABLE IF NOT EXISTS ${t} (
        src_id INTEGER NOT NULL REFERENCES ${e.table}(id) ON DELETE CASCADE,
        dst_id INTEGER NOT NULL REFERENCES ${target}(id) ON DELETE CASCADE,
        position INTEGER NOT NULL DEFAULT 0,
        status TEXT NOT NULL DEFAULT 'confirmed' CHECK (status IN ('confirmed','inferred','unverified')),
        confidence REAL,
        source_id INTEGER REFERENCES sources(id) ON DELETE SET NULL, note TEXT,
        attrs TEXT,
        created_at TEXT, created_by TEXT,
        PRIMARY KEY (src_id, dst_id))`);
      db.exec(`CREATE INDEX IF NOT EXISTS ${t}_dst ON ${t}(dst_id)`);
      if (f.target === e.key) db.exec(`CREATE TRIGGER IF NOT EXISTS ${t}_noself BEFORE INSERT ON ${t}
        WHEN NEW.src_id = NEW.dst_id BEGIN SELECT RAISE(ABORT, 'O înregistrare nu se poate lega de ea însăși.'); END`);
    }
  }
}

export function openDb(file = process.env.BRAIN_DB ?? 'data/brain.db') {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), {recursive: true});
  // un clone nou n-are data/brain.db: pornește din copia publică a conținutului (scripts/seed.mjs), dacă există
  const seed = path.resolve('seed/brain.db');
  if (file !== ':memory:' && path.resolve(file) === path.resolve('data/brain.db') && !fs.existsSync(file) && fs.existsSync(seed)) fs.copyFileSync(seed, file);
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  migrate(db);
  return db;
}

// ———————————————————————————————————————————— tranzacții

const state = new WeakMap();
const st = db => { let s = state.get(db); if (!s) state.set(db, s = {depth: 0, after: []}); return s; };

// O modificare = o tranzacție (§0.6). Tranzacțiile imbricate se alătură celei exterioare.
export function tx(db, fn) {
  const s = st(db);
  if (s.depth) { s.depth++; try { return fn(); } finally { s.depth--; } }
  db.exec('BEGIN IMMEDIATE');
  s.depth = 1; s.after = [];
  try {
    const out = fn();
    db.exec('COMMIT');
    s.depth = 0;
    const cbs = s.after; s.after = [];
    for (const cb of cbs) { try { cb(); } catch (err) { console.error('afterCommit:', err); } }
    return out;
  } catch (err) {
    s.depth = 0; s.after = [];
    try { db.exec('ROLLBACK'); } catch { /* deja anulată */ }
    throw err;
  }
}

// Ascultătorii află doar după COMMIT; o tranzacție anulată nu anunță pe nimeni (§3.3).
export function afterCommit(db, cb) {
  const s = st(db);
  if (s.depth) s.after.push(cb); else cb();
}

export const inTx = db => st(db).depth > 0;
