const database = require('./database');

const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 30_000;
const HOST_WIDE_SOURCES = new Set(['phishing_filter_domains']);
const cache = new Map();

function getCached(url) {
  const entry = cache.get(url);
  if (!entry) return undefined;
  if (entry.expiresAt <= Date.now()) {
    cache.delete(url);
    return undefined;
  }
  return entry.value;
}

function setCached(url, value) {
  cache.set(url, {
    value,
    expiresAt: Date.now() + (value ? POSITIVE_TTL_MS : NEGATIVE_TTL_MS),
  });
  return value;
}

function hostWideRow(row) {
  return row && HOST_WIDE_SOURCES.has(row.source) ? row : null;
}

async function getKnownMalicious(url, { force = false } = {}) {
  if (!force) {
    const cached = getCached(url);
    if (cached !== undefined) return cached;
  }

  const { data, error } = await database
    .from('malicious_links')
    .select('*')
    .eq('normalized_url', url)
    .maybeSingle();

  if (error) throw error;
  if (data) return setCached(url, data);

  // Domain-only public feeds are stored as http://host/. Treat those entries
  // as a host match so a malicious path on the same domain is also blocked.
  const hostname = new URL(url).hostname.toLowerCase();
  const hostResult = await database
    .from('malicious_links')
    .select('*')
    .eq('hostname', hostname);

  if (hostResult.error) throw hostResult.error;
  return setCached(url, (hostResult.data ?? []).map(hostWideRow).find(Boolean) ?? null);
}

async function findKnownMalicious(urls) {
  const unique = [...new Set((urls ?? []).filter(Boolean))];
  if (!unique.length) return [];

  const hits = [];
  const missing = [];

  for (const url of unique) {
    const cached = getCached(url);
    if (cached === undefined) missing.push(url);
    else if (cached) hits.push(cached);
  }

  if (missing.length) {
    const { data, error } = await database
      .from('malicious_links')
      .select('*')
      .in('normalized_url', missing);

    if (error) throw error;

    const rows = new Map((data ?? []).map((row) => [row.normalized_url, row]));
    const hostnames = [...new Set(missing.map((url) => {
      try { return new URL(url).hostname.toLowerCase(); } catch { return null; }
    }).filter(Boolean))];
    const hostResult = hostnames.length
      ? await database.from('malicious_links').select('*').in('hostname', hostnames)
      : { data: [], error: null };
    if (hostResult.error) throw hostResult.error;
    const hostRows = new Map();
    for (const row of hostResult.data ?? []) {
      const hostRow = hostWideRow(row);
      if (hostRow && !hostRows.has(hostRow.hostname)) hostRows.set(hostRow.hostname, hostRow);
    }

    for (const url of missing) {
      let hostname = null;
      try { hostname = new URL(url).hostname.toLowerCase(); } catch {}
      const row = rows.get(url) ?? hostRows.get(hostname) ?? null;
      setCached(url, row);
      if (row) hits.push(row);
    }
  }

  return hits;
}

async function recordMaliciousLink({ url, threatTypes, reportedBy, guildId, channelId, source = 'public_threat_feeds' }) {
  const parsed = new URL(url);
  const now = new Date().toISOString();
  const payload = {
    normalized_url: url,
    hostname: parsed.hostname.toLowerCase(),
    threat_types: [...new Set(threatTypes ?? [])],
    source: String(source || 'public_threat_feeds').slice(0, 80),
    reported_by: reportedBy ?? null,
    first_seen_guild_id: guildId ?? null,
    first_seen_channel_id: channelId ?? null,
    last_checked_at: now,
  };

  const { data, error } = await database
    .from('malicious_links')
    .insert(payload)
    .select('*')
    .single();

  if (error) {
    // Another shard/process may have inserted the same URL between the lookup
    // and this insert. In that case, return the already-existing row.
    if (error.code === '23505') return getKnownMalicious(url, { force: true });
    throw error;
  }

  return setCached(url, data);
}

/**
 * Imports feed results in chunks. Only threat-intelligence fields are updated,
 * so a feed refresh never erases who first reported a URL or its alert state.
 */
async function upsertMaliciousLinks(rows, { chunkSize = 500 } = {}) {
  const unique = new Map();

  for (const row of rows ?? []) {
    if (!row?.normalizedUrl || !row?.hostname) continue;
    const normalizedUrl = String(row.normalizedUrl).slice(0, 2_000);
    const threatTypes = [...new Set((row.threatTypes ?? []).map((type) => String(type).slice(0, 80)).filter(Boolean))];
    unique.set(normalizedUrl, {
      normalized_url: normalizedUrl,
      hostname: String(row.hostname).toLowerCase().slice(0, 255),
      threat_types: threatTypes,
      source: String(row.source || 'threat_feed').slice(0, 80),
      last_checked_at: row.lastCheckedAt || new Date().toISOString(),
    });
  }

  const values = [...unique.values()];
  for (let offset = 0; offset < values.length; offset += chunkSize) {
    const chunk = values.slice(offset, offset + chunkSize);
    const { error } = await database
      .from('malicious_links')
      .upsert(chunk, { onConflict: 'normalized_url' });
    if (error) throw error;
  }

  // A refresh may add a URL that was previously cached as clean. Evict all
  // imported URLs so the next ordinary-message lookup sees the database row.
  for (const row of values) cache.delete(row.normalized_url);
  return values.length;
}

async function markDeveloperAlerted(url) {
  const alertedAt = new Date().toISOString();
  const { data, error } = await database
    .from('malicious_links')
    .update({ dev_alerted_at: alertedAt })
    .eq('normalized_url', url)
    .is('dev_alerted_at', null)
    .select('*')
    .maybeSingle();

  if (error) throw error;
  if (data) setCached(url, data);
  return data;
}

module.exports = {
  getKnownMalicious,
  findKnownMalicious,
  recordMaliciousLink,
  upsertMaliciousLinks,
  markDeveloperAlerted,
};
