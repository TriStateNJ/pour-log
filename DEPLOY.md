// GET /api/state?job=942
// Returns the full live snapshot for a job: lanes, active pours, queue, recent history, notes.
// Frontend polls this every ~10s for multi-user sync.

import { sql, json, badRequest, serverError, handleOptions, normalizeJob } from './_db.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  const job = normalizeJob(req.query.job);
  if (!job) return badRequest(res, 'job query parameter required');

  try {
    const [lanesR, activeR, queueR, historyR, notesR] = await Promise.all([
      sql`SELECT id, name, equipment, position FROM lanes WHERE job_no = ${job} AND NOT archived ORDER BY position, id`,
      sql`SELECT id, lane_id, lane_name, equipment, operator, truck, cy, supplier, mix, notes,
                 arrived_at, started_at
            FROM pours
           WHERE job_no = ${job} AND ended_at IS NULL AND NOT cancelled
           ORDER BY started_at`,
      sql`SELECT id, truck, cy, supplier, mix, added_by, added_at
            FROM queue
           WHERE job_no = ${job} AND assigned_to_pour_id IS NULL
           ORDER BY added_at`,
      sql`SELECT id, lane_id, lane_name, equipment, operator, truck, cy, supplier, mix, notes,
                 arrived_at, started_at, ended_at
            FROM pours
           WHERE job_no = ${job} AND ended_at IS NOT NULL AND NOT cancelled
           ORDER BY ended_at DESC
           LIMIT 200`,
      sql`SELECT id, operator, text, created_at FROM notes WHERE job_no = ${job} ORDER BY created_at DESC LIMIT 50`
    ]);

    return json(res, 200, {
      job,
      ts: Date.now(),
      lanes: lanesR.rows,
      activePours: activeR.rows,
      queue: queueR.rows,
      history: historyR.rows,
      notes: notesR.rows
    });
  } catch (err) {
    return serverError(res, err);
  }
}
