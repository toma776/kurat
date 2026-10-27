// Parser HTML tolerant, fără dependențe: suficient pentru paginile prerandate ale site-ului vechi.
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'source', 'track', 'wbr']);
const RAW = new Set(['script', 'style', 'textarea', 'title']);
const ENT = {amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' '};

export const decode = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : +e.slice(1)) : ENT[e.toLowerCase()] ?? m);

export function parse(html) {
  const root = {tag: '#root', attrs: {}, children: [], parent: null};
  let cur = root, i = 0;
  const tagRe = /<(\/?)([a-zA-Z][\w:-]*)((?:\s+[^\s"'>\/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s>]+))?)*)\s*(\/?)>/y;
  while (i < html.length) {
    const lt = html.indexOf('<', i);
    if (lt < 0) { addText(cur, html.slice(i)); break; }
    if (lt > i) addText(cur, html.slice(i, lt));
    if (html.startsWith('<!--', lt)) { const e = html.indexOf('-->', lt); i = e < 0 ? html.length : e + 3; continue; }
    if (html[lt + 1] === '!' || html[lt + 1] === '?') { i = html.indexOf('>', lt) + 1 || html.length; continue; }
    tagRe.lastIndex = lt;
    const m = tagRe.exec(html);
    if (!m) { addText(cur, '<'); i = lt + 1; continue; }
    i = tagRe.lastIndex;
    const tag = m[2].toLowerCase();
    if (m[1]) {
      for (let n = cur; n !== root; n = n.parent) if (n.tag === tag) { cur = n.parent; break; }
      continue;
    }
    const node = {tag, attrs: parseAttrs(m[3]), children: [], parent: cur};
    cur.children.push(node);
    if (RAW.has(tag)) {
      const end = html.toLowerCase().indexOf(`</${tag}`, i);
      const stop = end < 0 ? html.length : end;
      node.children.push({tag: '#text', text: html.slice(i, stop), parent: node});
      i = end < 0 ? stop : html.indexOf('>', end) + 1;
    } else if (!VOID.has(tag) && !m[4]) cur = node;
  }
  return root;
}

function addText(parent, raw) { parent.children.push({tag: '#text', text: decode(raw), parent}); }

function parseAttrs(s) {
  const a = {};
  for (const m of s.matchAll(/([^\s"'>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g))
    a[m[1].toLowerCase()] = decode(m[2] ?? m[3] ?? m[4] ?? '');
  return a;
}

export function* walk(node) {
  for (const c of node.children ?? []) { yield c; if (c.children) yield* walk(c); }
}

const matcher = sel => {
  if (typeof sel === 'function') return sel;
  // tag, .clasă, tag.clasă, [atribut], [atribut=valoare]
  const m = sel.match(/^([a-z0-9-]*)((?:\.[\w-]+)*)(?:\[([\w-]+)(?:=([^\]]*))?\])?$/i);
  if (!m) throw new Error(`Selector nesuportat: ${sel}`);
  const [, tag, cls, attr, val] = m, classes = cls ? cls.slice(1).split('.') : [];
  return n => n.tag !== '#text' && (!tag || n.tag === tag)
    && classes.every(c => (n.attrs.class ?? '').split(/\s+/).includes(c))
    && (!attr || (attr in n.attrs && (val === undefined || n.attrs[attr] === val)));
};

export const all = (node, sel) => [...walk(node)].filter(matcher(sel));
export const one = (node, sel) => { const f = matcher(sel); for (const n of walk(node)) if (f(n)) return n; return null; };
export const kids = (node, sel) => (node?.children ?? []).filter(sel ? matcher(sel) : n => n.tag !== '#text');

const BLOCK = new Set(['p', 'div', 'li', 'ul', 'ol', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'section', 'article', 'blockquote',
  'figure', 'figcaption', 'header', 'footer', 'nav', 'main', 'table', 'tr', 'td', 'th', 'dd', 'dt']);
export const text = node => {
  if (!node) return '';
  if (node.tag === '#text') return node.text;
  if (node.tag === 'br') return '\n';
  if (['script', 'style', 'svg', 'template'].includes(node.tag)) return '';
  const inner = node.children.map(text).join('');
  return BLOCK.has(node.tag) ? ` ${inner} ` : inner;
};
// Elementul ca HTML (pentru comparații, de exemplu iconițele SVG din site-ul vechi).
const escA = s => String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
export const outer = node => !node ? '' : node.tag === '#text' ? node.text.replace(/&/g, '&amp;').replace(/</g, '&lt;')
  : `<${node.tag}${Object.entries(node.attrs).map(([k, v]) => ` ${k}="${escA(v)}"`).join('')}>${node.children.map(outer).join('')}${VOID.has(node.tag) ? '' : `</${node.tag}>`}`;

export const clean = s => (s ?? '').replace(/\s+/g, ' ').trim();
export const txt = node => clean(text(node));

// Secțiunea de pagină care conține un titlu cu textul dat.
export function sectionByHeading(root, re) {
  const h = all(root, n => /^h[1-6]$/.test(n.tag) && re.test(txt(n)))[0];
  if (!h) return null;
  let n = h;
  while (n.parent && n.tag !== 'section') n = n.parent;
  return n.tag === 'section' ? n : h.parent;
}
