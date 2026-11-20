// Casos de PRUEBA para que el mapa no se vea vacío. Todos quedan marcados como "CASO DE PRUEBA"
// (etiqueta en el pin, en la ficha y en la descripción) y no se archivan solos.
//   npm run seed:demo               → carga (o vuelve a cargar con fechas nuevas) los casos de prueba
//   npm run seed:demo -- --remove   → borra todos los casos y usuarios de prueba
import { pool } from './lib/db.js';
import { hashPassword, newId } from './lib/security.js';
import { migrate } from './migrate.js';

if (process.env.NODE_ENV === 'production' && process.env.ALLOW_DEMO_SEED !== 'true') {
  console.error('Por seguridad no se cargan datos de prueba en producción. Usa ALLOW_DEMO_SEED=true si es una presentación.'); process.exit(1);
}
await migrate();

const remove = async () => {
  await pool.query(`DELETE FROM cases WHERE is_demo`);
  await pool.query(`DELETE FROM users WHERE id LIKE 'usr_demo_%'`);
};
await remove();                                   // siempre se parte de cero: así no se duplican
if (process.argv.includes('--remove')) { console.log('Casos y usuarios de prueba eliminados.'); await pool.end(); process.exit(0); }

const hash = await hashPassword('Demo1234');
const users = [
  ['usr_demo_admin', 'Equipo de Moderación', 'moderador', 'moderador@demo.siemprecerca.app', '999888777', 'admin'],
  ['usr_demo_maria', 'María Castillo', 'maria.castillo', 'maria@demo.siemprecerca.app', '987654321', 'user'],
  ['usr_demo_jose', 'José Ramírez', 'jose.ramirez', 'jose@demo.siemprecerca.app', '976543210', 'user'],
  ['usr_demo_lucia', 'Lucía Torres', 'lucia.torres', 'lucia@demo.siemprecerca.app', '965432109', 'user'],
  ['usr_demo_diego', 'Diego Paredes', 'diego.paredes', 'diego@demo.siemprecerca.app', '954321098', 'user'],
];
for (const [id, name, username, email, phone, role] of users) {
  await pool.query(`INSERT INTO users (id,name,username,email,phone,password_hash,role,home_lat,home_lng,notify_email) VALUES ($1,$2,$3,$4,$5,$6,$7,-12.12,-77.03,FALSE)`,
    [id, name, username, email, phone, hash, role]);
}

// [id, dueño, tipo, nombre, raza/edad, descripción, lat, lng, referencia, horas desde que se vio]
const cases = [
  ['bruno',  'maria', 'pet',    'Bruno',        'Labrador · 3 años',   'Collar rojo, muy cariñoso. Responde a su nombre.',                -12.1211, -77.0297, 'Parque Kennedy, Miraflores', 2],
  ['carmen', 'jose',  'person', 'Carmen R.',    '72 años',             'Chaleco azul, camina con bastón. Puede estar desorientada.',      -12.1035, -77.0372, 'Av. Arequipa cdra. 45, San Isidro', 4],
  ['michi',  'lucia', 'pet',    'Michi',        'Gata siamesa · 2 años','Ojos azules, collar con cascabel. Muy asustadiza.',               -12.1490, -77.0210, 'Malecón de Barranco', 30],
  ['thiago', 'diego', 'person', 'Thiago P.',    '9 años',              'Polera amarilla y mochila verde. Salió del colegio y no llegó a casa.', -12.0710, -77.0510, 'Av. Brasil, Jesús María', 1],
  ['rocky',  'maria', 'pet',    'Rocky',        'Mestizo · 5 años',    'Pelaje marrón, una oreja caída. Se escapó al abrir el portón.',   -12.1450, -76.9930, 'Parque de Los Álamos, Surco', 9],
  ['luna',   'jose',  'pet',    'Luna',         'Poodle blanca · 1 año','Lazo rosado en la cabeza. Tiene microchip.',                       -12.0850, -76.9450, 'Av. La Molina, La Molina', 20],
  ['don',    'lucia', 'person', 'Don Alfredo M.','78 años',            'Gorra gris y camisa a cuadros. Toma medicación diaria.',           -12.0770, -77.0900, 'Plaza San Miguel, San Miguel', 3],
  ['coco',   'diego', 'pet',    'Coco',         'Loro · 4 años',       'Verde con pecho amarillo. Dice "hola" y silba.',                  -12.0830, -77.0340, 'Av. Petit Thouars, Lince', 5],
  ['simba',  'maria', 'pet',    'Simba',        'Gato naranja · 6 años','Muy grande, sin collar. Es de interior.',                          -12.0900, -77.0720, 'Av. Sucre, Magdalena', 14],
  ['lucho',  'jose',  'person', 'Lucho G.',     '17 años',             'Casaca negra y zapatillas blancas. Su familia lo busca desde la noche.', -11.9850, -77.0050, 'Av. Wiesse, San Juan de Lurigancho', 6],
];
const ids = {};
for (const [key, owner, type, name, ba, desc, lat, lng, where, hours] of cases) {
  const id = `case_demo_${key}`; ids[key] = id;
  const { rows: [{ n }] } = await pool.query(`SELECT nextval('case_folio_seq') AS n`);
  await pool.query(`INSERT INTO cases (id,folio,owner_id,type,name,breed_or_age,description,lat,lng,last_seen_text,last_seen_at,created_at,
      status,approved_at,contact_phone,is_demo,risk_score,risk_reasons,risk_source)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10, now() - ($11 || ' hours')::interval, now() - ($11 || ' hours')::interval,
      'active', now() - ($11 || ' hours')::interval, '+51 900 000 000', TRUE, 0, '[]'::jsonb, 'prueba')`,
    [id, `SC-${String(n).padStart(4, '0')}`, `usr_demo_${owner}`, type, name, ba, `CASO DE PRUEBA · ${desc}`, lat, lng, where, String(hours)]);
}

// Dos reencuentros (aparecen en "Comunidad")
for (const [key, owner, type, name, lat, lng, where] of [['pelusa', 'lucia', 'pet', 'Pelusa', -12.1000, -77.0300, 'Parque El Olivar, San Isidro'], ['nico', 'diego', 'person', 'Nico T.', -12.1200, -77.0100, 'Av. Primavera, Surco']]) {
  const { rows: [{ n }] } = await pool.query(`SELECT nextval('case_folio_seq') AS n`);
  await pool.query(`INSERT INTO cases (id,folio,owner_id,type,name,breed_or_age,description,lat,lng,last_seen_text,last_seen_at,status,approved_at,resolved_at,resolution_note,contact_phone,is_demo,risk_score,risk_reasons,risk_source)
    VALUES ($1,$2,$3,$4,$5,'', 'CASO DE PRUEBA · Ya fue encontrado.', $6,$7,$8, now() - interval '3 days','resolved', now() - interval '3 days', now() - interval '1 day','Apareció sano y salvo','+51 900 000 000', TRUE, 0, '[]'::jsonb, 'prueba')`,
    [`case_demo_${key}`, `SC-${String(n).padStart(4, '0')}`, `usr_demo_${owner}`, type, name, lat, lng, where]);
}

// Pistas y voluntarios para que el mapa de calor y los cuadrantes tengan datos
const sightings = [
  ['bruno', 'diego', 'Av. Larco con Diez Canseco', -12.1225, -77.0310, 'yes', 1.2],
  ['bruno', 'lucia', 'Parque Domodossola', -12.1198, -77.0288, 'unsure', 0.6],
  ['carmen', 'maria', 'Paradero de Av. Arequipa', -12.1050, -77.0360, 'yes', 2.5],
  ['thiago', 'jose', 'Frente al colegio, Av. Brasil', -12.0725, -77.0525, 'no', 0.5],
  ['rocky', 'lucia', 'Calle Los Cedros', -12.1462, -76.9941, 'yes', 3.0],
];
for (const [key, who, place, lat, lng, still, hours] of sightings) {
  await pool.query(`INSERT INTO sightings (id,case_id,reporter_id,place,note,lat,lng,still_there,created_at) VALUES ($1,$2,$3,$4,'Pista de prueba',$5,$6,$7, now() - ($8 || ' hours')::interval)`,
    [newId('sigt'), ids[key], `usr_demo_${who}`, place, lat, lng, still, String(hours)]);
}
for (const [key, who, zone, inspected] of [['bruno', 'jose', 'A1', true], ['bruno', 'lucia', 'B2', false], ['carmen', 'maria', 'A2', false], ['carmen', 'diego', 'B1', true], ['thiago', 'maria', 'A1', false], ['rocky', 'diego', 'A2', false]]) {
  await pool.query(`INSERT INTO participations (id,case_id,user_id,zone,inspected) VALUES ($1,$2,$3,$4,$5)`, [newId('part'), ids[key], `usr_demo_${who}`, zone, inspected]);
}

console.log(`Listo: ${cases.length} casos de prueba activos + 2 reencuentros, marcados como "CASO DE PRUEBA".`);
console.log('Usuarios de prueba (clave Demo1234): moderador (admin), maria.castillo, jose.ramirez, lucia.torres, diego.paredes.');
console.log('Para borrarlos todos: npm run seed:demo -- --remove');
await pool.end();
