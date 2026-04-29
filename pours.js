// /api/lanes
//   POST   { job, name, equipment }            -> create
//   PATCH  { id, name?, equipment? }           -> rename / change equipment
//   DELETE ?id=N                               -> archive (soft delete)

import { sql, json, badRequest, notFound, serverError, handleOptions, normalizeJob } from './_db.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method === 'POST') {
      const { job, name, equipment } = req.body || {};
      const j = normalizeJob(job);
      if (!j || !name || !equipment) return badRequest(res, 'job, name, equipment required');
      const r = await sql`
        INSERT INTO lanes (job_no, name, equipment)
        VALUES (${j}, ${name}, ${equipment})
        RETURNING id, name, equipment, position
      `;
      return json(res, 201, r.rows[0]);
    }

    if (req.method === 'PATCH') {
      const { id, name, equipment } = req.body || {};
      if (!id) return badRequest(res, 'id required');
      const r = await sql`
        UPDATE lanes
           SET name = COALESCE(${name ?? null}, name),
               equipment = COALESCE(${equipment ?? null}, equipment)
         WHERE id = ${id}
         RETURNING id, name, equipment, position
      `;
      if (!r.rows.length) return notFound(res, 'lane not found');
      return json(res, 200, r.rows[0]);
    }

    if (req.method === 'DELETE') {
      const id = parseInt(req.query.id, 10);
      if (!id) return badRequest(res, 'id required');
      // Refuse if there's an active pour attached.
      const active = await sql`SELECT id FROM pours WHERE lane_id = ${id} AND ended_at IS NULL AND NOT cancelled LIMIT 1`;
      if (active.rows.length) return json(res, 409, { error: 'lane has an active pour' });
      await sql`UPDATE lanes SET archived = TRUE WHERE id = ${id}`;
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
