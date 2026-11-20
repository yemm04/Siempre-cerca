import { query } from './db.js';
import { ENV } from './env.js';
import { newToken, sha256 } from './security.js';
import { parseCookies, setCookie } from './http.js';

export const COOKIE = 'sc_session';

export async function createSession(res, userId) {
  const token = newToken();
  const maxAge = ENV.sessionDays * 86400;
  await query(`INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1,$2, now() + ($3 || ' seconds')::interval)`,
    [sha256(token), userId, String(maxAge)]);
  setCookie(res, COOKIE, token, { maxAge });
}

export async function destroySession(req, res) {
  const t = parseCookies(req)[COOKIE];
  if (t) await query('DELETE FROM sessions WHERE token_hash = $1', [sha256(t)]);
  setCookie(res, COOKIE, '', { clear: true });
}

/** Devuelve el usuario (fila completa) de la sesión o null. Las cuentas suspendidas no tienen sesión. */
export async function resolveUser(req) {
  const t = parseCookies(req)[COOKIE];
  if (!t || t.length > 100) return null;
  const { rows } = await query(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.status = 'active'`, [sha256(t)]);
  return rows[0] || null;
}
