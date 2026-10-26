// GitHub: the releases of a repository. The public API (no key; `PETTO_GITHUB_TOKEN`, which the bot already uses for `!github`, raises the limit
// from 60 to 5000 calls an hour). A call that finds nothing new answers "304" and does not count against the limit, so each repository is asked
// with the tag of the last answer.
const config = require('../../config');
const { fetchJsonBody } = require('../http');
const { IntegrationError, USER_AGENT } = require('../../utils/integrations');

const API = 'https://api.github.com';
const REPO = /^[\w.\-]{1,100}\/[\w.\-]{1,100}$/;

/** `owner/name` from a name or a link to the repository (or to one of its pages). */
function parseRepo(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/\.git$/i, '');
  const parts = text.split(/[?#]/)[0].split('/').filter(Boolean).slice(0, 2).join('/');
  return REPO.test(parts) ? parts : null;
}

const headers = (extra = {}) => ({ Accept: 'application/vnd.github+json', ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}), ...extra });

async function resolveRepo(input) {
  const repo = parseRepo(input);
  if (!repo) throw new IntegrationError('badInput');
  const body = await fetchJsonBody(`${API}/repos/${repo}`, { headers: headers() });
  if (!body?.full_name) throw new IntegrationError('notFound');
  return { id: body.full_name.toLowerCase(), name: body.full_name, avatar: body.owner?.avatar_url ?? null, url: body.html_url, description: body.description ?? '' };
}

const tags = new Map(); // repo -> { etag, releases }
const TAGS_LIMIT = 5000;

/** The newest releases of a repository (drafts left out), newest first. */
async function fetchReleases(repo, limit = 5) {
  const kept = tags.get(repo);
  let response;
  try {
    response = await globalThis.fetch(`${API}/repos/${repo}/releases?per_page=${limit}`, { headers: { 'User-Agent': USER_AGENT, ...headers(kept ? { 'If-None-Match': kept.etag } : {}) }, signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new IntegrationError('unavailable');
  }
  if (response.status === 304 && kept) return kept.releases;
  if (response.status === 404) throw new IntegrationError('notFound');
  if (response.status === 403 || response.status === 429) throw new IntegrationError('rateLimited');
  if (!response.ok) throw new IntegrationError('unavailable', String(response.status));
  const body = await response.json().catch(() => null);
  const releases = (Array.isArray(body) ? body : []).filter((release) => !release.draft).map((release) => ({
    id: String(release.id), tag: release.tag_name, name: release.name || release.tag_name, url: release.html_url, body: release.body ?? '', prerelease: Boolean(release.prerelease),
    published: Date.parse(release.published_at ?? release.created_at) || null, author: release.author?.login ?? null,
  }));
  const etag = response.headers.get('etag');
  if (etag) { if (tags.size >= TAGS_LIMIT) tags.clear(); tags.set(repo, { etag, releases }); }
  return releases;
}

const firstLine = (markdown) => String(markdown ?? '').split('\n').map((line) => line.replace(/^[#>\-*\s]+/, '').replace(/[*_`]/g, '').trim()).find((line) => line.length > 3) ?? '';

function toItem(account, release) {
  const name = String(account.name ?? '').split('/')[1] ?? account.name;
  const label = release.name && release.name !== release.tag ? release.name : release.tag;
  return {
    platform: 'github', type: 'update', id: release.id, title: label.toLowerCase().includes(name.toLowerCase()) ? label : `${name} ${label}`, url: release.url,
    description: firstLine(release.body), image: null, avatar: account.avatar ?? null, author: account.name, authorUrl: account.url, publishedAt: release.published,
    extra: release.prerelease ? 'pre-release' : '',
  };
}

module.exports = { parseRepo, resolveRepo, fetchReleases, toItem };
