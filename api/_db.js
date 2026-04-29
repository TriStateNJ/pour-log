// Shared Postgres client + helpers for all API routes.
// Vercel injects POSTGRES_URL automatically when a Postgres database is connected to the project.
import { sql } from '@vercel/postgres';

export { sql };

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
