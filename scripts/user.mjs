// Utilizatorii /manage din linia de comandă.
//   node scripts/user.mjs add --email=ana@kurat.ro --name="Ana" --role=admin|editor|viewer [--password=...]
//   node scripts/user.mjs list
//   node scripts/user.mjs password --email=ana@kurat.ro [--password=...]
//   node scripts/user.mjs disable --email=ana@kurat.ro
// Fără --password se generează una și se afișează o singură dată.
import {openDb} from '../src/core/db.mjs';
import {createUser, hashPassword, randomPassword, ROLES} from '../src/auth/auth.mjs';

const arg = k => process.argv.find(a => a.startsWith(`--${k}=`))?.split('=').slice(1).join('=');
const db = openDb(process.env.BRAIN_DB ?? 'data/brain.db');
const cmd = process.argv[2];

if (cmd === 'add') {
  const password = arg('password') ?? randomPassword();
  const id = createUser(db, {email: arg('email'), name: arg('name') ?? arg('email'), role: arg('role') ?? 'editor', password});
  console.log(`Utilizator #${id} creat (${ROLES[arg('role') ?? 'editor'].label}).${arg('password') ? '' : `\nParola: ${password}\n(se afișează o singură dată)`}`);
} else if (cmd === 'password') {
  const password = arg('password') ?? randomPassword();
  const r = db.prepare('UPDATE users SET password_hash = ? WHERE email = ?').run(hashPassword(password), arg('email'));
  if (!r.changes) { console.error('Utilizator inexistent.'); process.exitCode = 1; }
  else { db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)').run(arg('email')); console.log(arg('password') ? 'Parolă schimbată.' : `Parola nouă: ${password}`); }
} else if (cmd === 'disable') {
  db.prepare('UPDATE users SET active = 0 WHERE email = ?').run(arg('email'));
  db.prepare('DELETE FROM sessions WHERE user_id = (SELECT id FROM users WHERE email = ?)').run(arg('email'));
  console.log('Dezactivat.');
} else if (cmd === 'list') {
  console.table(db.prepare('SELECT id, email, name, role, active, created_at FROM users').all());
} else {
  console.log('Comenzi: add, list, password, disable');
}
db.close();
