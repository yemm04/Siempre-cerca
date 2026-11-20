// Reputación del usuario: sube con anuncios que terminan bien y baja con rechazos o denuncias.
// Decide cuántas alertas puede publicar al día y cuánto pesa el puntaje de riesgo de lo que publica.
export const REP = {
  RESOLVED: +10,        // su alerta terminó en "encontrado"
  APPROVED_BY_TEAM: +3, // el equipo aprobó una alerta que estaba en revisión
  REJECTED: -15,        // alerta rechazada (automática o por el equipo)
  REPORTED: -10,        // la comunidad la ocultó con 3 denuncias
};

export function trustLevel(reputation) {
  const r = Number(reputation) || 0;
  if (r <= -15) return 'restricted';
  if (r >= 10) return 'trusted';
  return 'new';
}

export const DAILY_CASE_LIMIT = { new: 3, trusted: 6, restricted: 1 };
// Puntos que se suman (o restan) al puntaje de riesgo según la confianza
export const RISK_ADJUST = { new: 0, trusted: -25, restricted: +25 };

export async function adjustReputation(db, userId, delta) {
  if (!delta) return;
  await db.query('UPDATE users SET reputation = GREATEST(-100, LEAST(100, reputation + $2)) WHERE id = $1', [userId, delta]);
}
