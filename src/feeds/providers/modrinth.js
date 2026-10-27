// Modrinth: the versions of a project (a mod, plugin, modpack, resource pack or shader). Public API, no key.
const { fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');
const { t } = require('../../i18n');

const API = 'https://api.modrinth.com/v2';
const SLUG = /^[\w!@$()`.+,"\-']{3,64}$/;

/** The slug or id from a name or a link (`modrinth.com/mod/sodium`). */
function parseProject(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?modrinth\.com\/(mod|plugin|modpack|resourcepack|shader|datapack)\//i, '').split(/[/?#]/)[0];
  return SLUG.test(text) ? text : null;
}

// A project hardly changes: its name, icon and picture are kept for six hours, so each pass over the feeds does not ask for them again.
const PROJECT_KEEP_MS = 6 * 3_600_000;
const projects = new Map();

async function resolveProject(input) {
  const slug = parseProject(input);
  if (!slug) throw new IntegrationError('badInput');
  const kept = projects.get(slug.toLowerCase());
  if (kept && kept.until > Date.now()) return kept.value;
  const project = await fetchJsonBody(`${API}/project/${encodeURIComponent(slug)}`);
  const gallery = (project.gallery ?? []).find((picture) => picture.featured) ?? project.gallery?.[0];
  const value = {
    id: project.id, slug: project.slug, name: project.title, avatar: project.icon_url ?? null, type: project.project_type,
    url: `https://modrinth.com/${project.project_type}/${project.slug}`, image: gallery?.url ?? null, summary: project.description ?? '',
  };
  if (projects.size > 2000) projects.clear();
  projects.set(value.id.toLowerCase(), { value, until: Date.now() + PROJECT_KEEP_MS });
  projects.set(value.slug.toLowerCase(), { value, until: Date.now() + PROJECT_KEEP_MS });
  return value;
}

/** The newest versions of a project, newest first (a `release` is a final one; `beta` and `alpha` are tests). */
async function fetchVersions(projectId, limit = 10) {
  const versions = await fetchJsonBody(`${API}/project/${encodeURIComponent(projectId)}/version`);
  return (Array.isArray(versions) ? versions : []).slice(0, limit).map((v) => ({
    id: v.id, number: v.version_number, name: v.name, channel: v.version_type, loaders: v.loaders ?? [], gameVersions: v.game_versions ?? [],
    changelog: v.changelog ?? '', published: Date.parse(v.date_published) || null,
  }));
}

const firstLine = (changelog) => String(changelog ?? '').split('\n').map((line) => line.replace(/^[#\-*\s]+/, '').trim()).find((line) => line.length > 3) ?? '';

/** The card item of a version. */
function toItem(project, version) {
  const loaders = version.loaders.slice(0, 3).map((name) => name[0].toUpperCase() + name.slice(1)).join(', ');
  const games = version.gameVersions.length > 1 ? `${version.gameVersions[0]} – ${version.gameVersions.at(-1)}` : version.gameVersions[0];
  return {
    platform: 'modrinth', type: 'update', id: version.id, title: `${project.name} ${version.number}`, url: `${project.url}/version/${encodeURIComponent(version.number)}`,
    description: firstLine(version.changelog) || project.summary, image: project.image, avatar: project.avatar, author: project.name, authorUrl: project.url,
    publishedAt: version.published, extra: [version.channel !== 'release' ? version.channel : null, loaders, games].filter(Boolean).join(' · '),
  };
}

// --- The newest projects of one kind or of several in one feed: `new:mod`, `new:mod+shader`, `new:all` (mods, modpacks, resource packs, shaders, plugins and data packs).
const NEW_KINDS = { mod: 1, modpack: 1, resourcepack: 1, shader: 1, plugin: 1, datapack: 1 };
const ALL_KINDS = Object.keys(NEW_KINDS);

/** The kinds of an account that is a list (`new:mod+shader`, `new:all`), in order, or null when it is not one. */
function parseNew(input) {
  const match = /^new:([a-z+]+)$/.exec(String(input ?? '').trim().toLowerCase());
  if (!match) return null;
  const words = match[1].split('+').filter(Boolean);
  if (words.includes('all')) return ALL_KINDS;
  const kinds = ALL_KINDS.filter((kind) => words.includes(kind));
  return kinds.length && kinds.length === new Set(words).size ? kinds : null;
}

/** The account of a list of the newest projects of those kinds: one feed can follow several kinds, so a server does not use up its places on one kind each. */
function newAccount(kinds, lang) {
  const list = Array.isArray(kinds) ? kinds : [kinds];
  const all = list.length === ALL_KINDS.length;
  return {
    id: `new:${all ? 'all' : list.join('+')}`,
    name: all ? t(lang, 'feeds.list.modrinth.all') : list.map((kind) => t(lang, `feeds.list.modrinth.${kind}`)).join(' + '),
    avatar: null, url: list.length === 1 ? `https://modrinth.com/discover/${list[0]}s` : 'https://modrinth.com/discover/mods',
  };
}

/** The newest projects of those kinds, newest first (`kinds` can be one or several). */
async function fetchNewProjects(kinds) {
  const list = Array.isArray(kinds) ? kinds : [kinds];
  const facets = encodeURIComponent(JSON.stringify([list.map((kind) => `project_type:${kind}`)]));
  const body = await fetchJsonBody(`${API}/search?limit=${Math.min(20, 8 + list.length * 2)}&index=newest&facets=${facets}`);
  return (body?.hits ?? []).map((hit) => ({
    platform: 'modrinth', type: 'project', id: hit.project_id, title: String(hit.title ?? hit.slug).slice(0, 200), url: `https://modrinth.com/${hit.project_type}/${hit.slug}`, description: String(hit.description ?? '').slice(0, 300),
    image: /^https:\/\//.test(hit.featured_gallery ?? '') ? hit.featured_gallery : (hit.gallery ?? []).find((url) => /^https:\/\//.test(url)) ?? null, avatar: hit.icon_url ?? null, author: hit.author ?? '', authorUrl: hit.author ? `https://modrinth.com/user/${hit.author}` : null,
    publishedAt: Date.parse(hit.date_created) || null, extra: [String(hit.project_type ?? '').toUpperCase(), (hit.versions ?? []).at(-1)].filter(Boolean).join(' · '),
  }));
}

module.exports = { parseProject, resolveProject, fetchVersions, toItem, NEW_KINDS, ALL_KINDS, parseNew, newAccount, fetchNewProjects };
