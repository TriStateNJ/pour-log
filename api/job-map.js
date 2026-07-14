// /api/job-map
//
// GET  → { mappings: { "<silvi_job_name>": "<tscnj_job_num>", ... } }
// POST body: { silvi_job, tscnj_job_num, created_by? } → upserts a mapping
// DELETE body: { silvi_job } → removes a mapping

import { sql, json, badRequest, serverError, handleOptions } from './_db.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;

  try {
    if (req.method === 'GET') {
      const r = await sql`SELECT silvi_job, tscnj_job_num FROM silvi_job_map`;
      const mappings = {};
      for (const row of r.rows) mappings[row.silvi_job] = row.tscnj_job_num;
      return json(res, 200, { mappings, count: r.rows.length });
    }

    if (req.method === 'POST') {
      const { silvi_job, tscnj_job_num, created_by } = req.body || {};
      if (!silvi_job || !tscnj_job_num) return badRequest(res, 'silvi_job and tscnj_job_num required');
      await sql`
        INSERT INTO silvi_job_map (silvi_job, tscnj_job_num, created_by)
        VALUES (${silvi_job}, ${String(tscnj_job_num)}, ${created_by || null})
        ON CONFLICT (silvi_job)
        DO UPDATE SET tscnj_job_num = EXCLUDED.tscnj_job_num, created_by = EXCLUDED.created_by, created_at = NOW()
      `;
      return json(res, 200, { ok: true, silvi_job, tscnj_job_num });
    }

    if (req.method === 'DELETE') {
      const silvi_job = req.query.silvi_job || (req.body && req.body.silvi_job);
      if (!silvi_job) return badRequest(res, 'silvi_job required');
      await sql`DELETE FROM silvi_job_map WHERE silvi_job = ${silvi_job}`;
      return json(res, 200, { ok: true, silvi_job });
    }

    return json(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
