const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { ensureConfig, upsertConfig } = require('../../db/bumpReminders');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  aliases: ['bump'],
  data: new SlashCommandBuilder()
    .setName('bumpreminder')
    .setDescription('Reminds the server to /bump on DISBOARD every 2 hours.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('channel').setDescription('Set the DISBOARD bump channel.').addChannelOption((o) => o.setName('channel').setDescription('Bump channel').addChannelTypes(ChannelType.GuildText).setRequired(true)))
    .addSubcommand((s) => s.setName('message').setDescription('Set the reminder message (sent when the cooldown ends).').addStringOption((o) => o.setName('text').setDescription('Supports {user.mention} and other /embed variables').setRequired(true)))
    .addSubcommand((s) => s.setName('thankyou').setDescription('Set the thank-you message (sent right after a successful bump).').addStringOption((o) => o.setName('text').setDescription('Supports {user.mention}, {nextBump}, and other /embed variables').setRequired(true)))
    .addSubcommand((s) => s.setName('pingable').setDescription('Whether the reminder message can actually ping.').addBooleanOption((o) => o.setName('enabled').setDescription('Enable?').setRequired(true)))
    .addSubcommand((s) => s.setName('autolock').setDescription('Lock the bump channel (deny Send Messages) between bumps.').addBooleanOption((o) => o.setName('enabled').setDescription('Enable?').setRequired(true)))
    .addSubcommand((s) => s.setName('autoclean').setDescription('Delete non-bump chatter in the bump channel.').addBooleanOption((o) => o.setName('enabled').setDescription('Enable?').setRequired(true)))
    .addSubcommand((s) => s.setName('status').setDescription('Show the current bump reminder configuration.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'status') return status(interaction);
    return update(interaction, sub);
  },
};

async function update(interaction, sub) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await ensureConfig(interaction.guild.id);

  const patch = {};
  let confirmLine;

  if (sub === 'channel') {
    const channel = interaction.options.getChannel('channel', true);
    patch.channel_id = channel.id;
    confirmLine = `Bump channel set to ${channel}.`;
  } else if (sub === 'message') {
    patch.message = interaction.options.getString('text', true);
    confirmLine = 'Reminder message updated.';
  } else if (sub === 'thankyou') {
    patch.thankyou = interaction.options.getString('text', true);
    confirmLine = 'Thank-you message updated.';
  } else if (sub === 'pingable') {
    patch.pingable = interaction.options.getBoolean('enabled', true);
    confirmLine = `Pingable **${patch.pingable ? 'on' : 'off'}**.`;
  } else if (sub === 'autolock') {
    patch.autolock = interaction.options.getBoolean('enabled', true);
    confirmLine = `Autolock **${patch.autolock ? 'on' : 'off'}**.`;
  } else if (sub === 'autoclean') {
    patch.autoclean = interaction.options.getBoolean('enabled', true);
    confirmLine = `Autoclean **${patch.autoclean ? 'on' : 'off'}**.`;
  }

  await upsertConfig(interaction.guild.id, patch);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${confirmLine}`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function status(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const config = await ensureConfig(interaction.guild.id);

  const ready = !config.next_bump_at || new Date(config.next_bump_at) <= new Date();
  const lines = [
    `**Channel:** ${config.channel_id ? `<#${config.channel_id}>` : 'Not set'}`,
    `**Pingable:** ${config.pingable ? 'On' : 'Off'}`,
    `**Autolock:** ${config.autolock ? 'On' : 'Off'}`,
    `**Autoclean:** ${config.autoclean ? 'On' : 'Off'}`,
    `**Status:** ${ready ? `${EMOJI.APPROVE} Ready to bump` : `Next: <t:${Math.floor(new Date(config.next_bump_at).getTime() / 1000)}:R>`}`,
    `**Reminder:** ${config.message}`,
    `**Thank you:** ${config.thankyou}`,
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}
