// Lectura de variables de entorno (y de un archivo .env local si existe). Sin dependencias.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
try {
  const raw = fs.readFileSync(path.join(root, '.env'), 'utf8');
  for (const line of raw.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m || line.trim().startsWith('#')) continue;
    const v = m[2].replace(/^["']|["']$/g, '');
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
} catch { /* sin .env: se usan las variables del sistema (hosting) */ }

const e = process.env;
export const ENV = {
  root,
  isProd: e.NODE_ENV === 'production',
  port: Number(e.PORT) || 4000,
  databaseUrl: e.DATABASE_URL || '',
  // Neon exige SSL; en local con Postgres propio se puede poner DATABASE_SSL=false
  databaseSsl: e.DATABASE_SSL !== 'false',
  appUrl: (e.APP_URL || '').replace(/\/$/, ''),
  brevoApiKey: e.BREVO_API_KEY || '',
  mailFrom: e.MAIL_FROM || '',
  mailFromName: e.MAIL_FROM_NAME || 'Siempre Cerca',
  twilioSid: e.TWILIO_ACCOUNT_SID || '',
  twilioToken: e.TWILIO_AUTH_TOKEN || '',
  twilioVerifySid: e.TWILIO_VERIFY_SID || '',
  trustProxyHops: Number(e.TRUST_PROXY_HOPS ?? 1),
  sessionDays: Number(e.SESSION_DAYS) || 14,
  demoMode: e.DEMO_MODE === 'true',
  rateLimitPerMin: Number(e.RATE_LIMIT_PER_MIN) || 900,   // por IP; alto a propósito: en un salón toda la clase comparte la misma IP pública
  // Topes contra abuso y gasto: SMS por IP cada hora (una red compartida, como un salón, necesita holgura) y SMS por día en total
  smsPerIpHour: Number(e.SMS_PER_IP_HOUR) || 40,
  smsDailyLimit: Number(e.SMS_DAILY_LIMIT ?? 300),
  // IA (opcional): si AI_API_KEY está vacía, todo funciona solo con reglas
  aiProvider: (e.AI_PROVIDER || 'gemini').toLowerCase(),
  aiApiKey: e.AI_API_KEY || '',
  aiModel: e.AI_MODEL || '',
  aiBaseUrl: (e.AI_BASE_URL || '').replace(/\/$/, ''),   // solo para pruebas con un servidor falso
  aiDailyLimit: Number(e.AI_DAILY_LIMIT ?? 200),
  aiTimeoutMs: Number(e.AI_TIMEOUT_MS) || 10000,
  // Alertas sin actividad se archivan solas tras estos días (se avisa 2 días antes)
  archiveDays: Math.max(3, Number(e.ARCHIVE_DAYS) || 14),
};

if (!ENV.databaseUrl) {
  console.error('Falta DATABASE_URL. Copia .env.example como .env y completa los valores.');
  if (ENV.isProd) process.exit(1);
}
