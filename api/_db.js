// Shared Postgres client + helpers for all API routes.
// Uses `pg` directly so it works with any Postgres URL (Supabase, Neon, RDS, etc.)
import pg from 'pg';
const { Pool } = pg;

// Pool reused across warm invocations (Vercel keeps the function alive briefly between calls).
const pool = global.__pgPool || new Pool({
  connectionString: process.env.POSTGRES_URL,
  ssl: { rejectUnauthorized: false },
});
if (!global.__pgPool) global.__pgPool = pool;

// Tagged-template `sql` function — same API the routes were already using:
//   const r = await sql`SELECT ...`;
//   r.rows[0].whatever
export const sql = (strings, ...values) => {
  let text = '';
  const params = [];
  strings.forEach((str, i) => {
    text += str;
    if (i < values.length) {
      params.push(values[i]);
      text += `$${params.length}`;
    }
  });
  return pool.query(text, params);
};

// CORS / JSON response helpers — small wrapper to keep route code tidy.
export function json(res, status, body) {
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');
  res.status(status).end(JSON.stringify(body));
}

export function badRequest(res, msg)   { return json(res, 400, { error: msg }); }
export function notFound(res, msg)     { return json(res, 404, { error: msg || 'not found' }); }
export function serverError(res, err)  {
  console.error(err);
  return json(res, 500, { error: 'server_error', message: err.message });
}

// Handle browser preflight requests for CORS.
export function handleOptions(req, res) {
  if (req.method === 'OPTIONS') { json(res, 204, {}); return true; }
  return false;
}

// Normalize a job identifier — accepts "942" or "942 — Holtec Repairs" and returns the leading number.
export function normalizeJob(raw) {
  if (!raw) return null;
  const m = String(raw).match(/^(\d+)/);
  return m ? m[1] : String(raw).trim();
}
