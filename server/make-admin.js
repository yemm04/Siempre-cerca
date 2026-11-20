// Uso: npm run make-admin -- correo@ejemplo.com [moderator|admin]
import { pool } from './lib/db.js';
const [email, role = 'admin'] = process.argv.slice(2);
if (!email || !['admin', 'moderator', 'user'].includes(role)) { console.error('Uso: npm run make-admin -- correo@ejemplo.com [admin|moderator|user]'); process.exit(1); }
const r = await pool.query('UPDATE users SET role=$2 WHERE lower(email)=lower($1) RETURNING username, role', [email, role]);
console.log(r.rowCount ? `Listo: @${r.rows[0].username} ahora es ${r.rows[0].role}.` : 'No existe una cuenta con ese correo. Regístrate primero en la web.');
await pool.end();
