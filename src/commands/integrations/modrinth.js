const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, plain, dateTag } = require('../../utils/integrations');
const { t, formatNumber, languageOf } = require('../../i18n');

const CACHE_MS = 10 * 60_000;
const COOLDOWN = { name: 'modrinth', ms: 3000 };
const TYPES = ['mod', 'modpack', 'resourcepack', 'shader', 'plugin', 'datapack'];

/** The first project that matches some words, from the search of Modrinth. */
async function findProject(query, type) {
  return cached(`modrinth:${type ?? '*'}:${query.toLowerCase()}`, CACHE_MS, async () => {
    const facets = type ? `&facets=${encodeURIComponent(JSON.stringify([[`project_type:${type}`]]))}` : '';
    const body = await fetchJson(`https://api.modrinth.com/v2/search?query=${encodeURIComponent(query)}&limit=1${facets}`);
    const hit = body?.hits?.[0];
    if (!hit) throw new IntegrationError('notFound');
    return hit;
  });
}

module.exports = {
  aliases: ['mr'],
  data: new SlashCommandBuilder()
    .setName('modrinth')
    .setDescription('Look up a Minecraft mod, modpack, resource pack, shader or plugin on Modrinth.')
    .addStringOption((o) => o.setName('query').setDescription('The name, for example sodium. Start with mod, shader, plugin... to choose the kind').setMaxLength(100).setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const typed = interaction.options.getString('query', true).trim();
    await lookup(interaction, lang, 'Modrinth', async () => {
      // `!modrinth shader bsl` looks only for shaders.
      const [first, ...rest] = typed.split(/\s+/);
      const wanted = TYPES.find((type) => type === first.toLowerCase() || `${type}s` === first.toLowerCase());
      const query = wanted && rest.length ? rest.join(' ') : typed;
      if (!query) throw new IntegrationError('badInput');
      const project = await findProject(query, wanted && rest.length ? wanted : null);
      const versions = (project.versions ?? []).slice(-4).reverse().map((version) => `\`${plain(version, 12)}\``).join(' ');
      const loaders = (project.display_categories ?? project.categories ?? []).slice(0, 6).map((category) => `\`${plain(category, 20)}\``).join(' ');
      const side = (value) => t(lang, `integrations.modrinth.side.${value}`);
      return infoPayload({
        accent: null,
        title: plain(project.title, 100),
        subtitle: [plain(project.description, 300)],
        thumbnail: project.icon_url ?? null,
        banner: project.gallery?.[0] ?? null,
        sections: [{
          lines: [
            row(t(lang, 'integrations.modrinth.type'), t(lang, `integrations.modrinth.kind.${project.project_type}`)),
            project.author ? row(t(lang, 'integrations.modrinth.author'), plain(project.author, 40)) : null,
            row(t(lang, 'integrations.modrinth.downloads'), formatNumber(lang, project.downloads ?? 0)),
            row(t(lang, 'integrations.modrinth.follows'), formatNumber(lang, project.follows ?? 0)),
            loaders ? row(t(lang, 'integrations.modrinth.categories'), loaders) : null,
            versions ? row(t(lang, 'integrations.modrinth.versions'), versions) : null,
            ['required', 'optional', 'unsupported'].includes(project.client_side) ? row(t(lang, 'integrations.modrinth.client'), side(project.client_side)) : null,
            ['required', 'optional', 'unsupported'].includes(project.server_side) ? row(t(lang, 'integrations.modrinth.server'), side(project.server_side)) : null,
            project.date_modified ? row(t(lang, 'integrations.modrinth.updated'), dateTag(project.date_modified)) : null,
          ],
        }],
        footer: 'Modrinth', // i18n-ignore: a brand name
        buttons: [{ label: t(lang, 'integrations.modrinth.open'), url: `https://modrinth.com/${project.project_type}/${project.slug}` }],
      });
    }, COOLDOWN);
  },
};

module.exports.findProject = findProject;
