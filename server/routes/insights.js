// Zonas de búsqueda, consejos, resumen de pistas y asistente de ayuda.
import { add, notFound, forbidden, HttpError } from '../lib/http.js';
import { hit } from '../lib/security.js';
import { query } from '../lib/db.js';
import * as v from '../lib/validate.js';
import { buildPlan, ruleTips } from '../lib/zones.js';
import { aiEnabled, searchTips, summarizeSightings, assistantReply } from '../lib/ai.js';
import { FAQS } from '../../public/js/data/faqs.js';

const isStaff = (u) => ['moderator', 'admin'].includes(u.role);

async function caseForUser(user, id) {
  const { rows: [c] } = await query('SELECT * FROM cases WHERE id = $1', [id]);
  if (!c) throw notFound('Alerta no encontrada');
  if (!['active', 'resolved'].includes(c.status) && c.owner_id !== user.id && !isStaff(user)) throw notFound('Alerta no encontrada');
  return c;
}
async function loadPlan(c) {
  const [s, p] = await Promise.all([
    query(`SELECT lat, lng, created_at, still_there, place FROM sightings WHERE case_id = $1 AND created_at > now() - interval '72 hours'
           ORDER BY created_at DESC LIMIT 20`, [c.id]),
    query('SELECT zone, inspected FROM participations WHERE case_id = $1', [c.id]),
  ]);
  return { plan: buildPlan(c, s.rows, p.rows), sightings: s.rows };
}

// Radio probable, mapa de calor por celdas y cuadrante sugerido (cálculo del servidor, sin IA)
add('GET', '/api/cases/:id/plan', async ({ user, params }) => {
  const c = await caseForUser(user, params.id);
  if (c.status === 'resolved') return { closed: true };
  const { plan } = await loadPlan(c);
  const mine = await query('SELECT zone, inspected FROM participations WHERE case_id = $1 AND user_id = $2', [c.id, user.id]);
  return { ...plan, myZone: mine.rows[0]?.zone || null, myZoneInspected: mine.rows[0]?.inspected || false };
}, { auth: true, limit: [120, 60_000, 'plan'] });

// Consejos de búsqueda: con IA si hay clave (se guardan 2 horas), si no, reglas según tipo de caso y tiempo
add('GET', '/api/cases/:id/tips', async ({ user, params }) => {
  const c = await caseForUser(user, params.id);
  if (c.status === 'resolved') return { text: '', source: 'reglas' };
  const { plan } = await loadPlan(c);
  if (aiEnabled()) {
    const fresh = c.ai_tips && c.ai_tips_at && Date.now() - new Date(c.ai_tips_at).getTime() < 2 * 3600_000;
    if (fresh) return { text: c.ai_tips, source: 'ia' };
    const text = await searchTips(c, plan);
    if (text) {
      await query('UPDATE cases SET ai_tips = $2, ai_tips_at = now(), ai_tips_n = $3 WHERE id = $1', [c.id, text, plan.sightingsCount]);
      return { text, source: 'ia' };
    }
  }
  return { text: ruleTips(plan), source: 'reglas' };
}, { auth: true, limit: [60, 60_000, 'tips'] });

// Resumen de pistas para quienes ayudan (dueño, voluntarios del caso y equipo). No incluye quién reportó ni fotos.
add('GET', '/api/cases/:id/summary', async ({ user, params }) => {
  const c = await caseForUser(user, params.id);
  if (c.owner_id !== user.id && !isStaff(user)) {
    const { rows } = await query('SELECT 1 FROM participations WHERE case_id = $1 AND user_id = $2', [c.id, user.id]);
    if (!rows.length) throw forbidden('Únete a la búsqueda para ver el resumen de pistas.');
  }
  const { rows } = await query(`SELECT place, note, still_there, created_at FROM sightings WHERE case_id = $1 ORDER BY created_at DESC LIMIT 30`, [c.id]);
  if (!rows.length) return { text: 'Todavía no hay pistas. Si ves algo, reporta un avistamiento.', source: 'reglas', count: 0 };
  const last = rows[0];
  const mins = Math.max(1, Math.round((Date.now() - new Date(last.created_at).getTime()) / 60000));
  const ago = mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`;
  const stay = last.still_there === 'yes' ? 'y quien lo vio dice que seguía allí' : last.still_there === 'no' ? 'pero ya no estaba allí' : 'sin saber si seguía allí';
  const rules = `Hay ${rows.length} ${rows.length === 1 ? 'pista' : 'pistas'}. La más reciente fue hace ${ago}, cerca de ${last.place}, ${stay}.`;
  if (aiEnabled()) {
    const fresh = c.ai_summary && c.ai_summary_n === rows.length;
    const recent = c.ai_summary && c.ai_summary_at && Date.now() - new Date(c.ai_summary_at).getTime() < 3 * 60_000;
    if (fresh || recent) return { text: c.ai_summary, source: 'ia', count: rows.length };
    const text = await summarizeSightings(c, rows);
    if (text) {
      await query('UPDATE cases SET ai_summary = $2, ai_summary_at = now(), ai_summary_n = $3 WHERE id = $1', [c.id, text, rows.length]);
      return { text, source: 'ia', count: rows.length };
    }
  }
  return { text: rules, source: 'reglas', count: rows.length };
}, { auth: true, limit: [60, 60_000, 'summary'] });

// ---------- Asistente de ayuda ----------
const STOP = new Set('de la el en un una que como hago puedo mi se es por para con los las y a o lo al del si me te tu su sus mis donde cual cuando quiero necesito hay'.split(' '));
const norm = (s) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const tokens = (s) => norm(s).split(/[^a-z0-9]+/).filter((t) => t.length >= 3 && !STOP.has(t)).map((t) => t.slice(0, 5));

function searchFaqs(question) {
  const qt = new Set(tokens(question));
  if (!qt.size) return [];
  return FAQS.map((f) => {
    const head = new Set(tokens(f.q)), body = new Set(tokens(f.a));
    let score = 0;
    for (const t of qt) { if (head.has(t)) score += 2; else if (body.has(t)) score += 1; }
    return { f, score };
  }).filter((x) => x.score >= 2).sort((a, b) => b.score - a.score).slice(0, 2).map((x) => x.f);
}
const EMERGENCY = /\b(emergencia|peligro|secuestr\w*|agred\w*|violen\w*|amenaz\w*|herid[oa]|accidente|urgente)\b/i;

add('POST', '/api/assistant', async ({ user, body }) => {
  const l = hit(`assistant:${user.id}`, 30, 3600_000);   // por usuario (no por IP: en una red compartida hay mucha gente)
  if (!l.ok) throw new HttpError(429, 'Hiciste muchas preguntas seguidas. Intenta de nuevo en un rato.', { retryAfter: l.retryAfter });
  const message = v.str(body.message, { min: 2, max: 400, field: 'La pregunta' });
  if (EMERGENCY.test(message)) {
    return { source: 'emergencia', answer: 'Si hay una persona en peligro o una emergencia, llama de inmediato a la Policía Nacional (105). Siempre Cerca no reemplaza a los servicios de emergencia. Después, crea o actualiza la alerta para que la comunidad ayude.', suggestions: [] };
  }
  const found = searchFaqs(message);
  if (aiEnabled()) {
    const answer = await assistantReply(message, found.length ? found : FAQS);
    if (answer) return { source: 'ia', answer, suggestions: [] };
  }
  if (found.length) return { source: 'faq', answer: found[0].a, suggestions: found.slice(1).map((f) => f.q) };
  return { source: 'faq', answer: 'No encontré una respuesta a eso. Prueba con otras palabras, por ejemplo: crear alerta, avistamiento, unirme a una búsqueda o cambiar mi número.', suggestions: FAQS.slice(0, 3).map((f) => f.q) };
}, { auth: true });
