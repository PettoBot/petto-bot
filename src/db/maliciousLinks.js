const supabase = require('./supabase');

const POSITIVE_TTL_MS = 5 * 60_000;
const NEGATIVE_TTL_MS = 30_000;
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

async function getKnownMalicious(url, { force = false } = {}) {
  if (!force) {
    const cached = getCached(url);
    if (cached !== undefined) return cached;
  }

  const { data, error } = await supabase
    .from('malicious_links')
    .select('*')
    .eq('normalized_url', url)
    .maybeSingle();

  if (error) throw error;
  return setCached(url, data ?? null);
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
    const { data, error } = await supabase
      .from('malicious_links')
      .select('*')
      .in('normalized_url', missing);

    if (error) throw error;

    const rows = new Map((data ?? []).map((row) => [row.normalized_url, row]));
    for (const url of missing) {
      const row = rows.get(url) ?? null;
      setCached(url, row);
      if (row) hits.push(row);
    }
  }

  return hits;
}

async function recordMaliciousLink({ url, threatTypes, reportedBy, guildId, channelId }) {
  const parsed = new URL(url);
  const now = new Date().toISOString();
  const payload = {
    normalized_url: url,
    hostname: parsed.hostname.toLowerCase(),
    threat_types: [...new Set(threatTypes ?? [])],
    source: 'google_safe_browsing',
    reported_by: reportedBy ?? null,
    first_seen_guild_id: guildId ?? null,
    first_seen_channel_id: channelId ?? null,
    last_checked_at: now,
  };

  const { data, error } = await supabase
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

async function markDeveloperAlerted(url) {
  const alertedAt = new Date().toISOString();
  const { data, error } = await supabase
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
  markDeveloperAlerted,
};
