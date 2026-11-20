// Mini framework HTTP sin dependencias: rutas, JSON, cookies, errores y archivos estáticos.
import fs from 'node:fs';
import path from 'node:path';
import { ENV } from './env.js';
import { hit } from './security.js';

export class HttpError extends Error {
  constructor(status, message, extra) { super(message); this.status = status; this.extra = extra; }
}
export const bad = (m) => new HttpError(400, m);
export const unauthorized = (m = 'Debes iniciar sesión para continuar') => new HttpError(401, m);
export const forbidden = (m = 'No tienes permisos para esta acción.') => new HttpError(403, m);
export const notFound = (m = 'No encontrado') => new HttpError(404, m);
export const conflict = (m) => new HttpError(409, m);

const routes = [];
/** add('GET', '/api/cases/:id', handler, { auth: true|'staff', limit: [max, windowMs] }) */
export function add(method, pattern, handler, opts = {}) {
  const keys = [];
  const rx = new RegExp('^' + pattern.replace(/:([A-Za-z]+)/g, (_, k) => { keys.push(k); return '([^/]+)'; }) + '/?$');
  routes.push({ method, rx, keys, handler, opts });
}

export function clientIp(req) {
  const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (ENV.trustProxyHops > 0 && xff.length) return xff[Math.max(0, xff.length - ENV.trustProxyHops)];
  return req.socket.remoteAddress || 'unknown';
}

export function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}
export function setCookie(res, name, value, { maxAge, clear } = {}) {
  const parts = [`${name}=${clear ? '' : encodeURIComponent(value)}`, 'Path=/', 'HttpOnly', 'SameSite=Lax'];
  if (ENV.isProd) parts.push('Secure');
  parts.push(clear ? 'Max-Age=0' : `Max-Age=${maxAge}`);
  res.setHeader('Set-Cookie', parts.join('; '));
}

export const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'geolocation=(self), camera=(), microphone=(), payment=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Content-Security-Policy': [
    "default-src 'self'",
    "script-src 'self' https://unpkg.com",
    "style-src 'self' 'unsafe-inline' https://unpkg.com https://fonts.googleapis.com",
    "font-src 'self' https://fonts.gstatic.com",
    "img-src 'self' data: blob: https://tile.openstreetmap.org https://unpkg.com",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; '),
  ...(ENV.isProd ? { 'Strict-Transport-Security': 'max-age=31536000; includeSubDomains' } : {}),
};

function send(res, status, body, headers = {}) {
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...headers })) res.setHeader(k, v);
  res.statusCode = status;
  res.end(body);
}
export const sendJson = (res, status, data) =>
  send(res, status, JSON.stringify(data), { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });

const MAX_BODY = 1_500_000; // 1,5 MB (las fotos llegan comprimidas)
function readJson(req) {
  return new Promise((resolve, reject) => {
    if (['GET', 'HEAD', 'DELETE'].includes(req.method)) return resolve({});
    const hasBody = req.headers['transfer-encoding'] || Number(req.headers['content-length'] || 0) > 0;
    if (!hasBody) return resolve({});
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) {
      return reject(new HttpError(415, 'Formato no permitido'));
    }
    let size = 0; const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) { reject(new HttpError(413, 'La solicitud es demasiado grande.')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        const v = JSON.parse(Buffer.concat(chunks).toString('utf8'));
        resolve(v && typeof v === 'object' && !Array.isArray(v) ? v : {});
      } catch { reject(bad('JSON inválido')); }
    });
    req.on('error', reject);
  });
}

export async function handleApi(req, res, url, resolveUser) {
  try {
    const route = routes.find((r) => r.method === req.method && r.rx.test(url.pathname));
    if (!route) {
      if (routes.some((r) => r.rx.test(url.pathname))) throw new HttpError(405, 'Método no permitido');
      throw notFound('Ruta no encontrada');
    }
    const ip = clientIp(req);
    const g = hit(`ip:${ip}`, ENV.rateLimitPerMin, 60_000);
    if (!g.ok) throw new HttpError(429, 'Demasiadas solicitudes. Espera un momento.', { retryAfter: g.retryAfter });

    if (req.method !== 'GET') {
      // Defensa CSRF: la cabecera personalizada obliga a una petición del propio sitio
      if (req.headers['x-requested-with'] !== 'siempre-cerca') throw forbidden('Solicitud no permitida.');
      const origin = req.headers.origin;
      if (origin) {
        const host = req.headers['x-forwarded-host'] || req.headers.host;
        let ok = false;
        try { ok = new URL(origin).host === host; } catch { /* inválido */ }
        if (!ok) throw forbidden('Origen no permitido.');
      }
    }
    if (route.opts.limit) {
      const [max, win, name] = route.opts.limit;
      const l = hit(`${name || route.rx.source}:${ip}`, max, win);
      if (!l.ok) throw new HttpError(429, 'Demasiados intentos. Intenta de nuevo en unos minutos.', { retryAfter: l.retryAfter });
    }

    const m = url.pathname.match(route.rx);
    const params = {};
    route.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
    const ctx = { req, res, ip, params, query: Object.fromEntries(url.searchParams), body: await readJson(req), user: null };

    if (route.opts.auth) {
      ctx.user = await resolveUser(req);
      if (!ctx.user) throw unauthorized();
      if (route.opts.auth === 'staff' && !['moderator', 'admin'].includes(ctx.user.role)) throw forbidden();
      if (route.opts.auth === 'admin' && ctx.user.role !== 'admin') throw forbidden();
    }
    const out = await route.handler(ctx);
    sendJson(res, 200, out === undefined ? { ok: true } : out);
  } catch (err) {
    const status = err.status || 500;
    if (status >= 500) console.error(`[api] ${req.method} ${url.pathname}`, err);
    const headers = err.extra?.retryAfter ? { 'Retry-After': String(err.extra.retryAfter) } : {};
    for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
    sendJson(res, status, { error: status >= 500 ? 'Ocurrió un error en el servidor. Intenta de nuevo.' : err.message });
  }
}

// ---- Archivos estáticos (solo la carpeta public/) ----
const MIME = {
  '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2', '.txt': 'text/plain; charset=utf-8',
};
const PUBLIC = path.join(ENV.root, 'public');

export function serveStatic(req, res, url) {
  if (!['GET', 'HEAD'].includes(req.method)) return send(res, 405, 'Método no permitido');
  let rel;
  try { rel = decodeURIComponent(url.pathname); } catch { return send(res, 400, 'Solicitud inválida'); }
  if (rel.includes('\0') || rel.split('/').some((s) => s.startsWith('.'))) return send(res, 404, 'No encontrado');
  let file = path.join(PUBLIC, rel === '/' ? 'index.html' : rel);
  if (!file.startsWith(PUBLIC + path.sep) && file !== PUBLIC) return send(res, 404, 'No encontrado');
  let st;
  try { st = fs.statSync(file); if (st.isDirectory()) { file = path.join(file, 'index.html'); st = fs.statSync(file); } }
  catch { return send(res, 404, 'No encontrado'); }
  const ext = path.extname(file).toLowerCase();
  const cache = ext === '.html' ? 'no-cache' : 'public, max-age=300';
  const headers = { 'Content-Type': MIME[ext] || 'application/octet-stream', 'Cache-Control': cache, 'Content-Length': st.size };
  for (const [k, v] of Object.entries({ ...SECURITY_HEADERS, ...headers })) res.setHeader(k, v);
  res.statusCode = 200;
  if (req.method === 'HEAD') return res.end();
  fs.createReadStream(file).pipe(res);
}
