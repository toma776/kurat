// Reface src/site/static/base.css din stilurile originale (kurat.css): păstrează tokenii, fonturile (fără JetBrains Mono,
// nefolosit) și doar regulile ale căror clase apar în paginile randate, în scripturi sau în șabloane.
// Rulare: node scripts/css-base.mjs  (după schimbări mari de șabloane; kurat.css rămâne sursa, base.css e ce se încarcă)
import fs from 'node:fs';
import {openDb} from '../src/core/db.mjs';
import {renderPath} from '../src/site/pages.mjs';

const db = openDb('data/brain.db');
let text = '';
for (const p of ['/', '/servicii', '/servicii/locuinte', '/servicii/mentenanta', '/servicii/generala', '/portofoliu', '/despre-noi', '/contact', '/shop', '/nu-exista']) {
  text += renderPath(db, p).html + renderPath(db, p, {preview: true}).html;
}
for (const f of ['src/site/static/site.js', 'src/site/modern.mjs', 'src/site/theme.mjs', 'src/site/pages.mjs']) text += fs.readFileSync(f, 'utf8');

const used = new Set();
for (const m of text.matchAll(/class="([^"$]+)"/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));
for (const m of text.matchAll(/class=\\?"([^"\\$]+)/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));
for (const m of text.matchAll(/classList\.(?:add|toggle|remove)\('([\w-]+)'/g)) used.add(m[1]);
['is-scrolled', 'is-in', 'menu-open', 'ds-js', 'over'].forEach(c => used.add(c));

// reguli de nivel superior, cu blocuri imbricate (@media, @layer, @supports)
function parse(s) {
  const out = [];
  let i = 0;
  while (i < s.length) {
    const open = s.indexOf('{', i);
    if (open < 0) break;
    let head = s.slice(i, open), pre = '';
    const semi = head.lastIndexOf(';');
    if (semi >= 0) { pre = head.slice(0, semi + 1); head = head.slice(semi + 1); }
    let depth = 1, j = open + 1;
    while (j < s.length && depth) { if (s[j] === '{') depth++; else if (s[j] === '}') depth--; j++; }
    out.push({pre, sel: head.trim(), body: s.slice(open + 1, j - 1)});
    i = j;
  }
  return out;
}
const classesOf = sel => [...sel.matchAll(/\.((?:\\.|[\w-])+)/g)].map(m => m[1].replace(/\\(.)/g, '$1'));
let kept = 0, dropped = 0;
function filter(s) {
  return parse(s).map(({pre, sel, body}) => {
    if (sel.startsWith('@font-face')) return /JetBrains/.test(body) ? (dropped++, pre) : (kept++, `${pre}${sel}{${body}}`);
    if (/^@(media|layer|supports|container)/.test(sel)) { const inner = filter(body); return inner.trim() ? `${pre}${sel}{${inner}}` : pre; }
    if (sel.startsWith('@')) { kept++; return `${pre}${sel}{${body}}`; }
    const parts = sel.split(',').map(x => x.trim()).filter(x => classesOf(x).every(c => used.has(c)));
    if (!parts.length) { dropped++; return pre; }
    kept++;
    return `${pre}${parts.join(',')}{${body}}`;
  }).join('');
}
const css = fs.readFileSync('src/site/static/kurat.css', 'utf8');
const out = filter(css).replace(/--font-mono:\s*"JetBrains Mono",\s*/g, '--font-mono: ');
fs.writeFileSync('src/site/static/base.css', `/* Generat de scripts/css-base.mjs din kurat.css: tokeni, fonturi și regulile încă folosite. Nu edita de mână. */\n${out}`);
console.log(`base.css: ${kept} reguli păstrate, ${dropped} scoase · ${Math.round(css.length / 1024)} KB -> ${Math.round(out.length / 1024)} KB`);
