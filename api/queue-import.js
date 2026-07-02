// /api/queue-import
//
// Three roles in a single endpoint (routed via method + ?action= query):
//
//   POST  (with X-API-Key header)           → external inbound (Azure Function POSTs parsed Silvi emails here)
//   GET                                     → list all currently-staged imports (called by the app's UI)
//   POST  ?action=accept&id=<n>  body:{job} → operator accepted this import
//   POST  ?action=discard&id=<n>            → operator discarded this import
//
// Auth model: only the external POST requires the API key. GET + accept/discard are open because
// the app doesn't have credentials — the fact that only an authenticated operator can trigger them
// via the browser is our threat model. In a future hardening pass we can add per-operator auth.

import { sql, json, badRequest, serverError, handleOptions } from './_db.js';

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  const action = req.query.action;

  try {
    // ===== GET: list staged imports for the UI =====
    if (req.method === 'GET') {
      const r = await sql`
        SELECT id, source, silvi_job, truck, cy, supplier, mix,
               order_no, ticket_no, batch_time, usage, received_at,
               subject, created_at
        FROM staged_imports
        WHERE status = 'staged'
        ORDER BY created_at ASC
      `;
      return json(res, 200, { imports: r.rows });
    }

    // ===== POST ?action=accept → operator accepted this import =====
    if (req.method === 'POST' && action === 'accept') {
      const id = req.query.id;
      if (!id) return badRequest(res, 'id required');
      const acceptedJob = (req.body && req.body.job) ? String(req.body.job) : null;
      await sql`
        UPDATE staged_imports
        SET status = 'accepted',
            accepted_job = ${acceptedJob},
            accepted_at = NOW()
        WHERE id = ${id}
      `;
      return json(res, 200, { ok: true, id });
    }

    // ===== POST ?action=discard → operator discarded this import =====
    if (req.method === 'POST' && action === 'discard') {
      const id = req.query.id;
      if (!id) return badRequest(res, 'id required');
      await sql`
        UPDATE staged_imports
        SET status = 'discarded',
            accepted_at = NOW()
        WHERE id = ${id}
      `;
      return json(res, 200, { ok: true, id });
    }

    // ===== POST (with API key) → external inbound from Azure Function =====
    if (req.method === 'POST') {
      const apiKey = req.headers['x-api-key'] || req.headers['X-API-Key'];
      if (!process.env.IMPORT_API_KEY || apiKey !== process.env.IMPORT_API_KEY) {
        return json(res, 401, { error: 'unauthorized', message: 'Invalid or missing X-API-Key header' });
      }

      const { source, receivedAt, subject, trucks } = req.body || {};
      if (!Array.isArray(trucks) || trucks.length === 0) {
        return badRequest(res, 'trucks array required');
      }

      let inserted = 0;
      const errors = [];
      for (const t of trucks) {
        try {
          await sql`
            INSERT INTO staged_imports (
              source, silvi_job, truck, cy, supplier, mix,
              order_no, ticket_no, batch_time, usage,
              received_at, subject, raw_payload
            )
            VALUES (
              ${source || 'unknown'},
              ${t.silviJob || null},
              ${t.truck || ''},
              ${parseFloat(t.cy) || 0},
              ${t.supplier || 'Silvi'},
              ${t.mix || ''},
              ${t.orderNo || null},
              ${t.ticketNo || null},
              ${t.batchTime || null},
              ${t.usage || null},
              ${receivedAt ? new Date(receivedAt) : new Date()},
              ${subject || null},
              ${JSON.stringify(t)}::jsonb
            )
          `;
          inserted++;
        } catch (err) {
          console.error('Failed to insert staged import:', err.message);
          errors.push(err.message);
        }
      }
      return json(res, 200, { ok: true, inserted, errors });
    }

    return json(res, 405, { error: 'method_not_allowed' });
  } catch (err) {
    return serverError(res, err);
  }
}
