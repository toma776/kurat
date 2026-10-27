import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {openDb} from '../src/core/db.mjs';
import {runImport} from '../src/core/import.mjs';

export const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'kurat-brain-'));

// O bază nouă, cu importul rulat pe datele reale (snapshot-ul și analiza din reference/).
export function imported(opts = {}) {
  const dir = tmpDir();
  const db = openDb(path.join(dir, 'brain.db'));
  const report = runImport(db, {mediaDir: path.join(dir, 'media'), ...opts});
  return {db, dir, report, reimport: (o = {}) => runImport(db, {mediaDir: path.join(dir, 'media'), ...o})};
}

export const legacyMap = (db, table) =>
  Object.fromEntries(db.prepare(`SELECT legacy_ref, id FROM ${table} WHERE legacy_ref IS NOT NULL ORDER BY legacy_ref`).all().map(r => [r.legacy_ref, r.id]));
