// Validación en el servidor (nunca se confía en lo que valida el navegador).
import { bad } from './http.js';

export const str = (v, { min = 0, max = 500, field = 'Campo', trim = true } = {}) => {
  if (v === undefined || v === null) v = '';
  if (typeof v !== 'string') throw bad(`${field} no es válido.`);
  const s = trim ? v.trim() : v;
  // quita caracteres de control (salvo salto de línea y tabulación)
  const clean = s.replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '');
  if (clean.length < min) throw bad(`${field} es obligatorio.`);
  if (clean.length > max) throw bad(`${field} es demasiado largo (máx. ${max}).`);
  return clean;
};
export const isEmail = (e) => typeof e === 'string' && e.length <= 120 && /^[A-Za-z0-9._%+'-]{1,64}@[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}$/.test(e.trim());
export const email = (v) => { if (!isEmail(v)) throw bad('Ingresa un correo válido.'); return v.trim().toLowerCase(); };
export const username = (v) => {
  const s = String(v ?? '').trim().toLowerCase().replace(/^@/, '');
  if (!/^[a-z0-9._]{4,20}$/.test(s)) throw bad('El usuario debe tener 4 a 20 caracteres: minúsculas, números, punto o guion bajo.');
  return s;
};
export const phone = (v) => {
  const d = String(v ?? '').replace(/\D/g, '').replace(/^51(?=9\d{8}$)/, '');
  if (!/^9\d{8}$/.test(d)) throw bad('Ingresa un celular peruano de 9 dígitos que empiece con 9.');
  return d;
};
export const password = (v) => {
  if (typeof v !== 'string' || v.length < 8 || v.length > 128 || !/[A-Za-z]/.test(v) || !/\d/.test(v)) {
    throw bad('La contraseña debe tener mínimo 8 caracteres, una letra y un número.');
  }
  return v;
};
export const code6 = (v) => { const s = String(v ?? '').replace(/\D/g, ''); if (s.length !== 6) throw bad('El código debe tener 6 dígitos.'); return s; };
export const oneOf = (v, list, field = 'Valor') => { if (!list.includes(v)) throw bad(`${field} no es válido.`); return v; };
export const num = (v, min, max, field = 'Número') => {
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw bad(`${field} no es válido.`);
  return n;
};
// Ubicación dentro del Perú (el mapa está restringido a ese país)
export const coords = (lat, lng) => ({ lat: num(lat, -18.5, 0, 'Latitud'), lng: num(lng, -81.5, -68.5, 'Longitud') });

/** Solo imágenes en base64 propias (jpeg/png/webp); nada de URLs externas ni SVG */
export const image = (v, maxBytes, field = 'La foto') => {
  if (v === undefined || v === null || v === '') return '';
  if (typeof v !== 'string' || !/^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/.test(v)) throw bad(`${field} debe ser una imagen JPG, PNG o WEBP.`);
  if (v.length > maxBytes * 1.37) throw bad(`${field} es demasiado pesada.`);
  return v;
};
export const dateIso = (v, field = 'La fecha') => {
  const d = new Date(v);
  if (!v || Number.isNaN(d.getTime())) throw bad(`${field} no es válida.`);
  if (d.getTime() > Date.now() + 5 * 60_000) throw bad(`${field} no puede estar en el futuro.`);
  if (d.getTime() < Date.now() - 365 * 86400_000) throw bad(`${field} es demasiado antigua.`);
  return d.toISOString();
};
