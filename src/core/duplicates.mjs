// Dublurile (§1.7). Regula se declară în registru (`duplicates: {by: [...]}`), pe orice tip.
// Două înregistrări sunt candidate dacă au (aproape) aceleași cuvinte — fără diacritice, fără cuvinte de umplutură,
// comparate pe rădăcină — ȘI aceleași cifre: „Ecografie tiroidiană — 250 lei” ≈ „Ecografie tiroidă — 250 lei”, dar „30 de minute” ≠ „60 de minute”.
// Brain-ul doar propune; unirea o face un om (store.merge).
import {createStore} from './store.mjs';
import {ENTITIES, entity, titleOf} from '../registry/entities.mjs';
import {norm} from './util.mjs';

const FILLER = new Set(['de', 'la', 'si', 'cu', 'pentru', 'in', 'pe', 'a', 'al', 'ale', 'ai', 'din', 'sau', 'un', 'o', 'the', 'and', 'lei', 'ron', 'tva']);

export function signature(values) {
  const text = values.filter(v => v != null).map(String).join(' ');
  const words = norm(text).split(' ').filter(w => w && !FILLER.has(w) && !/^\d+$/.test(w));
  const numbers = (text.match(/\d+(?:[.,]\d+)?/g) ?? []).map(n => n.replace(',', '.'));
  return {words: [...new Set(words)].sort(), numbers: [...new Set(numbers)].sort(), exact: norm(text)};
}

// Rădăcina unui cuvânt: primele 5 litere („tiroidiană” ≈ „tiroidă”, „pardoselilor” ≈ „pardoseli”).
const stem = w => w.slice(0, 5);

// Jaccard pe rădăcini. Un cuvânt de conținut în plus („Aerisirea și odorizarea încăperilor”) schimbă sensul, deci scade scorul.
export function similarity(a, b) {
  if (!a.words.length || !b.words.length) return 0;
  if (a.numbers.join('|') !== b.numbers.join('|')) return 0; // alte cifre: nu e aceeași informație
  if (a.exact === b.exact) return 1;
  const A = new Set(a.words.map(stem)), B = new Set(b.words.map(stem));
  const inter = [...A].filter(w => B.has(w)).length;
  return inter / new Set([...A, ...B]).size;
}

const THRESHOLD = 0.75;

// Candidații pentru o înregistrare (sau, fără `id`, toate perechile tipului).
export function findDuplicates(db, key, id = null, {threshold = THRESHOLD} = {}) {
  const e = entity(key);
  if (!e.duplicates) return [];
  const store = createStore(db);
  const valuesOf = r => e.duplicates.by.map(f => {
    const fd = e.fields.find(x => x.key === f);
    if (fd?.type === 'ref' && r[f] != null) { const t = store.get(fd.target, r[f]); return t ? `#${fd.target}:${r[f]}` : null; }
    return r[f];
  });
  // câmpurile `ref` din regulă trebuie să fie identice (același serviciu), restul se compară prin similaritate
  const refKey = r => e.duplicates.by.filter(f => e.fields.find(x => x.key === f)?.type === 'ref').map(f => r[f]).join('|');
  const rows = store.list(key).filter(r => r.status !== 'archived');
  const sig = new Map(rows.map(r => [r.id, signature(valuesOf(r).filter(v => !String(v ?? '').startsWith('#')))]));
  const out = [];
  const pairs = id != null ? rows.filter(r => r.id === id).flatMap(a => rows.filter(b => b.id !== a.id).map(b => [a, b]))
    : rows.flatMap((a, i) => rows.slice(i + 1).map(b => [a, b]));
  for (const [a, b] of pairs) {
    if (refKey(a) !== refKey(b)) continue;
    const s = similarity(sig.get(a.id), sig.get(b.id));
    if (s >= threshold) out.push({key, a: {id: a.id, title: titleOf(key, a)}, b: {id: b.id, title: titleOf(key, b)}, score: Math.round(s * 100) / 100});
  }
  return out.sort((x, y) => y.score - x.score);
}

export const allDuplicates = db => ENTITIES.filter(e => e.duplicates).flatMap(e => findDuplicates(db, e.key));
