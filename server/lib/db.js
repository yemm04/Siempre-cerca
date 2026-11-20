import pg from 'pg';
import { ENV } from './env.js';

// Fechas como ISO (el frontend las usa con new Date()), números reales en lugar de texto
pg.types.setTypeParser(1700, parseFloat);
pg.types.setTypeParser(20, parseInt);

export const pool = new pg.Pool({
  connectionString: ENV.databaseUrl,
  ssl: ENV.databaseSsl ? { rejectUnauthorized: true } : false,
  max: 8,
  idleTimeoutMillis: 20000,
  connectionTimeoutMillis: 15000, // Neon puede tardar unos segundos en "despertar"
});
pool.on('error', (err) => console.error('[db] error en conexión inactiva:', err.message));

export const query = (text, params) => pool.query(text, params);

/** Ejecuta varias consultas en una transacción */
export async function tx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const out = await fn(client);
    await client.query('COMMIT');
    return out;
  } catch (e) {
    try { await client.query('ROLLBACK'); } catch { /* ya cerrada */ }
    throw e;
  } finally {
    client.release();
  }
}
