// Modrinth: the versions of a project (a mod, plugin, modpack, resource pack or shader). Public API, no key.
const { fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');

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

// --- The newest projects of a kind (not the versions of one project): `new:mod`, `new:modpack`, `new:resourcepack`, `new:shader`, `new:plugin`, `new:datapack`.
const NEW_KINDS = { mod: 'Mods', modpack: 'Modpacks', resourcepack: 'Resource packs', shader: 'Shaders', plugin: 'Plugins', datapack: 'Data packs' }; // i18n-ignore: the names of what Modrinth hosts

/** `new:mod` and the like (what the search gives), or null. */
const parseNew = (input) => { const kind = /^new:([a-z]+)$/.exec(String(input ?? '').trim().toLowerCase())?.[1]; return kind in NEW_KINDS ? kind : null; };

/** The account of the new projects of a kind. */
const newAccount = (kind) => ({ id: `new:${kind}`, name: `New ${NEW_KINDS[kind].toLowerCase()}`, avatar: null, url: `https://modrinth.com/discover/${kind}s` }); // i18n-ignore: the name of a list

/** The 10 newest projects of a kind, newest first. */
async function fetchNewProjects(kind) {
  const facets = encodeURIComponent(JSON.stringify([[`project_type:${kind}`]]));
  const body = await fetchJsonBody(`${API}/search?limit=10&index=newest&facets=${facets}`);
  return (body?.hits ?? []).map((hit) => ({
    platform: 'modrinth', type: 'post', id: hit.project_id, title: String(hit.title ?? hit.slug).slice(0, 200), url: `https://modrinth.com/${hit.project_type}/${hit.slug}`, description: String(hit.description ?? '').slice(0, 300),
    image: /^https:\/\//.test(hit.featured_gallery ?? '') ? hit.featured_gallery : (hit.gallery ?? []).find((url) => /^https:\/\//.test(url)) ?? null, avatar: hit.icon_url ?? null, author: hit.author ?? '', authorUrl: hit.author ? `https://modrinth.com/user/${hit.author}` : null,
    publishedAt: Date.parse(hit.date_created) || null, extra: [NEW_KINDS[kind].replace(/s$/, ''), (hit.versions ?? []).at(-1)].filter(Boolean).join(' · '),
  }));
}

module.exports = { parseProject, resolveProject, fetchVersions, toItem, NEW_KINDS, parseNew, newAccount, fetchNewProjects };
