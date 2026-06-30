// /api/jobs
//   GET → { jobs: [{num, name, nickname, address}, ...], ts, cached, count }
//
// Reads the TSC Job Check List from Smartsheet and returns it as JSON for the
// Pour Log sign-on dropdown.
//
// Columns captured:
//   - JOB           → split on " - " into num + name
//   - JOB NICKNAME  → nickname
//   - JOB ADDRESS   → address
//
// In-memory cache for 15 minutes so we don't hit Smartsheet on every page load.
// Env vars required:
//   - SMARTSHEET_TOKEN     (Smartsheet API access token)
//   - SMARTSHEET_SHEET_ID  (the sheet ID — long string in the Smartsheet URL)
import { json, serverError, handleOptions } from './_db.js';

let _cache = null;
let _cacheTs = 0;
const CACHE_MS = 15 * 60 * 1000; // 15 minutes

export default async function handler(req, res) {
  if (handleOptions(req, res)) return;
  if (req.method !== 'GET') return json(res, 405, { error: 'method_not_allowed' });

  // Serve cached result if still fresh
  if (_cache && (Date.now() - _cacheTs) < CACHE_MS) {
    return json(res, 200, { jobs: _cache, ts: _cacheTs, cached: true, count: _cache.length });
  }

  const SHEET_ID = process.env.SMARTSHEET_SHEET_ID;
  const TOKEN    = process.env.SMARTSHEET_TOKEN;

  if (!SHEET_ID || !TOKEN) {
    return json(res, 500, {
      error: 'config_missing',
      message: 'SMARTSHEET_SHEET_ID or SMARTSHEET_TOKEN env var not set in Vercel'
    });
  }

  try {
    const r = await fetch(`https://api.smartsheet.com/2.0/sheets/${SHEET_ID}`, {
      headers: { Authorization: `Bearer ${TOKEN}` }
    });

    if (!r.ok) {
      const body = await r.text();
      return json(res, r.status, { error: 'smartsheet_error', message: body.slice(0, 400) });
    }

    const sheet = await r.json();

    // Resolve column indexes by title (case/whitespace tolerant)
    const idx = {};
    (sheet.columns || []).forEach((c, i) => {
      const t = (c.title || '').trim().toUpperCase();
      if (t === 'JOB')          idx.job      = i;
      if (t === 'JOB NICKNAME') idx.nickname = i;
      if (t === 'JOB ADDRESS')  idx.address  = i;
    });

    if (idx.job === undefined) {
      return json(res, 500, {
        error: 'column_not_found',
        message: 'JOB column not found in sheet. Columns: ' +
          (sheet.columns || []).map(c => c.title).join(', ')
      });
    }

    // Parse rows
    const jobs = [];
    for (const row of (sheet.rows || [])) {
      const cells = row.cells || [];
      const jobRaw = String(cells[idx.job]?.value ?? '').trim();
      if (!jobRaw) continue;

      // "948 - NEP Power Supply Bloom Energy" → num="948", name="NEP Power Supply Bloom Energy"
      // Handle hyphen, en-dash, em-dash defensively.
      const m = jobRaw.match(/^(\d+)\s*[-–—]\s*(.+)$/);
      const num  = m ? m[1] : jobRaw;
      const name = m ? m[2].trim() : jobRaw;

      const nickname = idx.nickname !== undefined
        ? String(cells[idx.nickname]?.value ?? '').trim()
        : '';
      const address  = idx.address  !== undefined
        ? String(cells[idx.address]?.value  ?? '').trim()
        : '';

      jobs.push({ num, name, nickname, address });
    }

    // Sort by num descending (newest job first) so the most recent appear at the top of the dropdown
    jobs.sort((a, b) => {
      const na = parseInt(a.num, 10), nb = parseInt(b.num, 10);
      if (!isNaN(na) && !isNaN(nb)) return nb - na;
      return a.name.localeCompare(b.name);
    });

    _cache   = jobs;
    _cacheTs = Date.now();

    return json(res, 200, { jobs, ts: _cacheTs, cached: false, count: jobs.length });
  } catch (err) {
    return serverError(res, err);
  }
}
