// Changes a message Petto already sent, with a new embed code: `!editembed <message link> {embed}$v{description: ...}`.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { payloadFromCode } = require('../../utils/embedCodeMessage');
const { messageTarget, editMessage } = require('../../utils/codeArgs');

const REPLY_FLAGS = MessageFlags.IsComponentsV2;
const RED = 0xfe6465;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('editembed')
    .setDescription('Change a message that Petto sent, with a new embed code.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('code').setDescription('The new message as an embed code, e.g. {embed}$v{description: Hi}').setRequired(true).setMaxLength(6000))
    .addStringOption((o) => o.setName('message').setDescription('Link or ID of the message. Leave it out when you reply to the message.').setRequired(false)),
  // The code keeps its line breaks and quotes, so the text is read raw: `!editembed <link> {embed}$v{...}`.
  prefixRawOptions: { _: editMessage },

  async execute(interaction) {
    await interaction.deferReply({ flags: REPLY_FLAGS });
    const fail = (text) => interaction.editReply({ components: [textCard(text, RED)], flags: REPLY_FLAGS });
    const code = interaction.options.getString('code');
    if (!code) return fail('Write the new message as an embed code: `editembed <message link> {embed}$v{description: Hi}`. You can also reply to my message and write only the code.');

    const target = messageTarget(interaction.options.getString('message'));
    let channelId = target?.channelId ?? interaction.channel.id;
    let messageId = target?.messageId ?? interaction.rawMessage?.reference?.messageId ?? null;
    if (target?.guildId && target.guildId !== interaction.guild.id) return fail('That message is from another server.');
    if (!messageId) return fail('Say which message to change: its link, its ID, or reply to it.');

    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return fail('I cannot find that channel in this server.');
    const permissions = channel.permissionsFor(interaction.member);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.ManageMessages)) return fail('You need **Manage Messages** in that channel to change its messages.');

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return fail('I cannot find that message. Check the link, or that it was not deleted.');
    if (message.author.id !== interaction.client.user.id) return fail('I can only change messages that I sent.');
    if (message.flags?.has(MessageFlags.IsComponentsV2)) return fail('That message uses the new components layout, which cannot be changed into a normal embed message. Send a new one with `embed send`.');

    const { payload, warnings, error } = await payloadFromCode(code, { member: interaction.member, guild: interaction.guild, channel, message: interaction.rawMessage, args: '', argTokens: [], commandName: 'editembed', prefix: '' });
    if (error) return fail(`That code builds an embed Discord would refuse: ${error}`);
    if (!payload) return fail('That code has nothing to show. Write it like `{embed}$v{description: Hi {user.mention}}`; you can add `{message: text}`, more embeds and `{button: link && Label && https://...}`.');

    try {
      // What the new code does not set is cleared, so the message becomes exactly what the code says.
      await message.edit({ content: payload.content ?? null, embeds: payload.embeds ?? [], components: payload.components ?? [], files: payload.files, attachments: payload.files?.length ? undefined : [], allowedMentions: { parse: [] } });
    } catch (err) {
      return fail(`Discord did not let me change it: ${err.message}`);
    }
    const lines = [`${EMOJI.APPROVE}  Changed the message in <#${channel.id}>: ${message.url}`, ...warnings.map((line) => `- ${line}`)];
    return interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: REPLY_FLAGS });
  },
};
