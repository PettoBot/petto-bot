// A card with the recommended setup of Petto and the commands to copy, in the style of the "recommended config" cards of other bots.
const {
  SlashCommandBuilder,
  ContainerBuilder,
  TextDisplayBuilder,
  SeparatorBuilder,
  SeparatorSpacingSize,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
} = require('discord.js');
const guildPrefixes = require('../../utils/guildPrefixes');
const { ensureGuild } = require('../../db/guilds');
const { t, currentLanguage, languageOf } = require('../../i18n');

const WIKI_URL = 'https://wiki.petto.sbs';

/** The text of the card for a server prefix. Every command here exists in Petto; the numbers are the ones Petto suggests to start with. */
function buildConfigText(prefix, lang = currentLanguage()) {
  const block = (lines) => `\`\`\`\n${lines.map((line) => `${prefix}${line}`).join('\n')}\n\`\`\``;
  return [
    t(lang, 'info.cmdconfig.title'),
    t(lang, 'info.cmdconfig.protection'),
    block([
      'automod raid on --threshold 6 --window_seconds 10 --action kick', // i18n-ignore: a command to copy
      'automod anti-alt on --min_age_days 7 --action kick', // i18n-ignore: a command to copy
      'automod antinuke on --threshold 5 --window_seconds 10', // i18n-ignore: a command to copy
      'automod spam on --max_mentions 5', // i18n-ignore: a command to copy
    ]),
    t(lang, 'info.cmdconfig.whitelistQuestion'),
    block(['automod antinuke-whitelist add [user]']), // i18n-ignore: a command to copy
    t(lang, 'info.cmdconfig.whitelistNote'),
    t(lang, 'info.cmdconfig.immuneQuestion'),
    block(['automod immune add [role]']), // i18n-ignore: a command to copy
    t(lang, 'info.cmdconfig.logs', { prefix }),
    block(['logs add #logs sanctions', 'logs add #logs members', 'logs add #logs channels']), // i18n-ignore: a command to copy
    t(lang, 'info.cmdconfig.tickets'),
    block(['ticket setup']), // i18n-ignore: a command to copy
    t(lang, 'info.cmdconfig.modules', { prefix }),
  ].join('\n');
}

module.exports = {
  prefixOnly: true,
  data: new SlashCommandBuilder()
    .setName('cmdconfig')
    .setDescription('Show the recommended Petto configuration, with commands ready to copy.')
    .setDMPermission(false),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const guildConfig = await ensureGuild(interaction.guild.id).catch(() => null);
    const prefix = guildPrefixes.primaryPrefix(guildConfig);
    const container = new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildConfigText(prefix, lang)))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel(t(lang, 'info.cmdconfig.docs.button')).setStyle(ButtonStyle.Link).setURL(WIKI_URL)));
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};

module.exports.buildConfigText = buildConfigText;
