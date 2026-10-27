// Copiile de siguranță (§3.12): automat o dată pe zi (verificat la fiecare oră: ultima copie are peste 20 de ore?),
// manual din Setări, descărcare și restaurare. Restaurarea e tot o modificare, cu eveniment global.
//
// O copie e un singur fișier .tar.gz cu:
//   backup.json   — manifestul: când, cine, ce tabele, câte rânduri, fișierele media cu amprenta lor
//   brain.db      — copia consistentă a bazei (VACUUM INTO), făcută cu baza deschisă
//   media/uploads/<fișier> — fișierele media
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import {DatabaseSync} from 'node:sqlite';
import {pack, unpack} from '../lib/tar.mjs';
import {sha1, nowIso} from './util.mjs';
import {tx, migrate} from './db.mjs';
import {createStore} from './store.mjs';

export const AUTO_EVERY_HOURS = 20;
const KEEP = {auto: 14, 'pre-restore': 5, upload: 5}; // copiile manuale nu se șterg automat
// Ce NU se restaurează: conturile și sesiunile (ca restaurarea să nu încuie pe nimeni afară), registrul copiilor,
// și datele derivate (indexul paginilor, dependențele, jurnalul propagării), refăcute de evenimentul global.
const KEEP_CURRENT = new Set(['users', 'sessions', 'login_attempts', 'backups', 'change_events', 'sync_log', 'page_index', 'page_deps', 'meta', 'sqlite_sequence']);
const APP = 'kurat-brain';

const stamp = d => d.toISOString().replace(/[-:]/g, '').replace(/Z$/, '').replace('T', '-').replace('.', '-');
const safeMediaName = n => /^media\/uploads\/[\w.-]+$/.test(n) && !n.includes('..');

function userTables(db, schema = 'main') {
  return db.prepare(`SELECT name FROM ${schema}.sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`).all().map(r => r.name);
}

// ———————————————————————————————————————————— creare

export function createBackup(db, {dir, mediaDir, kind = 'manual', by = 'Sistem', note = null}) {
  fs.mkdirSync(dir, {recursive: true});
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kurat-backup-'));
  try {
    const dbCopy = path.join(tmp, 'brain.db');
    db.prepare('VACUUM INTO ?').run(dbCopy); // copie consistentă, fără să oprim scrierile
    const media = db.prepare('SELECT path, sha1 FROM media ORDER BY id').all();
    const entries = [], missing = [];
    for (const m of media) {
      const f = path.join(mediaDir, m.path.replace(/^\/media\//, ''));
      if (!fs.existsSync(f)) { missing.push(m.path); continue; }
      entries.push({name: m.path.replace(/^\//, ''), data: fs.readFileSync(f)});
    }
    const counts = Object.fromEntries(userTables(db).map(t => [t, db.prepare(`SELECT COUNT(*) n FROM "${t}"`).get().n]));
    const at = new Date();
    const manifest = {app: APP, version: 1, created_at: at.toISOString(), kind, by, note, counts,
      media: media.map(m => ({path: m.path, sha1: m.sha1})), missing_media: missing};
    const archive = zlib.gzipSync(pack([
      {name: 'backup.json', data: Buffer.from(JSON.stringify(manifest, null, 2))},
      {name: 'brain.db', data: fs.readFileSync(dbCopy)},
      ...entries
    ]), {level: 6});
    let file = `kurat-brain-${stamp(at)}-${kind}.tar.gz`;
    for (let n = 2; fs.existsSync(path.join(dir, file)) || db.prepare('SELECT 1 FROM backups WHERE file = ?').get(file); n++)
      file = `kurat-brain-${stamp(at)}-${n}-${kind}.tar.gz`;
    fs.writeFileSync(path.join(dir, file), archive);
    const {lastInsertRowid} = db.prepare('INSERT INTO backups (file, at, kind, size, sha1, by, note, media) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .run(file, manifest.created_at, kind, archive.length, sha1(archive), by, note, entries.length);
    prune(db, dir);
    return {id: Number(lastInsertRowid), file, size: archive.length, media: entries.length, missing};
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
}

export function listBackups(db, dir) {
  return db.prepare('SELECT * FROM backups ORDER BY at DESC, id DESC').all().map(b => ({...b, exists: fs.existsSync(path.join(dir, b.file))}));
}

export function backupPath(db, dir, id) {
  const b = db.prepare('SELECT * FROM backups WHERE id = ?').get(id);
  if (!b) return null;
  const f = path.join(dir, path.basename(b.file));
  return fs.existsSync(f) ? {...b, path: f} : null;
}

// Copiile vechi se șterg: ultimele 14 automate, ultimele 5 de dinainte de restaurare și 5 încărcate; cele manuale rămân.
function prune(db, dir) {
  for (const [kind, keep] of Object.entries(KEEP)) {
    for (const b of db.prepare('SELECT * FROM backups WHERE kind = ? ORDER BY at DESC, id DESC').all(kind).slice(keep)) {
      fs.rmSync(path.join(dir, path.basename(b.file)), {force: true});
      db.prepare('DELETE FROM backups WHERE id = ?').run(b.id);
    }
  }
}

// Verificarea orară: o copie automată dacă ultima (de orice fel, mai puțin cea încărcată) are peste 20 de ore.
export function maybeAutoBackup(db, {dir, mediaDir, now = Date.now()}) {
  const last = db.prepare("SELECT at FROM backups WHERE kind IN ('auto','manual') ORDER BY at DESC LIMIT 1").get();
  if (last && now - Date.parse(last.at) < AUTO_EVERY_HOURS * 3600_000) return null;
  return createBackup(db, {dir, mediaDir, kind: 'auto', by: 'Sistem'});
}

// ———————————————————————————————————————————— citire și verificare

export function readArchive(buffer) {
  let tar;
  try { tar = zlib.gunzipSync(buffer); } catch { throw Object.assign(new Error('Fișierul nu e o copie de siguranță (.tar.gz) validă.'), {status: 422}); }
  let entries;
  try { entries = unpack(tar); } catch (e) { throw Object.assign(new Error(e.message), {status: 422}); }
  const byName = new Map(entries.map(e => [e.name, e]));
  const manifestEntry = byName.get('backup.json'), dbEntry = byName.get('brain.db');
  if (!manifestEntry || !dbEntry) throw Object.assign(new Error('Arhiva nu conține backup.json și brain.db.'), {status: 422});
  const manifest = JSON.parse(manifestEntry.data.toString('utf8'));
  if (manifest.app !== APP) throw Object.assign(new Error('Arhiva nu e o copie a Brain-ului Kurat.'), {status: 422});
  const media = entries.filter(e => e.name.startsWith('media/'));
  const bad = media.filter(e => !safeMediaName(e.name)).map(e => e.name);
  if (bad.length) throw Object.assign(new Error(`Arhiva conține căi nepermise: ${bad.slice(0, 3).join(', ')}`), {status: 422});
  // fiecare fișier media trebuie să aibă amprenta din manifest
  const expected = new Map((manifest.media ?? []).map(m => [m.path.replace(/^\//, ''), m.sha1]));
  const wrong = media.filter(e => expected.has(e.name) && expected.get(e.name) !== sha1(e.data)).map(e => e.name);
  if (wrong.length) throw Object.assign(new Error(`Fișiere media alterate în arhivă: ${wrong.slice(0, 3).join(', ')}`), {status: 422});
  return {manifest, db: dbEntry.data, media};
}

// ———————————————————————————————————————————— restaurare

// Restaurarea: întâi o copie automată a stării curente, apoi conținutul copiei intră în baza deschisă într-o singură
// tranzacție, fișierele media se scriu, iar un eveniment global reface toate paginile.
export function restoreBackup(db, {buffer, dir, mediaDir, user, backupId = null}) {
  const {manifest, db: dbBuf, media} = readArchive(buffer);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'kurat-restore-'));
  const file = path.join(tmp, 'brain.db');
  fs.writeFileSync(file, dbBuf);
  try {
    // copia trebuie să fie o bază SQLite întreagă
    const check = new DatabaseSync(file);
    const ok = check.prepare('PRAGMA integrity_check').get();
    check.close();
    if (Object.values(ok)[0] !== 'ok') throw Object.assign(new Error('Baza din arhivă e coruptă (integrity_check).'), {status: 422});

    const pre = createBackup(db, {dir, mediaDir, kind: 'pre-restore', by: user.name, note: `înainte de restaurarea copiei din ${manifest.created_at}`});

    db.exec('PRAGMA foreign_keys = OFF');
    db.prepare('ATTACH DATABASE ? AS bk').run(file);
    let restored = [];
    try {
      tx(db, () => {
        const bkTables = new Set(userTables(db, 'bk'));
        for (const t of userTables(db)) {
          if (KEEP_CURRENT.has(t)) continue;
          db.exec(`DELETE FROM main."${t}"`);
          if (!bkTables.has(t)) continue; // tabel apărut după copie: rămâne gol, ca la data copiei
          const mine = new Set(db.prepare(`PRAGMA main.table_info("${t}")`).all().map(c => c.name));
          const cols = db.prepare(`PRAGMA bk.table_info("${t}")`).all().map(c => c.name).filter(c => mine.has(c)).map(c => `"${c}"`).join(', ');
          db.exec(`INSERT INTO main."${t}" (${cols}) SELECT ${cols} FROM bk."${t}"`);
          restored.push(t);
        }
        // contoarele AUTOINCREMENT: ID-urile șterse nu se refolosesc (§1.2)
        for (const t of restored) {
          const s = db.prepare('SELECT seq FROM bk.sqlite_sequence WHERE name = ?').get(t);
          db.prepare('DELETE FROM main.sqlite_sequence WHERE name = ?').run(t);
          if (s) db.prepare('INSERT INTO main.sqlite_sequence (name, seq) VALUES (?, ?)').run(t, s.seq);
        }
        const fk = db.prepare('PRAGMA foreign_key_check').all();
        if (fk.length) throw Object.assign(new Error(`Copia are trimiteri rupte (${fk.length}); restaurarea a fost anulată.`), {status: 422});
      });
    } finally {
      db.exec('DETACH DATABASE bk');
      db.exec('PRAGMA foreign_keys = ON');
    }
    migrate(db); // o copie mai veche primește coloanele noi din registru

    // fișierele media din copie (cele existente se suprascriu; cele în plus rămân, nefolosite)
    for (const m of media) {
      const f = path.join(mediaDir, m.name.replace(/^media\//, ''));
      fs.mkdirSync(path.dirname(f), {recursive: true});
      fs.writeFileSync(f, m.data);
    }
    if (backupId) db.prepare('UPDATE backups SET restored_at = ?, restored_by = ? WHERE id = ?').run(nowIso(), user.name, backupId);
    db.prepare(`INSERT INTO meta (key, value) VALUES ('last_restore', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value`)
      .run(JSON.stringify({at: nowIso(), by: user.name, from: manifest.created_at, pre: pre.file}));
    createStore(db, {user}).globalEvent('restore', `Restaurare din copia de ${manifest.created_at}`, {copie: [null, manifest.created_at], inainte: [null, pre.file]});
    return {restored: restored.length, from: manifest.created_at, media: media.length, preRestore: pre.file};
  } finally {
    fs.rmSync(tmp, {recursive: true, force: true});
  }
}
