// Sends a message as Petto: `!send [#channel] <text, links, role mentions or an embed code>`, with the files attached to the
// command. The embed code can have buttons that give roles or show a saved embed (see utils/embedActions.js).
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags, ChannelType } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { looksLikeScript, parseEmbedScript } = require('../../utils/embedScript');
const { payloadFromCode } = require('../../utils/embedCodeMessage');
const { plainMessage } = require('../../utils/cardService');
const { hasSendablePayload } = require('../../utils/embedBuilder');
const { resolveRole, roleRefsOf } = require('../../utils/embedActions');
const { getTemplate } = require('../../db/embedTemplates');
const { sendMessage } = require('../../utils/codeArgs');
const { t, languageOf } = require('../../i18n');

const REPLY_FLAGS = MessageFlags.IsComponentsV2;
const RED = 0xfe6465;
const MAX_FILES = 10;

/** The pings a message may make: people always, roles that anyone can mention, and everything for who has Mention Everyone. */
function mentionsFor(content, guild, permissions) {
  if (permissions?.has(PermissionFlagsBits.MentionEveryone)) return { parse: ['users', 'roles', 'everyone'] };
  const roles = [...String(content ?? '').matchAll(/<@&(\d{15,25})>/g)].map((match) => match[1]).filter((id) => guild.roles.cache.get(id)?.mentionable);
  return { parse: ['users'], roles: [...new Set(roles)] };
}

/** The first problem with the buttons of a code that the member may not cause: roles that do not exist, are above them, or saved embeds that are missing. */
async function buttonProblem(member, guild, buttons, lang) {
  const refs = roleRefsOf([buttons]);
  if (refs.length) {
    if (!member.permissions.has(PermissionFlagsBits.ManageRoles)) return t(lang, 'embeds.action.sendNoRoles');
    for (const ref of refs) {
      const role = resolveRole(guild, ref);
      if (!role) return t(lang, 'embeds.action.sendRoleMissing', { ref });
      if (guild.ownerId !== member.id && role.position >= member.roles.highest.position) return t(lang, 'embeds.action.sendRoleAbove', { role: `<@&${role.id}>` });
    }
  }
  for (const button of buttons) {
    for (const action of button.actions ?? []) {
      if (action.type === 'embed' && !(await getTemplate(guild.id, action.ref))) return t(lang, 'embeds.action.sendEmbedMissing', { name: action.ref });
    }
  }
  return null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('send')
    .setDescription('Send a message as Petto: text, links, files, role mentions or an embed code.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    .addStringOption((o) => o.setName('message').setDescription('The message: text, links, role mentions or an embed code.').setMaxLength(6000))
    .addChannelOption((o) => o.setName('channel').setDescription('Where to send it. The current channel when you leave it out.').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.PublicThread, ChannelType.PrivateThread))
    .addAttachmentOption((o) => o.setName('file').setDescription('A picture, video or file to send with it.')),
  // The text keeps its line breaks and quotes, so it is read raw: `!send #channel the message`.
  prefixRawOptions: { _: sendMessage },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.deferReply({ flags: REPLY_FLAGS });
    const fail = (key, vars) => interaction.editReply({ components: [textCard(t(lang, key, vars), RED)], flags: REPLY_FLAGS });
    const guild = interaction.guild;

    const picked = interaction.options.getChannel('channel');
    const channel = (typeof picked === 'string' ? await guild.channels.fetch(picked).catch(() => null) : picked) ?? interaction.channel;
    if (!channel?.isTextBased?.() || channel.guildId !== guild.id) return fail('embeds.send.noChannel');
    const text = (interaction.options.getString('message') ?? '').trim();
    const attachments = interaction.rawMessage?.attachments ? [...interaction.rawMessage.attachments.values()] : [interaction.options.getAttachment('file')].filter(Boolean);
    if (!text && !attachments.length) return fail('embeds.send.nothing');
    if (attachments.length > MAX_FILES) return fail('embeds.send.tooManyFiles', { max: MAX_FILES });

    const mine = channel.permissionsFor(interaction.member);
    if (!mine?.has(PermissionFlagsBits.ViewChannel) || !mine.has(PermissionFlagsBits.SendMessages) || !mine.has(PermissionFlagsBits.ManageMessages)) {
      return fail('embeds.send.noPermission', { channel: `<#${channel.id}>`, permission: t(lang, 'core.perm.ManageMessages') });
    }
    const bots = channel.permissionsFor(guild.members.me);
    if (!bots?.has(PermissionFlagsBits.ViewChannel) || !bots.has(PermissionFlagsBits.SendMessages)) return fail('embeds.send.botCannot', { channel: `<#${channel.id}>` });
    if (attachments.length && !bots.has(PermissionFlagsBits.AttachFiles)) return fail('embeds.send.botNoFiles', { channel: `<#${channel.id}>` });

    const ctx = { member: interaction.member, user: interaction.user, guild, channel, message: interaction.rawMessage, args: '', argTokens: [], commandName: 'send', lang };
    let payload;
    let warnings = [];
    if (looksLikeScript(text)) {
      const problem = await buttonProblem(interaction.member, guild, parseEmbedScript(text, lang).buttons, lang);
      if (problem) return interaction.editReply({ components: [textCard(problem, RED)], flags: REPLY_FLAGS });
      const built = await payloadFromCode(text, ctx, lang);
      if (built.error) return fail('embeds.code.refused', { error: built.error });
      payload = built.payload;
      warnings = built.warnings;
      if (payload?.embeds?.length && !bots.has(PermissionFlagsBits.EmbedLinks)) return fail('embeds.send.botNoEmbeds', { channel: `<#${channel.id}>` });
    } else if (text) {
      payload = await plainMessage(text, ctx);
    } else {
      payload = {};
    }
    const files = [...(payload?.files ?? []), ...attachments.map((file) => ({ attachment: file.url, name: file.name, description: file.description ?? undefined }))];
    const message = { ...payload, files };
    if (!hasSendablePayload(message)) return fail('embeds.send.nothing');
    if (message.content && message.content.length > 2000) return fail('embeds.send.tooLong');

    // Answering a message while replying to one in the same channel keeps it as a reply.
    const replyTo = interaction.rawMessage?.reference?.channelId === channel.id ? interaction.rawMessage.reference.messageId : null;
    let sent;
    try {
      sent = await channel.send({
        ...message,
        allowedMentions: mentionsFor(message.content, guild, mine),
        ...(replyTo ? { reply: { messageReference: replyTo, failIfNotExists: false } } : {}),
      });
    } catch (err) {
      return fail('embeds.send.failed', { error: err.message });
    }
    const lines = [t(lang, 'embeds.send.done', { emoji: EMOJI.APPROVE, channel: `<#${channel.id}>`, url: sent.url }), ...warnings.map((line) => `- ${line}`)];
    return interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: REPLY_FLAGS });
  },
};
