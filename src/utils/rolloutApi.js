// Reads the list of Discord's experiments (rollouts) that a community member publishes as a JSON file. It is asked gently, with
// the ETag of the last answer so a list that did not change costs almost nothing. Everything in it is treated as untrusted
// text: ids and names are cleaned and cut, and only the fields the bot shows are kept.
const logger = require('./logger');
const { t, currentLanguage } = require('../i18n');

// i18n-ignore: name of the data source
const SOURCE_NAME = "agnonotdev's rollouts list";
const SOURCE_URL = 'https://gist.github.com/agnonotdev/fb2b6a7ba1301733aa5c2050b3e59a18';
const DEFAULT_URL = 'https://gist.githubusercontent.com/agnonotdev/fb2b6a7ba1301733aa5c2050b3e59a18/raw/rollouts.json';
const TIMEOUT_MS = 45_000;
const MAX_BYTES = 8 * 1024 * 1024;

const KINDS = ['user', 'guild', 'apex_user', 'installation'];
// The names Petto gives to the kinds and statuses of an experiment. The English ones are kept as data; `kindLabel` and
// `statusLabel` give them in the language of a server when a message is built.
const KIND_KEYS = { user: 'user', guild: 'guild', apex_user: 'apexUser', installation: 'installation', unknown: 'unknown' };
const STATUS_KEYS = {
  rolling_out: 'rollingOut', full: 'full', ab_test: 'abTest', segmented: 'segmented', overrides_only: 'overridesOnly',
  full_filtered: 'fullFiltered', not_rolled_out: 'notRolledOut', rolling_back: 'rollingBack', unlisted: 'unlisted', unknown: 'unknown', none: 'none',
};
const KIND_LABELS = Object.fromEntries(Object.entries(KIND_KEYS).map(([kind, key]) => [kind, t('en', `rollouts.kind.${key}`)]));
const STATUS_LABELS = Object.fromEntries(Object.entries(STATUS_KEYS).map(([status, key]) => [status, t('en', `rollouts.status.${key}`)]));

/** The kind of an experiment in `lang` ("Servers experiment"). */
function kindLabel(kind, lang = currentLanguage()) {
  return t(lang, `rollouts.kind.${KIND_KEYS[kind] ?? KIND_KEYS.unknown}`);
}

/** The status of an experiment in `lang`; a status Petto does not know is shown as the list writes it. */
function statusLabel(status, lang = currentLanguage()) {
  const key = STATUS_KEYS[status ?? 'none'];
  return key ? t(lang, `rollouts.status.${key}`) : String(status);
}

const state = { etag: null, list: null, ok: null, at: null, error: null, pausedUntil: 0, strikes: 0 };

const clean = (value, max) => String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim().slice(0, max);
const number = (value) => (Number.isFinite(Number(value)) && value !== null && value !== '' ? Number(value) : null);
const round = (value) => Math.round(value * 100) / 100;

/** `2026-10-android-media-viewer` -> `Android media viewer`: the name to show when the list gives none. */
function humanize(id) {
  const text = String(id).replace(/^\d{4}[-_]\d{1,2}[-_]/, '').replace(/[-_]+/g, ' ').trim();
  return text ? text.charAt(0).toUpperCase() + text.slice(1) : String(id);
}

/** The share of users a list of ranges (`1600 - 3000`, out of 10000) covers, as a percentage. */
function rangesPercent(ranges) {
  let width = 0;
  for (const range of ranges ?? []) {
    const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(range));
    if (match) width += Math.max(0, Number(match[2]) - Number(match[1]));
  }
  return round(width / 100);
}

/** One filter of an experiment as a short line. Every type the list can have has its own line; an unknown one is shown by its name. */
/** The ranges of a list as `[from, to]` pairs of the 10000 buckets. */
function rangePairs(ranges) {
  const pairs = [];
  for (const range of ranges ?? []) {
    const match = /^\s*(\d+)\s*-\s*(\d+)\s*$/.exec(String(range));
    if (match && Number(match[2]) > Number(match[1])) pairs.push([Number(match[1]), Number(match[2])]);
  }
  return pairs;
}

/** Whether a variant is the one people are tested with: the treatments, and, when the list gives no roles, every variant that is not the control (variant 0) or "none". */
function isTreatment(variant) {
  // Variant 0 is the control, whatever the list says about its role: it is never read, not counted and never shown as what people are tested with.
  if (String(variant.variant) === '0') return false;
  if (variant.role === 'treatment') return true;
  if (variant.role) return false;
  return !['0', '-1', 'none', ''].includes(String(variant.variant));
}

/**
 * The share of Discord an experiment reaches: the treatments are added, and the control (variant 0) is not, nor the ones that are not eligible.
 * The ranges say it best, joined so two variants that cover the same part are not counted twice; with no ranges the percentages of the treatments
 * are added (up to 100). Null when there is nothing to count.
 */
function sharePercent(variants) {
  const counted = variants.filter(isTreatment);
  const pairs = counted.flatMap((variant) => rangePairs(variant.ranges)).sort((a, b) => a[0] - b[0]);
  if (pairs.length) {
    let covered = 0;
    let end = 0;
    for (const [from, to] of pairs) {
      const start = Math.max(from, end);
      if (to > start) covered += to - start;
      end = Math.max(end, to);
    }
    return round(Math.min(100, covered / 100));
  }
  const known = counted.filter((variant) => variant.percent != null);
  return known.length ? round(Math.min(100, known.reduce((sum, variant) => sum + variant.percent, 0))) : null;
}

/** One filter as a catalog key and its values: `{ key, vars }`. The values (features, countries) are data. */
function filterSpec(filter) {
  const type = clean(filter?.type, 60);
  const args = filter?.args ?? {};
  const list = (value, max = 6) => (Array.isArray(value) ? value : []).slice(0, max).map((item) => clean(item, 40)).filter(Boolean);
  const spec = (key, vars = {}) => ({ key: `rollouts.filter.${key}`, vars });
  if (type === 'guild_has_feature') {
    const features = list(filter.features ?? filter.guild_features).join(', ');
    return features ? spec('features', { features }) : spec('anyFeature');
  }
  if (type === 'guild_member_count_range') return spec('memberCount', { min: args.min_id ?? 0, max: args.max_id ?? '∞' });
  if (type === 'guild_id_range') return spec(args.min_id ? 'createdBetween' : 'createdBefore');
  if (type === 'guild_ids') return Array.isArray(filter.ids) ? spec(`idsCount.${filter.ids.length === 1 ? 'one' : 'other'}`, { count: filter.ids.length }) : spec('ids');
  if (type === 'guild_in_range_by_hash') return spec('hash');
  if (type === 'guild_has_vanity_url') return spec(filter.has_vanity === false ? 'noVanity' : 'vanity');
  if (type === 'user_in_country') {
    const countries = list(filter.regions, 8).join(', ');
    return countries ? spec('countries', { countries }) : spec('someCountries');
  }
  return type ? spec('raw', { text: type.replace(/_/g, ' ') }) : spec('filtered');
}

/** One filter as a short line in `lang`. Every type the list can have has its own line; an unknown one is shown by its name. */
function summarizeFilter(filter, lang = 'en') {
  const { key, vars } = filterSpec(filter);
  return t(lang, key, vars);
}

/**
 * The filters of an experiment as lines in `lang`. `filters` holds them in English (it is stored and compared); `filterSpecs`, when the
 * experiment has it, lets them be written in any language.
 */
function filterLines(rollout, lang = currentLanguage()) {
  const specs = Array.isArray(rollout.filterSpecs) && rollout.filterSpecs.length === rollout.filters.length ? rollout.filterSpecs : null;
  return specs ? specs.map((spec) => t(lang, spec.key, spec.vars)) : rollout.filters;
}

/** The variants of an experiment as plain objects (up to 12). */
function normalizeVariants(list) {
  return (Array.isArray(list) ? list : []).slice(0, 12).map((variant) => {
    const ranges = (Array.isArray(variant.ranges) ? variant.ranges : []).slice(0, 24).map((range) => clean(range, 24));
    const to = number(variant.to);
    return {
      variant: clean(variant.variant, 12),
      role: variant.role ? clean(variant.role, 20) : null,
      percent: to ?? (ranges.length ? rangesPercent(ranges) : null),
      ranges,
    };
  });
}

/** One entry of the list as the plain object the bot works with, or null when it has no usable id. */
function normalizeRollout(raw) {
  const id = clean(raw?.id, 120);
  if (!/^[\w.:-]{3,120}$/.test(id)) return null;
  const variants = normalizeVariants(raw.variants);
  const filterSpecs = [
    ...(Array.isArray(raw.filters) ? raw.filters : []),
    ...(Array.isArray(raw.populations) ? raw.populations.flatMap((population) => population.filters ?? []) : []),
  ].slice(0, 8).map(filterSpec);
  const filters = filterSpecs.map((spec) => t('en', spec.key, spec.vars));
  const total = number(raw.total?.to);
  // The list gives its own total for almost every experiment (it matches the treatments); without one the treatments are counted, never the control.
  const percent = total ?? sharePercent(variants);
  const kind = KINDS.includes(raw.kind) ? raw.kind : 'unknown';
  return {
    id,
    title: clean(raw.title, 100) || humanize(id),
    kind,
    status: raw.rollout_status ? clean(raw.rollout_status, 30) : null,
    // A/A mode (the experiment only measures, nothing changes for anyone) and the part reserved for employees; neither is added to the share.
    aaMode: raw.aa_mode === true,
    employeePercent: number(raw.internal_employee_only?.total?.to) ?? sharePercent(normalizeVariants(raw.internal_employee_only?.variants)),
    platforms: (Array.isArray(raw.platforms) ? raw.platforms : []).slice(0, 6).map((p) => clean(p, 20)),
    percent,
    variants,
    filters,
    filterSpecs,
  };
}

async function getJson(url, headers = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    // i18n-ignore: HTTP user agent
    const response = await fetch(url, { signal: controller.signal, headers: { accept: 'application/json', 'user-agent': 'Petto-Bot (https://petto.sbs)', ...headers } });
    if (response.status === 304) return { notModified: true };
    if (response.status === 429) {
      // i18n-ignore: technical detail of the source, logged and shown as-is in diagnostics
      const error = new Error('answered 429, too many requests');
      error.retryAfterMs = Math.min(3_600_000, Math.max(60_000, (Number(response.headers.get('retry-after')) || 600) * 1000));
      throw error;
    }
    if (!response.ok) throw new Error(`answered ${response.status}`);
    // i18n-ignore: technical detail of the source, logged and shown as-is in diagnostics
    if (Number(response.headers.get('content-length') ?? 0) > MAX_BYTES) throw new Error('the answer is too large');
    const text = await response.text();
    // i18n-ignore: technical detail of the source, logged and shown as-is in diagnostics
    if (text.length > MAX_BYTES) throw new Error('the answer is too large');
    return { data: JSON.parse(text), etag: response.headers.get('etag') };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * The current list. `{ notModified: true, list }` when it did not change since the last answer, with the list that was kept.
 * Throws when the source could not be read (a rate limit pauses it for a while, doubling each time).
 */
async function fetchRollouts({ url = process.env.ROLLOUTS_URL || DEFAULT_URL, force = false } = {}) {
  // i18n-ignore: technical detail of the source, logged and shown as-is in diagnostics
  if (state.pausedUntil > Date.now()) throw new Error(`paused after a rate limit, until ${new Date(state.pausedUntil).toISOString()}`);
  try {
    const result = await getJson(url, !force && state.etag && state.list ? { 'if-none-match': state.etag } : {});
    if (result.notModified) {
      Object.assign(state, { ok: true, at: new Date(), error: null, strikes: 0 });
      return { notModified: true, list: state.list };
    }
    // i18n-ignore: technical detail of the source, logged and shown as-is in diagnostics
    if (!Array.isArray(result.data)) throw new Error('the answer has an unexpected shape');
    const list = result.data.map(normalizeRollout).filter(Boolean);
    // i18n-ignore: technical detail of the source, logged and shown as-is in diagnostics
    if (!list.length) throw new Error('the list came back empty');
    Object.assign(state, { etag: result.etag ?? null, list, ok: true, at: new Date(), error: null, strikes: 0 });
    return { notModified: false, list };
  } catch (error) {
    // i18n-ignore: technical detail of the source, logged and shown as-is in diagnostics
    Object.assign(state, { ok: false, at: new Date(), error: error.name === 'AbortError' ? 'it took too long' : error.message });
    if (error.retryAfterMs) {
      state.strikes += 1;
      state.pausedUntil = Date.now() + Math.min(3_600_000, error.retryAfterMs * 2 ** (state.strikes - 1));
    }
    logger.warn(`The rollouts list could not be read: ${state.error}`);
    throw error;
  }
}

function resetCache() { state.etag = null; }
function getStatus() { return { ok: state.ok, at: state.at, error: state.error, count: state.list?.length ?? 0 }; }

module.exports = { SOURCE_NAME, SOURCE_URL, KINDS, KIND_LABELS, STATUS_LABELS, kindLabel, statusLabel, filterLines, summarizeFilter, normalizeRollout, rangesPercent, sharePercent, humanize, fetchRollouts, resetCache, getStatus };
