// /api/pours
//   POST   { job, lane_id, operator, ... }   action=start  -> begin a new pour on a lane
//   PATCH  { id, truck?, cy?, supplier?, mix?, notes?, arrived_at?, started_at? }
//   POST   ?id=N&action=complete             -> end the pour (set ended_at = now)
//   POST   ?id=N&action=reset                -> reset clock (started_at = now)
//   POST   ?id=N&action=cancel               -> mark cancelled (won't appear in history)
//
// Body methods accept JSON.

import { sql, json, badRequest, notFound, serverError, handleOptions, normalizeJob } from './_db.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const method = req.method;
  const action = (req.query.action || (req.body && req.body.action) || '').toLowerCase();
  const id = req.query.id ? parseInt(req.query.id, 10) : null;

  try {
    // Start a new pour
    if (method === 'POST' && action === 'start') {
      const { job, lane_id, operator, arrived_at, truck, cy, supplier, mix } = req.body || {};
      const j = normalizeJob(job);
      if (!j || !lane_id) return badRequest(res, 'job and lane_id required');
      const lane = await sql`SELECT id, name, equipment FROM lanes WHERE id = ${lane_id} AND NOT archived`;
      if (!lane.rows.length) return notFound(res, 'lane not found');
      // Reject if lane already has an active pour
      const busy = await sql`SELECT id FROM pours WHERE lane_id = ${lane_id} AND ended_at IS NULL AND NOT cancelled LIMIT 1`;
      if (busy.rows.length) return json(res, 409, { error: 'lane already has an active pour' });

      const now = new Date();
      const arrived = arrived_at ? new Date(arrived_at) : now;
      const r = await sql`
        INSERT INTO pours (job_no, lane_id, lane_name, equipment, operator, truck, cy, supplier, mix, arrived_at, started_at)
        VALUES (${j}, ${lane_id}, ${lane.rows[0].name}, ${lane.rows[0].equipment}, ${operator || null},
                ${truck || ''}, ${cy || 0}, ${supplier || ''}, ${mix || ''}, ${arrived}, ${now})
        RETURNING *
      `;
      return json(res, 201, r.rows[0]);
    }

    // Update fields on an active pour
    if (method === 'PATCH') {
      const { id: bodyId, truck, cy, supplier, mix, notes, arrived_at, started_at } = req.body || {};
      const targetId = id || bodyId;
      if (!targetId) return badRequest(res, 'id required');
      const r = await sql`
        UPDATE pours SET
          truck       = COALESCE(${truck ?? null}, truck),
          cy          = COALESCE(${cy ?? null}, cy),
          supplier    = COALESCE(${supplier ?? null}, supplier),
          mix         = COALESCE(${mix ?? null}, mix),
          notes       = COALESCE(${notes ?? null}, notes),
          arrived_at  = COALESCE(${arrived_at ? new Date(arrived_at) : null}, arrived_at),
          started_at  = COALESCE(${started_at ? new Date(started_at) : null}, started_at)
        WHERE id = ${targetId}
        RETURNING *
      `;
      if (!r.rows.length) return notFound(res, 'pour not found');
      return json(res, 200, r.rows[0]);
    }

    // Complete / reset / cancel
    if (method === 'POST' && id && action) {
      if (action === 'complete') {
        const r = await sql`UPDATE pours SET ended_at = NOW() WHERE id = ${id} AND ended_at IS NULL RETURNING *`;
        if (!r.rows.length) return notFound(res, 'pour not found or already ended');
        return json(res, 200, r.rows[0]);
      }
      if (action === 'reset') {
        const r = await sql`UPDATE pours SET started_at = NOW() WHERE id = ${id} AND ended_at IS NULL RETURNING *`;
        if (!r.rows.length) return notFound(res, 'pour not found or already ended');
        return json(res, 200, r.rows[0]);
      }
      if (action === 'cancel') {
        const r = await sql`UPDATE pours SET cancelled = TRUE, ended_at = NOW() WHERE id = ${id} RETURNING id`;
        if (!r.rows.length) return notFound(res, 'pour not found');
        return json(res, 200, { ok: true });
      }
    }

    return json(res, 405, { error: 'unknown method/action' });
  } catch (err) {
    return serverError(res, err);
  }
}
