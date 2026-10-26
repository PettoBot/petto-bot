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

async function resolveProject(input) {
  const slug = parseProject(input);
  if (!slug) throw new IntegrationError('badInput');
  const project = await fetchJsonBody(`${API}/project/${encodeURIComponent(slug)}`);
  const gallery = (project.gallery ?? []).find((picture) => picture.featured) ?? project.gallery?.[0];
  return {
    id: project.id, slug: project.slug, name: project.title, avatar: project.icon_url ?? null, type: project.project_type,
    url: `https://modrinth.com/${project.project_type}/${project.slug}`, image: gallery?.url ?? null, summary: project.description ?? '',
  };
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

module.exports = { parseProject, resolveProject, fetchVersions, toItem };
