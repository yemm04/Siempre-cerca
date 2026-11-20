import { pathToFileURL } from 'node:url';
import http from 'node:http';
import { ENV } from './lib/env.js';
import { handleApi, serveStatic, sendJson } from './lib/http.js';
import { resolveUser } from './lib/session.js';
import { startOutboxWorker, flushOutbox } from './lib/mailer.js';
import { pool, query } from './lib/db.js';
import { migrate } from './migrate.js';
import './routes/auth.js';
import './routes/cases.js';
import './routes/community.js';
import './routes/admin.js';
import './routes/insights.js';
import { startMaintenance } from './lib/maintenance.js';

export function createServer() {
  return http.createServer((req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname === '/healthz') {
      return query('SELECT 1').then(() => sendJson(res, 200, { ok: true }), () => sendJson(res, 503, { ok: false }));
    }
    if (url.pathname.startsWith('/api/')) return handleApi(req, res, url, resolveUser);
    return serveStatic(req, res, url);
  });
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate();
  const server = createServer();
  server.requestTimeout = 30_000;
  server.listen(ENV.port, () => console.log(`Siempre Cerca escuchando en el puerto ${ENV.port}`));
  startOutboxWorker();
  startMaintenance();
  flushOutbox();
  const stop = () => server.close(() => pool.end().then(() => process.exit(0)));
  process.on('SIGTERM', stop); process.on('SIGINT', stop);
}
