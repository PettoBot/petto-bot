const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const disabledDb = require('../../db/disabledCommands');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('disablecommand')
    .setDescription('Disable/enable specific commands, server-wide or per channel.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('disable').setDescription('Disable a command.').addStringOption((o) => o.setName('command').setDescription('Command name (as typed, without the prefix)').setRequired(true)).addChannelOption((o) => o.setName('channel').setDescription('Only in this channel (default: server-wide)').setRequired(false)))
    .addSubcommand((s) => s.setName('enable').setDescription('Re-enable a command.').addStringOption((o) => o.setName('command').setDescription('Command name').setRequired(true)).addChannelOption((o) => o.setName('channel').setDescription('The channel it was disabled in (default: server-wide rule)').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('List every disabled-command rule.')),
  aliases: ['dc'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'disable') return disableCmd(interaction);
    if (sub === 'enable') return enableCmd(interaction);
    return listCmd(interaction);
  },
};

async function disableCmd(interaction) {
  const command = canonicalCommandName(interaction, interaction.options.getString('command', true));
  const channel = interaction.options.getChannel('channel');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const existing = await disabledDb.find(interaction.guild.id, command, channel?.id);
  if (existing) {
    await interaction.editReply({ components: [textCard('Already disabled.', 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await disabledDb.disable(interaction.guild.id, command, channel?.id);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  \`${command}\` disabled${channel ? ` in ${channel}` : ' server-wide'}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function enableCmd(interaction) {
  const command = canonicalCommandName(interaction, interaction.options.getString('command', true));
  const channel = interaction.options.getChannel('channel');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await disabledDb.enable(interaction.guild.id, command, channel?.id);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  \`${command}\` re-enabled${channel ? ` in ${channel}` : ' server-wide'}.` : "That rule doesn't exist.", removed ? 0xa5ea7a : 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
}

function canonicalCommandName(interaction, rawName) {
  const name = rawName.trim().toLowerCase();
  return interaction.client.commandAliases.get(name)
    ?? interaction.client.commandRoutes?.get(name)?.command
    ?? name;
}

async function listCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rules = await disabledDb.listForGuild(interaction.guild.id);
  const text = rules.length ? rules.map((r) => `\`${r.command}\` — ${r.channel_id ? `<#${r.channel_id}>` : 'server-wide'}`).join('\n') : 'No disabled commands.';
  await interaction.editReply({ components: [textCard(text, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}
