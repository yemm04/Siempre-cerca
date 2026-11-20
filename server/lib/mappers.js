import { trustLevel } from './reputation.js';
// Convierte filas de la base de datos al formato que ya usa el frontend (_id, ownerId, location GeoJSON…)
const iso = (d) => (d ? new Date(d).toISOString() : undefined);

export function sessionUser(u) {
  return { _id: u.id, name: u.name, username: u.username, email: u.email, phone: u.phone, role: u.role, trust: trustLevel(u.reputation) };
}

export function caseOut(c, { viewer, withPhoto = false } = {}) {
  const isOwner = viewer && viewer.id === c.owner_id;
  const isStaff = viewer && ['moderator', 'admin'].includes(viewer.role);
  const out = {
    _id: c.id, folio: c.folio, ownerId: c.owner_id, ownerName: c.owner_name, type: c.type, name: c.name,
    breedOrAge: c.breed_or_age, description: c.description,
    thumb: c.thumb || c.photo || '',
    location: { type: 'Point', coordinates: [c.lng, c.lat] },
    lastSeenText: c.last_seen_text, lastSeenAt: iso(c.last_seen_at), relation: c.relation, status: c.status,
    volunteersCount: Number(c.volunteers_count ?? 0),
    searchQuadrants: { total: 4, checked: Number(c.zones_checked ?? 0) },
    createdAt: iso(c.created_at), updatedAt: iso(c.updated_at), resolvedAt: iso(c.resolved_at), approvedAt: iso(c.approved_at),
    isDemo: Boolean(c.is_demo),
  };
  if (isOwner || isStaff) { out.archivedAt = iso(c.archived_at); out.lastActivityAt = iso(c.last_activity_at); }
  if (isStaff && c.risk_score !== undefined && c.risk_score !== null) {
    out.riskScore = c.risk_score; out.riskSource = c.risk_source || 'reglas';
    out.riskReasons = (Array.isArray(c.risk_reasons) ? c.risk_reasons : []).map((r) => `${r.text}${r.points ? ` (${r.points > 0 ? '+' : ''}${r.points})` : ''}`);
  }
  if (withPhoto) out.photo = c.photo || '';
  // El teléfono de contacto solo lo ve el dueño del caso y el equipo
  if (isOwner || isStaff) out.contactPhone = c.contact_phone;
  if (isOwner || isStaff) { out.rejectionReason = c.rejection_reason || undefined; }
  if (c.distance_km !== undefined && c.distance_km !== null) out.distanceKm = Number(c.distance_km);
  return out;
}

export function sightingOut(s, { admin = false } = {}) {
  const out = {
    _id: s.id, caseId: s.case_id, name: s.case_name, img: s.case_thumb || '', reporterId: s.reporter_id,
    where: s.place, note: s.note, hasPhoto: Boolean(s.photo), status: s.status,
    location: { type: 'Point', coordinates: [s.lng, s.lat] }, stillThere: s.still_there, createdAt: iso(s.created_at),
  };
  if (admin) { out.photo = s.photo || null; out.reporterName = s.reporter_name || 'Usuario'; }
  return out;
}

export const notificationOut = (n) => ({
  _id: n.id, userId: n.user_id, type: n.type, title: n.title, body: n.body, caseId: n.case_id || undefined,
  read: n.read, createdAt: iso(n.created_at),
});

export const auditOut = (a) => ({
  _id: a.id, adminId: a.admin_id, adminName: a.admin_name, action: a.action, targetType: a.target_type,
  targetId: a.target_id, targetLabel: a.target_label, detail: a.detail, createdAt: iso(a.created_at),
});

export function adminUserOut(u) {
  return {
    _id: u.id, name: u.name, username: u.username, email: u.email, phone: u.phone, role: u.role, status: u.status,
    banReason: u.ban_reason || undefined, bannedAt: iso(u.banned_at), createdAt: iso(u.created_at),
    casesCount: Number(u.cases_count ?? 0), sightingsCount: Number(u.sightings_count ?? 0),
    settings: { radiusKm: u.radius_km, notifications: u.notify_email, location: u.share_location },
    reputation: Number(u.reputation ?? 0), trust: trustLevel(u.reputation),
  };
}
