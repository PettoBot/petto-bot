// i18n-ignore-file: Petto team operator command.
const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const { resolveOpsGuildId } = require('../../utils/opsGuild');
const { isPettoOperator } = require('../../utils/autoModControl');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { sendGuildNotice, TEMPLATES } = require('../../utils/guildOpsAlerts');
const logger = require('../../utils/logger');

const SNOWFLAKE_RE = /^\d{15,25}$/;
const TYPES = Object.keys(TEMPLATES);

module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  data: new SlashCommandBuilder()
    .setName('guildsend')
    .setDescription('Private support control: send a notice to a server.')
    .setDMPermission(false)
    .addStringOption((option) => option
      .setName('guild_id')
      .setDescription('Discord server ID.')
      .setRequired(true))
    .addStringOption((option) => option
      .setName('type')
      .setDescription(`Type: ${TYPES.join(', ')}`)
      .setRequired(true))
    .addStringOption((option) => option
      .setName('details')
      .setDescription('Optional notice context.')),

  async execute(interaction) {
    if (!isPettoOperator(interaction.user?.id)) {
      return reply(interaction, `${EMOJI.DENY} This private support control is not available to this account.`, 0xfe6465);
    }

    const supportGuildId = await resolveOpsGuildId(interaction.client);
    if (!supportGuildId || interaction.guildId !== supportGuildId) {
      return reply(interaction, `${EMOJI.DENY} This control can only be used in Petto's private operations server.`, 0xfe6465);
    }

    const guildId = interaction.options.getString('guild_id', true).trim();
    const kind = interaction.options.getString('type', true).trim().toLowerCase();
    const details = interaction.options.getString('details', false)?.trim() || null;

    if (!SNOWFLAKE_RE.test(guildId)) {
      return reply(interaction, `${EMOJI.WARNING} Use a valid Discord server ID.`, 0xfed53c);
    }
    if (!TYPES.includes(kind)) {
      return reply(interaction, `${EMOJI.WARNING} Unknown type. Use: \`${TYPES.join('`, `')}\`.`, 0xfed53c);
    }

    const guild = await resolveGuild(interaction.client, guildId);
    if (!guild) {
      return reply(interaction, `${EMOJI.DENY} Petto is not currently in a server with ID \`${guildId}\`.`, 0xfe6465);
    }

    await interaction.reply({
      components: [textCard(`${EMOJI.WARNING} Sending **${kind}** notice to \`${guildId}\`…`)],
      flags: MessageFlags.IsComponentsV2,
    });

    const result = await sendGuildNotice(interaction.client, {
      guildId,
      kind,
      details,
      source: '!guildsend',
      requestedBy: interaction.user.id,
      force: true,
      teamAlert: TEMPLATES[kind].severity === 'critical',
    });

    if (!result.ok) {
      logger.warn({ guildId, action: 'guildsend', userId: interaction.user.id }, 'Guild notice could not be delivered privately; team alert fallback was attempted.');
      return interaction.editReply({
        components: [textCard(`${EMOJI.WARNING} Petto could not find a safe private delivery route. No public channel was used; the team alert fallback was attempted.`, 0xfed53c)],
        flags: MessageFlags.IsComponentsV2,
      });
    }

    const destination = result.deliveryType === 'owner_dm'
      ? 'by DM to the server owner'
      : result.channel
        ? `in <#${result.channel.id}>`
        : 'through a private route';

    logger.info({ guildId, action: 'guildsend', userId: interaction.user.id, deliveryType: result.deliveryType }, `Guild ${kind} notice delivered ${destination}.`);
    return interaction.editReply({
      components: [textCard(`${EMOJI.APPROVE} Notice delivered to **${guild.name}** (\`${guildId}\`) ${destination}.`, 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
  },
};

async function resolveGuild(client, guildId) {
  return client.guilds.cache.get(String(guildId))
    ?? client.guilds.fetch(String(guildId)).catch(() => null);
}


async function reply(interaction, content, color) {
  return interaction.reply({
    components: [textCard(content, color)],
    flags: MessageFlags.IsComponentsV2,
    allowedMentions: { parse: [] },
  });
}
