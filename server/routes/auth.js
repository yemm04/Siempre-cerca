import { ENV } from '../lib/env.js';
import { add, bad, conflict, forbidden, HttpError } from '../lib/http.js';
import { query, tx } from '../lib/db.js';
import { hashPassword, verifyPassword, DUMMY_HASH, newId, hit, peek, clearHits } from '../lib/security.js';
import * as v from '../lib/validate.js';
import { issueCode, consumeCode } from '../lib/codes.js';
import { sendPhoneCode, checkPhoneCode } from '../lib/sms.js';
import { createSession, destroySession, resolveUser } from '../lib/session.js';
import { sessionUser } from '../lib/mappers.js';

const MSG = {
  INVALID: 'Usuario o contraseña incorrectos.',
  BANNED: 'Tu cuenta fue suspendida por incumplir las normas de la comunidad.',
  EMAIL_USED: 'Ese correo ya está registrado.',
  USER_USED: 'Ese nombre de usuario ya está en uso.',
  PHONE_USED: 'Ese número ya está asociado a otra cuenta.',
};
const findByIdentifier = async (id) => {
  const k = String(id ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!k || k.length > 120) return null;
  const { rows } = await query('SELECT * FROM users WHERE lower(email) = $1 OR lower(username) = $1', [k]);
  return rows[0] || null;
};
const maskEmail = (e) => { const [a, d] = e.split('@'); return `${a.slice(0, 2)}${'*'.repeat(Math.max(2, a.length - 2))}@${d}`; };
const uniqueMessage = (err) => {
  if (err.code !== '23505') return null;
  if (/email/.test(err.constraint)) return MSG.EMAIL_USED;
  if (/username/.test(err.constraint)) return MSG.USER_USED;
  if (/phone/.test(err.constraint)) return MSG.PHONE_USED;
  return 'Ya existe una cuenta con esos datos.';
};

// Paso final del registro: se envía un código por SMS al celular
add('POST', '/api/auth/send-code', async ({ body }) => {
  const email = v.email(body.email);
  const phone = v.phone(body.phone);
  const { rows } = await query('SELECT lower(email) = $1 AS same_email FROM users WHERE lower(email)=$1 OR phone=$2', [email, phone]);
  if (rows.length) throw conflict(rows[0].same_email ? MSG.EMAIL_USED : MSG.PHONE_USED);
  await sendPhoneCode(phone);
  return { sent: true };
}, { limit: [ENV.smsPerIpHour, 3600_000, 'sendcode'] });

add('POST', '/api/auth/register', async ({ body, res }) => {
  const data = {
    name: v.str(body.name, { min: 2, max: 60, field: 'El nombre' }),
    username: v.username(body.username),
    email: v.email(body.email),
    phone: v.phone(body.phone),
    password: v.password(body.password),
  };
  const code = v.code6(body.code);
  await checkPhoneCode(data.phone, code);
  const passwordHash = await hashPassword(data.password);
  const id = newId('usr');
  try {
    await query(`INSERT INTO users (id, name, username, email, phone, password_hash) VALUES ($1,$2,$3,$4,$5,$6)`,
      [id, data.name, data.username, data.email, data.phone, passwordHash]);
  } catch (e) {
    const m = uniqueMessage(e); if (m) throw conflict(m); throw e;
  }
  await createSession(res, id);
  return sessionUser({ id, ...data, role: 'user' });
}, { limit: [ENV.smsPerIpHour, 3600_000, 'register'] });

add('POST', '/api/auth/login', async ({ body, res, ip }) => {
  const identifier = String(body.identifier ?? '').trim().toLowerCase().replace(/^@/, '');
  const password = typeof body.password === 'string' ? body.password.slice(0, 200) : '';
  if (!identifier || !password) throw bad('Completa usuario y contraseña.');
  const key = `loginfail:${identifier}`;
  if (peek(key, 15 * 60_000) >= 8) {
    throw new HttpError(429, 'Demasiados intentos fallidos. Espera 15 minutos o recupera tu contraseña.');
  }
  const user = await findByIdentifier(identifier);
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) { hit(key, 99, 15 * 60_000); throw Object.assign(new Error(MSG.INVALID), { status: 401 }); }
  if (user.status === 'banned') throw forbidden(MSG.BANNED);
  clearHits(key);
  await createSession(res, user.id);
  return sessionUser(user);
}, { limit: [120, 10 * 60_000, 'login'] });

add('POST', '/api/auth/logout', async ({ req, res }) => { await destroySession(req, res); return { ok: true }; });

// Sesión actual (null si no hay): no responde 401 para que la web arranque sin errores
add('GET', '/api/me', async ({ req }) => {
  const u = await resolveUser(req);
  return { user: u ? sessionUser(u) : null };
});

// ---- Recuperar contraseña ----
add('POST', '/api/auth/forgot', async ({ body }) => {
  const user = await findByIdentifier(body.identifier);
  // Respuesta idéntica exista o no la cuenta (así no se pueden descubrir correos registrados)
  if (user && user.status === 'active') await issueCode(user.email, 'reset', user.name);
  return { email: user ? maskEmail(user.email) : 'tu correo registrado' };
}, { limit: [8, 3600_000, 'forgot'] });

add('POST', '/api/auth/reset', async ({ body }) => {
  const user = await findByIdentifier(body.identifier);
  const code = v.code6(body.code);
  const pw = v.password(body.newPassword);
  if (!user) throw bad('El código venció o no existe. Solicita uno nuevo.');
  await consumeCode(user.email, 'reset', code);
  await tx(async (db) => {
    await db.query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(pw)]);
    await db.query('DELETE FROM sessions WHERE user_id = $1', [user.id]); // cierra sesiones abiertas en otros equipos
  });
  return { ok: true };
}, { limit: [10, 3600_000, 'reset'] });

// ---- Cuenta (requiere sesión) ----
const checkPw = async (user, password) => typeof password === 'string' && (await verifyPassword(password, user.password_hash));

add('POST', '/api/me/check-password', async ({ user, body }) => {
  const ok = await checkPw(user, body.password);
  return { ok };
}, { auth: true, limit: [15, 10 * 60_000, 'checkpw'] });

add('POST', '/api/me/password', async ({ user, body }) => {
  if (!(await checkPw(user, body.current))) throw bad('La contraseña actual es incorrecta.');
  const next = v.password(body.next);
  if (await verifyPassword(next, user.password_hash)) throw bad('La nueva contraseña debe ser distinta a la actual.');
  await query('UPDATE users SET password_hash = $2 WHERE id = $1', [user.id, await hashPassword(next)]);
  return { ok: true };
}, { auth: true, limit: [10, 10 * 60_000, 'changepw'] });

// Cambiar correo: 1) contraseña + nuevo correo → código al correo nuevo, 2) confirmar con el código
add('POST', '/api/me/email/request', async ({ user, body }) => {
  if (!(await checkPw(user, body.password))) throw bad('La contraseña actual es incorrecta.');
  const email = v.email(body.newEmail);
  if (email === user.email.toLowerCase()) throw bad('Ese ya es tu correo actual.');
  const { rows } = await query('SELECT 1 FROM users WHERE lower(email)=$1', [email]);
  if (rows.length) throw conflict(MSG.EMAIL_USED);
  await issueCode(email, 'email_change', user.name);
  return { sent: true };
}, { auth: true, limit: [6, 3600_000, 'emailreq'] });

add('POST', '/api/me/email', async ({ user, body }) => {
  if (!(await checkPw(user, body.password))) throw bad('La contraseña actual es incorrecta.');
  const email = v.email(body.newEmail);
  await consumeCode(email, 'email_change', v.code6(body.code));
  try { await query('UPDATE users SET email = $2 WHERE id = $1', [user.id, email]); }
  catch (e) { const m = uniqueMessage(e); if (m) throw conflict(m); throw e; }
  return sessionUser({ ...user, email });
}, { auth: true, limit: [10, 3600_000, 'emailset'] });

// Cambiar teléfono: 1) contraseña + nuevo número → código SMS al número nuevo, 2) confirmar con el código
add('POST', '/api/me/phone/request', async ({ user, body }) => {
  if (!(await checkPw(user, body.password))) throw bad('La contraseña actual es incorrecta.');
  const phone = v.phone(body.newPhone);
  if (phone === user.phone) throw bad('Ese ya es tu número actual.');
  const { rows } = await query('SELECT 1 FROM users WHERE phone=$1', [phone]);
  if (rows.length) throw conflict(MSG.PHONE_USED);
  await sendPhoneCode(phone);
  return { sent: true };
}, { auth: true, limit: [6, 3600_000, 'phonereq'] });

add('POST', '/api/me/phone', async ({ user, body }) => {
  if (!(await checkPw(user, body.password))) throw bad('La contraseña actual es incorrecta.');
  const phone = v.phone(body.newPhone);
  await checkPhoneCode(phone, v.code6(body.code));
  try { await query('UPDATE users SET phone = $2 WHERE id = $1', [user.id, phone]); }
  catch (e) { const m = uniqueMessage(e); if (m) throw conflict(m); throw e; }
  return sessionUser({ ...user, phone });
}, { auth: true, limit: [10, 3600_000, 'phoneset'] });
