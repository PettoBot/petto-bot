const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const { getConfig, upsertConfig } = require('../../db/memberEvents');
const { getTemplate } = require('../../db/embedTemplates');
const { sendMemberEvent } = require('../../utils/memberEventMessage');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('dmonjoin')
    .setDescription('DM new members a message when they join (separate from the /welcome channel message).')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('setup')
        .setDescription('Set the join DM.')
        .addStringOption((o) => o.setName('embed').setDescription('Use a saved /embed template instead of plain text').setRequired(false))
        .addStringOption((o) => o.setName('message').setDescription('Plain text (supports /embed variables, e.g. {user}, {server_name})').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('status').setDescription('Show the current join-DM configuration.'))
    .addSubcommand((s) => s.setName('test').setDescription('DM yourself a preview.'))
    .addSubcommand((s) => s.setName('disable').setDescription('Turn off the join DM.')),
  aliases: ['dmjoin'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'setup') return setup(interaction);
    if (sub === 'status') return status(interaction);
    if (sub === 'test') return test(interaction);
    return disable(interaction);
  },
};

async function setup(interaction) {
  const message = interaction.options.getString('message');
  const embed = interaction.options.getString('embed');

  if (embed && !(await getTemplate(interaction.guild.id, embed))) {
    await interaction.reply({ content: `No embed named \`${embed}\` found. Create it with \`/embed create\` first.`, flags: MessageFlags.Ephemeral });
    return;
  }
  if (!message && !embed) {
    await interaction.reply({ content: 'Provide a `message` or an `embed`.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { dm_join_message: message ?? null, dm_join_embed_template: embed ?? null });

  const text = `${EMOJI.APPROVE}  Join DM set.${embed ? `\n**Embed:** \`${embed}\`` : `\n**Message:** ${message}`}`;
  await interaction.editReply({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function status(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const config = await getConfig(interaction.guild.id);

  const lines = [
    `**Embed template:** ${config?.dm_join_embed_template ? `\`${config.dm_join_embed_template}\`` : 'None'}`,
    `**Plain message:** ${config?.dm_join_message ? config.dm_join_message : 'None'}`,
  ];
  await interaction.editReply({ components: [textCard(lines.join('\n'), 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function test(interaction) {
  const config = await getConfig(interaction.guild.id);
  if (!config?.dm_join_message && !config?.dm_join_embed_template) {
    await interaction.reply({ content: 'The join DM is not configured. Use `/dmonjoin setup` first.', flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  const dm = await interaction.user.createDM().catch(() => null);
  if (!dm) {
    await interaction.editReply({ content: 'I could not open a DM with you (DMs may be closed).' });
    return;
  }

  await sendMemberEvent({
    guild: interaction.guild,
    channel: dm,
    kind: 'welcome',
    messageText: config.dm_join_message,
    embedTemplateName: config.dm_join_embed_template,
    ctx: { member: interaction.member, guild: interaction.guild, channel: dm },
  });
  await interaction.editReply({ content: `${EMOJI.APPROVE} Preview sent to your DMs.` });
}

async function disable(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await upsertConfig(interaction.guild.id, { dm_join_message: null, dm_join_embed_template: null });
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Join DM disabled.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}
