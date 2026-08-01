const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/memberEvents');
const { getTemplate } = require('../../db/embedTemplates');
const { sendMemberEvent } = require('../../utils/memberEventMessage');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  aliases: ['wc'],
  data: new SlashCommandBuilder()
    .setName('welcome')
    .setDescription('Configure the message sent when a member joins.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Set the welcome channel and message.')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel welcome messages are posted to').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('embed').setDescription('Use a saved /embed template instead of plain text').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Plain text (supports /embed variables, e.g. {user}, {server_name})').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show the current welcome configuration.'))
    .addSubcommand((s) => s.setName('test').setDescription('Send a test welcome message using your own account.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off welcome messages.')),

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
    await interaction.reply({ content: `No embed named \`${embed}\` found. Create it with \`/embed create\` first.`, flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { welcome_channel_id: channel.id, welcome_message: message ?? null, welcome_embed_template: embed ?? null });

  const text = `${EMOJI.APPROVE}  Welcome messages will be posted to ${channel}.${embed ? `\n**Embed:** \`${embed}\`` : message ? `\n**Message:** ${message}` : `\n${EMOJI.ALERT}  No message or embed set yet — nothing will send until you add one.`}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function status(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await getConfig(interaction.guild.id);

  const lines = [
    `**Channel:** ${config?.welcome_channel_id ? `<#${config.welcome_channel_id}>` : 'Not set'}`,
    `**Embed template:** ${config?.welcome_embed_template ? `\`${config.welcome_embed_template}\`` : 'None'}`,
    `**Plain message:** ${config?.welcome_message ? config.welcome_message : 'None'}`,
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function test(interaction) {
  const config = await getConfig(interaction.guild.id);
  if (!config?.welcome_channel_id || (!config.welcome_message && !config.welcome_embed_template)) {
    await interaction.reply({ content: 'Welcome messages are not fully configured. Use `/welcome setup` first.', flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await interaction.guild.channels.fetch(config.welcome_channel_id).catch(() => null);
  if (!channel) {
    await interaction.reply({ content: 'The configured welcome channel no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await sendMemberEvent({
    guild: interaction.guild,
    channel,
    kind: 'welcome',
    messageText: config.welcome_message,
    embedTemplateName: config.welcome_embed_template,
    ctx: { member: interaction.member, guild: interaction.guild, channel },
  });
  await interaction.editReply({ content: `${EMOJI.APPROVE} Test welcome message sent to ${channel}.` });
}

async function disable(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { welcome_channel_id: null });
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Welcome messages disabled.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}
