// Sincronizarea automată cu GitHub: după ce conținutul sau imaginile se schimbă în panou și e liniște un minut,
// serverul reface copia publică (seed/brain.db, fără date personale) și urcă DOAR seed/ și media/ în depozit.
// Codul nu intră niciodată în aceste commit-uri. Pornește doar cu BRAIN_GIT_SYNC=1 (serverul local din .claude/launch.json).
import fs from 'node:fs';
import path from 'node:path';
import {execFile} from 'node:child_process';
import {makeSeed} from './seed.mjs';
import {makeVariants, findChrome} from './images.mjs';

const PATHS = ['seed', 'media'];
const git = (args, cwd) => new Promise(resolve => execFile('git', args, {cwd, windowsHide: true, timeout: 120_000},
  (err, stdout, stderr) => resolve({ok: !err, code: err?.code ?? 0, out: String(stdout).trim(), err: String(stderr).trim()})));

// Semnătura conținutului: se schimbă la orice modificare din panou (evenimente, istoric) și la orice fișier media.
const signature = db => {
  const one = sql => db.prepare(sql).get();
  return JSON.stringify([one('SELECT MAX(id) m FROM change_events').m, one('SELECT MAX(id) m FROM audit_log').m,
    one('SELECT COUNT(*) n, MAX(updated_at) u FROM media')]);
};

// Starea pentru panou (bara laterală): oprită / la zi / modificări în așteptare / se urcă / eroare.
const status = {enabled: false, state: 'off', lastPushAt: null, lastMsg: null, lastError: null, pendingSince: null};
export const gitSyncStatus = () => ({...status});

export function startGitSync(db, {root = process.cwd(), log = console.log, quietMs = 60_000, everyMs = 15_000} = {}) {
  if (!fs.existsSync(path.join(root, '.git'))) { log('sincronizare git: dosarul nu e un depozit git, oprită'); return null; }
  const stateFile = path.join(root, 'data', '.git-sync');
  let synced = fs.existsSync(stateFile) ? fs.readFileSync(stateFile, 'utf8') : null;
  let seen = signature(db), seenAt = Date.now(), busy = false;
  // fără stare salvată (prima pornire), nu presupunem nimic: după un minut reface copia și urcă doar dacă diferă de depozit
  if (synced == null) synced = '';
  git(['remote', 'get-url', 'origin'], root).then(r => { if (r.ok) status.repoUrl = r.out.replace(/.git$/, '').replace(/^git@github.com:/, 'https://github.com/'); });
  status.previewUrl = process.env.BRAIN_PREVIEW_URL ?? null;
  Object.assign(status, {enabled: true, state: seen === synced ? 'ok' : 'pending', pendingSince: seen === synced ? null : Date.now()});

  async function run() {
    const sig = signature(db);
    if (sig !== seen) { seen = sig; seenAt = Date.now(); if (sig !== synced) { status.state = 'pending'; status.pendingSince ??= Date.now(); } return; }
    if (busy || sig === synced || Date.now() - seenAt < quietMs) return;
    busy = true; status.state = 'pushing';
    try {
      // fotografiile noi sau înlocuite primesc variantele mici înainte de urcare (doar unde e Chrome, adică local)
      if (findChrome()) await makeVariants(path.join(root, 'media')).catch(e => log(`sincronizare git: variante de imagini — ${e.message}`));
      makeSeed(db, path.join(root, 'seed/brain.db'));
      // doar dosarele care există: o cale lipsă ar face git add să eșueze și ar părea că nu e nimic de urcat
      const paths = PATHS.filter(p => fs.existsSync(path.join(root, p)));
      await git(['add', '-A', '--', ...paths], root);
      const staged = await git(['diff', '--cached', '--quiet', '--', ...paths], root);
      if (staged.ok) { save(sig); Object.assign(status, {state: 'ok', pendingSince: null}); return; } // nimic nou de urcat
      const labels = db.prepare("SELECT DISTINCT label FROM change_events WHERE label IS NOT NULL ORDER BY id DESC LIMIT 3").all().map(r => r.label);
      const msg = `Conținut actualizat din panou${labels.length ? `: ${labels.join(', ').slice(0, 120)}` : ''}`;
      const c = await git(['commit', '-q', '-m', msg, '--', ...paths], root);
      if (!c.ok) { fail(`commit eșuat — ${c.err || c.out}`); return; }
      let p = await git(['push', '-q'], root);
      if (!p.ok) { await git(['pull', '--rebase', '--autostash', '-q'], root); p = await git(['push', '-q'], root); }
      if (!p.ok) { fail(`push eșuat, reîncerc — ${p.err}`); return; }
      save(sig);
      Object.assign(status, {state: 'ok', lastPushAt: new Date().toISOString(), lastMsg: msg, lastError: null, pendingSince: null});
      log(`sincronizare git: urcat „${msg}”`);
    } catch (e) {
      fail(`eroare — ${e.message}`);
    } finally { busy = false; }
  }
  const fail = m => { log(`sincronizare git: ${m}`); Object.assign(status, {state: 'error', lastError: m}); };
  const save = sig => { synced = sig; fs.mkdirSync(path.dirname(stateFile), {recursive: true}); fs.writeFileSync(stateFile, sig); };
  const timer = setInterval(run, everyMs);
  timer.unref();
  log('sincronizare git: pornită (seed/ și media/ se urcă singure după modificări)');
  return {stop: () => clearInterval(timer), run};
}
