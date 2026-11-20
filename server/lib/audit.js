import { newId } from './security.js';

export async function audit(db, staff, { action, targetType, targetId, targetLabel, detail = '' }) {
  await db.query(
    `INSERT INTO audit (id, admin_id, admin_name, action, target_type, target_id, target_label, detail)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
    [newId('audit'), staff?.id ?? null, staff?.name ?? 'Sistema', action, targetType, targetId, targetLabel, detail]);
}
