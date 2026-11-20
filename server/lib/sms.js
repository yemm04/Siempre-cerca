// Verificación del celular por SMS con la API Verify de Twilio.
// Twilio genera, envía y valida el código (vence a los 10 min). Si no hay credenciales y no es producción,
// se usa un modo de desarrollo: el código se imprime en la consola del servidor.
import { query } from './db.js';
import { ENV } from './env.js';
import { sha256, sixDigits, hit } from './security.js';
import { bad, HttpError } from './http.js';

const e164 = (phone) => `+51${phone}`;
const twilioReady = () => ENV.twilioSid && ENV.twilioToken && ENV.twilioVerifySid;
const auth = () => 'Basic ' + Buffer.from(`${ENV.twilioSid}:${ENV.twilioToken}`).toString('base64');

async function twilio(path, params) {
  const r = await fetch(`https://verify.twilio.com/v2/Services/${ENV.twilioVerifySid}/${path}`, {
    method: 'POST',
    headers: { Authorization: auth(), 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
    signal: AbortSignal.timeout(15000),
  });
  const data = await r.json().catch(() => ({}));
  return { ok: r.ok, status: r.status, data };
}

export function smsMode() { return twilioReady() ? 'twilio' : 'dev'; }

/** Envía el código por SMS al celular (9 dígitos peruanos) */
export async function sendPhoneCode(phone) {
  const l = hit(`sms:${phone}`, 3, 10 * 60_000);
  if (!l.ok) throw new HttpError(429, 'Ya enviamos varios códigos a este número. Espera unos minutos.', { retryAfter: l.retryAfter });
  if (twilioReady()) {
    // Tope diario global: protege tu saldo de Twilio si alguien intenta abusar del registro
    const { rows } = await query(
      `INSERT INTO daily_counters (day, key, n) VALUES (current_date, 'sms', 1)
       ON CONFLICT (day, key) DO UPDATE SET n = daily_counters.n + 1 WHERE daily_counters.n < $1 RETURNING n`, [ENV.smsDailyLimit]);
    if (!rows.length) throw new HttpError(503, 'Hoy se alcanzó el límite de SMS del sistema. Intenta de nuevo mañana.');
    const r = await twilio('Verifications', { To: e164(phone), Channel: 'sms', Locale: 'es' });
    if (!r.ok) {
      console.error('[sms] Twilio', r.status, r.data?.code, r.data?.message);
      if (r.data?.code === 60200 || r.data?.code === 21211) throw bad('Ese número de celular no es válido.');
      if (r.data?.code === 21608 || r.data?.code === 21610) throw bad('Este número no puede recibir SMS en este momento.');
      throw new HttpError(502, 'No pudimos enviar el SMS. Intenta de nuevo en un momento.');
    }
    return;
  }
  if (ENV.isProd) throw new HttpError(503, 'El envío de SMS no está configurado en el servidor.');
  // Modo desarrollo: código guardado con hash y mostrado en consola (vía cola de correos simulada)
  const code = sixDigits();
  const key = `sms:${phone}`;
  await query(`UPDATE email_codes SET used_at = now() WHERE email = $1 AND purpose = 'phone' AND used_at IS NULL`, [key]);
  await query(`INSERT INTO email_codes (email, purpose, code_hash, expires_at) VALUES ($1,'phone',$2, now() + interval '10 minutes')`,
    [key, sha256(`${key}:${code}`)]);
  await query(`INSERT INTO outbox (to_email, subject, html, text, attempts, sent_at) VALUES ($1,'Código SMS (modo desarrollo)',$2,$2,0,now())`,
    [key, `Tu código de Siempre Cerca es ${code}`]);
  console.log(`[SMS simulado] ${e164(phone)} → Tu código de Siempre Cerca es ${code}`);
}

/** Comprueba el código recibido por SMS; lanza error si no es correcto */
export async function checkPhoneCode(phone, code) {
  if (twilioReady()) {
    const r = await twilio('VerificationCheck', { To: e164(phone), Code: code });
    if (r.status === 404) throw bad('El código venció o no existe. Solicita uno nuevo.');
    if (!r.ok) throw new HttpError(502, 'No pudimos verificar el código. Intenta de nuevo.');
    if (r.data.status !== 'approved') throw bad('El código ingresado no es correcto.');
    return;
  }
  const key = `sms:${phone}`;
  const { rows: [row] } = await query(
    `SELECT id, code_hash, attempts FROM email_codes WHERE email=$1 AND purpose='phone' AND used_at IS NULL AND expires_at > now() ORDER BY id DESC LIMIT 1`, [key]);
  if (!row) throw bad('El código venció o no existe. Solicita uno nuevo.');
  if (row.attempts >= 5) throw bad('Demasiados intentos. Solicita un código nuevo.');
  if (row.code_hash !== sha256(`${key}:${code}`)) {
    await query('UPDATE email_codes SET attempts = attempts + 1 WHERE id=$1', [row.id]);
    throw bad('El código ingresado no es correcto.');
  }
  await query('UPDATE email_codes SET used_at = now() WHERE id=$1', [row.id]);
}
