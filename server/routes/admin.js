import { add, bad, notFound, forbidden } from '../lib/http.js';
import { query, tx } from '../lib/db.js';
import * as v from '../lib/validate.js';
import { caseOut, sightingOut, adminUserOut, auditOut } from '../lib/mappers.js';
import { pushNotification, alertNeighbors } from '../lib/notify.js';
import { audit } from '../lib/audit.js';
import { adjustReputation, REP } from '../lib/reputation.js';
import { aiStatus, aiCallsToday } from '../lib/ai.js';
import { ENV } from '../lib/env.js';

const ST = { auth: 'staff' };
const like = (s) => `%${String(s || '').trim().slice(0, 60).toLowerCase().replace(/[\\%_]/g, (m) => `\\${m}`)}%`;
const label = (c) => `${c.name} (${c.folio})`;
// Sin la foto grande (solo miniatura) para que la lista cargue rápido; la foto completa se pide al abrir el detalle
const CASE_ADMIN = `SELECT c.id, c.folio, c.owner_id, c.type, c.name, c.breed_or_age, c.description, c.thumb, c.lat, c.lng,
  c.last_seen_text, c.last_seen_at, c.contact_phone, c.relation, c.status, c.rejection_reason,
  c.created_at, c.updated_at, c.approved_at, c.resolved_at, c.is_demo, c.risk_score, c.risk_reasons, c.risk_source,
  c.last_activity_at, c.archived_at, u.name AS owner_name,
  (SELECT count(*) FROM participations p WHERE p.case_id=c.id) AS volunteers_count,
  (SELECT count(*) FROM case_reports r WHERE r.case_id=c.id) AS reports FROM cases c JOIN users u ON u.id=c.owner_id`;

add('GET', '/api/admin/stats', async () => {
  const { rows: [r] } = await query(`SELECT
    (SELECT count(*) FROM users)::int AS users, (SELECT count(*) FROM users WHERE status='banned')::int AS banned,
    count(*)::int AS total,
    count(*) FILTER (WHERE status='active')::int AS active, count(*) FILTER (WHERE status='pending_review')::int AS pending,
    count(*) FILTER (WHERE status='resolved')::int AS resolved, count(*) FILTER (WHERE status='rejected')::int AS rejected,
    count(*) FILTER (WHERE status='archived')::int AS archived,
    count(*) FILTER (WHERE status='rejected' AND risk_score IS NOT NULL)::int AS auto_rejected,
    count(*) FILTER (WHERE risk_score IS NOT NULL)::int AS auto_checked,
    count(*) FILTER (WHERE type='person')::int AS persons, count(*) FILTER (WHERE type='pet')::int AS pets,
    (SELECT count(*) FROM sightings)::int AS sightings,
    (SELECT count(*) FROM sightings WHERE status='received')::int AS sightings_new FROM cases`);
  const { rows: days } = await query(`SELECT to_char(d, 'YYYY-MM-DD') AS date,
      (SELECT count(*) FROM cases c WHERE c.created_at >= d AND c.created_at < d + interval '1 day')::int AS count
    FROM generate_series(date_trunc('day', now()) - interval '6 days', date_trunc('day', now()), interval '1 day') d ORDER BY d`);
  const decided = r.active + r.resolved;
  return {
    users: { total: r.users, banned: r.banned },
    cases: { total: r.total, active: r.active, pending_review: r.pending, resolved: r.resolved, rejected: r.rejected, archived: r.archived },
    automation: { checked: r.auto_checked, autoRejected: r.auto_rejected, ai: { ...aiStatus(), callsToday: await aiCallsToday().catch(() => 0), dailyLimit: ENV.aiDailyLimit },
      sms: Boolean(ENV.twilioSid && ENV.twilioToken && ENV.twilioVerifySid), email: Boolean(ENV.brevoApiKey && ENV.mailFrom), archiveDays: ENV.archiveDays },
    byType: { person: r.persons, pet: r.pets },
    sightings: { total: r.sightings, received: r.sightings_new },
    resolutionRate: decided ? Math.round((r.resolved / decided) * 100) : 0,
    last7: days,
  };
}, ST);

add('GET', '/api/admin/cases', async ({ query: q }) => {
  const params = []; const where = [];
  if (q.status && q.status !== 'all') { params.push(v.oneOf(q.status, ['pending_review', 'active', 'resolved', 'rejected', 'archived'], 'Estado')); where.push(`c.status = $${params.length}`); }
  if (q.q?.trim()) { params.push(like(q.q)); where.push(`(lower(c.name) LIKE $${params.length} OR lower(c.folio) LIKE $${params.length} OR lower(u.name) LIKE $${params.length} OR lower(c.last_seen_text) LIKE $${params.length})`); }
  const { rows } = await query(`${CASE_ADMIN} ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY CASE c.status WHEN 'pending_review' THEN 0 WHEN 'active' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END,
      CASE WHEN c.status = 'pending_review' THEN c.risk_score END DESC NULLS LAST, c.created_at DESC LIMIT 300`, params);
  return rows.map((c) => ({ ...caseOut(c, { viewer: { id: '', role: 'admin' } }), reports: Number(c.reports) }));
}, ST);

add('PATCH', '/api/admin/cases/:id/review', async ({ user, params, body }) => {
  const decision = v.oneOf(body.decision, ['approve', 'reject'], 'La decisión');
  const reason = v.str(body.reason, { max: 200, field: 'El motivo' });
  return tx(async (db) => {
    const { rows: [c] } = await db.query('SELECT * FROM cases WHERE id=$1 FOR UPDATE', [params.id]);
    if (!c) throw notFound('Caso no encontrado');
    if (decision === 'approve') {
      const { rows: [u] } = await db.query(`UPDATE cases SET status='active', approved_at=now(), updated_at=now(), rejection_reason=NULL WHERE id=$1 RETURNING *`, [c.id]);
      await db.query('DELETE FROM case_reports WHERE case_id=$1', [c.id]);
      await pushNotification(db, { userId: c.owner_id, type: 'nearby', caseId: c.id, title: `¡Tu alerta de ${c.name} fue aprobada!`, body: `Tu alerta ${c.folio} ya es visible en el mapa para la comunidad.` });
      // Si el filtro automático la había rechazado por error, se revierte la penalización
      if (c.status === 'rejected') await adjustReputation(db, c.owner_id, -REP.REJECTED);
      if (['pending_review', 'rejected'].includes(c.status) && !c.approved_at) { await alertNeighbors(db, u); await adjustReputation(db, c.owner_id, REP.APPROVED_BY_TEAM); }
    } else {
      await db.query(`UPDATE cases SET status='rejected', rejection_reason=$2, updated_at=now() WHERE id=$1`, [c.id, reason || 'No cumple con las normas de la comunidad.']);
      if (c.status !== 'rejected') await adjustReputation(db, c.owner_id, REP.REJECTED);
      await pushNotification(db, { userId: c.owner_id, type: 'review', caseId: c.id, title: `Tu alerta de ${c.name} no fue aprobada`, body: reason || 'No cumple con las normas de la comunidad.' });
    }
    await audit(db, user, { action: decision === 'approve' ? 'case_approved' : 'case_rejected', targetType: 'case', targetId: c.id, targetLabel: label(c), detail: decision === 'reject' ? reason : '' });
    const { rows: [out] } = await db.query(`${CASE_ADMIN} WHERE c.id=$1`, [c.id]);
    return caseOut(out, { viewer: user });
  });
}, ST);

add('PATCH', '/api/admin/cases/:id/resolve', async ({ user, params }) => tx(async (db) => {
  const { rows: [c] } = await db.query(`UPDATE cases SET status='resolved', resolved_at=now(), updated_at=now() WHERE id=$1 RETURNING *`, [params.id]);
  if (!c) throw notFound('Caso no encontrado');
  await audit(db, user, { action: 'case_resolved', targetType: 'case', targetId: c.id, targetLabel: label(c) });
  return caseOut({ ...c, owner_name: '' }, { viewer: user });
}), ST);

add('DELETE', '/api/admin/cases/:id', async ({ user, params }) => tx(async (db) => {
  const { rows: [c] } = await db.query('DELETE FROM cases WHERE id=$1 RETURNING name, folio', [params.id]);
  if (!c) throw notFound('Caso no encontrado');
  await audit(db, user, { action: 'case_deleted', targetType: 'case', targetId: params.id, targetLabel: label(c) });
  return { ok: true };
}), ST);

add('GET', '/api/admin/users', async ({ query: q }) => {
  const params = []; const where = [];
  if (q.status && q.status !== 'all') { params.push(v.oneOf(q.status, ['active', 'banned'], 'Estado')); where.push(`u.status = $${params.length}`); }
  if (q.q?.trim()) { params.push(like(q.q)); const p = `$${params.length}`; where.push(`(lower(u.name) LIKE ${p} OR lower(u.username) LIKE ${p} OR lower(u.email) LIKE ${p} OR u.phone LIKE ${p})`); }
  const { rows } = await query(`SELECT u.*, (SELECT count(*) FROM cases c WHERE c.owner_id=u.id) AS cases_count,
    (SELECT count(*) FROM sightings s WHERE s.reporter_id=u.id) AS sightings_count FROM users u
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY u.created_at DESC LIMIT 300`, params);
  return rows.map(adminUserOut);
}, ST);

add('PATCH', '/api/admin/users/:id/status', async ({ user, params, body }) => {
  const status = v.oneOf(body.status, ['active', 'banned'], 'El estado');
  const reason = v.str(body.reason, { max: 200, field: 'El motivo' }) || 'Incumplimiento de las normas de la comunidad.';
  return tx(async (db) => {
    const { rows: [t] } = await db.query('SELECT * FROM users WHERE id=$1 FOR UPDATE', [params.id]);
    if (!t) throw notFound('Usuario no encontrado');
    if (t.id === user.id) throw bad('No puedes suspender tu propia cuenta.');
    if (['moderator', 'admin'].includes(t.role)) throw forbidden('No se puede suspender a otro miembro del equipo.');
    if (status === 'banned') {
      await db.query(`UPDATE users SET status='banned', ban_reason=$2, banned_at=now() WHERE id=$1`, [t.id, reason]);
      await db.query('DELETE FROM sessions WHERE user_id=$1', [t.id]); // lo saca de inmediato
      await db.query(`UPDATE cases SET status='rejected', rejection_reason='Cuenta suspendida.', updated_at=now() WHERE owner_id=$1 AND status IN ('active','pending_review')`, [t.id]);
    } else {
      await db.query(`UPDATE users SET status='active', ban_reason=NULL, banned_at=NULL WHERE id=$1`, [t.id]);
    }
    await audit(db, user, { action: status === 'banned' ? 'user_banned' : 'user_unbanned', targetType: 'user', targetId: t.id, targetLabel: `@${t.username}`, detail: status === 'banned' ? reason : '' });
    const { rows: [o] } = await db.query(`SELECT u.*, (SELECT count(*) FROM cases c WHERE c.owner_id=u.id) AS cases_count, (SELECT count(*) FROM sightings s WHERE s.reporter_id=u.id) AS sightings_count FROM users u WHERE u.id=$1`, [t.id]);
    return adminUserOut(o);
  });
}, ST);

add('GET', '/api/admin/sightings', async ({ query: q }) => {
  const params = []; const where = [];
  if (q.status && q.status !== 'all') { params.push(v.oneOf(q.status, ['received', 'confirmed', 'helped'], 'Estado')); where.push(`s.status = $${params.length}`); }
  if (q.q?.trim()) { params.push(like(q.q)); const p = `$${params.length}`; where.push(`(lower(c.name) LIKE ${p} OR lower(s.place) LIKE ${p} OR lower(s.note) LIKE ${p})`); }
  const { rows } = await query(`SELECT s.*, c.name AS case_name, c.thumb AS case_thumb, u.name AS reporter_name FROM sightings s
    JOIN cases c ON c.id=s.case_id JOIN users u ON u.id=s.reporter_id ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY s.created_at DESC LIMIT 300`, params);
  return rows.map((s) => sightingOut(s, { admin: true }));
}, ST);

add('PATCH', '/api/admin/sightings/:id/status', async ({ user, params, body }) => {
  const status = v.oneOf(body.status, ['received', 'confirmed', 'helped'], 'El estado');
  return tx(async (db) => {
    const { rows: [s] } = await db.query(`UPDATE sightings SET status=$2 WHERE id=$1 RETURNING *`, [params.id, status]);
    if (!s) throw notFound('Avistamiento no encontrado');
    const { rows: [c] } = await db.query('SELECT name FROM cases WHERE id=$1', [s.case_id]);
    await audit(db, user, { action: 'sighting_status', targetType: 'sighting', targetId: s.id, targetLabel: c?.name, detail: status });
    return sightingOut({ ...s, case_name: c?.name }, { admin: true });
  });
}, ST);

add('GET', '/api/admin/audit', async ({ query: q }) => {
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 12));
  const { rows } = await query('SELECT * FROM audit ORDER BY created_at DESC LIMIT $1', [limit]);
  return rows.map(auditOut);
}, ST);
