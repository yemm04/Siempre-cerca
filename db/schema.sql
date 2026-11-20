-- Siempre Cerca · Esquema PostgreSQL
-- Se ejecuta solo (de forma idempotente) al iniciar el servidor: `npm run migrate`.
-- Compatible con PostgreSQL 14+ (Neon). No requiere extensiones.

CREATE TABLE IF NOT EXISTS users (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  username      TEXT NOT NULL,
  email         TEXT NOT NULL,
  phone         TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'user'   CHECK (role   IN ('user','moderator','admin')),
  status        TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active','banned')),
  ban_reason    TEXT,
  banned_at     TIMESTAMPTZ,
  radius_km     INTEGER NOT NULL DEFAULT 5 CHECK (radius_km BETWEEN 1 AND 50),
  notify_email  BOOLEAN NOT NULL DEFAULT TRUE,
  share_location BOOLEAN NOT NULL DEFAULT TRUE,
  home_lat      DOUBLE PRECISION,
  home_lng      DOUBLE PRECISION,
  created_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_username_uq ON users (lower(username));
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uq    ON users (lower(email));
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_uq    ON users (phone);

-- Sesiones: solo se guarda el hash del token (si se filtra la tabla, no sirven)
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user_idx ON sessions (user_id);

-- Códigos de verificación enviados por correo (guardados con hash)
CREATE TABLE IF NOT EXISTS email_codes (
  id         BIGSERIAL PRIMARY KEY,
  email      TEXT NOT NULL,
  purpose    TEXT NOT NULL,
  code_hash  TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  expires_at TIMESTAMPTZ NOT NULL,
  used_at    TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS email_codes_lookup ON email_codes (lower(email), purpose, created_at DESC);

CREATE SEQUENCE IF NOT EXISTS case_folio_seq START 1001;

CREATE TABLE IF NOT EXISTS cases (
  id             TEXT PRIMARY KEY,
  folio          TEXT NOT NULL UNIQUE,
  owner_id       TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type           TEXT NOT NULL CHECK (type IN ('person','pet')),
  name           TEXT NOT NULL,
  breed_or_age   TEXT NOT NULL DEFAULT '',
  description    TEXT NOT NULL DEFAULT '',
  photo          TEXT NOT NULL DEFAULT '',
  thumb          TEXT NOT NULL DEFAULT '',
  lat            DOUBLE PRECISION NOT NULL,
  lng            DOUBLE PRECISION NOT NULL,
  last_seen_text TEXT NOT NULL DEFAULT '',
  last_seen_at   TIMESTAMPTZ NOT NULL DEFAULT now(),
  contact_phone  TEXT NOT NULL DEFAULT '',
  relation       TEXT NOT NULL DEFAULT 'owner',
  status         TEXT NOT NULL DEFAULT 'active'
                 CHECK (status IN ('pending_review','active','resolved','rejected')),
  rejection_reason TEXT,
  resolution_note  TEXT,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  approved_at    TIMESTAMPTZ,
  resolved_at    TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS cases_status_idx ON cases (status, created_at DESC);
CREATE INDEX IF NOT EXISTS cases_owner_idx  ON cases (owner_id);

-- Denuncias de la comunidad contra una alerta (con 3 distintas se oculta para revisión)
CREATE TABLE IF NOT EXISTS case_reports (
  case_id    TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason     TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (case_id, user_id)
);

CREATE TABLE IF NOT EXISTS sightings (
  id          TEXT PRIMARY KEY,
  case_id     TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  reporter_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  place       TEXT NOT NULL DEFAULT '',
  note        TEXT NOT NULL DEFAULT '',
  photo       TEXT,
  lat         DOUBLE PRECISION NOT NULL,
  lng         DOUBLE PRECISION NOT NULL,
  still_there TEXT NOT NULL DEFAULT 'yes',
  status      TEXT NOT NULL DEFAULT 'received' CHECK (status IN ('received','confirmed','helped')),
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sightings_case_idx     ON sightings (case_id, created_at DESC);
CREATE INDEX IF NOT EXISTS sightings_reporter_idx ON sightings (reporter_id);

CREATE TABLE IF NOT EXISTS participations (
  id        TEXT PRIMARY KEY,
  case_id   TEXT NOT NULL REFERENCES cases(id) ON DELETE CASCADE,
  user_id   TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  zone      TEXT NOT NULL DEFAULT 'A2',
  inspected BOOLEAN NOT NULL DEFAULT FALSE,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (case_id, user_id)
);

CREATE TABLE IF NOT EXISTS notifications (
  id         TEXT PRIMARY KEY,
  user_id    TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type       TEXT NOT NULL,
  title      TEXT NOT NULL,
  body       TEXT NOT NULL DEFAULT '',
  case_id    TEXT REFERENCES cases(id) ON DELETE CASCADE,
  read       BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS notifications_user_idx ON notifications (user_id, created_at DESC);

-- Cola de correos: si el envío falla se reintenta (el servidor la revisa cada 20 s)
CREATE TABLE IF NOT EXISTS outbox (
  id         BIGSERIAL PRIMARY KEY,
  to_email   TEXT NOT NULL,
  to_name    TEXT,
  subject    TEXT NOT NULL,
  html       TEXT NOT NULL,
  text       TEXT NOT NULL,
  attempts   INTEGER NOT NULL DEFAULT 0,
  next_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  sent_at    TIMESTAMPTZ,
  last_error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS outbox_pending_idx ON outbox (next_at) WHERE sent_at IS NULL;

CREATE TABLE IF NOT EXISTS audit (
  id           TEXT PRIMARY KEY,
  admin_id     TEXT,
  admin_name   TEXT NOT NULL DEFAULT 'Sistema',
  action       TEXT NOT NULL,
  target_type  TEXT NOT NULL,
  target_id    TEXT,
  target_label TEXT,
  detail       TEXT NOT NULL DEFAULT '',
  created_at   TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS audit_created_idx ON audit (created_at DESC);

-- ============================================================
-- Versión 2: revisión automática (puntaje de riesgo), reputación, archivado,
-- resúmenes/consejos guardados, casos de prueba y control de uso de la IA.
-- Todo es idempotente: se puede ejecutar cuantas veces haga falta sin borrar datos.
-- ============================================================
ALTER TABLE users ADD COLUMN IF NOT EXISTS reputation INTEGER NOT NULL DEFAULT 0;

ALTER TABLE cases ADD COLUMN IF NOT EXISTS risk_score      INTEGER;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS risk_reasons    JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS risk_source     TEXT;          -- 'reglas' | 'reglas+ia'
ALTER TABLE cases ADD COLUMN IF NOT EXISTS is_demo         BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS last_activity_at TIMESTAMPTZ NOT NULL DEFAULT now();
ALTER TABLE cases ADD COLUMN IF NOT EXISTS archive_warned  BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS archived_at     TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS ai_summary      TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS ai_summary_at   TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS ai_summary_n    INTEGER NOT NULL DEFAULT 0;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS ai_tips         TEXT;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS ai_tips_at      TIMESTAMPTZ;
ALTER TABLE cases ADD COLUMN IF NOT EXISTS ai_tips_n       INTEGER NOT NULL DEFAULT 0;

-- Estado nuevo: 'archived' (alerta sin actividad). Se reemplaza la restricción de forma segura.
ALTER TABLE cases DROP CONSTRAINT IF EXISTS cases_status_check;
ALTER TABLE cases ADD CONSTRAINT cases_status_check
  CHECK (status IN ('pending_review','active','resolved','rejected','archived'));

CREATE INDEX IF NOT EXISTS cases_activity_idx ON cases (status, last_activity_at);

-- Contador diario de llamadas a la IA (para respetar AI_DAILY_LIMIT)
CREATE TABLE IF NOT EXISTS ai_usage (
  day   DATE PRIMARY KEY,
  calls INTEGER NOT NULL DEFAULT 0
);

-- Contadores diarios genéricos (por ejemplo, tope de SMS por día para no gastar de más)
CREATE TABLE IF NOT EXISTS daily_counters (
  day DATE NOT NULL,
  key TEXT NOT NULL,
  n   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (day, key)
);
