// Variante mai mici ale fotografiilor (480, 960, 1440 px lățime, WebP), ca telefonul să nu descarce imaginea de desktop.
// Fără dependențe: redimensionarea o face Chrome-ul instalat, pornit fără fereastră și comandat prin protocolul lui (CDP).
// Variantele stau în media/variants/<lățime>/<nume>.webp; serverul trimite originalul când o variantă lipsește.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';

export const WIDTHS = [480, 960, 1440];
const MIN_BYTES = 40 * 1024; // logo-urile și imaginile mici rămân cum sunt
const PHOTO = /\.(webp|jpe?g|png)$/i;

export const variantPath = (mediaDir, file, w) => path.join(mediaDir, 'variants', String(w), file.replace(/\.[^.]+$/, '.webp'));
export const variantUrl = (src, w) => src.replace(/^\/media\/uploads\//, `/media/variants/${w}/`).replace(/\.[^./?]+(\?.*)?$/, '.webp$1');

const CHROME = [process.env.CHROME_PATH, 'C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome'].filter(Boolean);
export const findChrome = () => CHROME.find(p => fs.existsSync(p)) ?? null;

// Fotografiile cărora le lipsește cel puțin o variantă sau au variante mai vechi decât originalul.
export function pendingImages(mediaDir) {
  const dir = path.join(mediaDir, 'uploads');
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(f => PHOTO.test(f)).filter(f => {
    const st = fs.statSync(path.join(dir, f));
    if (st.size < MIN_BYTES) return false;
    return WIDTHS.some(w => { const v = variantPath(mediaDir, f, w); return !fs.existsSync(v) || fs.statSync(v).mtimeMs < st.mtimeMs; });
  });
}

async function withChrome(fn) {
  const exe = findChrome();
  if (!exe) throw new Error('Chrome/Edge nu e instalat; variantele de imagini nu se pot genera aici');
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kurat-img-'));
  const proc = spawn(exe, ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      const t = setTimeout(() => reject(new Error('Chrome nu a pornit')), 20_000);
      proc.stderr.on('data', d => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) { clearTimeout(t); resolve(m[1]); } });
      proc.on('exit', () => reject(new Error('Chrome s-a oprit la pornire')));
    });
    const ws = new WebSocket(wsUrl);
    await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
    let id = 0;
    const waiting = new Map();
    ws.onmessage = e => { const msg = JSON.parse(e.data); if (msg.id && waiting.has(msg.id)) { const {resolve, reject} = waiting.get(msg.id); waiting.delete(msg.id); msg.error ? reject(new Error(msg.error.message)) : resolve(msg.result); } };
    const send = (method, params = {}, sessionId) => new Promise((resolve, reject) => { const i = ++id; waiting.set(i, {resolve, reject}); ws.send(JSON.stringify({id: i, method, params, sessionId})); });
    const {targetId} = await send('Target.createTarget', {url: 'about:blank'});
    const {sessionId} = await send('Target.attachToTarget', {targetId, flatten: true});
    const evaluate = async expression => {
      const r = await send('Runtime.evaluate', {expression, awaitPromise: true, returnByValue: true}, sessionId);
      if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description ?? 'eroare în pagină');
      return r.result.value;
    };
    const out = await fn(evaluate);
    ws.close();
    return out;
  } finally {
    proc.kill();
    setTimeout(() => fs.rmSync(profile, {recursive: true, force: true}), 1500).unref();
  }
}

// Generează variantele lipsă; întoarce lista fișierelor scrise. Nu mărește imaginile mai mici decât lățimea cerută.
export async function makeVariants(mediaDir, {log = () => {}} = {}) {
  const todo = pendingImages(mediaDir);
  if (!todo.length) return [];
  const written = [];
  await withChrome(async evaluate => {
    for (const file of todo) {
      const src = path.join(mediaDir, 'uploads', file);
      const mime = /\.png$/i.test(file) ? 'image/png' : /\.jpe?g$/i.test(file) ? 'image/jpeg' : 'image/webp';
      const data = `data:${mime};base64,${fs.readFileSync(src).toString('base64')}`;
      const res = await evaluate(`(async () => {
        const im = new Image(); im.src = ${JSON.stringify(data)}; await im.decode();
        const out = {};
        for (const w of ${JSON.stringify(WIDTHS)}) {
          const tw = Math.min(w, im.naturalWidth), th = Math.round(im.naturalHeight * tw / im.naturalWidth);
          const c = document.createElement('canvas'); c.width = tw; c.height = th;
          const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, tw, th);
          out[w] = c.toDataURL('image/webp', 0.8);
        }
        return {w: im.naturalWidth, out};
      })()`);
      for (const w of WIDTHS) {
        const v = variantPath(mediaDir, file, w);
        fs.mkdirSync(path.dirname(v), {recursive: true});
        fs.writeFileSync(v, Buffer.from(res.out[w].split(',')[1], 'base64'));
        written.push(path.relative(mediaDir, v));
      }
      log(`variante pentru ${file} (original ${res.w}px)`);
    }
  });
  return written;
}
