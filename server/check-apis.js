// Revisa que tus claves (.env) funcionen de verdad: base de datos, SMS (Twilio), correo (Brevo) e IA.
//   npm run check
// No envía SMS ni correos: solo consulta tu cuenta en cada servicio.
import { ENV } from './lib/env.js';
import { pool } from './lib/db.js';
import { aiEnabled, aiStatus, aiPing } from './lib/ai.js';

const ok = (m) => console.log(`  ✅ ${m}`);
const warn = (m) => console.log(`  ⚠️  ${m}`);
const bad = (m) => { console.log(`  ❌ ${m}`); problems++; };
let problems = 0;
const get = (url, headers) => fetch(url, { headers, signal: AbortSignal.timeout(12000) });

console.log('\n1) Base de datos (PostgreSQL / Neon)');
try {
  const { rows: [r] } = await pool.query(`SELECT current_database() AS db, (SELECT count(*) FROM information_schema.tables WHERE table_schema='public')::int AS tablas`);
  r.tablas ? ok(`Conectada a "${r.db}" · ${r.tablas} tablas`) : warn(`Conectada a "${r.db}" pero sin tablas: ejecuta npm start o npm run migrate una vez`);
} catch (e) { bad(`No se pudo conectar: ${e.message}. Revisa DATABASE_URL en el .env (debe terminar en ?sslmode=require).`); }

console.log('\n2) SMS · Twilio Verify (verifica el celular al registrarse)');
if (!(ENV.twilioSid && ENV.twilioToken && ENV.twilioVerifySid)) {
  warn('Sin configurar → modo prueba: el código de verificación sale en la consola del servidor, no llega al celular.');
} else {
  try {
    const r = await get(`https://verify.twilio.com/v2/Services/${ENV.twilioVerifySid}`, { Authorization: 'Basic ' + Buffer.from(`${ENV.twilioSid}:${ENV.twilioToken}`).toString('base64') });
    if (r.ok) { const d = await r.json(); ok(`Conectado al servicio Verify "${d.friendly_name}". Límite diario del sistema: ${ENV.smsDailyLimit} SMS.`); warn('Si tu cuenta es de prueba, solo llegan SMS a números verificados en Twilio.'); }
    else if (r.status === 401) bad('Twilio rechazó las credenciales: revisa TWILIO_ACCOUNT_SID y TWILIO_AUTH_TOKEN.');
    else if (r.status === 404) bad('No existe ese servicio Verify: revisa TWILIO_VERIFY_SID (empieza con VA).');
    else bad(`Twilio respondió ${r.status}.`);
  } catch (e) { bad(`No se pudo contactar a Twilio: ${e.message}`); }
}

console.log('\n3) Correo · Brevo (avisos de alertas y recuperar contraseña)');
if (!ENV.brevoApiKey) {
  warn('Sin configurar → modo prueba: los correos se imprimen en la consola del servidor.');
} else {
  try {
    const r = await get('https://api.brevo.com/v3/account', { 'api-key': ENV.brevoApiKey, accept: 'application/json' });
    if (r.status === 401) bad('Brevo rechazó la API Key: revisa BREVO_API_KEY.');
    else if (!r.ok) bad(`Brevo respondió ${r.status}.`);
    else {
      const d = await r.json(); ok(`Conectado a Brevo (${d.companyName || d.email || 'cuenta'}).`);
      if (!ENV.mailFrom) bad('Falta MAIL_FROM (el correo remitente verificado en Brevo).');
      else {
        const s = await get('https://api.brevo.com/v3/senders', { 'api-key': ENV.brevoApiKey, accept: 'application/json' });
        const list = s.ok ? (await s.json()).senders || [] : [];
        const mine = list.find((x) => x.email?.toLowerCase() === ENV.mailFrom.toLowerCase());
        if (mine?.active) ok(`Remitente ${ENV.mailFrom} verificado.`);
        else bad(`El remitente ${ENV.mailFrom} no está verificado en Brevo (Senders & IP → Senders).`);
        if (/@gmail\.com$/i.test(ENV.mailFrom)) warn('Con un remitente @gmail.com los correos pueden caer en spam; un dominio propio llega mejor.');
      }
    }
  } catch (e) { bad(`No se pudo contactar a Brevo: ${e.message}`); }
}

console.log('\n4) Inteligencia artificial (opcional)');
if (!aiEnabled()) {
  warn('Apagada → el filtro de anuncios usa solo reglas; consejos, resumen y asistente usan versiones sin IA.');
} else {
  const st = aiStatus();
  const t = await aiPing().catch(() => null);
  t ? ok(`Responde (${st.provider} · ${st.model}). Tope diario: ${ENV.aiDailyLimit} llamadas.`)
    : bad(`No respondió (${st.provider} · ${st.model}). Revisa AI_API_KEY y AI_MODEL, o si se agotó el cupo gratuito.`);
}

console.log(problems ? `\nHay ${problems} problema(s) por corregir.\n` : '\nTodo lo configurado funciona.\n');
await pool.end();
process.exit(problems ? 1 : 0);
