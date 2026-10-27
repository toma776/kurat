import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {DatabaseSync} from 'node:sqlite';
import {tmpDir} from './helpers.mjs';
import {openDb} from '../src/core/db.mjs';
import {createStore} from '../src/core/store.mjs';
import {startGitSync} from '../src/core/gitsync.mjs';

const git = (cwd, ...args) => execFileSync('git', args, {cwd, encoding: 'utf8'}).trim();

// Un depozit de probă cu „GitHub” local (bare), ca testul să nu urce nimic nicăieri.
function sandbox() {
  const dir = tmpDir(), remote = path.join(dir, 'remote.git'), root = path.join(dir, 'work');
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote);
  fs.mkdirSync(root);
  git(root, 'init', '-q', '-b', 'main'); git(root, 'config', 'user.name', 'Test'); git(root, 'config', 'user.email', 'test@example.com');
  git(root, 'remote', 'add', 'origin', remote);
  fs.writeFileSync(path.join(root, 'cod.mjs'), 'export const v = 1;\n');
  fs.writeFileSync(path.join(root, '.gitignore'), '/data/\n');
  git(root, 'add', '-A'); git(root, 'commit', '-q', '-m', 'inițial'); git(root, 'push', '-q', '-u', 'origin', 'main');
  const db = openDb(path.join(root, 'data', 'lucru.db'));
  return {root, remote, db};
}

test('după o modificare în panou și un minut de liniște, seed/ și media/ se urcă singure; codul și datele personale nu', async () => {
  const {root, remote, db} = sandbox();
  const sync = startGitSync(db, {root, log: () => {}, quietMs: 0, everyMs: 3_600_000});
  const store = createStore(db, {user: {name: 'Ana'}});
  store.create('clienti', {nume: 'Firma Nouă'}, {publish: true});
  db.prepare("INSERT INTO leads (nume, contact, sursa, stare, created_at, updated_at) VALUES ('Ion Popescu', '0711 111 111', 'formular', 'noua', datetime('now'), datetime('now'))").run();
  fs.mkdirSync(path.join(root, 'media', 'uploads'), {recursive: true});
  fs.writeFileSync(path.join(root, 'media', 'uploads', 'logo.png'), Buffer.from('89504e470d0a1a0a', 'hex'));
  fs.writeFileSync(path.join(root, 'cod.mjs'), 'export const v = 2; // nesalvat, nu trebuie urcat\n');

  await sync.run(); // vede schimbarea
  await sync.run(); // e liniște: urcă
  const files = git(remote, 'show', '--name-only', '--format=%s', 'main');
  assert.match(files, /^Conținut actualizat din panou/);
  assert.match(files, /seed\/brain\.db/);
  assert.match(files, /media\/uploads\/logo\.png/);
  assert.doesNotMatch(files, /cod\.mjs|data\//, 'codul și baza de lucru rămân pe loc');

  // copia urcată are conținutul, dar nu și cererile de ofertă
  const out = path.join(root, 'verif.db');
  fs.writeFileSync(out, execFileSync('git', ['show', 'main:seed/brain.db'], {cwd: remote}));
  const seed = new DatabaseSync(out);
  assert.equal(seed.prepare("SELECT COUNT(*) n FROM clients WHERE nume = 'Firma Nouă'").get().n, 1);
  assert.equal(seed.prepare('SELECT COUNT(*) n FROM leads').get().n, 0);
  assert.equal(seed.prepare('SELECT COUNT(*) n FROM users').get().n, 0);
  seed.close();

  // fără modificări noi, nu mai urcă nimic
  const before = git(remote, 'rev-parse', 'main');
  await sync.run(); await sync.run();
  assert.equal(git(remote, 'rev-parse', 'main'), before);
  sync.stop();
});

test('modificările făcute cât serverul era oprit se urcă la pornire (fără stare salvată nu presupune că depozitul e la zi)', async () => {
  const {root, remote, db} = sandbox();
  createStore(db, {user: {name: 'Ana'}}).create('clienti', {nume: 'Făcută offline'}, {publish: true});
  const before = git(remote, 'rev-parse', 'main');
  const sync = startGitSync(db, {root, log: () => {}, quietMs: 0, everyMs: 3_600_000});
  await sync.run();
  assert.notEqual(git(remote, 'rev-parse', 'main'), before);
  assert.match(git(remote, 'show', '--name-only', '--format=%s', 'main'), /seed\/brain\.db/);
  sync.stop();
});
