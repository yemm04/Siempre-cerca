// Envío de correos con la API de Brevo (gratis: 300/día). Cola con reintentos en la tabla outbox.
import { query } from './db.js';
import { ENV } from './env.js';

export const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function layout(title, bodyHtml, cta) {
  const btn = cta ? `<p style="margin:24px 0"><a href="${esc(cta.url)}" style="background:#2D6A4F;color:#fff;text-decoration:none;padding:12px 22px;border-radius:10px;font-weight:600;display:inline-block">${esc(cta.label)}</a></p>` : '';
  return `<!doctype html><html><body style="margin:0;background:#f4f1ea;font-family:Arial,Helvetica,sans-serif;color:#1f2a24">
<div style="max-width:520px;margin:0 auto;padding:24px">
<div style="font-weight:700;font-size:18px;color:#2D6A4F;margin-bottom:12px">Siempre Cerca</div>
<div style="background:#fff;border-radius:14px;padding:24px">
<h2 style="margin:0 0 12px;font-size:20px">${esc(title)}</h2>${bodyHtml}${btn}
</div>
<p style="font-size:12px;color:#6b756f;margin-top:16px">Recibes este correo porque tienes una cuenta en Siempre Cerca. Puedes desactivar los avisos en Perfil → Notificaciones.</p>
</div></body></html>`;
}

/** Pone un correo en la cola (se envía en segundo plano) */
export async function queueEmail({ to, name, subject, title, lines, cta, db = { query } }) {
  const html = layout(title || subject, lines.map((l) => `<p style="margin:0 0 10px;line-height:1.5">${l}</p>`).join(''), cta);
  const text = `${title || subject}\n\n${lines.map((l) => l.replace(/<[^>]+>/g, '')).join('\n')}${cta ? `\n\n${cta.label}: ${cta.url}` : ''}`;
  await db.query('INSERT INTO outbox (to_email, to_name, subject, html, text) VALUES ($1,$2,$3,$4,$5)', [to, name || null, subject, html, text]);
}

async function sendViaBrevo(row) {
  if (!ENV.brevoApiKey || !ENV.mailFrom) throw new Error('Brevo no configurado (BREVO_API_KEY / MAIL_FROM)');
  const r = await fetch('https://api.brevo.com/v3/smtp/email', {
    method: 'POST',
    headers: { 'api-key': ENV.brevoApiKey, 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify({
      sender: { name: ENV.mailFromName, email: ENV.mailFrom },
      to: [{ email: row.to_email, ...(row.to_name ? { name: row.to_name } : {}) }],
      subject: row.subject, htmlContent: row.html, textContent: row.text,
    }),
    signal: AbortSignal.timeout(15000),
  });
  if (!r.ok) throw new Error(`Brevo ${r.status}: ${(await r.text()).slice(0, 200)}`);
}

let running = false;
/** Envía los correos pendientes (máx. 20 por vuelta). Reintenta con espera creciente, hasta 5 veces. */
export async function flushOutbox() {
  if (running) return; running = true;
  try {
    const { rows } = await query(
      `SELECT * FROM outbox WHERE sent_at IS NULL AND attempts < 5 AND next_at <= now() ORDER BY id LIMIT 20`);
    for (const row of rows) {
      try {
        if (!ENV.brevoApiKey) {
          // Sin Brevo (desarrollo): se muestra en consola y se da por enviado
          console.log(`[correo simulado] Para: ${row.to_email} · ${row.subject}\n${row.text}\n`);
        } else {
          await sendViaBrevo(row);
        }
        await query('UPDATE outbox SET sent_at = now(), attempts = attempts + 1, last_error = NULL WHERE id = $1', [row.id]);
      } catch (e) {
        const wait = Math.min(60, 2 ** row.attempts) ; // minutos
        await query(`UPDATE outbox SET attempts = attempts + 1, last_error = $2, next_at = now() + ($3 || ' minutes')::interval WHERE id = $1`,
          [row.id, String(e.message).slice(0, 300), String(wait)]);
        console.error('[correo] falló el envío:', e.message);
      }
    }
  } catch (e) { console.error('[correo] cola:', e.message); } finally { running = false; }
}
export function startOutboxWorker() {
  setInterval(flushOutbox, 20_000).unref();
  // Limpieza: correos enviados de hace más de 7 días y códigos/sesiones vencidos
  setInterval(() => {
    query(`DELETE FROM outbox WHERE created_at < now() - interval '7 days'`).catch(() => {});
    query(`DELETE FROM email_codes WHERE expires_at < now() - interval '1 day'`).catch(() => {});
    query(`DELETE FROM sessions WHERE expires_at < now()`).catch(() => {});
  }, 6 * 3600_000).unref();
}
