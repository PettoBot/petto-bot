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
const { ensureGuild } = require('../../db/guilds');

const WIKI_URL = 'https://wiki.petto.sbs';

/** The text of the card for a server prefix. Every command here exists in Petto; the numbers are the ones Petto suggests to start with. */
function buildConfigText(prefix) {
  const block = (lines) => `\`\`\`\n${lines.map((line) => `${prefix}${line}`).join('\n')}\n\`\`\``;
  return [
    '### Recommended Petto Config',
    '**Protection** (anti-raid, new accounts and anti-nuke):',
    block([
      'automod raid on --threshold 6 --window_seconds 10 --action kick',
      'automod anti-alt on --min_age_days 7 --action kick',
      'automod antinuke on --threshold 5 --window_seconds 10',
      'automod spam on --max_mentions 5',
    ]),
    '**How do I whitelist a user from anti-nuke?**',
    block(['automod antinuke-whitelist add [user]']),
    '-# Whitelisted users are ignored by anti-nuke, so only whitelist staff and bots you trust.',
    '**How do I make a role immune to AutoMod?**',
    block(['automod immune add [role]']),
    '**Logs** (pick a channel and an event; `' + prefix + 'logs view` lists them):',
    block(['logs add #logs sanctions', 'logs add #logs members', 'logs add #logs channels']),
    '**Tickets** (guided setup, with menus and buttons):',
    block(['ticket setup']),
  ].join('\n');
}

module.exports = {
  prefixOnly: true,
  data: new SlashCommandBuilder()
    .setName('cmdconfig')
    .setDescription('Show the recommended Petto configuration, with commands ready to copy.')
    .setDMPermission(false),

  async execute(interaction) {
    const guildConfig = await ensureGuild(interaction.guild.id).catch(() => null);
    const prefix = guildConfig?.prefix || '!';
    const container = new ContainerBuilder()
      .setAccentColor(0x4b4f59)
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(buildConfigText(prefix)))
      .addSeparatorComponents(new SeparatorBuilder().setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(new ActionRowBuilder().addComponents(new ButtonBuilder().setLabel('Documentation').setStyle(ButtonStyle.Link).setURL(WIKI_URL)));
    await interaction.reply({ components: [container], flags: MessageFlags.IsComponentsV2 });
  },
};

module.exports.buildConfigText = buildConfigText;
