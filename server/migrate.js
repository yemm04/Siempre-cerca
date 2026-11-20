import { pathToFileURL } from 'node:url';
import fs from 'node:fs';
import path from 'node:path';
import { ENV } from './lib/env.js';
import { pool } from './lib/db.js';

export async function migrate() {
  const sql = fs.readFileSync(path.join(ENV.root, 'db', 'schema.sql'), 'utf8');
  await pool.query(sql);
  console.log('Base de datos lista.');
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await migrate();
  await pool.end();
}
