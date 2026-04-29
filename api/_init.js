// One-time schema setup endpoint. Hit GET /api/_init?secret=<INIT_SECRET> after first deploy
// to create the tables. Idempotent — safe to call multiple times.
//
// Set the INIT_SECRET environment variable in Vercel to any random string of your choosing.

import { sql, json, serverError } from './_db.js';

export default async function handler(req, res) {
  const secret = req.query.secret || '';
  if (!process.env.INIT_SECRET || secret !== process.env.INIT_SECRET) {
    return json(res, 401, { error: 'INIT_SECRET missing or wrong' });
  }

  try {
    await sql`
      CREATE TABLE IF NOT EXISTS lanes (
        id           SERIAL PRIMARY KEY,
        job_no       TEXT NOT NULL,
        name         TEXT NOT NULL,
        equipment    TEXT NOT NULL,
        position     INTEGER DEFAULT 0,
        archived     BOOLEAN DEFAULT FALSE,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS lanes_job_active ON lanes(job_no) WHERE NOT archived;`;

    await sql`
      CREATE TABLE IF NOT EXISTS pours (
        id           SERIAL PRIMARY KEY,
        job_no       TEXT NOT NULL,
        lane_id      INTEGER REFERENCES lanes(id) ON DELETE SET NULL,
        lane_name    TEXT NOT NULL,
        equipment    TEXT NOT NULL,
        operator     TEXT,
        truck        TEXT,
        cy           NUMERIC(10,2) DEFAULT 0,
        supplier     TEXT,
        mix          TEXT,
        notes        TEXT,
        arrived_at   TIMESTAMPTZ NOT NULL,
        started_at   TIMESTAMPTZ NOT NULL,
        ended_at     TIMESTAMPTZ NULL,
        cancelled    BOOLEAN DEFAULT FALSE,
        created_at   TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS pours_active ON pours(job_no) WHERE ended_at IS NULL AND NOT cancelled;`;
    await sql`CREATE INDEX IF NOT EXISTS pours_history ON pours(job_no, ended_at DESC) WHERE ended_at IS NOT NULL;`;

    await sql`
      CREATE TABLE IF NOT EXISTS queue (
        id                  SERIAL PRIMARY KEY,
        job_no              TEXT NOT NULL,
        truck               TEXT NOT NULL,
        cy                  NUMERIC(10,2) DEFAULT 0,
        supplier            TEXT,
        mix                 TEXT,
        added_by            TEXT,
        added_at            TIMESTAMPTZ DEFAULT NOW(),
        assigned_to_pour_id INTEGER REFERENCES pours(id) ON DELETE SET NULL
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS queue_waiting ON queue(job_no) WHERE assigned_to_pour_id IS NULL;`;

    await sql`
      CREATE TABLE IF NOT EXISTS notes (
        id          SERIAL PRIMARY KEY,
        job_no      TEXT NOT NULL,
        operator    TEXT,
        text        TEXT NOT NULL,
        created_at  TIMESTAMPTZ DEFAULT NOW()
      );
    `;
    await sql`CREATE INDEX IF NOT EXISTS notes_job ON notes(job_no, created_at DESC);`;

    // Simple JSON-blob state sync (used by the frontend in v1).
    await sql`
      CREATE TABLE IF NOT EXISTS state_blob (
        job_no       TEXT PRIMARY KEY,
        state        JSONB NOT NULL,
        updated_at   TIMESTAMPTZ DEFAULT NOW()
      );
    `;

    return json(res, 200, { ok: true, message: 'schema ready' });
  } catch (err) {
    return serverError(res, err);
  }
}
