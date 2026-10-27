import {test, before, after} from 'node:test';
import assert from 'node:assert/strict';
import {imported} from './helpers.mjs';
import {createServer} from '../src/server.mjs';
import {scan} from '../src/core/sync.mjs';

let server, base, db;
before(async () => {
  ({db} = imported());
  scan(db);
  server = createServer(db, {log: () => {}});
  await new Promise(r => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
after(() => server.close());

test('paginile publice răspund 200, cu antete de securitate', async () => {
  for (const p of ['/', '/servicii', '/servicii/generala', '/portofoliu', '/despre-noi', '/contact', '/shop']) {
    const r = await fetch(base + p);
    assert.equal(r.status, 200, p);
    assert.match(r.headers.get('content-type'), /text\/html/);
    assert.ok(r.headers.get('content-security-policy'));
  }
});

test('adresele cu bară la final primesc 301 spre forma fără bară, ca în site-ul vechi', async () => {
  const r = await fetch(`${base}/servicii/generala/`, {redirect: 'manual'});
  assert.equal(r.status, 301);
  assert.equal(r.headers.get('location'), '/servicii/generala');
});

test('o adresă necunoscută dă 404 cu pagina site-ului; /wp-admin dă 404', async () => {
  const r = await fetch(`${base}/nu-exista`);
  assert.equal(r.status, 404);
  assert.match(await r.text(), /Pagina nu există/);
  assert.equal((await fetch(`${base}/wp-admin/`, {redirect: 'manual'})).status, 404);
});

test('până la lansare, motoarele de căutare nu indexează nimic: noindex pe pagini, imagini și /manage, fără hartă a site-ului', async () => {
  for (const p of ['/', '/servicii/generala', '/nu-exista', '/static/site.css', '/favicon.ico', '/robots.txt', '/manage/login']) {
    const r = await fetch(base + p, {redirect: 'manual'});
    assert.match(r.headers.get('x-robots-tag') ?? '', /noindex/, p);
  }
  assert.match(await (await fetch(base + '/')).text(), /<meta name="robots" content="noindex, nofollow, noarchive">/);
  const robots = await (await fetch(`${base}/robots.txt`)).text();
  assert.match(robots, /Allow: \//, 'roboții pot citi paginile, ca să vadă noindex');
  assert.doesNotMatch(robots, /Sitemap:/);
  assert.equal((await fetch(`${base}/sitemap.xml`)).status, 404);
});

test('la lansare (BRAIN_INDEXING=1), sitemap.xml și robots.txt se generează din Brain, fără noindex', async () => {
  process.env.BRAIN_INDEXING = '1';
  try {
    const sm = await (await fetch(`${base}/sitemap.xml`)).text();
    assert.equal((sm.match(/<loc>/g) ?? []).length, 12);
    assert.match(sm, /<loc>https:\/\/kurat\.ro\/servicii\/generala<\/loc>/);
    const robots = await fetch(`${base}/robots.txt`);
    assert.equal(robots.headers.get('x-robots-tag'), null);
    const text = await robots.text();
    assert.match(text, /Sitemap: https:\/\/kurat\.ro\/sitemap\.xml/);
    assert.match(text, /Disallow: \/manage\//);
  } finally { delete process.env.BRAIN_INDEXING; }
});

test('fișierele media și statice se servesc; încercările de a ieși din director sunt refuzate', async () => {
  const m = db.prepare('SELECT path FROM media LIMIT 1').get().path;
  assert.equal((await fetch(base + m)).status, 200);
  assert.equal((await fetch(`${base}/static/site.css`)).status, 200);
  assert.equal((await fetch(`${base}/static/..%2f..%2fpackage.json`)).status, 404);
});

test('cererea de ofertă se salvează; din alt site e refuzată; fără acord e respinsă', async () => {
  const post = (body, headers = {}) => fetch(`${base}/api/cerere`, {method: 'POST', headers: {'content-type': 'application/json', ...headers}, body: JSON.stringify(body)});
  assert.equal((await post({nume: 'Ion', contact: '0700 000 000', mesaj: 'Birou 80 mp', acord: '1'})).status, 201);
  assert.equal((await post({nume: 'Ion', contact: '0700 000 000', acord: '1'}, {origin: 'https://evil.example'})).status, 403);
  assert.equal((await post({nume: 'Ion', contact: '0700 000 000'})).status, 422);
  assert.equal((await post({sursa: 'calculator', nume: 'Ana', contact: 'ana@ex.ro', detalii: {estimare: 900}})).status, 201);
  const leads = db.prepare('SELECT nume, sursa, stare FROM leads ORDER BY id').all();
  assert.deepEqual(leads.map(l => [l.nume, l.sursa, l.stare]), [['Ion', 'formular', 'noua'], ['Ana', 'calculator', 'noua']]);
});

test('tick-ul de cron cere cheia', async () => {
  assert.equal((await fetch(`${base}/api/manage/cron/tick`, {method: 'POST'})).status, 401);
});
