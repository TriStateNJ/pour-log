// /api/sync
//   GET  ?job=942                -> { state, ts } | { state: null }
//   POST { job, state }          -> { ts }
//
// Whole-state JSON sync: simplest possible multi-device persistence.
// Two operators on the same job get last-write-wins behavior, which is fine for the prototype.

import { sql, json, badRequest, serverError, handleOptions, normalizeJob } from './_db.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method === 'GET') {
      const job = normalizeJob(req.query.job);
      if (!job) return badRequest(res, 'job required');
      const r = await sql`SELECT state, EXTRACT(EPOCH FROM updated_at) * 1000 AS ts FROM state_blob WHERE job_no = ${job}`;
      if (!r.rows.length) return json(res, 200, { state: null, ts: 0 });
      return json(res, 200, { state: r.rows[0].state, ts: Math.floor(r.rows[0].ts) });
    }

    if (req.method === 'POST') {
      const { job, state } = req.body || {};
      const j = normalizeJob(job);
      if (!j || !state) return badRequest(res, 'job and state required');
      // Strip operator name so the snapshot is shared cleanly across operators.
      // Each browser keeps its own operator/job in localStorage.
      const shared = { ...state, operator: undefined, job: undefined, dayStart: state.dayStart };
      const r = await sql`
        INSERT INTO state_blob (job_no, state, updated_at)
        VALUES (${j}, ${JSON.stringify(shared)}::jsonb, NOW())
        ON CONFLICT (job_no) DO UPDATE
          SET state = EXCLUDED.state, updated_at = NOW()
        RETURNING EXTRACT(EPOCH FROM updated_at) * 1000 AS ts
      `;
      return json(res, 200, { ts: Math.floor(r.rows[0].ts) });
    }

    return json(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
