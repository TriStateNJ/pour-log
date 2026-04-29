// /api/end-day
// POST { job, operator, history, notes, dayStart }
//   Archives the day's pours into the permanent `pours` table and notes into `notes`.
//   Then clears the live state_blob so the next sign-in starts fresh.
//
// Called by the frontend's Log Out button (which now doubles as End-of-Day).

import { sql, json, badRequest, serverError, handleOptions, normalizeJob } from './_db.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'POST') return json(res, 405, { error: 'method_not_allowed' });

  try {
    const { job, operator, history, notes } = req.body || {};
    const j = normalizeJob(job);
    if (!j) return badRequest(res, 'job required');
    if (!Array.isArray(history)) return badRequest(res, 'history array required');

    let poursInserted = 0;
    for (const h of history) {
      try {
        await sql`
          INSERT INTO pours (
            job_no, lane_name, equipment, operator, truck, cy, supplier, mix, notes,
            arrived_at, started_at, ended_at, cancelled
          )
          VALUES (
            ${j},
            ${h.laneName || ''},
            ${h.equipment || ''},
            ${operator || null},
            ${h.truck || ''},
            ${parseFloat(h.cy) || 0},
            ${h.supplier || ''},
            ${h.mix || ''},
            ${h.notes || ''},
            ${new Date(h.arrivedAt || h.startAt)},
            ${new Date(h.startAt)},
            ${new Date(h.endAt)},
            FALSE
          )
        `;
        poursInserted++;
      } catch (err) {
        console.error('Failed to insert pour:', err.message);
      }
    }

    let notesInserted = 0;
    if (Array.isArray(notes)) {
      for (const n of notes) {
        try {
          await sql`
            INSERT INTO notes (job_no, operator, text, created_at)
            VALUES (${j}, ${operator || null}, ${n.text || ''}, ${new Date(n.ts || Date.now())})
          `;
          notesInserted++;
        } catch (err) { console.error('Failed to insert note:', err.message); }
      }
    }

    // Clear the live state_blob for this job — next sign-in starts fresh.
    await sql`DELETE FROM state_blob WHERE job_no = ${j}`;

    return json(res, 200, { ok: true, poursArchived: poursInserted, notesArchived: notesInserted });
  } catch (err) {
    return serverError(res, err);
  }
}
