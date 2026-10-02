// Reads the Discord Quests that api.discordquest.com publishes (a community directory, not Discord). It answers with a
// public JSON list that has to be asked for from time to time, so this keeps the last answer's ETag and asks again with
// it, which costs almost nothing when nothing changed. Everything that comes back is treated as untrusted text: names are
// cleaned and cut, links must be https, and pictures must come from Discord's own CDN.
const logger = require('./logger');

const API_BASE = 'https://api.discordquest.com';
const CDN_BASE = 'https://cdn.discordapp.com/';
const SOURCE_NAME = 'discordquest.com';
const SOURCE_URL = 'https://discordquest.com';
const TRACKER_URL = 'https://github.com/xGustavvo/discord-api-tracker';
const TIMEOUT_MS = 45_000;
const MAX_BYTES = 12 * 1024 * 1024;

const REWARD_KINDS = { 1: 'code', 2: 'ingame', 3: 'decoration', 4: 'orbs', 5: 'nitro' };
const REWARD_LABELS = { code: 'Code', ingame: 'In-game item', decoration: 'Collectible', orbs: 'Orbs', nitro: 'Nitro', other: 'Reward' };
// The kind of task a member does, grouped so a server can choose "videos" without knowing every task name.
const TASKS = {
  WATCH_VIDEO: { kind: 'video', label: 'Watch a video', platform: 'Desktop' },
  WATCH_VIDEO_ON_MOBILE: { kind: 'video', label: 'Watch a video on mobile', platform: 'Mobile' },
  PLAY_ON_DESKTOP: { kind: 'play', label: 'Play the game', platform: 'Desktop' },
  PLAY_ON_DESKTOP_V2: { kind: 'play', label: 'Play the game', platform: 'Desktop' },
  PLAY_ON_XBOX: { kind: 'play', label: 'Play on Xbox', platform: 'Xbox' },
  PLAY_ON_PLAYSTATION: { kind: 'play', label: 'Play on PlayStation', platform: 'PlayStation' },
  STREAM_ON_DESKTOP: { kind: 'stream', label: 'Stream the game', platform: 'Desktop' },
  PLAY_ACTIVITY: { kind: 'activity', label: 'Play an Activity', platform: 'Desktop' },
  ACHIEVEMENT_IN_ACTIVITY: { kind: 'activity', label: 'Earn an achievement in an Activity', platform: 'Desktop' },
  ACHIEVEMENT_IN_GAME: { kind: 'play', label: 'Earn an achievement in the game', platform: 'Desktop' },
};
const TASK_KINDS = ['video', 'play', 'stream', 'activity'];
const REWARD_KIND_LIST = ['orbs', 'decoration', 'code', 'ingame', 'nitro'];

// Two public copies of the same list of quests are read, so one being late or down does not stop the alerts: the
// community API (which also knows the region and age limits) and the GitHub tracker, which follows Discord's own data.
const SOURCES = [
  { name: 'discordquest.com', url: `${API_BASE}/api/quests`, regions: true },
  { name: 'discord-api-tracker', url: 'https://raw.githubusercontent.com/xGustavvo/discord-api-tracker/main/quests.json', regions: false },
];
const state = new Map(SOURCES.map((source) => [source.name, { etag: null, quests: null, ok: null, at: null, error: null }]));

function clean(value, max) {
  return String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
}

function httpsUrl(value) {
  try {
    const url = new URL(String(value));
    return url.protocol === 'https:' ? url.href : null;
  } catch {
    return null;
  }
}

/** A picture path from the API (`quests/<id>/<file>`) as a Discord CDN link, only for still images. */
function cdnImage(path) {
  const text = String(path ?? '');
  if (!/^quests\/\d+\/[\w.-]+\.(png|jpe?g|webp)$/i.test(text)) return null;
  return `${CDN_BASE}${text}`;
}

function date(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function normalizeRewards(config) {
  const list = Array.isArray(config.rewards_config?.rewards) ? config.rewards_config.rewards : [];
  return list.slice(0, 5).map((reward) => {
    const kind = REWARD_KINDS[reward.type] ?? 'other';
    const orbs = Number(reward.orb_quantity) || 0;
    const name = clean(reward.messages?.name, 100) || (kind === 'orbs' && orbs ? `${orbs} Orbs` : REWARD_LABELS[kind]);
    return { kind, name, amount: kind === 'orbs' ? orbs : 0, image: cdnImage(reward.asset) };
  });
}

function normalizeTasks(config) {
  const tasks = config.task_config_v2?.tasks ?? config.task_config?.tasks ?? {};
  return Object.values(tasks).slice(0, 8).map((task) => {
    const type = clean(task.type ?? task.event_name, 60);
    const known = TASKS[type] ?? { kind: 'play', label: type.toLowerCase().replace(/_/g, ' ') || 'Complete the task', platform: 'Desktop' };
    return { type, kind: known.kind, label: known.label, platform: known.platform, seconds: Math.max(0, Number(task.target) || 0) };
  });
}

/** One quest of the API as the plain object the bot works with, or null when it has no usable name or dates. */
function normalizeQuest(raw, region = null) {
  const config = raw?.config;
  const id = String(raw?.id ?? config?.id ?? '');
  if (!config || !/^\d{15,25}$/.test(id)) return null;
  const name = clean(config.messages?.quest_name, 100);
  const startsAt = date(config.starts_at);
  const expiresAt = date(config.expires_at);
  if (!name || !startsAt || !expiresAt) return null;
  const tasks = normalizeTasks(config);
  const assets = config.assets ?? {};
  return {
    id,
    name,
    game: clean(config.messages?.game_title, 100) || clean(config.application?.name, 100),
    publisher: clean(config.messages?.game_publisher, 100),
    startsAt,
    expiresAt,
    url: `https://discord.com/quests/${id}`,
    link: httpsUrl(config.application?.link),
    color: /^#[0-9a-f]{6}$/i.test(config.colors?.primary ?? '') ? config.colors.primary : '#5865f2',
    image: cdnImage(assets.hero) ?? cdnImage(assets.quest_bar_hero),
    logo: cdnImage(assets.logotype_dark) ?? cdnImage(assets.game_tile_dark) ?? cdnImage(assets.logotype) ?? cdnImage(assets.game_tile),
    rewards: normalizeRewards(config),
    tasks,
    platforms: [...new Set(tasks.map((task) => task.platform))],
    global: region ? Boolean(region.is_global) : true,
    regions: region ? { include: (region.regions?.include ?? []).slice(0, 20).map((c) => clean(c, 4)), exclude: (region.regions?.exclude ?? []).slice(0, 20).map((c) => clean(c, 4)) } : { include: [], exclude: [] },
    ageGate: Boolean(region?.show_age_gate),
  };
}

function isActive(quest, now = Date.now()) {
  return quest.startsAt.getTime() <= now && quest.expiresAt.getTime() > now;
}

async function getJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(url, { headers: { accept: 'application/json', 'user-agent': 'Petto-Quest-Alerts (+https://petto.sbs)', ...headers }, signal: controller.signal });
    if (response.status === 304) return { notModified: true, etag: response.headers.get('etag') };
    if (!response.ok) throw new Error(`answered ${response.status}`);
    const length = Number(response.headers.get('content-length') ?? 0);
    if (length > MAX_BYTES) throw new Error('the answer is too large');
    const text = await response.text();
    if (text.length > MAX_BYTES) throw new Error('the answer is too large');
    return { data: JSON.parse(text), etag: response.headers.get('etag') };
  } finally {
    clearTimeout(timer);
  }
}

async function readRegions() {
  try {
    const rows = (await getJson(`${API_BASE}/api/regions`)).data?.quests ?? [];
    return new Map(rows.map((row) => [String(row.id), row]));
  } catch (error) {
    logger.warn(`The quest regions could not be read: ${error.message}`);
    return new Map();
  }
}

/** Reads one source. Returns true when it brought a new list, false when it had not changed. Throws when it failed. */
async function readSource(source, force) {
  const entry = state.get(source.name);
  try {
    const result = await getJson(source.url, !force && entry.etag && entry.quests ? { 'if-none-match': entry.etag } : {});
    if (result.notModified) {
      Object.assign(entry, { ok: true, at: new Date(), error: null });
      return false;
    }
    if (!Array.isArray(result.data)) throw new Error('the answer has an unexpected shape');
    const regions = source.regions ? await readRegions() : new Map();
    entry.quests = result.data.map((raw) => normalizeQuest(raw, regions.get(String(raw?.id)) ?? null)).filter(Boolean);
    Object.assign(entry, { etag: result.etag ?? null, ok: true, at: new Date(), error: null });
    return true;
  } catch (error) {
    Object.assign(entry, { ok: false, at: new Date(), error: error.name === 'AbortError' ? 'it took too long' : error.message });
    throw error;
  }
}

/**
 * The current list of quests from every source that answers, joined by quest id (the community API wins, it has the
 * limits), or `{ notModified: true }` when no source changed. It only fails when every source failed.
 */
async function fetchQuests({ force = false } = {}) {
  const results = await Promise.allSettled(SOURCES.map((source) => readSource(source, force)));
  const failed = results.filter((result) => result.status === 'rejected');
  if (failed.length === SOURCES.length) throw new Error(`The quests could not be read: ${failed.map((result, i) => `${SOURCES[i].name} ${result.reason?.message}`).join('; ')}`);
  if (!results.some((result) => result.status === 'fulfilled' && result.value)) return { notModified: true, quests: [] };
  const merged = new Map();
  for (const source of [...SOURCES].reverse()) for (const quest of state.get(source.name).quests ?? []) merged.set(quest.id, quest);
  return { notModified: false, quests: [...merged.values()] };
}

/** Forgets the ETags, so the next pass downloads everything again (used when a pass could not finish). */
function resetCache() {
  for (const entry of state.values()) entry.etag = null;
}

/** How each source did the last time it was asked. */
function getStatus() {
  const sources = SOURCES.map((source) => ({ name: source.name, ...state.get(source.name) }));
  const asked = sources.filter((source) => source.ok !== null);
  return { ok: asked.length ? asked.some((source) => source.ok) : null, sources, count: Math.max(0, ...sources.map((source) => source.quests?.length ?? 0)) };
}

module.exports = {
  API_BASE, SOURCE_NAME, SOURCE_URL, TRACKER_URL, TASK_KINDS, REWARD_KIND_LIST, REWARD_LABELS,
  fetchQuests, resetCache, normalizeQuest, isActive, getStatus, cdnImage,
};
