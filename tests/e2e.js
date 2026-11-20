import { spawn } from 'node:child_process';
import http from 'node:http';
import { pool } from '../server/lib/db.js';

// Seguridad: esta prueba BORRA las tablas de usuarios. Solo se permite en una base local de pruebas.
const dbUrl = process.env.DATABASE_URL || '';
if (!/@(localhost|127\.0\.0\.1)[:/]/.test(dbUrl)) {
  console.error('Por seguridad, las pruebas solo corren contra una base de datos local (localhost). No las ejecutes contra Neon.');
  process.exit(1);
}
const BASE = 'http://127.0.0.1:4100';
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('  ✗ FALLA:', m); } };

class Client {
  constructor(name) { this.name = name; this.cookie = ''; }
  async req(method, path, body, extra = {}) {
    const r = await fetch(BASE + path, { method, redirect: 'manual',
      headers: { ...(body ? { 'content-type': 'application/json' } : {}), 'x-requested-with': 'siempre-cerca', ...(this.cookie ? { cookie: this.cookie } : {}), ...extra },
      body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) this.cookie = sc.split(';')[0].endsWith('=') ? '' : sc.split(';')[0];
    let data = null; try { data = await r.json(); } catch {}
    return { status: r.status, data, headers: r.headers };
  }
}
const lastCode = async (email) => {
  const { rows } = await pool.query(`SELECT text FROM outbox WHERE lower(to_email)=lower($1) AND subject LIKE 'Tu código%' ORDER BY id DESC LIMIT 1`, [email]);
  return rows[0].text.match(/\b(\d{6})\b/)[1];
};
const smsCode = async (phone) => {
  const { rows } = await pool.query(`SELECT text FROM outbox WHERE to_email = $1 ORDER BY id DESC LIMIT 1`, [`sms:${phone}`]);
  return rows[0].text.match(/\b(\d{6})\b/)[1];
};
async function register(c, n) {
  const email = `${n}@test.pe`;
  const phone = '9' + String(10000000 + Math.floor(Math.random() * 8e7));
  let r = await c.req('POST', '/api/auth/send-code', { email, phone }); ok(r.status === 200, `send-code ${n} ${r.status}`);
  const code = await smsCode(phone);
  r = await c.req('POST', '/api/auth/register', { name: `Usuario ${n}`, username: n, email, phone, password: 'Clave1234', code });
  ok(r.status === 200 && r.data._id, `register ${n}: ${JSON.stringify(r.data)}`);
  return r.data;
}


// Servidor falso de IA (imita a Gemini) para probar la integración sin gastar ni necesitar claves reales
const aiLog = [];
const mockAi = http.createServer((req, res) => {
  let body = ''; req.on('data', (d) => { body += d; });
  req.on('end', () => {
    aiLog.push(body);
    let j = {}; try { j = JSON.parse(body); } catch {}
    const sys = j.systemInstruction?.parts?.[0]?.text || '', usr = j.contents?.[0]?.parts?.[0]?.text || '';
    if (/FALLA-IA/.test(usr)) { res.writeHead(500); return res.end('{}'); }
    let out;
    if (sys.includes('revisor de seguridad')) out = JSON.stringify(/SOSPECHA-IA/.test(usr) ? { level: 'high', coherent: true, reasons: ['Texto con señales de estafa'] } : { level: 'low', coherent: true, reasons: [] });
    else if (sys.includes('Resumes pistas')) out = 'Resumen IA de prueba.';
    else if (sys.includes('consejos prácticos')) out = '• Consejo IA uno\n• Consejo IA dos';
    else out = 'Respuesta IA de prueba.';
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: out }] } }] }));
  });
}).listen(4101);

await pool.query('TRUNCATE users, outbox, email_codes, ai_usage RESTART IDENTITY CASCADE');
const srv = spawn('node', ['server/index.js'], { env: { ...process.env, PORT: '4100', RATE_LIMIT_PER_MIN: '5000', AI_PROVIDER: 'gemini', AI_API_KEY: 'clave-de-prueba', AI_BASE_URL: 'http://127.0.0.1:4101', AI_DAILY_LIMIT: '200' }, stdio: ['ignore', 'pipe', 'inherit'] });
srv.stdout.on('data', () => {});
await new Promise((r) => setTimeout(r, 1500));

try {
  console.log('1. Cabeceras y estáticos');
  const anon = new Client('anon');
  let r = await anon.req('GET', '/');
  ok(r.status === 200, 'index 200');
  ok(r.headers.get('content-security-policy')?.includes("default-src 'self'"), 'CSP');
  ok(r.headers.get('x-frame-options') === 'DENY', 'X-Frame');
  for (const p of ['/.env', '/server/index.js', '/db/schema.sql', '/package.json', '/%2e%2e/package.json', '/..%2fpackage.json', '/js/../../.env']) {
    const x = await fetch(BASE + p); ok(x.status === 404 || x.status === 400, `no debe servir ${p} (dio ${x.status})`);
  }
  ok((await fetch(BASE + '/js/app.js')).status === 200, 'js servido');

  console.log('2. Sesión / CSRF');
  r = await anon.req('GET', '/api/me'); ok(r.status === 200 && r.data.user === null, 'me anon null');
  r = await anon.req('GET', '/api/cases'); ok(r.status === 401, 'cases requiere sesión');
  r = await fetch(BASE + '/api/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' }); ok(r.status === 403, 'sin cabecera CSRF → 403');
  r = await anon.req('POST', '/api/auth/login', { identifier: 'a', password: 'b' }, { origin: 'https://evil.com' }); ok(r.status === 403, 'origen ajeno → 403');

  console.log('3. Registro con código por SMS');
  const A = new Client('A'), B = new Client('B'), C = new Client('C');
  const ua = await register(A, 'ana.test'); const ub = await register(B, 'beto.test'); await register(C, 'carlos.test');
  r = await anon.req('POST', '/api/auth/register', { name: 'X', username: 'ana.test', email: 'otro@test.pe', phone: '987000111', password: 'Clave1234', code: '000000' });
  ok(r.status === 400, 'código incorrecto rechazado');
  r = await anon.req('POST', '/api/auth/send-code', { email: 'ana.test@test.pe', phone: '911000111' }); ok(r.status === 409, 'correo duplicado 409');
  r = await anon.req('POST', '/api/auth/send-code', { email: 'mal', phone: '911000111' }); ok(r.status === 400, 'correo inválido');
  r = await anon.req('POST', '/api/auth/send-code', { email: '<svg/onload=alert(1)>@x.co', phone: '911000111' }); ok(r.status === 400, 'correo con HTML rechazado');
  const { rows: [h] } = await pool.query(`SELECT password_hash FROM users WHERE username='ana.test'`);
  ok(h.password_hash.startsWith('scrypt$') && !h.password_hash.includes('Clave1234'), 'contraseña hasheada');
  const { rows: sess } = await pool.query('SELECT token_hash FROM sessions'); ok(sess.every((s) => s.token_hash.length === 64), 'sesión guardada como hash');

  console.log('4. Login');
  const A2 = new Client('A2');
  r = await A2.req('POST', '/api/auth/login', { identifier: 'ana.test@test.pe', password: 'Clave1234' }); ok(r.status === 200 && r.data.username === 'ana.test', 'login por correo');
  ok(!JSON.stringify(r.data).includes('password'), 'sin hash en respuesta');
  r = await A2.req('GET', '/api/me'); ok(r.data.user?.email === 'ana.test@test.pe', 'me con sesión');
  r = await anon.req('POST', '/api/auth/login', { identifier: 'ana.test', password: 'mala' }); ok(r.status === 401 && r.data.error.includes('incorrectos'), 'mala clave 401');
  r = await anon.req('POST', '/api/auth/login', { identifier: 'noexiste', password: 'mala' }); ok(r.status === 401 && r.data.error.includes('incorrectos'), 'usuario inexistente mismo mensaje');
  for (let i = 0; i < 8; i++) await anon.req('POST', '/api/auth/login', { identifier: 'beto.test', password: 'x' + i });
  r = await anon.req('POST', '/api/auth/login', { identifier: 'beto.test', password: 'Clave1234' }); ok(r.status === 429, `bloqueo tras fallos (${r.status})`);

  console.log('5. Ubicación y alertas');
  r = await B.req('POST', '/api/me/location', { lat: -12.12, lng: -77.03 }); ok(r.status === 200, 'ubicación B');
  r = await C.req('POST', '/api/me/location', { lat: -11.5, lng: -77.0 }); // lejos (~70km)
  const caseBody = { type: 'pet', name: 'Bruno', breedOrAge: 'Labrador', description: 'Collar rojo', lat: -12.1211, lng: -77.0297, lastSeenText: 'Parque Kennedy', lastSeenAt: new Date(Date.now() - 3600e3).toISOString(), contactPhone: '+51 912 345 678', relation: 'owner' };
  r = await A.req('POST', '/api/cases', caseBody); ok(r.status === 200 && r.data.status === 'active' && r.data.autoApproved, `alerta auto-aprobada ${JSON.stringify(r.data).slice(0, 150)}`);
  const caseId = r.data._id; ok(/^SC-\d{4}$/.test(r.data.folio), 'folio');
  r = await A.req('POST', '/api/cases', { ...caseBody, name: 'Otro' }); ok(r.status === 429, 'límite 1/min');
  const { rows: mails } = await pool.query(`SELECT to_email FROM outbox WHERE subject LIKE 'Alerta cerca%'`);
  ok(mails.length === 1 && mails[0].to_email === 'beto.test@test.pe', `solo el vecino cercano recibe correo (${mails.map(m=>m.to_email)})`);
  r = await B.req('GET', '/api/notifications'); ok(r.data.some((n) => n.type === 'nearby'), 'notificación in-app a vecino');
  r = await C.req('GET', '/api/notifications'); ok(!r.data.some((n) => n.type === 'nearby'), 'lejano no recibe');
  r = await A.req('GET', '/api/notifications'); ok(!r.data.some((n) => n.title.includes('cerca de ti')), 'el dueño no se auto-avisa');

  console.log('6. Privacidad');
  r = await B.req('GET', `/api/cases/${caseId}`); ok(r.status === 200 && r.data.contactPhone === undefined && r.data.photo !== undefined, 'otro usuario NO ve teléfono');
  r = await A.req('GET', `/api/cases/${caseId}`); ok(r.data.contactPhone === '+51 912 345 678', 'dueño sí ve teléfono');
  r = await B.req('GET', '/api/cases?lat=-12.12&lng=-77.03&radiusKm=10'); ok(r.data.length === 1 && r.data[0].contactPhone === undefined && r.data[0].distanceKm < 1, 'lista con distancia sin teléfono');
  ok(!JSON.stringify(r.data).includes('912 345'), 'teléfono no aparece en lista');
  r = await B.req('GET', '/api/cases?q=' + encodeURIComponent("'; DROP TABLE users;--")); ok(r.status === 200 && r.data.length === 0, 'inyección SQL inerte');
  r = await B.req('GET', '/api/cases?q=bru'); ok(r.data.length === 1, 'búsqueda de texto');
  r = await B.req('GET', '/api/cases?type=person'); ok(r.data.length === 0, 'filtro tipo');
  r = await B.req('GET', '/api/me/settings'); ok(!('password_hash' in r.data), 'ajustes sin hash');

  console.log('7. Validación');
  r = await B.req('POST', '/api/cases', { ...caseBody, name: '', lat: 'x' }); ok(r.status === 400, 'validación nombre/lat');
  r = await B.req('POST', '/api/cases', { ...caseBody, lat: 40, lng: 2 }); ok(r.status === 400, 'fuera de Perú rechazado');
  r = await B.req('POST', '/api/cases', { ...caseBody, photo: 'https://evil.com/x.png' }); ok(r.status === 400, 'foto externa rechazada');
  r = await B.req('POST', '/api/cases', { ...caseBody, photo: 'data:image/svg+xml;base64,AAAA' }); ok(r.status === 400, 'SVG rechazado');
  r = await B.req('POST', '/api/cases', { ...caseBody, name: 'Spam', description: 'gana dinero en www.casino.com' });
  ok(r.status === 200 && r.data.status === 'rejected' && r.data.autoRejected && /No pudimos publicar/.test(r.data.rejectionReason || ''), `spam → rechazo automático ${JSON.stringify(r.data).slice(0, 120)}`);
  const spamId = r.data._id;

  console.log('8. Avistamientos, voluntarios, notificaciones');
  r = await B.req('POST', `/api/cases/${caseId}/sightings`, { where: 'Av. Larco', note: 'Lo vi cerca', lat: -12.125, lng: -77.03, stillThere: 'yes' }); ok(r.status === 200 && r.data.status === 'received', 'avistamiento');
  r = await A.req('GET', '/api/notifications'); ok(r.data.some((n) => n.type === 'sighting'), 'dueño recibe pista');
  r = await B.req('POST', `/api/cases/${caseId}/sightings`, { where: 'x', lat: -12, lng: -77 }); ok(r.status === 400, 'lugar muy corto');
  r = await B.req('POST', `/api/cases/${caseId}/join`, { zone: 'B1' }); ok(r.status === 200, 'unirse');
  r = await B.req('POST', `/api/cases/${caseId}/join`, { zone: 'B1' }); ok(r.status === 200, 'unirse idempotente');
  r = await B.req('POST', `/api/cases/${caseId}/inspect`, {}); ok(r.data.inspected === true, 'marcar zona');
  r = await B.req('GET', `/api/cases/${caseId}/volunteers`); ok(r.data.length === 1 && r.data[0].name === 'Usuario B.' || r.data[0].name.includes('.'), `voluntarios ${JSON.stringify(r.data)}`);
  r = await B.req('GET', `/api/cases/${caseId}`); ok(r.data.volunteersCount === 1, 'conteo voluntarios');
  r = await B.req('GET', `/api/cases/${caseId}/sightings`); ok(r.status === 403, 'pistas solo dueño');
  r = await A.req('GET', `/api/cases/${caseId}/sightings`); ok(r.data.length === 1, 'dueño ve pistas');
  r = await B.req('GET', '/api/sightings/mine'); ok(r.data.length === 1, 'mis avistamientos');
  r = await B.req('POST', '/api/notifications/read-all'); r = await B.req('GET', '/api/notifications'); ok(r.data.every((n) => n.read), 'marcar leídas');
  r = await A.req('GET', '/api/notifications'); const nid = r.data[0]._id;
  r = await B.req('POST', `/api/notifications/${nid}/read`); r = await A.req('GET', '/api/notifications'); ok(r.data.find((n) => n._id === nid).read === false, 'no se puede leer notificación ajena');
  r = await B.req('GET', `/api/cases/${spamId}`); ok(r.status === 200, 'dueño ve su alerta en revisión');
  r = await C.req('GET', `/api/cases/${spamId}`); ok(r.status === 404, 'otros no ven alerta en revisión');

  console.log('9. Marcar encontrado');
  r = await C.req('POST', `/api/cases/${caseId}/resolve`, {}); ok(r.status === 403, 'solo el dueño resuelve');
  r = await A.req('POST', `/api/cases/${caseId}/resolve`, { note: 'Apareció' }); ok(r.status === 200 && r.data.status === 'resolved', 'dueño resuelve');
  r = await B.req('GET', '/api/notifications'); ok(r.data.some((n) => n.type === 'resolved'), 'ayudantes avisados');
  const { rows: rm } = await pool.query(`SELECT 1 FROM outbox WHERE subject LIKE '%fue encontrado%'`); ok(rm.length >= 1, 'correo de final feliz');
  r = await A.req('POST', `/api/cases/${caseId}/resolve`, {}); ok(r.status === 400, 'no se resuelve dos veces');
  r = await B.req('POST', `/api/cases/${caseId}/sightings`, { where: 'Larco', lat: -12, lng: -77 }); ok(r.status === 404, 'no avistamientos en alerta resuelta');

  console.log('10. Denuncias');
  const D = new Client('D'), E = new Client('E'), F = new Client('F');
  await register(D, 'd.test'); await register(E, 'e.test'); await register(F, 'f.test');
  await pool.query(`UPDATE users SET created_at = now() - interval '1 day'`);
  await pool.query(`UPDATE cases SET created_at = now() - interval '2 days'`);
  r = await D.req('POST', '/api/cases', { ...caseBody, name: 'Luna' }); const luna = r.data._id; ok(r.status === 200, 'otra alerta');
  r = await D.req('POST', `/api/cases/${luna}/report`, { reason: 'x' }); ok(r.status === 400, 'no autodenuncia');
  for (const x of [A, E]) { r = await x.req('POST', `/api/cases/${luna}/report`, { reason: 'Falsa' }); ok(r.status === 200, 'denuncia'); }
  r = await F.req('GET', `/api/cases/${luna}`); ok(r.data.status === 'active', 'con 2 denuncias sigue activa');
  await A.req('POST', `/api/cases/${luna}/report`, { reason: 'Falsa' });
  r = await F.req('POST', `/api/cases/${luna}/report`, { reason: 'Falsa' });
  r = await C.req('GET', `/api/cases/${luna}`); ok(r.status === 404, 'con 3 denuncias distintas se oculta');

  console.log('11. Panel admin y permisos');
  r = await B.req('GET', '/api/admin/stats'); ok(r.status === 403, 'usuario normal sin admin');
  r = await anon.req('GET', '/api/admin/users'); ok(r.status === 401, 'anónimo sin admin');
  await pool.query(`INSERT INTO users (id,name,username,email,phone,password_hash,role) SELECT 'usr_adm','Admin','admin.test','admin@test.pe','999000111',password_hash,'admin' FROM users LIMIT 1`);
  const ADM = new Client('adm'); r = await ADM.req('POST', '/api/auth/login', { identifier: 'admin.test', password: 'Clave1234' }); ok(r.status === 200 && r.data.role === 'admin', 'login admin');
  r = await ADM.req('GET', '/api/admin/stats'); ok(r.data.cases.total >= 3 && r.data.last7.length === 7, `stats ${JSON.stringify(r.data.cases)}`);
  r = await ADM.req('GET', '/api/admin/cases?status=pending_review'); ok(r.data.length >= 1, 'pendientes');
  r = await ADM.req('PATCH', `/api/admin/cases/${spamId}/review`, { decision: 'approve' }); ok(r.status === 200 && r.data.status === 'active', 'admin aprueba');
  r = await ADM.req('PATCH', `/api/admin/cases/${luna}/review`, { decision: 'reject', reason: 'Falsa' }); ok(r.data.status === 'rejected', 'admin rechaza');
  r = await ADM.req('GET', '/api/admin/users?q=ana'); ok(r.data.length === 1 && r.data[0].casesCount >= 1 && !JSON.stringify(r.data).includes('scrypt'), 'usuarios sin hash');
  r = await ADM.req('PATCH', `/api/admin/users/${ub._id}/status`, { status: 'banned', reason: 'Spam' }); ok(r.data.status === 'banned', 'ban');
  r = await B.req('GET', '/api/me'); ok(r.data.user === null, 'sesión del baneado muerta al instante');
  r = await anon.req('POST', '/api/auth/login', { identifier: 'beto.test', password: 'Clave1234' }); ok(r.status === 403 || r.status === 429, `baneado no entra (${r.status})`);
  r = await ADM.req('PATCH', `/api/admin/users/usr_adm/status`, { status: 'banned' }); ok(r.status === 400, 'no se banea a sí mismo');
  r = await ADM.req('GET', '/api/admin/sightings'); ok(r.data.length === 1 && r.data[0].reporterName, 'avistamientos admin');
  r = await ADM.req('PATCH', `/api/admin/sightings/${r.data[0]._id}/status`, { status: 'confirmed' }); ok(r.data.status === 'confirmed', 'estado avistamiento');
  r = await ADM.req('GET', '/api/admin/audit?limit=5'); ok(r.data.length >= 3, 'auditoría');
  r = await ADM.req('DELETE', `/api/admin/cases/${luna}`); ok(r.status === 200, 'borrar');

  console.log('12. Cuenta');
  r = await A.req('POST', '/api/me/check-password', { password: 'Clave1234' }); ok(r.data.ok === true, 'check-password ok');
  r = await A.req('POST', '/api/me/check-password', { password: 'no' }); ok(r.data.ok === false, 'check-password mal');
  r = await A.req('POST', '/api/me/password', { current: 'mal', next: 'Nueva12345' }); ok(r.status === 400, 'cambio con clave actual mala');
  r = await A.req('POST', '/api/me/password', { current: 'Clave1234', next: 'corta' }); ok(r.status === 400, 'clave débil');
  r = await A.req('POST', '/api/me/password', { current: 'Clave1234', next: 'Nueva12345' }); ok(r.status === 200, 'cambio de clave');
  r = await A.req('POST', '/api/me/email/request', { password: 'Nueva12345', newEmail: 'ana.nueva@test.pe' }); ok(r.status === 200, 'cambio correo: pide código');
  r = await A.req('POST', '/api/me/email', { password: 'Nueva12345', newEmail: 'ana.nueva@test.pe', code: '123456' }); ok(r.status === 400, 'código malo');
  r = await A.req('POST', '/api/me/email', { password: 'Nueva12345', newEmail: 'ana.nueva@test.pe', code: await lastCode('ana.nueva@test.pe') }); ok(r.status === 200 && r.data.email === 'ana.nueva@test.pe', 'correo cambiado');
  r = await A.req('POST', '/api/me/phone', { password: 'Nueva12345', newPhone: '911222333', code: '123456' }); ok(r.status === 400, 'teléfono sin código válido rechazado');
  r = await A.req('POST', '/api/me/phone/request', { password: 'Nueva12345', newPhone: '911222333' }); ok(r.status === 200, 'SMS al número nuevo');
  r = await A.req('POST', '/api/me/phone', { password: 'Nueva12345', newPhone: '911222333', code: await smsCode('911222333') }); ok(r.data.phone === '911222333', 'teléfono cambiado con código');
  r = await A.req('POST', '/api/me/phone/request', { password: 'Nueva12345', newPhone: '999888777' }); ok(r.status === 200 || r.status === 409, 'teléfono ocupado o libre responde');
  r = await A.req('PATCH', '/api/me', { name: 'Ana Nueva', username: 'ana.nueva' }); ok(r.data.username === 'ana.nueva', 'perfil');
  r = await A.req('PATCH', '/api/me/settings', { radiusKm: 12, notifications: false }); ok(r.data.radiusKm === 12 && r.data.notifications === false, 'ajustes');
  r = await A.req('PATCH', '/api/me/settings', { radiusKm: 999 }); ok(r.status === 400, 'radio inválido');

  console.log('13. Recuperar contraseña');
  r = await anon.req('POST', '/api/auth/forgot', { identifier: 'ana.nueva' }); ok(r.status === 200 && r.data.email.includes('*'), 'forgot');
  const fr = await anon.req('POST', '/api/auth/forgot', { identifier: 'nadie' }); ok(fr.status === 200 && fr.data.email, 'forgot inexistente misma respuesta');
  r = await anon.req('POST', '/api/auth/reset', { identifier: 'ana.nueva', code: await lastCode('ana.nueva@test.pe'), newPassword: 'Otra123456' }); ok(r.status === 200, 'reset');
  r = await A.req('GET', '/api/me'); ok(r.data.user === null, 'reset cierra sesiones');
  r = await anon.req('POST', '/api/auth/login', { identifier: 'ana.nueva', password: 'Otra123456' }); ok(r.status === 200, 'login con nueva clave');
  r = await anon.req('POST', '/api/auth/logout'); r = await anon.req('GET', '/api/me'); ok(r.data.user === null, 'logout');

  console.log('14. Revisión automática, reputación, avisos a voluntarios, zonas, IA y archivado');
  const mk = async (n) => { const c = new Client(n); await register(c, n); return c; };
  const [G, H, I, J, K, L, M, N, O] = [await mk('g.test'), await mk('h.test'), await mk('i.test'), await mk('j.test'), await mk('k.test'), await mk('l.test'), await mk('m.test'), await mk('n.test'), await mk('o.test')];
  await pool.query(`UPDATE users SET created_at = now() - interval '1 day' WHERE username IN ('g.test','h.test','i.test','j.test','k.test','l.test','m.test','n.test','o.test')`);
  const getRow = async (id) => (await pool.query('SELECT * FROM cases WHERE id=$1', [id])).rows[0];

  r = await G.req('POST', '/api/cases', { ...caseBody, name: 'Mora' }); const mora = r.data._id;
  ok(r.data.status === 'active' && r.data.riskScore === undefined, 'normal: se publica y el dueño no ve el puntaje');
  let row = await getRow(mora); ok(row.risk_score !== null && row.risk_source === 'reglas+ia', 'puntaje y fuente guardados');
  r = await H.req('POST', '/api/cases', { ...caseBody, name: 'Linky', description: 'Fotos en www.ejemplo.pe por favor ayuden' });
  const linky = r.data._id; ok(r.data.status === 'pending_review' && !r.data.autoApproved && !r.data.autoRejected, `enlace → revisión (${r.data.status})`);
  r = await ADM.req('GET', '/api/admin/cases?status=pending_review'); const lk = r.data.find((c) => c._id === linky);
  ok(lk && lk.riskScore >= 35 && lk.riskReasons.some((x) => /enlaces/.test(x)), 'el equipo ve puntaje y motivos');
  r = await H.req('GET', `/api/cases/${linky}`); ok(r.data.riskScore === undefined && r.data.riskReasons === undefined, 'el dueño no ve puntaje ni motivos');
  r = await N.req('POST', '/api/cases', { ...caseBody, name: 'Rex', description: 'SOSPECHA-IA collar azul grande' });
  ok(r.data.status === 'pending_review', `la IA suma riesgo → revisión (${r.data.status})`);
  row = await getRow(r.data._id); ok(row.risk_source === 'reglas+ia' && row.risk_score >= 50, 'fuente reglas+ia');
  r = await O.req('POST', '/api/cases', { ...caseBody, name: 'Kira', description: 'FALLA-IA collar verde pequeña' });
  ok(r.data.status === 'active', 'si la IA falla, el anuncio igual se publica con reglas'); row = await getRow(r.data._id); ok(row.risk_source === 'reglas', 'fuente reglas cuando la IA falla');
  r = await I.req('POST', '/api/cases', { ...caseBody, name: 'Casino', description: 'gana dinero ya en www.apuestas.com' });
  const bad1 = r.data._id; ok(r.data.autoRejected && r.data.status === 'rejected', 'estafa → rechazo automático');
  let u = (await pool.query(`SELECT reputation FROM users WHERE username='i.test'`)).rows[0]; ok(u.reputation === -15, `reputación baja tras rechazo (${u.reputation})`);
  r = await I.req('GET', '/api/me'); ok(r.data.user.trust === 'restricted', 'nivel restringido');
  r = await I.req('POST', '/api/cases', { ...caseBody, name: 'Otra' }); ok(r.status === 429, 'restringido: límite diario y por minuto');
  r = await ADM.req('PATCH', `/api/admin/cases/${bad1}/review`, { decision: 'approve' }); ok(r.status === 200 && r.data.status === 'active', 'el equipo corrige un falso positivo');
  u = (await pool.query(`SELECT reputation FROM users WHERE username='i.test'`)).rows[0]; ok(u.reputation === 3, `se revierte la penalización (${u.reputation})`);
  u = (await pool.query(`SELECT reputation FROM users WHERE id=$1`, [ua._id])).rows[0]; ok(u.reputation >= 10, `reputación sube al resolver (${u.reputation})`);
  r = await ADM.req('GET', '/api/admin/stats'); ok(r.data.automation.checked >= 4 && r.data.automation.ai.enabled && r.data.automation.ai.provider === 'gemini' && r.data.automation.ai.callsToday > 0, 'estadísticas de automatización');

  // Avisos a voluntarios
  r = await J.req('POST', '/api/cases', { ...caseBody, name: 'Tobi' }); const jc = r.data._id; ok(r.data.status === 'active', 'caso Tobi');
  r = await K.req('POST', `/api/cases/${jc}/join`, { zone: 'A1' }); ok(r.status === 200, 'K se une');
  r = await L.req('POST', `/api/cases/${jc}/join`, { zone: 'B2' }); ok(r.status === 200, 'L se une');
  r = await M.req('POST', `/api/cases/${jc}/sightings`, { where: 'Av. Larco 500', lat: -12.1215, lng: -77.0299, stillThere: 'yes', note: 'lo vi cruzando' }); ok(r.status === 200, 'M reporta pista');
  for (const [who, name] of [[K, 'K'], [L, 'L']]) { r = await who.req('GET', '/api/notifications'); ok(r.data.some((n) => n.type === 'sighting' && /Nueva pista/.test(n.title) && n.caseId === jc), `${name} recibe aviso de la pista`); }
  r = await M.req('GET', '/api/notifications'); ok(!r.data.some((n) => /Nueva pista/.test(n.title)), 'quien reportó no recibe aviso');
  r = await J.req('GET', '/api/notifications'); ok(r.data.some((n) => /Posible pista/.test(n.title)), 'el dueño recibe su aviso');
  await M.req('POST', `/api/cases/${jc}/sightings`, { where: 'Calle Berlín', lat: -12.122, lng: -77.031, stillThere: 'unsure' });
  r = await K.req('GET', '/api/notifications'); ok(r.data.filter((n) => n.type === 'sighting').length === 2, 'K: 2 avisos dentro de la app');
  const { rows: ke } = await pool.query(`SELECT 1 FROM outbox WHERE to_email='k.test@test.pe' AND subject LIKE 'Nueva pista%'`); ok(ke.length === 1, `correo limitado a 1 cada 15 min (${ke.length})`);
  ok(!JSON.stringify((await K.req('GET', '/api/notifications')).data).includes('lo vi cruzando'), 'el aviso no filtra la nota privada');

  // Zonas, consejos y resumen
  r = await K.req('GET', `/api/cases/${jc}/plan`);
  ok(r.status === 200 && r.data.cells.length > 0 && r.data.radiusKm > 0 && ['A1', 'A2', 'B1', 'B2'].includes(r.data.suggestedZone) && r.data.center.source === 'sighting' && r.data.myZone === 'A1', `plan de búsqueda ${r.status}`);
  ok(r.data.cells.every((c) => c.score >= 0 && c.score <= 1 && c.bounds.length === 2), 'celdas con puntaje 0-1');
  await K.req('POST', `/api/cases/${jc}/inspect`, { zone: 'A1' });
  const p2 = await K.req('GET', `/api/cases/${jc}/plan`); ok(p2.data.zones.find((z) => z.zone === 'A1').inspected === true, 'zona inspeccionada se refleja');
  r = await K.req('GET', `/api/cases/${jc}/tips`); ok(r.data.source === 'ia' && r.data.text.includes('Consejo IA'), 'consejos con IA');
  r = await K.req('GET', `/api/cases/${jc}/summary`); ok(r.data.source === 'ia' && r.data.count === 2 && r.data.text.includes('Resumen IA'), 'resumen con IA');
  r = await M.req('GET', `/api/cases/${jc}/summary`); ok(r.status === 403, 'el resumen no es para quien no participa');
  r = await J.req('GET', `/api/cases/${jc}/summary`); ok(r.status === 200, 'el dueño ve el resumen');
  r = await anon.req('GET', `/api/cases/${jc}/plan`); ok(r.status === 401, 'plan requiere sesión');
  r = await H.req('GET', `/api/cases/${linky}/plan`); ok(r.status === 200, 'el dueño ve el plan de su alerta en revisión');
  r = await K.req('GET', `/api/cases/${linky}/plan`); ok(r.status === 404, 'otros no ven el plan de una alerta en revisión');

  // Asistente
  r = await K.req('POST', '/api/assistant', { message: '¿Cómo creo una alerta?' }); ok(r.status === 200 && r.data.source === 'ia' && r.data.answer, 'asistente con IA');
  r = await K.req('POST', '/api/assistant', { message: 'Hay una emergencia, una persona en peligro' }); ok(r.data.source === 'emergencia' && /105/.test(r.data.answer), 'emergencia → 105 sin IA');
  r = await K.req('POST', '/api/assistant', { message: '' }); ok(r.status === 400, 'pregunta vacía rechazada');
  r = await anon.req('POST', '/api/assistant', { message: 'hola' }); ok(r.status === 401, 'asistente requiere sesión');
  // privacidad hacia la IA: nunca se envían teléfonos ni correos
  const sent = aiLog.join('\n'); ok(aiLog.length > 5 && !/\+51|912 345 678|@test\.pe|Usuario /.test(sent), `a la IA no se envían datos personales (${aiLog.length} llamadas)`);

  // Archivado automático, renovación y casos de prueba
  const { runMaintenance } = await import('../server/lib/maintenance.js');
  await pool.query(`UPDATE cases SET last_activity_at = now() - interval '13 days' WHERE id=$1`, [jc]);
  await pool.query(`UPDATE cases SET is_demo = TRUE, last_activity_at = now() - interval '40 days' WHERE id=$1`, [mora]);
  let m = await runMaintenance(); ok(m.warned >= 1, 'avisa antes de archivar');
  r = await J.req('GET', '/api/notifications'); ok(r.data.some((n) => /se archivará pronto/.test(n.title)), 'dueño avisado');
  await pool.query(`UPDATE cases SET last_activity_at = now() - interval '20 days' WHERE id=$1`, [jc]);
  m = await runMaintenance(); ok(m.archived >= 1, 'archiva por inactividad');
  row = await getRow(jc); ok(row.status === 'archived', 'estado archivado');
  row = await getRow(mora); ok(row.status === 'active', 'los casos de prueba no se archivan');
  r = await G.req('GET', `/api/cases/${mora}`); ok(r.data.isDemo === true, 'caso de prueba marcado isDemo');
  r = await K.req('GET', '/api/cases?radiusKm=0'); ok(!r.data.some((c) => c._id === jc), 'archivado no sale en el mapa');
  r = await J.req('GET', '/api/cases/mine'); ok(r.data.find((c) => c._id === jc)?.status === 'archived', 'el dueño lo ve archivado');
  r = await K.req('GET', '/api/notifications'); ok(r.data.some((n) => /se pausó/.test(n.title)), 'voluntarios avisados de la pausa');
  r = await K.req('POST', `/api/cases/${jc}/renew`, {}); ok(r.status === 404, 'solo el dueño renueva');
  r = await J.req('POST', `/api/cases/${jc}/renew`, {}); ok(r.status === 200 && r.data.status === 'active', 'el dueño reactiva su alerta');
  r = await K.req('GET', '/api/cases?radiusKm=0'); ok(r.data.some((c) => c._id === jc), 'vuelve al mapa');

  // Tope diario de la IA: al agotarse, se sigue con reglas
  await pool.query(`UPDATE ai_usage SET calls = 200 WHERE day = current_date`);
  const P = await mk('p.test'); await pool.query(`UPDATE users SET created_at = now() - interval '1 day' WHERE username='p.test'`);
  r = await P.req('POST', '/api/cases', { ...caseBody, name: 'Sin cupo' }); row = await getRow(r.data._id);
  ok(r.data.status === 'active' && row.risk_source === 'reglas', 'sin cupo de IA → solo reglas');
} catch (e) { fail++; console.log('EXCEPCIÓN', e); }
srv.kill(); mockAi.close(); await pool.end();
console.log(`\n${pass} pruebas correctas, ${fail} fallidas`);
process.exit(fail ? 1 : 0);
