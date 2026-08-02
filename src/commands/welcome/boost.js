const { SlashCommandBuilder, PermissionFlagsBits, ChannelType, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/memberEvents');
const { getTemplate } = require('../../db/embedTemplates');
const { sendMemberEvent } = require('../../utils/memberEventMessage');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  aliases: ['bst'],
  data: new SlashCommandBuilder()
    .setName('boost')
    .setDescription('Configure server boost announcement messages.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Set the channel and message sent for every individual boost.')
        .addChannelOption((o) => o.setName('channel').setDescription('Channel boost messages are posted to').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setRequired(true))
        .addStringOption((o) => o.setName('embed').setDescription('Use a saved /embed template instead of plain text').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Plain text (supports /embed variables, e.g. {user}, {server_boostcount})').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('level-up')
        .setDescription('Set the message sent when the server reaches a new boost level.')
        .addStringOption((o) => o.setName('embed').setDescription('Use a saved /embed template instead of plain text').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Plain text (supports {server_boostlevel}, {server_boostcount})').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show the current boost configuration.'))
    .addSubcommand((s) => s.setName('test').setDescription('Send a test boost message using your own account.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off boost announcements.')),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setup(interaction);
    if (sub === 'level-up') return levelUp(interaction);
    if (sub === 'status') return status(interaction);
    if (sub === 'test') return test(interaction);
    return disable(interaction);
  },
};

async function validateEmbed(interaction, embed) {
  if (!embed) return true;
  if (await getTemplate(interaction.guild.id, embed)) return true;
  await interaction.reply({ content: `No embed named \`${embed}\` found. Create it with \`!embed create\` first.`, flags: MessageFlags.Ephemeral });
  return false;
}

async function setup(interaction) {
  const channel = interaction.options.getChannel('channel', true);
  const message = interaction.options.getString('message');
  const embed = interaction.options.getString('embed');
  if (!(await validateEmbed(interaction, embed))) return;

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { boost_channel_id: channel.id, boost_message: message ?? null, boost_embed_template: embed ?? null });

  const text = `${EMOJI.APPROVE}  Boost messages will be posted to ${channel} (once per individual boost).${embed ? `\n**Embed:** \`${embed}\`` : message ? `\n**Message:** ${message}` : `\n${EMOJI.ALERT}  No message or embed set yet — nothing will send until you add one.`}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function levelUp(interaction) {
  const message = interaction.options.getString('message');
  const embed = interaction.options.getString('embed');
  if (!(await validateEmbed(interaction, embed))) return;

  const existing = await getConfig(interaction.guild.id);
  if (!existing?.boost_channel_id) {
    await interaction.reply({ content: 'Set a boost channel first with `!boost setup`.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await upsertConfig(interaction.guild.id, { boost_level_message: message ?? null, boost_level_embed_template: embed ?? null });

  const text = `${EMOJI.APPROVE}  Level-up announcements will post to <#${existing.boost_channel_id}> whenever the server reaches a new boost level.${embed ? `\n**Embed:** \`${embed}\`` : message ? `\n**Message:** ${message}` : `\n${EMOJI.ALERT}  No message or embed set — level-ups won't send anything until you add one.`}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function status(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await getConfig(interaction.guild.id);

  const lines = [
    `**Channel:** ${config?.boost_channel_id ? `<#${config.boost_channel_id}>` : 'Not set'}`,
    `**Per-boost embed:** ${config?.boost_embed_template ? `\`${config.boost_embed_template}\`` : 'None'}`,
    `**Per-boost message:** ${config?.boost_message ? config.boost_message : 'None'}`,
    `**Level-up embed:** ${config?.boost_level_embed_template ? `\`${config.boost_level_embed_template}\`` : 'None'}`,
    `**Level-up message:** ${config?.boost_level_message ? config.boost_level_message : 'None'}`,
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function test(interaction) {
  const config = await getConfig(interaction.guild.id);
  if (!config?.boost_channel_id || (!config.boost_message && !config.boost_embed_template)) {
    await interaction.reply({ content: 'Boost messages are not fully configured. Use `!boost setup` first.', flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await interaction.guild.channels.fetch(config.boost_channel_id).catch(() => null);
  if (!channel) {
    await interaction.reply({ content: 'The configured boost channel no longer exists.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  await sendMemberEvent({
    guild: interaction.guild,
    channel,
    kind: 'boost',
    messageText: config.boost_message,
    embedTemplateName: config.boost_embed_template,
    ctx: { member: interaction.member, guild: interaction.guild, channel },
  });
  await interaction.editReply({ content: `${EMOJI.APPROVE} Test boost message sent to ${channel}.` });
}

async function disable(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { boost_channel_id: null });
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Boost announcements disabled.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}
