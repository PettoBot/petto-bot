const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/memberEvents');
const { getTemplate } = require('../../db/embedTemplates');
const { sendMemberEvent } = require('../../utils/memberEventMessage');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  aliases: ['lv'],
  data: new SlashCommandBuilder()
    .setName('leave')
    .setDescription('Configure the message sent when a member leaves.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Set the leave channel and message.')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel leave messages are posted to').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('embed').setDescription('Use a saved /embed template instead of plain text').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Plain text (supports /embed variables, e.g. {user_tag}, {server_name})').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show the current leave configuration.'))
    .addSubcommand((s) => s.setName('test').setDescription('Send a test leave message using your own account.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off leave messages.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setup(interaction);
    if (sub === 'status') return status(interaction);
    if (sub === 'test') return test(interaction);
    return disable(interaction);
  },
};

async function setup(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const message = interaction.options.getString('message');
  const embed = interaction.options.getString('embed');

  if (embed && !(await getTemplate(interaction.guild.id, embed))) {
    await interaction.reply({ content: `No embed named \`${embed}\` found. Create it with \`!embed create\` first.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { leave_channel_id: channel.id, leave_message: message ?? null, leave_embed_template: embed ?? null });

  const text = `${EMOJI.APPROVE}  Leave messages will be posted to ${channel}.${embed ? `\n**Embed:** \`${embed}\`` : message ? `\n**Message:** ${message}` : `\n${EMOJI.ALERT}  No message or embed set yet — nothing will send until you add one.`}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function status(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await getConfig(interaction.guild.id);

  const lines = [
    `**Channel:** ${config?.leave_channel_id ? `<#${config.leave_channel_id}>` : 'Not set'}`,
    `**Embed template:** ${config?.leave_embed_template ? `\`${config.leave_embed_template}\`` : 'None'}`,
    `**Plain message:** ${config?.leave_message ? config.leave_message : 'None'}`,
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function test(interaction) {
  const config = await getConfig(interaction.guild.id);
  if (!config?.leave_channel_id || (!config.leave_message && !config.leave_embed_template)) {
    await interaction.reply({ content: 'Leave messages are not fully configured. Use `!leave setup` first.', flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await interaction.guild.channels.fetch(config.leave_channel_id).catch(() => null);
  if (!channel) {
    await interaction.reply({ content: 'The configured leave channel no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await sendMemberEvent({
    guild: interaction.guild,
    channel,
    kind: 'leave',
    messageText: config.leave_message,
    embedTemplateName: config.leave_embed_template,
    ctx: { member: interaction.member, guild: interaction.guild, channel },
  });
  await interaction.editReply({ content: `${EMOJI.APPROVE} Test leave message sent to ${channel}.` });
}

async function disable(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { leave_channel_id: null });
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Leave messages disabled.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}
