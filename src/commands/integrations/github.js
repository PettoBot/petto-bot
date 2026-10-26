const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, short, plain, dateTag } = require('../../utils/integrations');
const { t, formatNumber, languageOf } = require('../../i18n');

const API = 'https://api.github.com';
const CACHE_MS = 5 * 60_000;
const COOLDOWN = { name: 'github', ms: 3000 };
const USER_PATTERN = /^[a-z\d](?:[a-z\d-]{0,38})$/i;
const REPO_PATTERN = /^[\w.-]{1,100}$/;

/** `{ owner, repo }` from `owner/repo` or a github.com link, or null. */
function parseRepo(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '');
  const [owner, rawRepo] = text.split(/[/?#]/);
  const repo = String(rawRepo ?? '').replace(/\.git$/i, '');
  if (!owner || !repo || !USER_PATTERN.test(owner) || !REPO_PATTERN.test(repo) || repo === '.' || repo === '..') return null;
  return { owner, repo };
}

/** The login from `octocat`, `@octocat` or a github.com link, or null. */
function parseUser(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?github\.com\//i, '').replace(/^@/, '').split(/[/?#]/)[0];
  return USER_PATTERN.test(text) ? text : null;
}

const github = (path) => cached(`gh:${path}`, CACHE_MS, () => fetchJson(`${API}${path}`, {
  headers: {
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    ...(config.githubToken ? { Authorization: `Bearer ${config.githubToken}` } : {}),
  },
}));

/** Release notes as plain lines: headings lose their marks, and the text is cut. */
function notesOf(body, max = 700) {
  const text = String(body ?? '').replace(/\r/g, '').replace(/^#{1,6}\s+/gm, '').replace(/\n{3,}/g, '\n\n').trim();
  return text.length > max ? `${text.slice(0, max - 1).trimEnd()}…` : text;
}

module.exports = {
  aliases: ['gh'],
  data: new SlashCommandBuilder()
    .setName('github')
    .setDescription('Look up a GitHub profile, repository or release.')
    .addSubcommand((s) => s
      .setName('user')
      .setDescription('The profile of a GitHub user.')
      .addStringOption((o) => o.setName('name').setDescription('The username, for example octocat').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('repo')
      .setDescription('A repository: stars, forks, language and more.')
      .addStringOption((o) => o.setName('repository').setDescription('owner/name, or the link to the repository').setMaxLength(200).setRequired(true)))
    .addSubcommand((s) => s
      .setName('release')
      .setDescription('The latest release of a repository.')
      .addStringOption((o) => o.setName('repository').setDescription('owner/name, or the link to the repository').setMaxLength(200).setRequired(true))),

  // The short words people type after the command.
  // `!gh octocat` is the user, `!gh PettoBot/petto-bot` (or a link to a repository) is the repository.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? (parseRepo(tokens[0]) ? 'repo' : 'user') : null),
  prefixSubcommandAliases: { u: 'user', profile: 'user', r: 'repo', rel: 'release', latest: 'release' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const number = (value) => formatNumber(lang, value ?? 0);
    await lookup(interaction, lang, 'GitHub', async () => {
      if (sub === 'user') {
        const login = parseUser(interaction.options.getString('name', true));
        if (!login) throw new IntegrationError('badInput');
        const user = await github(`/users/${login}`);
        return infoPayload({
          accent: null,
          title: user.name ? `${plain(user.name, 100)} (${user.login})` : user.login,
          subtitle: user.bio ? [plain(user.bio, 300)] : [],
          thumbnail: user.avatar_url,
          sections: [{
            lines: [
              row(t(lang, 'integrations.github.repos'), number(user.public_repos)),
              row(t(lang, 'integrations.github.followers'), number(user.followers)),
              row(t(lang, 'integrations.github.following'), number(user.following)),
              user.company ? row(t(lang, 'integrations.github.company'), plain(user.company, 80)) : null,
              user.location ? row(t(lang, 'integrations.github.location'), plain(user.location, 80)) : null,
              row(t(lang, 'integrations.github.joined'), dateTag(user.created_at)),
            ],
          }],
          footer: `${user.type === 'Organization' ? t(lang, 'integrations.github.org') : t(lang, 'integrations.github.person')} · GitHub`,
          buttons: [{ label: t(lang, 'integrations.github.open'), url: user.html_url }],
        });
      }

      const target = parseRepo(interaction.options.getString('repository', true));
      if (!target) throw new IntegrationError('badInput');
      const path = `/repos/${target.owner}/${target.repo}`;

      if (sub === 'repo') {
        const repo = await github(path);
        const topics = (repo.topics ?? []).slice(0, 8).map((topic) => `\`${topic}\``).join(' ');
        return infoPayload({
          accent: null,
          title: repo.full_name,
          subtitle: repo.description ? [plain(repo.description, 300)] : [],
          thumbnail: repo.owner?.avatar_url,
          sections: [{
            lines: [
              row(t(lang, 'integrations.github.stars'), number(repo.stargazers_count)),
              row(t(lang, 'integrations.github.forks'), number(repo.forks_count)),
              row(t(lang, 'integrations.github.issues'), number(repo.open_issues_count)),
              repo.language ? row(t(lang, 'integrations.github.language'), plain(repo.language, 40)) : null,
              repo.license?.spdx_id && repo.license.spdx_id !== 'NOASSERTION' ? row(t(lang, 'integrations.github.license'), plain(repo.license.spdx_id, 40)) : null,
              row(t(lang, 'integrations.github.updated'), dateTag(repo.pushed_at)),
              row(t(lang, 'integrations.github.created'), dateTag(repo.created_at)),
              topics ? row(t(lang, 'integrations.github.topics'), topics) : null,
              repo.archived ? `-# ${t(lang, 'integrations.github.archived')}` : null,
            ],
          }],
          footer: 'GitHub',
          buttons: [{ label: t(lang, 'integrations.github.open'), url: repo.html_url }],
        });
      }

      const release = await github(`${path}/releases/latest`);
      const assets = (release.assets ?? []).slice(0, 5).map((asset) => `\`${short(asset.name, 60)}\` · ${number(asset.download_count)}`);
      const notes = notesOf(release.body);
      return infoPayload({
        accent: null,
        title: `${target.owner}/${target.repo} ${release.tag_name}`,
        subtitle: release.name && release.name !== release.tag_name ? [plain(release.name, 150)] : [],
        sections: [
          {
            lines: [
              row(t(lang, 'integrations.github.published'), dateTag(release.published_at, 'F')),
              release.author?.login ? row(t(lang, 'integrations.github.author'), plain(release.author.login, 40)) : null,
              release.prerelease ? `-# ${t(lang, 'integrations.github.prerelease')}` : null,
            ],
          },
          notes ? { title: t(lang, 'integrations.github.notes'), lines: [notes] } : null,
          assets.length ? { title: t(lang, 'integrations.github.downloads'), lines: assets } : null,
        ].filter(Boolean),
        footer: 'GitHub',
        buttons: [{ label: t(lang, 'integrations.github.open'), url: release.html_url }],
      });
    }, COOLDOWN);
  },
};

module.exports.parseRepo = parseRepo;
module.exports.parseUser = parseUser;
module.exports.notesOf = notesOf;
