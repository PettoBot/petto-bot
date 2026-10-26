// New versions of a package: npm and PyPI. Both registries are public and need no key; only the newest version is read, so each answer is small.
const { fetchJsonBody } = require('../http');
const { IntegrationError } = require('../../utils/integrations');

const NPM = /^(@[a-z0-9~][a-z0-9._~-]{0,213}\/)?[a-z0-9~][a-z0-9._~-]{0,213}$/;
const PYPI = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/;

function parseNpm(input) {
  const text = decodeURIComponent(String(input ?? '').trim().replace(/^https?:\/\/(www\.)?npmjs\.com\/package\//i, '').split(/[?#]/)[0].replace(/\/v\/[^/]*$/, '')).toLowerCase();
  return NPM.test(text) ? text : null;
}

function parsePypi(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?pypi\.org\/project\//i, '').split(/[/?#]/)[0];
  return PYPI.test(text) ? text.toLowerCase() : null;
}

async function npmLatest(name) {
  const body = await fetchJsonBody(`https://registry.npmjs.org/${name.replace(/\//g, '%2F')}/latest`);
  if (!body?.version) throw new IntegrationError('notFound');
  return { name: body.name ?? name, version: String(body.version), description: String(body.description ?? ''), url: `https://www.npmjs.com/package/${name}`, published: null };
}

async function pypiLatest(name) {
  const body = await fetchJsonBody(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
  if (!body?.info?.version) throw new IntegrationError('notFound');
  const version = String(body.info.version);
  const upload = body.releases?.[version]?.[0]?.upload_time_iso_8601;
  return { name: body.info.name ?? name, version, description: String(body.info.summary ?? ''), url: `https://pypi.org/project/${name}/`, published: upload ? Date.parse(upload) || null : null };
}

/** The card item of a package's newest version. `now` stands for the day a version has no date (npm answers without one). */
const toItem = (platform, account, latest, now = Date.now()) => ({
  platform, type: 'update', id: `${latest.name}@${latest.version}`, title: `${latest.name} ${latest.version}`, url: latest.url, description: latest.description, image: null,
  avatar: account.avatar ?? null, author: latest.name, authorUrl: latest.url, publishedAt: latest.published ?? now, extra: '',
});

module.exports = { parseNpm, parsePypi, npmLatest, pypiLatest, toItem };
