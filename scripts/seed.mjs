// Reface manual copia publică a Brain-ului. De obicei nu e nevoie: serverul local o reface și o urcă singur (src/core/gitsync.mjs).
// Rulare: node scripts/seed.mjs [--from=data/brain.db] [--to=seed/brain.db]
import path from 'node:path';
import {makeSeed} from '../src/core/seed.mjs';

const arg = (k, d) => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=') ?? d;
const r = makeSeed(arg('from', 'data/brain.db'), arg('to', 'seed/brain.db'));
console.log(`Copia publică: ${path.relative(process.cwd(), r.file)} (${Math.round(r.size / 1024)} KB)`);
console.log('Scoase:', Object.entries(r.removed).map(([t, n]) => `${t} ${n}`).join(', ') || 'nimic');
