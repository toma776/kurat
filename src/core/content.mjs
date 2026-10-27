import {parse, kids, txt, clean} from '../lib/html.mjs';
import {fold} from './util.mjs';

// ———————————————————————————————————————————— text bogat: vocabular fix (§1.8)

const ALLOWED = {
  h2: [], h3: [], h4: [], p: [], ul: [], ol: [], li: [], blockquote: [], figure: [], figcaption: [],
  table: [], thead: [], tbody: [], tr: [], th: [], td: [], strong: [], em: [], br: [],
  a: ['href', 'data-ref', 'data-media', 'class'], img: ['data-media', 'alt'], video: ['data-media']
};
const DROP = new Set(['script', 'style', 'iframe', 'object', 'embed', 'form', 'input', 'button', 'select', 'textarea', 'svg', 'noscript', 'template', 'head']);
const RENAME = {b: 'strong', i: 'em', h1: 'h2', h5: 'h4', h6: 'h4'};
const VOIDS = new Set(['br', 'img']);
const BLOCKS = new Set(['h2', 'h3', 'h4', 'p', 'li', 'blockquote', 'figcaption', 'th', 'td']);

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escAttr = s => esc(s).replace(/"/g, '&quot;');

// Scoate tot ce nu e conținut: clase, stiluri, scripturi, cadre, machete lipite din alt site.
export function sanitizeContent(html) {
  const out = [];
  const emit = n => {
    if (n.tag === '#text') return out.push(esc(n.text));
    if (DROP.has(n.tag)) return;
    const tag = RENAME[n.tag] ?? n.tag;
    if (!(tag in ALLOWED)) return n.children.forEach(emit); // despachetează div, span, section…
    const attrs = ALLOWED[tag].filter(a => n.attrs[a] != null && n.attrs[a] !== '')
      .filter(a => a !== 'class' || n.attrs.class === 'buton')
      .filter(a => a !== 'href' || !/^\s*javascript:/i.test(n.attrs.href))
      .map(a => ` ${a}="${escAttr(n.attrs[a])}"`).join('');
    if (tag === 'img' && !n.attrs['data-media']) return; // o imagine fără fișier în bibliotecă nu e conținut
    out.push(`<${tag}${attrs}>`);
    if (VOIDS.has(tag)) return;
    n.children.forEach(emit);
    out.push(`</${tag}>`);
  };
  parse(html).children.forEach(emit);
  return out.join('').replace(/<p>\s*<\/p>/g, '').trim();
}

export const paragraphs = lines => lines.map(l => clean(l)).filter(Boolean).map(l => `<p>${esc(l)}</p>`).join('');

// Blocurile unui text: ce compară verificarea dus-întors (§1.3).
export function blocks(html) {
  const out = [];
  const visit = n => {
    if (n.tag === '#text') return;
    if (BLOCKS.has(n.tag)) { const t = txt(n); if (t) out.push({tag: n.tag, text: t}); return; }
    kids(n).forEach(visit);
  };
  const root = parse(html);
  const loose = clean(root.children.filter(c => c.tag === '#text').map(c => c.text).join(' '));
  if (loose) out.push({tag: 'p', text: loose});
  kids(root).forEach(visit);
  return out;
}

// ———————————————————————————————————————————— valori legate (jetoane), §1.6 a

const PHONE_RE = /(?<![\d+])(?:\+?40|0040|0)[\s.\-/]?(?:\(0\))?[\s.\-]?[237]\d{1,2}(?:[\s.\-]?\d){6,7}(?!\d)/g;
const EMAIL_RE = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g;

export const phoneKey = s => { const d = String(s).replace(/\D/g, ''); return d.replace(/^(0040|40)/, '0').replace(/^(?!0)/, '0'); };
export const phoneDisplay = s => { const d = phoneKey(s); return d.length === 10 ? `${d.slice(0, 4)} ${d.slice(4, 7)} ${d.slice(7)}` : d; };
export const phoneIntl = s => `+40${phoneKey(s).slice(1)}`;

// Valorile legate se iau din registru: câmpurile cu `token` ale tipului `firma`.
export function valueTokens(firma, fields) {
  const out = [];
  for (const f of fields) {
    if (!f.token || firma?.[f.key] == null || firma[f.key] === '') continue;
    out.push({token: f.token, field: f.key, kind: f.type, value: firma[f.key]});
  }
  return out;
}

export function displayValue(t) {
  if (t.kind === 'phone') return phoneDisplay(t.value);
  if (t.token === 'ani') return String(new Date().getFullYear() - Number(t.value));
  return String(t.value);
}

// Înlocuiește valorile scrise de mână cu jetoane, doar în text (nu în atribute).
// O valoare de același fel care contrazice sursa nu se înlocuiește: devine observație.
export function tokenizeValues(html, tokens) {
  const phones = tokens.filter(t => t.kind === 'phone'), emails = tokens.filter(t => t.kind === 'email');
  const replaced = [], conflicts = [];
  const inText = s => s
    .replace(PHONE_RE, m => {
      const hit = phones.find(t => phoneKey(t.value) === phoneKey(m));
      if (hit) { replaced.push({token: hit.token, value: m}); return `{${hit.token}}`; }
      if (phones.length) conflicts.push({kind: 'phone', value: m, expected: phoneDisplay(phones[0].value)});
      return m;
    })
    .replace(EMAIL_RE, m => {
      const hit = emails.find(t => t.value.toLowerCase() === m.toLowerCase());
      if (hit) { replaced.push({token: hit.token, value: m}); return `{${hit.token}}`; }
      if (emails.length && /@kurat\.ro$/i.test(m)) conflicts.push({kind: 'email', value: m, expected: emails[0].value});
      return m;
    });
  const text = String(html).split(/(<[^>]*>)/).map((part, i) => i % 2 ? part : inText(part)).join('');
  return {text, replaced, conflicts};
}

export function expandTokens(text, tokens) {
  return String(text ?? '').replace(/\{([a-z][\w-]*)\}/g, (m, k) => {
    const t = tokens.find(x => x.token === k);
    return t ? esc(displayValue(t)) : m;
  });
}

// Forma canonică pentru comparații: telefoanele în orice formă devin aceeași cifră.
export const canonValues = s => String(s).replace(PHONE_RE, m => phoneKey(m)).replace(EMAIL_RE, m => m.toLowerCase());

// ———————————————————————————————————————————— mențiuni, §1.6 b

// Doar numele lungi: cel puțin 8 caractere sau cel puțin 2 cuvinte.
export const mentionable = name => { const n = clean(name); return n.length >= 8 || n.split(' ').length >= 2; };

const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// candidates: [{key, id, names: [...]}]. Potrivirea respectă granițele cuvintelor și ignoră diacriticele.
export function findMentions(text, candidates) {
  const plain = clean(String(text ?? '').replace(/<[^>]*>/g, ' '));
  const folded = fold(plain);
  const hits = [];
  for (const c of candidates) {
    const names = new Set();
    for (const n of c.names.filter(Boolean)) {
      if (!mentionable(n)) continue;
      names.add(fold(clean(n)));
      const w = clean(n).split(' ');
      if (w.length === 2) names.add(fold(`${w[1]} ${w[0]}`)); // „Popescu Ion”
    }
    for (const n of names) {
      const m = new RegExp(`(?<![\\p{L}\\p{N}])${reEsc(n)}(?![\\p{L}\\p{N}])`, 'u').exec(folded);
      if (!m) continue;
      const a = Math.max(0, m.index - 40), b = Math.min(plain.length, m.index + n.length + 40);
      hits.push({key: c.key, id: c.id, name: n, excerpt: `${a ? '…' : ''}${plain.slice(a, b)}${b < plain.length ? '…' : ''}`});
      break;
    }
  }
  return hits;
}
