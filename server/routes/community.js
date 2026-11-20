// Avistamientos, equipos de búsqueda, notificaciones y perfil.
import { add, bad, forbidden, notFound } from '../lib/http.js';
import { query } from '../lib/db.js';
import { newId } from '../lib/security.js';
import * as v from '../lib/validate.js';
import { sightingOut, notificationOut, sessionUser } from '../lib/mappers.js';
import { pushNotification, caseLink } from '../lib/notify.js';
import { queueEmail, esc } from '../lib/mailer.js';

// Marca actividad en la alerta (evita que se archive por inactividad)
const touchCase = (id) => query('UPDATE cases SET last_activity_at = now(), archive_warned = FALSE WHERE id = $1', [id]);

/**
 * Avisa a todos los voluntarios del caso (menos al dueño y a quien reportó) de una nueva pista:
 * siempre dentro de la app; por correo como máximo uno cada 15 minutos por caso (evita llenar la bandeja).
 * No se comparten datos de quien reportó ni la nota privada de la pista.
 */
async function notifyVolunteers(c, reporterId, place) {
  const { rows } = await query(
    `SELECT u.id, u.name, u.email, u.notify_email,
            EXISTS (SELECT 1 FROM notifications n WHERE n.user_id = u.id AND n.case_id = $1 AND n.type = 'sighting'
                      AND n.created_at > now() - interval '15 minutes') AS recent
     FROM participations p JOIN users u ON u.id = p.user_id
     WHERE p.case_id = $1 AND u.status = 'active' AND u.id <> $2 AND u.id <> $3 LIMIT 100`, [c.id, reporterId, c.owner_id]);
  for (const h of rows) {
    await pushNotification({ query }, { userId: h.id, type: 'sighting', caseId: c.id,
      title: `Nueva pista sobre ${c.name}`, body: `Alguien creyó verlo cerca de ${place}. Revisa el mapa de calor y tu cuadrante.` });
    if (h.notify_email && !h.recent) {
      await queueEmail({ to: h.email, name: h.name, subject: `Nueva pista sobre ${c.name}`, title: 'Hay una nueva pista',
        lines: [`Un vecino reportó un avistamiento de <b>${esc(c.name)}</b> cerca de <b>${esc(place)}</b>.`, 'Entra para ver la zona sugerida y ayudar a la búsqueda.'],
        cta: { label: 'Ver alerta', url: caseLink(c.id) } });
    }
  }
}

const SIGHT_COLS = `s.*, c.name AS case_name, c.thumb AS case_thumb`;

// ---------- Avistamientos ----------
add('POST', '/api/cases/:id/sightings', async ({ user, params, body }) => {
  const { rows: [c] } = await query('SELECT id, owner_id, name, status FROM cases WHERE id = $1', [params.id]);
  if (!c || c.status !== 'active') throw notFound('La alerta no está activa.');
  const place = v.str(body.where, { min: 3, max: 160, field: 'El lugar' });
  const note = v.str(body.note, { max: 500, field: 'La nota' });
  const photo = v.image(body.photo, 500_000) || null;
  const { lat, lng } = v.coords(body.lat, body.lng);
  const stillThere = v.oneOf(body.stillThere || 'yes', ['yes', 'no', 'unsure', 'unknown'], 'La opción');
  const { rows: [{ n }] } = await query(`SELECT count(*)::int AS n FROM sightings WHERE reporter_id=$1 AND created_at > now() - interval '1 hour'`, [user.id]);
  if (n >= 10) throw bad('Enviaste muchos avistamientos seguidos. Intenta de nuevo en un rato.');
  const id = newId('sigt');
  await query(`INSERT INTO sightings (id, case_id, reporter_id, place, note, photo, lat, lng, still_there) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [id, c.id, user.id, place, note, photo, lat, lng, stillThere]);
  await touchCase(c.id);
  await notifyVolunteers(c, user.id, place);
  if (c.owner_id !== user.id) {
    await pushNotification({ query }, { userId: c.owner_id, type: 'sighting', caseId: c.id,
      title: `Posible pista sobre ${c.name}`, body: `Un vecino envió un avistamiento cerca de ${place}.` });
    const { rows: [o] } = await query('SELECT name, email, notify_email FROM users WHERE id=$1', [c.owner_id]);
    if (o?.notify_email) await queueEmail({ to: o.email, name: o.name, subject: `Nueva pista sobre ${c.name}`, title: 'Alguien vio a ' + c.name,
      lines: [`Un vecino reportó un avistamiento cerca de <b>${esc(place)}</b>.`, note ? `<i>"${esc(note)}"</i>` : '', 'Revisa el detalle y coordina la búsqueda.'].filter(Boolean),
      cta: { label: 'Ver alerta', url: caseLink(c.id) } });
  }
  const { rows: [s] } = await query(`SELECT ${SIGHT_COLS} FROM sightings s JOIN cases c ON c.id = s.case_id WHERE s.id = $1`, [id]);
  return sightingOut(s);
}, { auth: true });

add('GET', '/api/sightings/mine', async ({ user }) => {
  const { rows } = await query(`SELECT ${SIGHT_COLS} FROM sightings s JOIN cases c ON c.id = s.case_id WHERE s.reporter_id=$1 ORDER BY s.created_at DESC LIMIT 100`, [user.id]);
  return rows.map((s) => sightingOut(s));
}, { auth: true });

// Pistas de una alerta: solo las ve el dueño de la alerta o el equipo
add('GET', '/api/cases/:id/sightings', async ({ user, params }) => {
  const { rows: [c] } = await query('SELECT owner_id FROM cases WHERE id=$1', [params.id]);
  if (!c) throw notFound('Alerta no encontrada');
  if (c.owner_id !== user.id && !['moderator', 'admin'].includes(user.role)) throw forbidden();
  const { rows } = await query(`SELECT ${SIGHT_COLS} FROM sightings s JOIN cases c ON c.id = s.case_id WHERE s.case_id=$1 ORDER BY s.created_at DESC LIMIT 100`, [params.id]);
  return rows.map((s) => sightingOut(s));
}, { auth: true });

// ---------- Búsqueda en equipo ----------
const partOut = (p) => ({ _id: p.id, caseId: p.case_id, userId: p.user_id, userName: p.user_name, zone: p.zone, inspected: p.inspected, joinedAt: new Date(p.joined_at).toISOString() });
const ZONES = ['A1', 'A2', 'B1', 'B2'];

async function ensureParticipation(user, caseId, zone) {
  const { rows: [c] } = await query('SELECT status FROM cases WHERE id=$1', [caseId]);
  if (!c || c.status !== 'active') throw notFound('La alerta no está activa.');
  const z = zone ? v.oneOf(zone, ZONES, 'La zona') : null;
  // Al unirse se elige cuadrante; si ya estaba unido y elige otro, se cambia (y se desmarca como inspeccionado)
  await query(
    `INSERT INTO participations (id, case_id, user_id, zone) VALUES ($1,$2,$3,$4)
     ON CONFLICT (case_id, user_id) DO UPDATE SET
       inspected = CASE WHEN $5::text IS NOT NULL AND participations.zone <> $5 THEN FALSE ELSE participations.inspected END,
       zone = COALESCE($5, participations.zone)`,
    [newId('part'), caseId, user.id, z || 'A2', z]);
  await touchCase(caseId);
  const { rows: [p] } = await query(`SELECT p.*, $2::text AS user_name FROM participations p WHERE case_id=$1 AND user_id=$3`, [caseId, user.name, user.id]);
  return p;
}
add('POST', '/api/cases/:id/join', async ({ user, params, body }) => partOut(await ensureParticipation(user, params.id, body.zone)), { auth: true });

add('POST', '/api/cases/:id/inspect', async ({ user, params, body }) => {
  const p = await ensureParticipation(user, params.id, body.zone);
  const { rows: [u] } = await query(`UPDATE participations SET inspected = NOT inspected WHERE id=$1 RETURNING *`, [p.id]);
  return partOut({ ...u, user_name: user.name });
}, { auth: true });

add('GET', '/api/searches/mine', async ({ user }) => {
  const { rows } = await query(
    `SELECT p.*, $2::text AS user_name, c.name AS case_name, c.type AS case_type, c.thumb AS case_thumb, c.status AS case_status,
       c.last_seen_text, c.resolved_at,
       (SELECT count(*)::int FROM participations x WHERE x.case_id = c.id) AS volunteers
     FROM participations p JOIN cases c ON c.id = p.case_id
     WHERE p.user_id = $1 AND c.status IN ('active','resolved') ORDER BY p.joined_at DESC LIMIT 100`, [user.id, user.name]);
  return rows.map((r) => ({ ...partOut(r), case: {
    name: r.case_name, type: r.case_type, thumb: r.case_thumb || '', status: r.case_status, lastSeenText: r.last_seen_text,
    volunteers: r.volunteers, resolvedAt: r.resolved_at ? new Date(r.resolved_at).toISOString() : null } }));
}, { auth: true });

// Voluntarios: solo nombre de pila e inicial del apellido (privacidad)
add('GET', '/api/cases/:id/volunteers', async ({ params }) => {
  const { rows } = await query(`SELECT p.zone, u.name FROM participations p JOIN users u ON u.id=p.user_id WHERE p.case_id=$1 ORDER BY p.joined_at LIMIT 100`, [params.id]);
  const colors = ['sage', 'ochre', 'beige'];
  return rows.map((r, i) => {
    const [first, last] = r.name.split(/\s+/);
    return { initials: (first[0] + (last?.[0] || first[1] || '')).toUpperCase(), name: last ? `${first} ${last[0]}.` : first, area: `Cuadrante ${r.zone}`, color: colors[i % 3] };
  });
}, { auth: true });

// ---------- Notificaciones ----------
add('GET', '/api/notifications', async ({ user }) => {
  const { rows } = await query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100', [user.id]);
  return rows.map(notificationOut);
}, { auth: true });
add('POST', '/api/notifications/read-all', async ({ user }) => { await query('UPDATE notifications SET read=TRUE WHERE user_id=$1', [user.id]); return { ok: true }; }, { auth: true });
add('POST', '/api/notifications/:id/read', async ({ user, params }) => { await query('UPDATE notifications SET read=TRUE WHERE id=$1 AND user_id=$2', [params.id, user.id]); return { ok: true }; }, { auth: true });

// ---------- Perfil y ajustes ----------
add('PATCH', '/api/me', async ({ user, body }) => {
  const name = v.str(body.name, { min: 2, max: 60, field: 'El nombre' });
  const username = v.username(body.username);
  try { await query('UPDATE users SET name=$2, username=$3 WHERE id=$1', [user.id, name, username]); }
  catch (e) { if (e.code === '23505') throw Object.assign(new Error('Ese nombre de usuario ya está en uso.'), { status: 409 }); throw e; }
  return sessionUser({ ...user, name, username });
}, { auth: true });

const settingsOut = (u) => ({ radiusKm: u.radius_km, notifications: u.notify_email, location: u.share_location });
add('GET', '/api/me/settings', async ({ user }) => settingsOut(user), { auth: true });
add('PATCH', '/api/me/settings', async ({ user, body }) => {
  const radius = body.radiusKm === undefined ? user.radius_km : Math.round(v.num(body.radiusKm, 1, 50, 'El radio'));
  const notif = body.notifications === undefined ? user.notify_email : Boolean(body.notifications);
  const loc = body.location === undefined ? user.share_location : Boolean(body.location);
  const { rows: [u] } = await query(
    `UPDATE users SET radius_km=$2, notify_email=$3, share_location=$4,
       home_lat = CASE WHEN $4 THEN home_lat END, home_lng = CASE WHEN $4 THEN home_lng END WHERE id=$1 RETURNING *`,
    [user.id, radius, notif, loc]);
  return settingsOut(u);
}, { auth: true });

// Zona base del usuario: sirve para avisarle de alertas cercanas por correo aunque no tenga la web abierta
add('POST', '/api/me/location', async ({ user, body }) => {
  if (!user.share_location) return { ok: false };
  const { lat, lng } = v.coords(body.lat, body.lng);
  // Se redondea (~1 km) para no guardar la ubicación exacta de la persona
  await query('UPDATE users SET home_lat=$2, home_lng=$3 WHERE id=$1', [user.id, Math.round(lat * 100) / 100, Math.round(lng * 100) / 100]);
  return { ok: true };
}, { auth: true, limit: [30, 3600_000, 'loc'] });
