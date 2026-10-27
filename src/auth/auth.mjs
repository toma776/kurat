// Autentificare și drepturi (§1.9). Autorizarea se face pe server, la fiecare cerere.
import crypto from 'node:crypto';
import {nowIso} from '../core/util.mjs';
import {entity, RELATION_TYPES} from '../registry/entities.mjs';

export const PERMISSIONS = ['content.read', 'content.write', 'content.publish', 'content.approve', 'content.delete',
  'media.read', 'media.write', 'settings.write', 'users.write', 'backups.create', 'backups.download', 'backups.restore'];

export const ROLES = {
  admin: {label: 'Administrator', perms: PERMISSIONS},
  editor: {label: 'Editor', perms: ['content.read', 'content.write', 'content.publish', 'media.read', 'media.write']},
  viewer: {label: 'Vizualizare', perms: ['content.read', 'media.read']}
};

export const can = (user, perm) => !!user && user.active !== 0 && (ROLES[user.role]?.perms ?? []).includes(perm);

export class Forbidden extends Error {
  constructor(perm, why) { super(why ?? `Nu ai dreptul ${perm}.`); this.status = 403; this.perm = perm; }
}
export const need = (user, perm, why) => { if (!can(user, perm)) throw new Forbidden(perm, why); };

// Aprobarea acoperă toate căile spre site (§1.9 NOU): publicare, stare de legătură, confirmare în masă, surse, arhivare.
export const needsApproval = key => !!entity(key).approval;
export const relationSensitive = relationId => !!RELATION_TYPES.find(r => r.id === relationId)?.sensitive;
export function needApprovalFor(user, {key, relationId} = {}) {
  if ((key && needsApproval(key)) || (relationId && (relationSensitive(relationId) || needsApproval(relationId.split('.')[0]))))
    need(user, 'content.approve', `Schimbarea cere aprobare (${relationId ?? entity(key).label}). Trimite-o unui administrator.`);
}

// ———————————————————————————————————————————— parole (scrypt)

const SCRYPT = {N: 16384, r: 8, p: 1, keylen: 64};
export function hashPassword(pw) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(String(pw), salt, SCRYPT.keylen, {N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p});
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${hash.toString('base64')}`;
}
export function verifyPassword(pw, stored) {
  if (!stored?.startsWith('scrypt$')) return false;
  const [, N, r, p, salt, hash] = stored.split('$');
  const expected = Buffer.from(hash, 'base64');
  const got = crypto.scryptSync(String(pw), Buffer.from(salt, 'base64'), expected.length, {N: +N, r: +r, p: +p});
  return crypto.timingSafeEqual(got, expected);
}
export const randomPassword = () => crypto.randomBytes(12).toString('base64url');

// ———————————————————————————————————————————— utilizatori și sesiuni

const SESSION_DAYS = 14;
const COOKIE = 'kurat_session';
const tokenHash = t => crypto.createHash('sha256').update(t).digest('hex');

export function createUser(db, {email, name, role = 'editor', password}) {
  if (!ROLES[role]) throw Object.assign(new Error(`Rol necunoscut: ${role}`), {status: 422});
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email ?? '')) throw Object.assign(new Error('Email invalid.'), {status: 422});
  if (String(password ?? '').length < 10) throw Object.assign(new Error('Parola are cel puțin 10 caractere.'), {status: 422});
  const {lastInsertRowid} = db.prepare('INSERT INTO users (email, name, role, password_hash, created_at) VALUES (?, ?, ?, ?, ?)')
    .run(email.trim().toLowerCase(), String(name).trim(), role, hashPassword(password), nowIso());
  return Number(lastInsertRowid);
}

export const userById = (db, id) => db.prepare('SELECT id, email, name, role, active, created_at FROM users WHERE id = ?').get(id) ?? null;

// Limita încercărilor: cel mult 8 eșecuri pe IP în 15 minute.
export function tooManyAttempts(db, ip) {
  const since = new Date(Date.now() - 15 * 60_000).toISOString();
  return db.prepare('SELECT COUNT(*) n FROM login_attempts WHERE ip = ? AND ok = 0 AND at > ?').get(ip, since).n >= 8;
}

export function login(db, {email, password, ip, userAgent}) {
  if (tooManyAttempts(db, ip)) throw Object.assign(new Error('Prea multe încercări. Încearcă din nou peste 15 minute.'), {status: 429});
  const u = db.prepare('SELECT * FROM users WHERE email = ? AND active = 1').get(String(email ?? '').trim().toLowerCase());
  const ok = !!u && verifyPassword(password, u.password_hash);
  db.prepare('INSERT INTO login_attempts (ip, email, at, ok) VALUES (?, ?, ?, ?)').run(ip, email ?? null, nowIso(), ok ? 1 : 0);
  if (!ok) throw Object.assign(new Error('Email sau parolă greșite.'), {status: 401});
  return startSession(db, u.id, {ip, userAgent});
}

export function startSession(db, userId, {ip = null, userAgent = null} = {}) {
  const token = crypto.randomBytes(32).toString('base64url');
  const expires = new Date(Date.now() + SESSION_DAYS * 86400_000).toISOString();
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, ip, user_agent) VALUES (?, ?, ?, ?, ?, ?)')
    .run(tokenHash(token), userId, nowIso(), expires, ip, userAgent);
  return {token, expires};
}

export function logout(db, req) {
  const t = readCookie(req, COOKIE);
  if (t) db.prepare('DELETE FROM sessions WHERE id = ?').run(tokenHash(t));
}

export const readCookie = (req, name) => {
  for (const part of String(req.headers.cookie ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return null;
};

export const sessionCookie = ({token, expires}, {secure}) =>
  `${COOKIE}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Expires=${new Date(expires).toUTCString()}${secure ? '; Secure' : ''}`;
export const clearCookie = ({secure}) => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure ? '; Secure' : ''}`;

const isLoopback = ip => ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(ip);

// Utilizatorul cererii. Fără parolă doar pe localhost, și doar când e cerut explicit (BRAIN_DEV_LOGIN=1).
export function currentUser(db, req) {
  const t = readCookie(req, COOKIE);
  if (t) {
    const s = db.prepare('SELECT * FROM sessions WHERE id = ?').get(tokenHash(t));
    if (s && s.expires_at > nowIso()) {
      const u = userById(db, s.user_id);
      if (u?.active) return u;
    }
  }
  if (process.env.BRAIN_DEV_LOGIN === '1' && isLoopback(req.socket.remoteAddress) && !req.headers['x-forwarded-for'])
    return {id: 0, email: 'local@localhost', name: 'Local (fără parolă)', role: 'admin', active: 1, dev: true};
  return null;
}

// Scrierile venite din alt site sunt refuzate (verificarea Origin).
export function sameOrigin(req) {
  const o = req.headers.origin;
  if (!o) return req.method === 'GET' || req.method === 'HEAD' || !!req.headers['sec-fetch-site']?.match(/same-origin|none/) || !req.headers['sec-fetch-site'];
  try { return new URL(o).host === req.headers.host; } catch { return false; }
}

export const storeUser = u => u ? {id: u.id || null, name: u.name, email: u.email, role: u.role} : {name: 'Anonim'};
