import crypto from 'node:crypto';

export const nowIso = () => new Date().toISOString();

// Fără diacritice, litere mici, spații normalizate: baza comparațiilor de nume și a cheilor naturale.
export const fold = s => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '')
  .replace(/[ţ]/g, 't').replace(/[ş]/g, 's').toLowerCase();
export const norm = s => fold(s).replace(/[^a-z0-9]+/g, ' ').trim();

export const slugify = s => norm(s).replace(/ /g, '-').slice(0, 80) || 'fara-nume';

export const sha1 = buf => crypto.createHash('sha1').update(buf).digest('hex');

// JSON cu chei sortate: amprente stabile pentru validări și comparații.
export const stableJson = v => JSON.stringify(v, (k, x) =>
  x && typeof x === 'object' && !Array.isArray(x) ? Object.fromEntries(Object.entries(x).sort(([a], [b]) => a < b ? -1 : 1)) : x);

export const same = (a, b) => stableJson(a ?? null) === stableJson(b ?? null);
