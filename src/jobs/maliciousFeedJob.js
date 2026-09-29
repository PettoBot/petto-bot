const config = require('../config');
const { upsertMaliciousLinks } = require('../db/maliciousLinks');
const { normalizeUrl } = require('../utils/safeBrowsing');
const logger = require('../utils/logger');

const FETCH_TIMEOUT_MS = 5 * 60_000;
const MAX_FEED_BYTES = 512 * 1024 * 1024;
const OPENPHISH_SOURCE = 'openphish';
const PHISHTANK_SOURCE = 'phishtank';
const PHISHING_FILTER_SOURCE = 'phishing_filter_domains';

// These are public, no-key downloads. They are intentionally static URLs so
// Petto never needs to create an account or store a provider credential.
const PUBLIC_FEEDS = [
  {
    source: OPENPHISH_SOURCE,
    url: 'https://raw.githubusercontent.com/openphish/public_feed/main/feed.txt',
    parser: (text) => parsePlainUrlList(text, OPENPHISH_SOURCE, ['SOCIAL_ENGINEERING']),
  },
  {
    source: PHISHTANK_SOURCE,
    url: 'https://data.phishtank.com/data/online-valid.json',
    parser: parsePhishtankJson,
  },
  {
    source: PHISHING_FILTER_SOURCE,
    url: 'https://malware-filter.gitlab.io/malware-filter/phishing-filter.txt',
    parser: (text) => parseDomainList(text, PHISHING_FILTER_SOURCE, ['SOCIAL_ENGINEERING']),
  },
];

let runningSync = null;

function makeFeedRow(rawUrl, source, threatTypes) {
  const normalizedUrl = normalizeUrl(String(rawUrl ?? '').trim());
  if (!normalizedUrl) return null;

  try {
    const parsed = new URL(normalizedUrl);
    return {
      normalizedUrl,
      hostname: parsed.hostname,
      threatTypes,
      source,
    };
  } catch {
    return null;
  }
}

function parsePlainUrlList(text, source, threatTypes) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#') && /^https?:\/\//i.test(line))
    .map((line) => makeFeedRow(line, source, threatTypes))
    .filter(Boolean);
}

function isPositiveFeedFlag(value) {
  return value === true || String(value ?? '').trim().toLowerCase() === 'yes';
}

function parsePhishtankJson(text) {
  const payload = JSON.parse(String(text ?? ''));
  const entries = Array.isArray(payload) ? payload : payload?.results;
  if (!Array.isArray(entries)) throw new Error('PhishTank returned an unexpected JSON shape.');

  return entries
    .filter((entry) => isPositiveFeedFlag(entry.verified) && isPositiveFeedFlag(entry.online))
    .map((entry) => makeFeedRow(entry.url, PHISHTANK_SOURCE, ['SOCIAL_ENGINEERING']))
    .filter(Boolean);
}

function parseDomainList(text, source, threatTypes) {
  return String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('!') && !line.startsWith('#') && !line.includes(' '))
    .map((domain) => makeFeedRow(`http://${domain}/`, source, threatTypes))
    .filter(Boolean);
}

async function fetchText(url, { headers = {}, maxBytes = MAX_FEED_BYTES } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        'user-agent': 'Petto public threat-feed synchronizer/1.0 (+https://petto.sbs)',
        ...headers,
      },
      signal: controller.signal,
    });

    if (!response.ok) throw new Error(`Feed returned HTTP ${response.status}.`);
    const declaredLength = Number(response.headers.get('content-length'));
    if (Number.isFinite(declaredLength) && declaredLength > maxBytes) {
      throw new Error(`Feed is larger than the configured ${Math.round(maxBytes / 1024 / 1024)} MiB limit.`);
    }

    if (!response.body) return response.text();

    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) throw new Error(`Feed is larger than the configured ${Math.round(maxBytes / 1024 / 1024)} MiB limit.`);
        chunks.push(Buffer.from(value));
      }
    } finally {
      reader.releaseLock();
    }

    return Buffer.concat(chunks, total).toString('utf8');
  } finally {
    clearTimeout(timeout);
  }
}

async function syncFeed(feed) {
  const text = await fetchText(feed.url, feed.source === PHISHTANK_SOURCE
    ? { headers: { accept: 'application/json' } }
    : {});
  const count = await upsertMaliciousLinks(feed.parser(text));
  logger.info({ source: feed.source, count }, `Synchronized ${count} public malicious feed entry/entries from ${feed.source}.`);
  return count;
}

async function syncMaliciousFeeds() {
  if (runningSync) return runningSync;

  runningSync = Promise.allSettled(PUBLIC_FEEDS.map(async (feed) => {
    try {
      return { source: feed.source, count: await syncFeed(feed) };
    } catch (error) {
      // One public feed going offline must not disable the other sources or
      // affect the bot's message/event loop.
      logger.warn({ source: feed.source }, `Public malicious feed synchronization failed for ${feed.source}:`, error);
      throw error;
    }
  })).then((results) => ({
    configured: results.length,
    succeeded: results.filter((result) => result.status === 'fulfilled').length,
    failed: results.filter((result) => result.status === 'rejected').length,
  })).finally(() => {
    runningSync = null;
  });

  return runningSync;
}

function startMaliciousFeedJob() {
  logger.info({ sources: PUBLIC_FEEDS.map((feed) => feed.source), intervalMs: config.maliciousFeedSyncIntervalMs }, 'Public malicious threat-feed synchronizer started; no API keys are required.');

  const first = setTimeout(() => syncMaliciousFeeds().catch(() => {}), 30_000);
  first.unref?.();
  const interval = setInterval(() => syncMaliciousFeeds().catch(() => {}), config.maliciousFeedSyncIntervalMs);
  interval.unref?.();
}

module.exports = {
  parseDomainList,
  parsePhishtankJson,
  parsePlainUrlList,
  syncMaliciousFeeds,
  startMaliciousFeedJob,
};
