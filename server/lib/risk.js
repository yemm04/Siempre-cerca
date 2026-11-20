// Puntaje de riesgo de un anuncio (0 = normal, 100 = casi seguro falso/spam).
// Primero reglas (gratis e inmediatas); si hay clave de IA, un modelo da una segunda opinión en los casos dudosos.
//   puntaje < 35  → se publica sola
//   35 a 69       → "en revisión" (solo esto ve el equipo)
//   >= 70         → se rechaza sola, con el motivo
import { trustLevel, RISK_ADJUST } from './reputation.js';
import { aiEnabled, assessCase } from './ai.js';

export const REVIEW_AT = 35;
export const REJECT_AT = 70;

const RE = {
  url: /(https?:\/\/|www\.)|\b[a-z0-9-]+\.(com|net|org|pe|xyz)\b/i,
  pay: /\b(yape|plin|transferencia|transfiere|deposit[oa]|dep[oó]sito|cuenta bancaria|cci|bcp|interbank|bbva|scotiabank|paypal)\b/i,
  reward: /\brecompensa\b.{0,25}(s\/|soles|\$|\d{2,})/i,
  spam: /\b(casino|apuesta[s]?|ganaste|gana dinero|sorteo|premio|bono|inversi[oó]n|criptomoneda|bitcoin|pr[eé]stamo|oferta|descuento|promoci[oó]n)\b/i,
  social: /\b(whatsapp|telegram|instagram|facebook|tiktok|inbox)\b|@[a-z0-9_.]{4,}/i,
  phone: /(?:\+?51)?\s?9\d{2}[\s-]?\d{3}[\s-]?\d{3}/,
  email: /[\w.+-]+@[\w-]+\.[\w.]+/,
  insult: /\b(mierda|puta|puto|carajo|idiota|est[uú]pid[oa]|imb[eé]cil|conchatumadre|ctm|hdp|malparid[oa])\b/i,
  petWords: /\b(perro|perra|gato|gata|cachorr[oa]|mascota|labrador|mestiz[oa]|chihuahua|poodle|pitbull)\b/i,
};
const LIMA = { latMin: -12.55, latMax: -11.55, lngMin: -77.25, lngMax: -76.7 };

/** Reglas puras (no tocan la base de datos). Devuelve { score, reasons: [{text, points}] } */
export function ruleScore(c, ctx = {}) {
  const reasons = [];
  const add = (points, text) => reasons.push({ text, points });
  const all = `${c.name} ${c.breedOrAge} ${c.description} ${c.lastSeenText}`;

  if (RE.url.test(all)) add(45, 'Contiene enlaces o direcciones web');
  if (RE.pay.test(all)) add(50, 'Menciona pagos, depósitos o cuentas bancarias');
  if (RE.reward.test(all)) add(20, 'Ofrece recompensa en dinero');
  if (RE.spam.test(all)) add(70, 'Parece publicidad, sorteo o estafa');
  if (RE.social.test(all)) add(20, 'Redirige a otras redes o chats');
  if (RE.email.test(c.description)) add(15, 'Incluye un correo en la descripción');
  if (RE.phone.test(c.description)) add(10, 'Incluye un teléfono en la descripción');
  if (RE.insult.test(all)) add(60, 'Lenguaje ofensivo');

  const letters = (c.description.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) || []);
  if (letters.length > 20 && letters.filter((x) => x === x.toUpperCase() && x !== x.toLowerCase()).length / letters.length > 0.7) add(10, 'Texto todo en mayúsculas');
  if ((all.match(/!/g) || []).length >= 4) add(8, 'Exceso de signos de exclamación');

  const nm = c.name.trim();
  if (/(.)\1{3,}/.test(nm) || (nm.length >= 4 && !/[aeiouáéíóúAEIOUÁÉÍÓÚ]/.test(nm))) add(30, 'El nombre no parece real');
  else if (c.type === 'person' && /\d/.test(nm)) add(15, 'El nombre de la persona tiene números');

  if (c.description.trim().length < 10) add(8, 'Descripción muy corta');
  if (!c.hasPhoto) add(c.type === 'person' ? 10 : 5, 'Sin foto');

  // Coherencia entre tipo y texto
  if (c.type === 'person' && RE.petWords.test(`${c.breedOrAge} ${c.description}`)) add(25, 'Dice que es una persona pero el texto habla de una mascota');
  if (c.type === 'pet' && /\b(persona|adulto mayor|menor de edad)\b/i.test(c.breedOrAge)) add(25, 'Dice que es una mascota pero la edad es de una persona');

  if (!(c.lat >= LIMA.latMin && c.lat <= LIMA.latMax && c.lng >= LIMA.lngMin && c.lng <= LIMA.lngMax)) add(10, 'Ubicación fuera de Lima');
  if (c.lastSeenAt && Date.now() - new Date(c.lastSeenAt).getTime() > 10 * 86400_000) add(10, 'Se vio por última vez hace más de 10 días');

  if (ctx.accountAgeMin !== undefined && ctx.accountAgeMin < 5) add(8, 'Cuenta recién creada');
  if (ctx.recentRejected > 0) add(Math.min(30, 15 * ctx.recentRejected), 'Tuvo alertas rechazadas hace poco');
  if (ctx.nearDuplicates > 0) add(15, 'Ya existe una alerta parecida cerca (posible duplicado)');

  const level = trustLevel(ctx.reputation);
  if (RISK_ADJUST[level]) add(RISK_ADJUST[level], level === 'trusted' ? 'Usuario con buena reputación' : 'Usuario con reputación baja');

  const score = Math.max(0, Math.min(100, reasons.reduce((a, r) => a + r.points, 0)));
  return { score, reasons, level };
}

export const decide = (score) => (score >= REJECT_AT ? 'reject' : score >= REVIEW_AT ? 'review' : 'publish');

/** Reglas + (opcional) IA. La IA solo suma puntos; nunca publica ni rechaza por su cuenta. */
export async function evaluateCase(c, ctx = {}) {
  const r = ruleScore(c, ctx);
  let { score } = r; const reasons = [...r.reasons]; let source = 'reglas';
  const skipAi = score >= REJECT_AT || (r.level === 'trusted' && score < 15);
  if (aiEnabled() && !skipAi) {
    const a = await assessCase({ ...c, photo: c.aiPhoto }).catch(() => null);
    if (a) {
      source = 'reglas+ia';
      if (a.level === 'high') { score += 50; reasons.push({ text: `IA: ${a.reasons[0] || 'riesgo alto'}`, points: 50 }); }
      else if (a.level === 'medium') { score += 20; reasons.push({ text: `IA: ${a.reasons[0] || 'algo no cuadra'}`, points: 20 }); }
      if (a.coherent === false) { score += 15; reasons.push({ text: 'IA: el texto y la foto no parecen coincidir', points: 15 }); }
      score = Math.max(0, Math.min(100, score));
    }
  }
  return { score, reasons, source, decision: decide(score) };
}

// Texto para mostrar al usuario o al equipo
export const reasonsText = (reasons, withPoints = false) =>
  reasons.filter((r) => r.points > 0).map((r) => (withPoints ? `${r.text} (+${r.points})` : r.text));
