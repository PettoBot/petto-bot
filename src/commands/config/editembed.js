// Changes a message Petto already sent, with a new embed code: `!editembed <message link> {embed}$v{description: ...}`.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { payloadFromCode } = require('../../utils/embedCodeMessage');
const { messageTarget, editMessage } = require('../../utils/codeArgs');
const { t, languageOf } = require('../../i18n');

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
    const lang = await languageOf(interaction);
    await interaction.deferReply({ flags: REPLY_FLAGS });
    const fail = (key, vars) => interaction.editReply({ components: [textCard(t(lang, key, vars), RED)], flags: REPLY_FLAGS });
    const code = interaction.options.getString('code');
    if (!code) return fail('embeds.editembed.noCode');

    const target = messageTarget(interaction.options.getString('message'));
    let channelId = target?.channelId ?? interaction.channel.id;
    let messageId = target?.messageId ?? interaction.rawMessage?.reference?.messageId ?? null;
    if (target?.guildId && target.guildId !== interaction.guild.id) return fail('embeds.editembed.otherServer');
    if (!messageId) return fail('embeds.editembed.noTarget');

    const channel = await interaction.guild.channels.fetch(channelId).catch(() => null);
    if (!channel?.isTextBased?.()) return fail('embeds.editembed.noChannel');
    const permissions = channel.permissionsFor(interaction.member);
    if (!permissions?.has(PermissionFlagsBits.ViewChannel) || !permissions.has(PermissionFlagsBits.ManageMessages)) return fail('embeds.editembed.noPermission', { permission: t(lang, 'core.perm.ManageMessages') });

    const message = await channel.messages.fetch(messageId).catch(() => null);
    if (!message) return fail('embeds.editembed.noMessage');
    if (message.author.id !== interaction.client.user.id) return fail('embeds.editembed.notMine');
    if (message.flags?.has(MessageFlags.IsComponentsV2)) return fail('embeds.editembed.componentsV2');

    const { payload, warnings, error } = await payloadFromCode(code, { member: interaction.member, guild: interaction.guild, channel, message: interaction.rawMessage, args: '', argTokens: [], commandName: 'editembed', prefix: '', lang });
    if (error) return fail('embeds.code.refused', { error });
    if (!payload) return fail('embeds.editembed.nothing');

    try {
      // What the new code does not set is cleared, so the message becomes exactly what the code says.
      await message.edit({ content: payload.content ?? null, embeds: payload.embeds ?? [], components: payload.components ?? [], files: payload.files, attachments: payload.files?.length ? undefined : [], allowedMentions: { parse: [] } });
    } catch (err) {
      return fail('embeds.editembed.editFailed', { error: err.message });
    }
    const lines = [t(lang, 'embeds.editembed.done', { emoji: EMOJI.APPROVE, channel: `<#${channel.id}>`, url: message.url }), ...warnings.map((line) => `- ${line}`)];
    return interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: REPLY_FLAGS });
  },
};
