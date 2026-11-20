// Contraseñas, tokens y límites de uso. Solo módulos nativos de Node (crypto).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt);
const N = 16384, R = 8, P = 1, KEYLEN = 64;

export async function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(password, salt, KEYLEN, { N, r: R, p: P, maxmem: 64 * 1024 * 1024 });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password, stored) {
  try {
    const [algo, n, r, p, saltB64, keyB64] = String(stored).split('$');
    if (algo !== 'scrypt') return false;
    const expected = Buffer.from(keyB64, 'base64');
    const key = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length,
      { N: +n, r: +r, p: +p, maxmem: 64 * 1024 * 1024 });
    return crypto.timingSafeEqual(key, expected);
  } catch { return false; }
}

// Hash "falso" para que el login tarde lo mismo si el usuario no existe (evita descubrir cuentas)
export const DUMMY_HASH = await hashPassword(crypto.randomBytes(8).toString('hex'));

export const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');
export const newToken = () => crypto.randomBytes(32).toString('base64url');
export const newId = (prefix) => `${prefix}_${crypto.randomBytes(9).toString('base64url')}`;
export const sixDigits = () => String(crypto.randomInt(0, 1_000_000)).padStart(6, '0');

/** Límite de peticiones por clave en una ventana de tiempo (memoria; un solo servidor). */
const buckets = new Map();
export function hit(key, max, windowMs) {
  const now = Date.now();
  const arr = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  arr.push(now);
  buckets.set(key, arr);
  return { ok: arr.length <= max, retryAfter: Math.ceil((arr[0] + windowMs - now) / 1000) };
}
export function peek(key, windowMs) {
  const now = Date.now();
  return (buckets.get(key) || []).filter((t) => now - t < windowMs).length;
}
export function clearHits(key) { buckets.delete(key); }
setInterval(() => {
  const now = Date.now();
  for (const [k, arr] of buckets) {
    if (!arr.length || now - arr[arr.length - 1] > 3600_000) buckets.delete(k);
  }
}, 600_000).unref();
