// i18n-ignore-file: status checks for the public status page (service names and details are not shown to members from here).
const { getPrimaryPool } = require('./postgres');

/** The length of the window a check belongs to: every check of a window is one row, whoever made it. */
const SLOT_MS = 2 * 60_000;
const slotOf = (time) => Math.floor(time / SLOT_MS) * SLOT_MS;

/**
 * Saves checks (a row per slot, service and source; a repeated one replaces the earlier one). Each check is
 * { slot (ms), service, source, ok, latencyMs, detail }.
 */
async function saveChecks(checks, pool = getPrimaryPool()) {
  if (!checks.length) return;
  await pool.query(
    `insert into status_checks (slot, service, source, ok, latency_ms, detail)
     select * from unnest($1::timestamptz[], $2::text[], $3::text[], $4::boolean[], $5::integer[], $6::text[])
     on conflict (slot, service, source) do update set ok = excluded.ok, latency_ms = excluded.latency_ms, detail = excluded.detail`,
    [
      checks.map((check) => new Date(check.slot).toISOString()),
      checks.map((check) => check.service),
      checks.map((check) => check.source),
      checks.map((check) => Boolean(check.ok)),
      checks.map((check) => (Number.isFinite(check.latencyMs) ? Math.round(check.latencyMs) : null)),
      checks.map((check) => (check.detail ? String(check.detail).slice(0, 80) : null)),
    ],
  );
}

module.exports = { SLOT_MS, slotOf, saveChecks };
