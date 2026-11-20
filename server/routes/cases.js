import { add, bad, forbidden, notFound, conflict, HttpError } from '../lib/http.js';
import { query, tx } from '../lib/db.js';
import { newId, hit } from '../lib/security.js';
import * as v from '../lib/validate.js';
import { caseOut } from '../lib/mappers.js';
import { pushNotification, alertNeighbors, caseLink } from '../lib/notify.js';
import { queueEmail, esc } from '../lib/mailer.js';
import { evaluateCase, reasonsText } from '../lib/risk.js';
import { trustLevel, DAILY_CASE_LIMIT, adjustReputation, REP } from '../lib/reputation.js';

// Columnas del listado (sin la foto grande: solo miniatura, para que el mapa cargue rápido)
const LIST_COLS = `c.id, c.folio, c.owner_id, c.type, c.name, c.breed_or_age, c.description, c.thumb, c.lat, c.lng,
  c.last_seen_text, c.last_seen_at, c.contact_phone, c.relation, c.status, c.rejection_reason,
  c.created_at, c.updated_at, c.approved_at, c.resolved_at, c.is_demo, c.risk_score, c.risk_reasons, c.risk_source,
  c.last_activity_at, c.archived_at, u.name AS owner_name,
  (SELECT count(*) FROM participations p WHERE p.case_id = c.id) AS volunteers_count,
  (SELECT count(*) FROM participations p WHERE p.case_id = c.id AND p.inspected) AS zones_checked`;
const FULL_COLS = LIST_COLS.replace('c.thumb,', 'c.thumb, c.photo,');
const FROM = 'FROM cases c JOIN users u ON u.id = c.owner_id';
const likeEscape = (s) => s.replace(/[\\%_]/g, (m) => `\\${m}`);

// Distancia en km (fórmula de Haversine) entre el punto ($1,$2) y el caso
const DIST = (a, b) => `(6371 * 2 * asin(sqrt(power(sin(radians(c.lat - $${a}) / 2), 2) +
  cos(radians($${a})) * cos(radians(c.lat)) * power(sin(radians(c.lng - $${b}) / 2), 2))))`;

// Mapa: alertas activas y las resueltas en los últimos 14 días
add('GET', '/api/cases', async ({ user, query: q }) => {
  const params = []; const where = [`(c.status = 'active' OR (c.status = 'resolved' AND c.resolved_at > now() - interval '14 days'))`];
  let distSql = 'NULL::float8';
  const hasPos = q.lat !== undefined && q.lng !== undefined && q.lat !== '' && q.lng !== '';
  if (hasPos) {
    const lat = v.num(q.lat, -90, 90, 'Latitud'), lng = v.num(q.lng, -180, 180, 'Longitud');
    params.push(lat, lng); distSql = DIST(1, 2);
    const r = q.radiusKm === undefined ? 10 : v.num(q.radiusKm, 0, 500, 'Radio');
    if (r > 0) { params.push(r); where.push(`${distSql} <= $${params.length}`); }
  }
  if (q.type && q.type !== 'all') { params.push(v.oneOf(q.type, ['person', 'pet'], 'Tipo')); where.push(`c.type = $${params.length}`); }
  if (q.q && q.q.trim()) {
    params.push(`%${likeEscape(q.q.trim().slice(0, 60).toLowerCase())}%`);
    const p = `$${params.length}`;
    where.push(`(lower(c.name) LIKE ${p} OR lower(c.description) LIKE ${p} OR lower(c.breed_or_age) LIKE ${p} OR lower(c.last_seen_text) LIKE ${p})`);
  }
  const { rows } = await query(
    `SELECT ${LIST_COLS}, ${distSql} AS distance_km ${FROM} WHERE ${where.join(' AND ')}
     ORDER BY ${hasPos ? 'distance_km ASC,' : ''} c.created_at DESC LIMIT 300`, params);
  return rows.map((c) => caseOut(c, { viewer: user }));
}, { auth: true });

add('GET', '/api/cases/mine', async ({ user }) => {
  const { rows } = await query(`SELECT ${LIST_COLS} ${FROM} WHERE c.owner_id = $1 ORDER BY c.created_at DESC`, [user.id]);
  return rows.map((c) => caseOut(c, { viewer: user }));
}, { auth: true });

add('GET', '/api/cases/:id', async ({ user, params }) => {
  const { rows } = await query(`SELECT ${FULL_COLS} ${FROM} WHERE c.id = $1`, [params.id]);
  const c = rows[0];
  if (!c) throw notFound('Alerta no encontrada');
  const staff = ['moderator', 'admin'].includes(user.role);
  // Las alertas rechazadas o en revisión solo las ve su dueño o el equipo
  if (!['active', 'resolved'].includes(c.status) && c.owner_id !== user.id && !staff) throw notFound('Alerta no encontrada');
  return caseOut(c, { viewer: user, withPhoto: true });
}, { auth: true });

add('POST', '/api/cases', async ({ user, body }) => {
  const type = v.oneOf(body.type, ['person', 'pet'], 'El tipo de alerta');
  const name = v.str(body.name, { min: 2, max: 60, field: 'El nombre' });
  const breedOrAge = v.str(body.breedOrAge, { max: 80, field: 'La raza o edad' });
  const description = v.str(body.description, { max: 800, field: 'La descripción' });
  const lastSeenText = v.str(body.lastSeenText, { min: 3, max: 160, field: 'La referencia del lugar' });
  const { lat, lng } = v.coords(body.lat, body.lng);
  const lastSeenAt = v.dateIso(body.lastSeenAt, 'La fecha en que se vio por última vez');
  const photo = v.image(body.photo, 500_000);
  let thumb = v.image(body.thumb, 80_000, 'La miniatura');
  if (!thumb && photo && photo.length < 80_000 * 1.37) thumb = photo;
  const relation = v.oneOf(body.relation || 'owner', ['owner', 'family', 'friend', 'witness', 'other'], 'El parentesco');
  const contactPhone = v.str(body.contactPhone || '', { max: 30, field: 'El teléfono' }).replace(/[^\d+ ]/g, '') || `+51 ${user.phone}`;

  // --- Reglas de aprobación automática ---
  const limits = hit(`newcase:${user.id}`, 1, 60_000);
  if (!limits.ok) throw new HttpError(429, 'Espera un minuto antes de crear otra alerta.', { retryAfter: limits.retryAfter });
  const { rows: recent } = await query(
    `SELECT count(*)::int AS n, count(*) FILTER (WHERE lower(name) = lower($2) AND type = $3 AND created_at > now() - interval '7 days'
        AND status IN ('active','pending_review')) AS dup
     FROM cases WHERE owner_id = $1 AND created_at > now() - interval '24 hours'`, [user.id, name, type]);
  const level = trustLevel(user.reputation);
  const dailyMax = DAILY_CASE_LIMIT[level];
  if (recent[0].n >= dailyMax) throw new HttpError(429, `Alcanzaste el límite de ${dailyMax} ${dailyMax === 1 ? 'alerta' : 'alertas'} por día. Si necesitas más, contacta al equipo.`);
  const { rows: dup } = await query(
    `SELECT 1 FROM cases WHERE owner_id = $1 AND lower(name) = lower($2) AND type = $3 AND status IN ('active','pending_review')
       AND created_at > now() - interval '7 days'`, [user.id, name, type]);
  if (dup.length) throw conflict(`Ya tienes una alerta activa para ${name}.`);

  // --- Revisión automática: puntaje de riesgo (reglas + IA opcional) ---
  const [{ rows: [rej] }, { rows: [near] }] = await Promise.all([
    query(`SELECT count(*)::int AS n FROM cases WHERE owner_id = $1 AND status = 'rejected' AND created_at > now() - interval '30 days'`, [user.id]),
    query(`SELECT count(*)::int AS n FROM cases WHERE owner_id <> $1 AND type = $2 AND lower(name) = lower($3)
             AND status IN ('active','pending_review') AND created_at > now() - interval '7 days'
             AND abs(lat - $4) < 0.01 AND abs(lng - $5) < 0.01`, [user.id, type, name, lat, lng]),
  ]);
  const risk = await evaluateCase(
    { type, name, breedOrAge, description, lastSeenText, relation, hasPhoto: Boolean(photo), lat, lng, lastSeenAt,
      aiPhoto: thumb || (photo && photo.length < 110_000 ? photo : '') },
    { reputation: user.reputation, accountAgeMin: (Date.now() - new Date(user.created_at).getTime()) / 60000,
      recentRejected: rej.n, nearDuplicates: near.n });
  const status = risk.decision === 'publish' ? 'active' : risk.decision === 'review' ? 'pending_review' : 'rejected';
  const rejectionReason = status === 'rejected'
    ? `No pudimos publicar tu alerta: ${reasonsText(risk.reasons).slice(0, 2).join('; ') || 'no cumple las normas de la comunidad'}. Corrige el texto y vuelve a intentarlo, o escribe al equipo si crees que es un error.`
    : null;

  const id = newId('case');
  const created = await tx(async (db) => {
    const { rows: [{ n }] } = await db.query(`SELECT nextval('case_folio_seq') AS n`);
    const folio = `SC-${String(n).padStart(4, '0')}`;
    const { rows: [c] } = await db.query(
      `INSERT INTO cases (id, folio, owner_id, type, name, breed_or_age, description, photo, thumb, lat, lng,
         last_seen_text, last_seen_at, contact_phone, relation, status, approved_at, rejection_reason,
         risk_score, risk_reasons, risk_source)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16, CASE WHEN $16 = 'active' THEN now() END, $17,
         $18, $19::jsonb, $20)
       RETURNING *`,
      [id, folio, user.id, type, name, breedOrAge, description, photo, thumb, lat, lng, lastSeenText, lastSeenAt,
        contactPhone, relation, status, rejectionReason, risk.score, JSON.stringify(risk.reasons), risk.source]);
    if (status === 'active') {
      await pushNotification(db, { userId: user.id, type: 'nearby', caseId: id,
        title: `¡Tu alerta de ${name} ya está publicada!`,
        body: `La alerta ${folio} ya es visible en el mapa y avisamos a los vecinos cercanos.` });
      c.neighbors = await alertNeighbors(db, c);
    } else if (status === 'pending_review') {
      await pushNotification(db, { userId: user.id, type: 'review', caseId: id,
        title: 'Tu alerta está en revisión',
        body: `Por seguridad, el equipo revisará ${folio} antes de publicarla. Suele tardar poco.` });
    } else {
      await adjustReputation(db, user.id, REP.REJECTED);
      await pushNotification(db, { userId: user.id, type: 'review', caseId: id,
        title: `Tu alerta de ${name} no fue publicada`, body: rejectionReason });
    }
    return c;
  });
  return { ...caseOut({ ...created, owner_name: user.name }, { viewer: user, withPhoto: true }),
    autoApproved: status === 'active', autoRejected: status === 'rejected' };
}, { auth: true });

// El dueño (o el equipo) marca la alerta como encontrada
add('POST', '/api/cases/:id/resolve', async ({ user, params, body }) => {
  const note = v.str(body.note, { max: 300, field: 'La nota' });
  const { rows } = await query('SELECT * FROM cases WHERE id = $1', [params.id]);
  const c = rows[0];
  if (!c) throw notFound('Alerta no encontrada');
  const staff = ['moderator', 'admin'].includes(user.role);
  if (c.owner_id !== user.id && !staff) throw forbidden('Solo quien creó la alerta puede marcarla como encontrada.');
  if (c.status === 'resolved') throw bad('Esta alerta ya fue marcada como encontrada.');
  if (c.status === 'rejected') throw bad('Esta alerta fue rechazada.');
  await tx(async (db) => {
    await db.query(`UPDATE cases SET status='resolved', resolved_at=now(), updated_at=now(), resolution_note=$2 WHERE id=$1`, [c.id, note || null]);
    // Avisa a quienes ayudaron (voluntarios y quienes reportaron avistamientos)
    const { rows: helpers } = await db.query(
      `SELECT DISTINCT u.id, u.name, u.email, u.notify_email FROM users u
       WHERE u.status = 'active' AND u.id <> $2 AND u.id IN (
         SELECT user_id FROM participations WHERE case_id = $1 UNION SELECT reporter_id FROM sightings WHERE case_id = $1) LIMIT 100`,
      [c.id, c.owner_id]);
    for (const h of helpers) {
      await pushNotification(db, { userId: h.id, type: 'resolved', caseId: c.id,
        title: `¡${c.name} fue encontrado!`, body: 'Gracias por ayudar. La comunidad volvió a hacerlo posible.' });
      if (h.notify_email) await queueEmail({ db, to: h.email, name: h.name, subject: `¡${c.name} fue encontrado!`,
        title: '¡Final feliz!', lines: [`La alerta de <b>${esc(c.name)}</b> se cerró: ya fue encontrado.`, 'Gracias por haber ayudado en la búsqueda.'],
        cta: { label: 'Ver alerta', url: caseLink(c.id) } });
    }
    if (!c.is_demo) await adjustReputation(db, c.owner_id, REP.RESOLVED);
    await pushNotification(db, { userId: c.owner_id, type: 'resolved', caseId: c.id,
      title: `¡${c.name} está de vuelta en casa!`, body: 'Marcaste la alerta como encontrada. Gracias por usar Siempre Cerca.' });
  });
  const { rows: [out] } = await query(`SELECT ${FULL_COLS} ${FROM} WHERE c.id = $1`, [c.id]);
  return caseOut(out, { viewer: user, withPhoto: true });
}, { auth: true });

// El dueño mantiene viva su alerta (o la reactiva si fue archivada por inactividad)
add('POST', '/api/cases/:id/renew', async ({ user, params }) => {
  const { rows: [c] } = await query('SELECT id, owner_id, status, name FROM cases WHERE id = $1', [params.id]);
  if (!c || c.owner_id !== user.id) throw notFound('Alerta no encontrada');
  if (!['active', 'archived'].includes(c.status)) throw bad('Esta alerta no se puede renovar.');
  await query(`UPDATE cases SET status='active', archived_at=NULL, archive_warned=FALSE, last_activity_at=now(), updated_at=now() WHERE id=$1`, [c.id]);
  const { rows: [out] } = await query(`SELECT ${FULL_COLS} ${FROM} WHERE c.id = $1`, [c.id]);
  return caseOut(out, { viewer: user, withPhoto: true });
}, { auth: true, limit: [10, 3600_000, 'renew'] });

// Denunciar una alerta falsa o inapropiada. Con 3 denuncias distintas se oculta hasta que el equipo la revise.
add('POST', '/api/cases/:id/report', async ({ user, params, body }) => {
  const reason = v.str(body.reason, { max: 200, field: 'El motivo' });
  const { rows } = await query(`SELECT id, owner_id, name, folio, status FROM cases WHERE id = $1`, [params.id]);
  const c = rows[0];
  if (!c || c.status !== 'active') throw notFound('Alerta no encontrada');
  if (c.owner_id === user.id) throw bad('No puedes denunciar tu propia alerta.');
  await query(`INSERT INTO case_reports (case_id, user_id, reason) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING`, [c.id, user.id, reason]);
  const { rows: [{ n }] } = await query('SELECT count(*)::int AS n FROM case_reports WHERE case_id = $1', [c.id]);
  if (n >= 3) {
    await query(`UPDATE cases SET status='pending_review', updated_at=now() WHERE id=$1 AND status='active'`, [c.id]);
    await adjustReputation({ query }, c.owner_id, REP.REPORTED);
    await pushNotification({ query }, { userId: c.owner_id, type: 'review', caseId: c.id, title: 'Tu alerta está en revisión',
      body: `Varios vecinos reportaron ${c.folio}. El equipo la revisará.` });
  }
  return { ok: true };
}, { auth: true, limit: [20, 3600_000, 'report'] });

// Pantalla "Comunidad": cifras reales del mes, búsquedas activas cercanas y reencuentros recientes
add('GET', '/api/community', async ({ user, query: q }) => {
  const hasPos = q.lat !== undefined && q.lng !== undefined && q.lat !== '' && q.lng !== '';
  const params = []; let dist = 'NULL::float8';
  if (hasPos) { params.push(v.num(q.lat, -90, 90, 'Latitud'), v.num(q.lng, -180, 180, 'Longitud')); dist = DIST(1, 2); }
  const [stats, active, reunions] = await Promise.all([
    query(`SELECT
      (SELECT count(*)::int FROM cases WHERE status='resolved' AND resolved_at >= date_trunc('month', now())) AS resolved_month,
      (SELECT count(DISTINCT user_id)::int FROM participations WHERE joined_at > now() - interval '30 days') AS volunteers,
      (SELECT round(avg(extract(epoch FROM (fs.first - c.created_at)) / 60))::int FROM cases c
         JOIN (SELECT case_id, min(created_at) AS first FROM sightings GROUP BY case_id) fs ON fs.case_id = c.id
         WHERE c.created_at > now() - interval '30 days') AS first_clue_min,
      (SELECT count(*)::int FROM cases WHERE status='active') AS active_total`),
    query(`SELECT ${LIST_COLS}, ${dist} AS distance_km ${FROM} WHERE c.status = 'active'
           ORDER BY ${hasPos ? 'distance_km ASC,' : ''} c.created_at DESC LIMIT 5`, params),
    query(`SELECT c.id, c.type, c.name, c.thumb, c.resolved_at,
             (SELECT count(*)::int FROM (SELECT user_id FROM participations WHERE case_id = c.id
                UNION SELECT reporter_id FROM sightings WHERE case_id = c.id) h) AS helpers
           FROM cases c WHERE c.status = 'resolved' AND c.resolved_at > now() - interval '14 days'
           ORDER BY c.resolved_at DESC LIMIT 10`),
  ]);
  const s = stats.rows[0];
  return {
    month: { resolved: s.resolved_month, volunteers: s.volunteers, firstClueMinutes: s.first_clue_min, activeTotal: s.active_total },
    active: active.rows.map((c) => caseOut(c, { viewer: user })),
    reunions: reunions.rows.map((r) => ({ _id: r.id, type: r.type, name: r.name, thumb: r.thumb || '', helpers: r.helpers, resolvedAt: new Date(r.resolved_at).toISOString() })),
  };
}, { auth: true });
