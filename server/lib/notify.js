// Notificaciones dentro de la app + avisos por correo a vecinos cercanos.
import { query } from './db.js';
import { newId } from './security.js';
import { queueEmail, esc } from './mailer.js';
import { ENV } from './env.js';

export async function pushNotification(db, { userId, type, title, body, caseId = null }) {
  await db.query(
    'INSERT INTO notifications (id, user_id, type, title, body, case_id) VALUES ($1,$2,$3,$4,$5,$6)',
    [newId('notif'), userId, type, title, body, caseId]);
}

export const caseLink = (id) => `${ENV.appUrl || ''}/#/caso/${id}`;

/**
 * Avisa a los vecinos cuya zona está dentro de su radio de la alerta (por correo y en la app).
 * Máximo 150 destinatarios por alerta para cuidar el límite diario del correo gratuito.
 */
export async function alertNeighbors(db, c) {
  const { rows } = await db.query(
    `SELECT id, name, email, notify_email, d FROM (
       SELECT u.*, 6371 * 2 * asin(sqrt(
         power(sin(radians(u.home_lat - $1) / 2), 2) +
         cos(radians($1)) * cos(radians(u.home_lat)) * power(sin(radians(u.home_lng - $2) / 2), 2))) AS d
       FROM users u
       WHERE u.status = 'active' AND u.id <> $3 AND u.home_lat IS NOT NULL AND u.share_location = TRUE
     ) t WHERE d <= radius_km ORDER BY d LIMIT 150`,
    [c.lat, c.lng, c.owner_id]);
  const what = c.type === 'person' ? 'una persona' : 'una mascota';
  for (const u of rows) {
    const km = Number(u.d).toFixed(1);
    await pushNotification(db, {
      userId: u.id, type: 'nearby', caseId: c.id,
      title: `Alerta cerca de ti: ${c.name}`,
      body: `Se busca ${what} a ${km} km de tu zona (${c.last_seen_text || 'Lima'}). ¿Puedes ayudar?`,
    });
    if (u.notify_email) {
      await queueEmail({
        db, to: u.email, name: u.name, subject: `Alerta cerca de ti: ${c.name}`,
        title: `Se busca ${c.type === 'person' ? 'a' : 'a la mascota'} ${c.name}`,
        lines: [
          `Hola ${esc(u.name.split(' ')[0])}, hay una nueva alerta a <b>${km} km</b> de tu zona.`,
          `<b>Último lugar visto:</b> ${esc(c.last_seen_text || 'Lima')}`,
          'Si lo ves, reporta un avistamiento desde la app. Cada minuto cuenta.',
        ],
        cta: { label: 'Ver alerta en el mapa', url: caseLink(c.id) },
      });
    }
  }
  return rows.length;
}
