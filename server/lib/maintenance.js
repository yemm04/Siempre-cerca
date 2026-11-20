// Tareas automáticas cada 30 minutos: avisar y archivar alertas sin actividad, y limpiar datos viejos.
import { query, tx } from './db.js';
import { ENV } from './env.js';
import { pushNotification, caseLink } from './notify.js';
import { queueEmail, esc } from './mailer.js';

export async function runMaintenance() {
  const days = ENV.archiveDays;
  // 1) Aviso 2 días antes de archivar
  const { rows: warn } = await query(
    `SELECT c.id, c.name, c.owner_id, u.name AS owner_name, u.email, u.notify_email FROM cases c JOIN users u ON u.id = c.owner_id
     WHERE c.status = 'active' AND NOT c.is_demo AND NOT c.archive_warned
       AND c.last_activity_at < now() - ($1::int * interval '1 day') + interval '2 days' LIMIT 50`, [days]);
  for (const c of warn) {
    await tx(async (db) => {
      await db.query('UPDATE cases SET archive_warned = TRUE WHERE id = $1', [c.id]);
      await pushNotification(db, { userId: c.owner_id, type: 'review', caseId: c.id,
        title: `Tu alerta de ${c.name} se archivará pronto`,
        body: 'No tiene actividad hace varios días. Si todavía lo buscas, toca "Mantener activa". Si ya lo encontraste, márcala como encontrada.' });
      if (c.notify_email) await queueEmail({ db, to: c.email, name: c.owner_name, subject: `Tu alerta de ${c.name} se archivará pronto`,
        title: '¿Sigues buscando?', lines: [`La alerta de <b>${esc(c.name)}</b> no tiene actividad hace varios días y se archivará en 2 días.`, 'Entra y toca "Mantener activa" si aún lo buscas, o márcala como encontrada.'],
        cta: { label: 'Abrir alerta', url: caseLink(c.id) } });
    });
  }
  // 2) Archivado
  const { rows: old } = await query(
    `SELECT c.id, c.name, c.owner_id FROM cases c
     WHERE c.status = 'active' AND NOT c.is_demo AND c.last_activity_at < now() - ($1::int * interval '1 day') LIMIT 50`, [days]);
  for (const c of old) {
    await tx(async (db) => {
      const { rowCount } = await db.query(`UPDATE cases SET status = 'archived', archived_at = now(), updated_at = now() WHERE id = $1 AND status = 'active'`, [c.id]);
      if (!rowCount) return;
      await pushNotification(db, { userId: c.owner_id, type: 'review', caseId: c.id,
        title: `Tu alerta de ${c.name} fue archivada`, body: 'Por inactividad dejó de mostrarse en el mapa. Puedes reactivarla cuando quieras desde "Mis alertas".' });
      const { rows: vols } = await db.query('SELECT user_id FROM participations WHERE case_id = $1 AND user_id <> $2 LIMIT 100', [c.id, c.owner_id]);
      for (const h of vols) await pushNotification(db, { userId: h.user_id, type: 'review', caseId: c.id,
        title: `La búsqueda de ${c.name} se pausó`, body: 'La alerta se archivó por inactividad. Gracias por ayudar.' });
    });
  }
  // 3) Limpieza
  await query(`DELETE FROM sessions WHERE expires_at < now()`);
  await query(`DELETE FROM outbox WHERE sent_at IS NOT NULL AND sent_at < now() - interval '30 days'`);
  await query(`DELETE FROM email_codes WHERE expires_at < now() - interval '1 day'`);
  return { warned: warn.length, archived: old.length };
}

export function startMaintenance() {
  const run = () => runMaintenance().catch((e) => console.error('[mantenimiento]', e.message));
  setTimeout(run, 15_000).unref();
  setInterval(run, 30 * 60_000).unref();
}
