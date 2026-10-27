// „De făcut” (§1.8): observații calculate, cu impact și link direct la câmp. Nimic nu e scris de mână aici.
import {createStore} from './store.mjs';
import {ENTITIES, entity, titleOf} from '../registry/entities.mjs';
import {tokenizeValues, phoneDisplay} from './content.mjs';
import {allDuplicates} from './duplicates.mjs';
import {inferredCount} from './inferred.mjs';
import {health} from './graph.mjs';

const href = (key, id, tab = 'detalii', field = null) => `/manage/entitati/${key}/${id}/${tab}/${field ? `?camp=${encodeURIComponent(field)}` : ''}`;

export function todo(db) {
  const store = createStore(db), out = [];
  const push = (impact, title, extra = {}) => out.push({impact, title, ...extra});

  // propagări eșuate
  for (const ev of db.prepare("SELECT * FROM change_events WHERE status = 'failed' ORDER BY id DESC").all())
    push('mare', `Propagare eșuată: ${ev.label ?? ev.action} (${ev.attempts} încercări)`, {detail: ev.last_error, href: '/manage/#propagare', event: ev.id});

  // legături de verificat — numărate la fel ca pe hartă
  const n = inferredCount(db);
  if (n) push('mare', `${n} legături deduse de verificat`, {href: '/manage/surse/legaturi/'});

  // ciorne care așteaptă aprobare
  for (const e of ENTITIES.filter(x => x.approval && !x.noStatus))
    for (const r of store.list(e.key).filter(r => r.draft || r.status === 'draft'))
      push('mediu', `${e.one} „${titleOf(e.key, r)}” așteaptă aprobare`, {href: href(e.key, r.id, 'prezentare')});

  // câmpuri obligatorii goale; trimiteri rupte (din sănătatea hărții)
  const h = health(db);
  for (const r of h.requiredEmpty) push('mare', `${entity(r.key).one} „${r.title}”: ${r.field} e gol`, {href: href(r.key, r.id, 'relatii')});
  for (const b of h.broken) push('mare', `Trimitere ruptă din „${b.srcTitle}” spre ${b.dst}`, {href: href(...b.src.split(':'), 'relatii')});
  for (const e of ENTITIES.filter(x => !x.operational)) for (const r of store.list(e.key)) {
    if (r.status === 'archived') continue;
    for (const f of e.fields.filter(f => f.required && !['refs', 'ref'].includes(f.type)))
      if (r[f.key] == null || r[f.key] === '') push('mare', `${e.one} „${titleOf(e.key, r)}”: ${f.label} e obligatoriu`, {href: href(e.key, r.id, 'detalii', f.key)});
    // legături spre înregistrări arhivate
    for (const f of e.fields.filter(f => f.type === 'refs')) for (const l of store.links(e.key, r.id, f.key)) {
      const t = store.get(f.target, l.dst_id);
      if (t?.status === 'archived') push('mediu', `„${titleOf(e.key, r)}” trimite la „${titleOf(f.target, t)}”, care e arhivat`, {href: href(e.key, r.id, 'relatii')});
    }
  }

  // valori scrise de mână care contrazic sursa (telefon, email)
  const toks = store.tokens();
  for (const e of ENTITIES.filter(x => x.tokenize !== false)) for (const r of store.list(e.key))
    for (const f of e.fields.filter(f => ['text', 'textarea', 'richtext'].includes(f.type) && typeof r[f.key] === 'string')) {
      const c = tokenizeValues(r[f.key], toks);
      for (const x of c.conflicts) push('mare', `${e.one} „${titleOf(e.key, r)}”: ${x.kind === 'phone' ? phoneDisplay(x.value) : x.value} contrazice Date firmă (${x.expected})`, {href: href(e.key, r.id, 'detalii', f.key)});
      if (c.replaced.length) push('mic', `${e.one} „${titleOf(e.key, r)}”: valoare scrisă de mână în loc de jeton`, {href: href(e.key, r.id, 'detalii', f.key)});
    }

  // texte propuse, marcate [[de-validat:notă]]: o sarcină de impact mare fiecare (§1.8)
  for (const e of ENTITIES.filter(x => !x.operational)) for (const r of store.list(e.key)) {
    for (const f of e.fields.filter(f => ['text', 'textarea', 'richtext', 'list', 'links'].includes(f.type))) {
      const v = typeof r[f.key] === 'string' ? r[f.key] : JSON.stringify(r[f.key] ?? '');
      for (const m of v.matchAll(/\[\[de-validat(?::([^\]]*))?\]\]/g))
        push('mare', `De validat — ${e.one} „${titleOf(e.key, r).replace(/\[\[[^\]]*\]\]/g, '').trim().slice(0, 60)}”: ${m[1] ?? f.label}`, {href: href(e.key, r.id, 'detalii', f.key)});
    }
  }

  // surse nesigure (date contradictorii din site-ul vechi)
  for (const p of db.prepare("SELECT entity, entity_id, field, MAX(excerpt) excerpt, COUNT(*) n FROM provenance WHERE certainty IN ('unverified','unrecoverable') AND field <> '' AND field NOT LIKE '%:%' GROUP BY entity, entity_id, field").all()) {
    const r = store.get(p.entity, p.entity_id);
    if (!r) continue;
    const f = entity(p.entity).fields.find(x => x.key === p.field);
    push('mediu', `${entity(p.entity).one} „${titleOf(p.entity, r)}”: ${f?.label ?? p.field} — sursă neverificată`, {detail: p.excerpt, href: href(p.entity, p.entity_id, 'surse')});
  }

  // posibile dubluri (regula din registru, `duplicates`)
  for (const d of allDuplicates(db))
    push('mediu', `Posibilă dublură: ${entity(d.key).one} „${d.b.title}” seamănă cu „${d.a.title}” (${Math.round(d.score * 100)}%)`, {href: href(d.key, d.a.id, 'prezentare')});

  // pagini fără descriere proprie
  const descs = new Map();
  for (const p of store.list('pagini')) (descs.get(p.meta_description) ?? descs.set(p.meta_description, []).get(p.meta_description)).push(p);
  for (const [d, ps] of descs) if (!d || ps.length > 1) for (const p of ps) push('mic', `Pagina „${p.nume_scurt ?? p.titlu}” ${d ? 'are aceeași descriere SEO ca alte pagini' : 'nu are descriere SEO'}`, {href: href('pagini', p.id, 'detalii', 'meta_description')});

  // pagini publice cu erori de randare
  for (const p of db.prepare('SELECT path, error FROM page_index WHERE error IS NOT NULL').all()) push('mare', `Pagina ${p.path} nu se poate randa`, {detail: p.error, href: p.path});

  const rank = {mare: 0, mediu: 1, mic: 2};
  return out.sort((a, b) => rank[a.impact] - rank[b.impact]);
}
