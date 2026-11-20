// Códigos de 6 dígitos enviados por correo (verificar correo, recuperar contraseña, cambiar correo).
import { query } from './db.js';
import { sha256, sixDigits, hit } from './security.js';
import { queueEmail } from './mailer.js';
import { bad, HttpError } from './http.js';

const TTL_MIN = 10;
const PURPOSE_TEXT = {
  reset: 'restablecer tu contraseña',
  email_change: 'confirmar tu nuevo correo',
};

export async function issueCode(email, purpose, name) {
  const em = email.toLowerCase();
  const l = hit(`code:${em}`, 3, TTL_MIN * 60_000);
  if (!l.ok) throw new HttpError(429, 'Ya enviamos varios códigos a este correo. Espera unos minutos.', { retryAfter: l.retryAfter });
  const code = sixDigits();
  await query(`UPDATE email_codes SET used_at = now() WHERE lower(email)=$1 AND purpose=$2 AND used_at IS NULL`, [em, purpose]);
  await query(`INSERT INTO email_codes (email, purpose, code_hash, expires_at) VALUES ($1,$2,$3, now() + ($4 || ' minutes')::interval)`,
    [em, purpose, sha256(`${em}:${purpose}:${code}`), String(TTL_MIN)]);
  await queueEmail({
    to: em, name, subject: `Tu código de Siempre Cerca: ${code}`, title: 'Tu código de verificación',
    lines: [`Usa este código para ${PURPOSE_TEXT[purpose]}:`,
      `<span style="font-size:30px;letter-spacing:6px;font-weight:700;color:#2D6A4F">${code}</span>`,
      `Vence en ${TTL_MIN} minutos. Si no fuiste tú, ignora este mensaje y no compartas el código con nadie.`],
  });
}

/** Comprueba y consume el código. Máx. 5 intentos por código. */
export async function consumeCode(email, purpose, code) {
  const em = email.toLowerCase();
  const { rows } = await query(
    `SELECT id, code_hash, attempts FROM email_codes
     WHERE lower(email)=$1 AND purpose=$2 AND used_at IS NULL AND expires_at > now()
     ORDER BY id DESC LIMIT 1`, [em, purpose]);
  const row = rows[0];
  if (!row) throw bad('El código venció o no existe. Solicita uno nuevo.');
  if (row.attempts >= 5) throw bad('Demasiados intentos. Solicita un código nuevo.');
  if (row.code_hash !== sha256(`${em}:${purpose}:${code}`)) {
    await query('UPDATE email_codes SET attempts = attempts + 1 WHERE id = $1', [row.id]);
    throw bad('El código ingresado no es correcto.');
  }
  await query('UPDATE email_codes SET used_at = now() WHERE id = $1', [row.id]);
}
