// i18n-ignore-file: Petto team operator command.
const { SlashCommandBuilder } = require('discord.js');
const { EMOJI } = require('../../utils/emojis');
const { sendGuildNotice, TEMPLATES } = require('../../utils/guildOpsAlerts');
const logger = require('../../utils/logger');
const { isTeam, findGuild, notFoundText, guildLine, opsNote, teamReply, oneLine } = require('../../utils/teamTools');

const TYPES = Object.keys(TEMPLATES);
const RED = 0xfe6465;
const YELLOW = 0xfed53c;
const GREEN = 0xa5ea7a;

/**
 * Private support control, prefix only: sends one of the notices (`policy`, `permissions`, `logs`, `diagnostic`, `maintenance`) to a server, in its language.
 * The notice goes to a PRIVATE staff or log channel of that server, else to the owner by direct message, never to a public channel; no mention can ping anyone
 * (`allowedMentions` none in every route). Anybody outside the team gets no answer. What it did is shown (name, ID, members, owner, where it went) and noted in
 * the operations channel.
 */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  teamOnly: true,
  team: {
    summary: `Sends a notice (${TYPES.join(', ')}) to a server in its own language: to a private staff channel, else to its owner by DM, never to a public channel and never with pings.`,
    usage: ['!guildsend <server id or name> <type> [details]', '!guildsend here <type> [details]'],
    who: 'owner and developers',
    area: 'servers',
    examples: ['!guildsend 123456789012345678 notice', '!guildsend here notice'],
    answers: 'where the notice went (private staff channel or the owner by DM) and a note in the operations channel',
    dangers: 'It sends a real message to a server or its owner, in the language of the server, with no pings.',
  },
  data: new SlashCommandBuilder()
    .setName('guildsend')
    .setDescription('Private support control: send a notice to a server.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('server')
      .setDescription('Server ID, its exact name (in quotes if it has spaces), or here.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('type')
      .setDescription(`Type: ${TYPES.join(', ')}`)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('details')
      .setDescription('Optional notice context.')),

  async execute(interaction) {
    if (!isTeam(interaction.user?.id)) return undefined;
    const client = interaction.client;
    const query = interaction.options.getString('server', true).trim();
    const kind = interaction.options.getString('type', true).trim().toLowerCase();
    const details = interaction.options.getString('details', false)?.trim() || null;

    if (!TYPES.includes(kind)) return teamReply(interaction, `${EMOJI.WARNING} Unknown type. Use: \`${TYPES.join('`, `')}\`.`, YELLOW);
    const found = await findGuild(client, query, { current: interaction.guild ?? null });
    if (!found.ok) return teamReply(interaction, `${EMOJI.WARNING} ${notFoundText(found, query)}`, YELLOW);
    if (!found.guild) return teamReply(interaction, `${EMOJI.DENY} Petto is not currently in a server with ID \`${found.id}\`.`, RED);
    const guild = found.guild;

    await interaction.deferReply?.();
    const result = await sendGuildNotice(client, {
      guildId: guild.id, kind, details, source: '!guildsend', requestedBy: interaction.user.id, force: true, teamAlert: TEMPLATES[kind].severity === 'critical',
    });
    const summary = guildLine(guild);
    if (!result.ok) {
      logger.warn({ guildId: guild.id, action: 'guildsend', userId: interaction.user.id }, 'Guild notice could not be delivered privately; team alert fallback was attempted.');
      await opsNote(client, `**Notice (${kind}) could NOT be delivered.**\n${summary}\nBy: <@${interaction.user.id}> (\`${interaction.user.id}\`)`);
      return teamReply(interaction, `${EMOJI.WARNING} Petto could not find a safe private route to ${summary}. No public channel was used; the team alert fallback was attempted.`, YELLOW);
    }

    const destination = result.deliveryType === 'owner_dm' ? 'by DM to the server owner' : result.channel ? `in the private channel <#${result.channel.id}>` : 'through a private route';
    logger.info({ guildId: guild.id, action: 'guildsend', userId: interaction.user.id, deliveryType: result.deliveryType }, `Guild ${kind} notice delivered ${destination}.`);
    await opsNote(client, `**Notice (${kind}) sent ${oneLine(destination, 100)}.**\n${summary}\nBy: <@${interaction.user.id}> (\`${interaction.user.id}\`)${details ? `\nDetails: ${oneLine(details, 300)}` : ''}`);
    return teamReply(interaction, `${EMOJI.APPROVE} Notice **${kind}** delivered ${destination}.\n${summary}`, GREEN);
  },
};
