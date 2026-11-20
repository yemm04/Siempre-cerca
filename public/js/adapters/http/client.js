/**
 * client.js - Cliente HTTP único hacia la API (/api).
 * - Misma origen: el navegador envía la cookie de sesión (httpOnly) sola; el JS nunca ve el token.
 * - La cabecera X-Requested-With protege contra CSRF (el servidor la exige en POST/PATCH/DELETE).
 */
import { CONFIG } from '../../config.js';

export async function request(method, path, body) {
  let res;
  try {
    res = await fetch(`${CONFIG.API_BASE_URL}${path}`, {
      method,
      credentials: 'same-origin',
      headers: {
        'X-Requested-With': 'siempre-cerca',
        ...(method !== 'GET' ? { 'Content-Type': 'application/json' } : {}),
      },
      body: method !== 'GET' && method !== 'DELETE' ? JSON.stringify(body ?? {}) : undefined,
    });
  } catch {
    throw new Error('No hay conexión con el servidor. Revisa tu internet e intenta de nuevo.');
  }
  let data = null;
  try { data = await res.json(); } catch { /* respuesta sin cuerpo */ }
  if (!res.ok) {
    const err = new Error(data?.error || 'Ocurrió un error. Intenta de nuevo.');
    err.status = res.status;
    // Sesión vencida: avisa a la app para volver al login
    if (res.status === 401 && !path.startsWith('/auth/') && path !== '/me') {
      window.dispatchEvent(new CustomEvent('sc:session-expired'));
    }
    throw err;
  }
  return data;
}

export const get = (path, params) => {
  const qs = params
    ? '?' + new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString()
    : '';
  return request('GET', path + (qs === '?' ? '' : qs));
};
export const post = (path, body) => request('POST', path, body);
export const patch = (path, body) => request('PATCH', path, body);
export const del = (path) => request('DELETE', path);
