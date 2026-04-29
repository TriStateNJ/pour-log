// /api/queue
//   POST   { job, truck, cy?, supplier?, mix?, added_by? }   -> add waiting truck
//   DELETE ?id=N                                             -> remove from queue
//   POST   ?id=N&action=assign  body: { lane_id, operator? } -> assign queued truck to a lane (creates pour)

import { sql, json, badRequest, notFound, serverError, handleOptions, normalizeJob } from './_db.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const method = req.method;
  const id = req.query.id ? parseInt(req.query.id, 10) : null;
  const action = (req.query.action || '').toLowerCase();

  try {
    if (method === 'POST' && action === 'assign' && id) {
      const { lane_id, operator } = req.body || {};
      if (!lane_id) return badRequest(res, 'lane_id required');
      // Get queue row
      const q = await sql`SELECT * FROM queue WHERE id = ${id} AND assigned_to_pour_id IS NULL`;
      if (!q.rows.length) return notFound(res, 'queue entry not found or already assigned');
      const lane = await sql`SELECT id, name, equipment FROM lanes WHERE id = ${lane_id} AND NOT archived`;
      if (!lane.rows.length) return notFound(res, 'lane not found');
      const busy = await sql`SELECT id FROM pours WHERE lane_id = ${lane_id} AND ended_at IS NULL AND NOT cancelled`;
      if (busy.rows.length) return json(res, 409, { error: 'lane already has an active pour' });
      const row = q.rows[0];
      const now = new Date();
      const ins = await sql`
        INSERT INTO pours (job_no, lane_id, lane_name, equipment, operator, truck, cy, supplier, mix, arrived_at, started_at)
        VALUES (${row.job_no}, ${lane_id}, ${lane.rows[0].name}, ${lane.rows[0].equipment}, ${operator || null},
                ${row.truck}, ${row.cy}, ${row.supplier || ''}, ${row.mix || ''}, ${row.added_at}, ${now})
        RETURNING *
      `;
      await sql`UPDATE queue SET assigned_to_pour_id = ${ins.rows[0].id} WHERE id = ${id}`;
      return json(res, 201, ins.rows[0]);
    }

    if (method === 'POST') {
      const { job, truck, cy, supplier, mix, added_by } = req.body || {};
      const j = normalizeJob(job);
      if (!j || !truck) return badRequest(res, 'job and truck required');
      const r = await sql`
        INSERT INTO queue (job_no, truck, cy, supplier, mix, added_by)
        VALUES (${j}, ${truck}, ${cy || 0}, ${supplier || ''}, ${mix || ''}, ${added_by || null})
        RETURNING id, truck, cy, supplier, mix, added_by, added_at
      `;
      return json(res, 201, r.rows[0]);
    }

    if (method === 'DELETE' && id) {
      await sql`DELETE FROM queue WHERE id = ${id} AND assigned_to_pour_id IS NULL`;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
