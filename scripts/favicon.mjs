// Iconița din tab-ul browserului, din semnul Kurat (K alb pe albastrul brandului, colțuri rotunjite ca în antet):
// favicon.svg (browserele noi), favicon.ico cu 16/32/48 px (cele vechi, Windows) și apple-touch-icon.png (180 px, iPhone).
// Rulare: node scripts/favicon.mjs — PNG-urile le desenează Chrome-ul instalat, fără dependențe.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawn} from 'node:child_process';
import {findChrome} from '../src/core/images.mjs';
import {icon} from '../src/site/icons.mjs';

const OUT = new URL('../src/site/static/', import.meta.url);
const BRAND = '#0f69f5';
// semnul din icons.mjs (viewBox 247×250), centrat în pătrat la ~58% din latură
const inner = icon('logo-mark', 10).replace(/^<svg[^>]*>|<\/svg>$/g, '').replace(/fill="currentColor"/g, 'fill="#fff"');
const svg = ({rounded = true} = {}) => {
  const k = 0.58 * 512 / 250, w = 247 * k, h = 250 * k;
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512"><rect width="512" height="512" rx="${rounded ? 148 : 0}" fill="${BRAND}"/>` +
    `<g transform="translate(${((512 - w) / 2 + 6).toFixed(1)} ${((512 - h) / 2).toFixed(1)}) scale(${k.toFixed(4)})">${inner}</g></svg>`;
};
fs.writeFileSync(new URL('favicon.svg', OUT), svg());

// PNG-urile: SVG-ul desenat pe un canvas în Chrome
async function render(list) {
  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'kurat-ico-'));
  const proc = spawn(findChrome(), ['--headless=new', '--disable-gpu', '--no-first-run', '--remote-debugging-port=0', `--user-data-dir=${profile}`, 'about:blank'], {stdio: ['ignore', 'ignore', 'pipe']});
  try {
    const wsUrl = await new Promise((resolve, reject) => {
      let buf = '';
      proc.stderr.on('data', d => { buf += d; const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf); if (m) resolve(m[1]); });
      setTimeout(() => reject(new Error('Chrome nu a pornit')), 20000);
    });
    const ws = new WebSocket(wsUrl);
    await new Promise(r => { ws.onopen = r; });
    let id = 0; const waiting = new Map();
    ws.onmessage = e => { const m = JSON.parse(e.data); if (m.id && waiting.has(m.id)) { waiting.get(m.id)(m); waiting.delete(m.id); } };
    const send = (method, params = {}, sessionId) => new Promise(r => { const i = ++id; waiting.set(i, r); ws.send(JSON.stringify({id: i, method, params, sessionId})); });
    const {result: {targetId}} = await send('Target.createTarget', {url: 'about:blank'});
    const {result: {sessionId}} = await send('Target.attachToTarget', {targetId, flatten: true});
    const out = [];
    for (const {size, rounded} of list) {
      const data = 'data:image/svg+xml;base64,' + Buffer.from(svg({rounded})).toString('base64');
      const r = await send('Runtime.evaluate', {awaitPromise: true, returnByValue: true, expression: `(async () => {
        const im = new Image(); im.src = ${JSON.stringify(data)}; await im.decode();
        const c = document.createElement('canvas'); c.width = c.height = ${size};
        const g = c.getContext('2d'); g.imageSmoothingQuality = 'high'; g.drawImage(im, 0, 0, ${size}, ${size});
        return c.toDataURL('image/png');
      })()`}, sessionId);
      out.push(Buffer.from(r.result.result.value.split(',')[1], 'base64'));
    }
    ws.close();
    return out;
  } finally { proc.kill(); setTimeout(() => fs.rmSync(profile, {recursive: true, force: true}), 1500).unref(); }
}

const sizes = [16, 32, 48];
const [p16, p32, p48, apple] = await render([...sizes.map(size => ({size, rounded: true})), {size: 180, rounded: false}]);
fs.writeFileSync(new URL('apple-touch-icon.png', OUT), apple);

// ICO cu PNG-uri înăuntru (acceptat de toate browserele și de Windows din Vista încoace)
const pngs = [p16, p32, p48];
const head = Buffer.alloc(6); head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(pngs.length, 4);
let offset = 6 + 16 * pngs.length;
const dir = pngs.map((png, i) => {
  const e = Buffer.alloc(16), s = sizes[i];
  e.writeUInt8(s, 0); e.writeUInt8(s, 1); e.writeUInt8(0, 2); e.writeUInt8(0, 3);
  e.writeUInt16LE(1, 4); e.writeUInt16LE(32, 6); e.writeUInt32LE(png.length, 8); e.writeUInt32LE(offset, 12);
  offset += png.length;
  return e;
});
fs.writeFileSync(new URL('favicon.ico', OUT), Buffer.concat([head, ...dir, ...pngs]));
console.log('favicon.svg, favicon.ico (16/32/48), apple-touch-icon.png');
