const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, plain, short, dateTag } = require('../../utils/integrations');
const { t, formatNumber, languageOf } = require('../../i18n');

const CACHE_MS = 10 * 60_000;
const COOLDOWN = { name: 'package', ms: 3000 };
const NPM_NAME = /^(?:@[a-z0-9][\w.-]*\/)?[a-z0-9][\w.-]*$/i;
const PYPI_NAME = /^[a-z0-9][\w.-]*$/i;

/** The name of an npm package (`discord.js`, `@napi-rs/canvas`) or null; a link to npmjs.com works too. */
function parseNpm(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?npmjs\.com\/package\//i, '').replace(/[?#].*$/, '').replace(/\/v\/.*$/, '');
  return text.length <= 214 && NPM_NAME.test(text) ? text : null;
}

/** The name of a PyPI project, or null; a link to pypi.org works too. */
function parsePypi(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?pypi\.org\/project\//i, '').replace(/[/?#].*$/, '');
  return text.length <= 100 && PYPI_NAME.test(text) ? text : null;
}

/** A repository address as a web link (`git+https://github.com/a/b.git` becomes `https://github.com/a/b`), or null. */
function repositoryLink(repository) {
  const raw = typeof repository === 'string' ? repository : repository?.url;
  if (!raw) return null;
  const match = /(?:github\.com|gitlab\.com|bitbucket\.org)[:/]([\w.-]+\/[\w.-]+?)(?:\.git)?(?:[#?].*)?$/i.exec(raw);
  if (!match) return null;
  const host = /gitlab/i.test(raw) ? 'gitlab.com' : /bitbucket/i.test(raw) ? 'bitbucket.org' : 'github.com';
  return `https://${host}/${match[1]}`;
}

async function findNpm(name) {
  return cached(`npm:${name.toLowerCase()}`, CACHE_MS, async () => {
    const [latest, downloads] = await Promise.all([
      fetchJson(`https://registry.npmjs.org/${name.replace(/\//g, '%2f')}/latest`),
      fetchJson(`https://api.npmjs.org/downloads/point/last-week/${name}`).catch(() => null),
    ]);
    if (!latest?.name) throw new IntegrationError('notFound');
    return { latest, downloads: downloads?.downloads ?? null };
  });
}

async function findPypi(name) {
  return cached(`pypi:${name.toLowerCase()}`, CACHE_MS, async () => {
    const body = await fetchJson(`https://pypi.org/pypi/${encodeURIComponent(name)}/json`);
    if (!body?.info?.name) throw new IntegrationError('notFound');
    return body;
  });
}

module.exports = {
  aliases: ['pkg'],
  data: new SlashCommandBuilder()
    .setName('package')
    .setDescription('Look up a package of npm or PyPI: version, downloads, license and links.')
    .addSubcommand((s) => s
      .setName('npm')
      .setDescription('A package of npm (JavaScript).')
      .addStringOption((o) => o.setName('package').setDescription('The name, for example discord.js').setMaxLength(214).setRequired(true)))
    .addSubcommand((s) => s
      .setName('pypi')
      .setDescription('A project of PyPI (Python).')
      .addStringOption((o) => o.setName('package').setDescription('The name, for example requests').setMaxLength(100).setRequired(true))),

  // `!pkg discord.js` is an npm package.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'npm' : null),
  prefixSubcommandAliases: { js: 'npm', node: 'npm', py: 'pypi', python: 'pypi', pip: 'pypi' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const typed = interaction.options.getString('package', true);
    await lookup(interaction, lang, sub === 'npm' ? 'npm' : 'PyPI', async () => {
      if (sub === 'npm') {
        const name = parseNpm(typed);
        if (!name) throw new IntegrationError('badInput');
        const { latest, downloads } = await findNpm(name);
        const repo = repositoryLink(latest.repository);
        const buttons = [{ label: t(lang, 'integrations.package.open'), url: `https://www.npmjs.com/package/${latest.name}` }];
        if (repo) buttons.push({ label: t(lang, 'integrations.package.source'), url: repo });
        else if (/^https?:\/\//i.test(latest.homepage ?? '')) buttons.push({ label: t(lang, 'integrations.package.homepage'), url: latest.homepage });
        const size = latest.dist?.unpackedSize ? `${formatNumber(lang, Math.round(latest.dist.unpackedSize / 1024))} kB` : null;
        return infoPayload({
          accent: null,
          title: `${plain(latest.name, 100)} ${plain(latest.version, 30)}`,
          subtitle: latest.description ? [plain(latest.description, 300)] : [],
          sections: [{
            lines: [
              downloads !== null ? row(t(lang, 'integrations.package.weekly'), formatNumber(lang, downloads)) : null,
              latest.license ? row(t(lang, 'integrations.package.license'), plain(typeof latest.license === 'string' ? latest.license : latest.license.type, 40)) : null,
              row(t(lang, 'integrations.package.dependencies'), formatNumber(lang, Object.keys(latest.dependencies ?? {}).length)),
              size ? row(t(lang, 'integrations.package.size'), size) : null,
              (latest.keywords ?? []).length ? row(t(lang, 'integrations.package.keywords'), latest.keywords.slice(0, 6).map((word) => `\`${plain(word, 20)}\``).join(' ')) : null,
              row(t(lang, 'integrations.package.install'), `\`npm i ${latest.name}\``),
            ],
          }],
          footer: 'npm', // i18n-ignore: a brand name
          buttons,
        });
      }

      const name = parsePypi(typed);
      if (!name) throw new IntegrationError('badInput');
      const body = await findPypi(name);
      const info = body.info;
      const links = info.project_urls ?? {};
      const source = Object.entries(links).map(([, url]) => repositoryLink(url)).find(Boolean);
      const uploaded = body.urls?.[0]?.upload_time_iso_8601 ?? body.urls?.[0]?.upload_time;
      const buttons = [{ label: t(lang, 'integrations.package.open'), url: info.package_url ?? `https://pypi.org/project/${info.name}/` }];
      if (source) buttons.push({ label: t(lang, 'integrations.package.source'), url: source });
      const license = info.license && info.license.length < 40 ? info.license : (info.classifiers ?? []).find((entry) => entry.startsWith('License ::'))?.split('::').at(-1)?.trim();
      return infoPayload({
        accent: null,
        title: `${plain(info.name, 100)} ${plain(info.version, 30)}`,
        subtitle: info.summary ? [plain(info.summary, 300)] : [],
        sections: [{
          lines: [
            license ? row(t(lang, 'integrations.package.license'), plain(license, 40)) : null,
            info.requires_python ? row(t(lang, 'integrations.package.python'), `\`${plain(info.requires_python, 30)}\``) : null,
            info.author ? row(t(lang, 'integrations.package.author'), plain(info.author, 60)) : null,
            uploaded ? row(t(lang, 'integrations.package.released'), dateTag(uploaded)) : null,
            row(t(lang, 'integrations.package.versions'), formatNumber(lang, Object.keys(body.releases ?? {}).length)),
            row(t(lang, 'integrations.package.install'), `\`pip install ${info.name}\``), // i18n-ignore: a shell command
          ],
        }],
        footer: 'PyPI',
        buttons,
      });
    }, COOLDOWN);
  },
};

module.exports.parseNpm = parseNpm;
module.exports.parsePypi = parsePypi;
module.exports.repositoryLink = repositoryLink;
