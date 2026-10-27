// Bucăți mici de interfață, comune tuturor secțiunilor site-ului public.
import {esc} from './context.mjs';

export {esc};
export const STIL = {'btn-brand': 'btn', 'btn-outline': 'btn btn-outline', 'btn-green': 'btn btn-green', 'btn-soft': 'btn btn-soft', link: 'lnk'};
export const button = (ctx, l, cls) => l ? `<a class="${cls ?? STIL[l.stil] ?? 'btn'}" href="${esc(l.href)}">${ctx.text(l.label)}</a>` : '';
export const buttons = (ctx, items) => {
  const out = (items ?? []).map(i => button(ctx, ctx.link(i))).filter(Boolean);
  return out.length ? `<div class="actions">${out.join('')}</div>` : '';
};
export const img = (f, cls = '', eager = false) => f ? `<img class="${cls}" src="${esc(f.src)}" alt="${esc(f.alt)}" ${eager ? 'fetchpriority="high"' : 'loading="lazy"'} decoding="async">` : '';
export const stars = n => n ? `<span class="stars" aria-label="${n} din 5 stele">${'★'.repeat(Math.round(n))}</span>` : '';
export const fmt = n => n == null ? '' : Number(n).toLocaleString('ro-RO');
export const lei = n => `${fmt(n)} lei`;
export const jsonLd = obj => `<script type="application/ld+json">${JSON.stringify(obj).replace(/</g, '\\u003c')}</script>`;
