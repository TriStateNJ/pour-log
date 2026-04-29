// /api/notes
//   POST   { job, text, operator? }   -> add a note/issue

import { sql, json, badRequest, serverError, handleOptions, normalizeJob } from './_db.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });
  try {
    const { job, text, operator } = req.body || {};
    const j = normalizeJob(job);
    if (!j || !text) return badRequest(res, 'job and text required');
    const r = await sql`
      INSERT INTO notes (job_no, operator, text)
      VALUES (${j}, ${operator || null}, ${text})
      RETURNING id, operator, text, created_at
    `;
    return json(res, 201, r.rows[0]);
  } catch (err) {
    return serverError(res, err);
  }
}
