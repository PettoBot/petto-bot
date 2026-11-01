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
const { permissionLabels } = require('../../utils/permissions');
const { t, languageOf } = require('../../i18n');

const REPLY_FLAGS = MessageFlags.IsComponentsV2;
const PRIVATE_FLAGS = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
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

/**
 * The channel to send to, as a channel of discord.js: the slash option gives one (or, for a thread that is not in the cache, only its data),
 * the prefix gives an id. Null when the server has no such channel.
 */
async function channelOf(guild, picked) {
  const id = typeof picked === 'string' ? picked : picked?.id;
  if (!id) return null;
  if (typeof picked === 'object' && typeof picked.isTextBased === 'function') return picked;
  return guild.channels.cache.get(id) ?? await guild.channels.fetch(id).catch(() => null);
}

/** Whether a member has a permission in the server. Anything that is not a real answer (no member, permissions that are not a bit field) is a no. */
function memberHas(member, permission) {
  const permissions = member?.permissions;
  return typeof permissions?.has === 'function' && permissions.has(permission) === true;
}

/**
 * The member of the server who ran the command, as a real member (the permissions of its roles in the server, never the ones a channel gives):
 * the one of the message or the interaction when it has them, or the one the server finds for the person. Null when there is none.
 */
async function guildMemberOf(interaction, guild) {
  const member = interaction.member;
  if (typeof member?.permissions?.has === 'function') return member;
  const id = interaction.user?.id ?? member?.id ?? member?.user?.id;
  return id && typeof guild.members?.fetch === 'function' ? await guild.members.fetch(id).catch(() => null) : null;
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('send')
    .setDescription('Send a message as Petto: text, links, files, role mentions or an embed code.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageMessages)
    .setDMPermission(false)
    // The channel goes first: it is the order the help shows (`send [channel] [message]`), and the order the prefix reads.
    .addChannelOption((o) => o.setName('channel').setDescription('Where to send it. The current channel when you leave it out.').addChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement, ChannelType.GuildVoice, ChannelType.AnnouncementThread, ChannelType.PublicThread, ChannelType.PrivateThread))
    .addStringOption((o) => o.setName('message').setDescription('The message: text, links, role mentions or an embed code.').setMaxLength(6000))
    .addAttachmentOption((o) => o.setName('file').setDescription('A picture, video or file to send with it.')),
  // The text keeps its line breaks and quotes, so it is read raw: `!send #channel the message`.
  prefixRawOptions: { _: sendMessage },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    // A refusal is private (ephemeral for the slash command): before the answer is deferred it is a private reply, after it the deferred one is already private.
    const fail = (key, vars) => {
      const payload = { components: [textCard(t(lang, key, vars), RED)], flags: PRIVATE_FLAGS };
      return interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload);
    };
    const guild = interaction.guild;
    if (!guild) return fail('embeds.send.noChannel');

    // WHO MAY SEND comes first, before anything is read or sent, and the same for the prefix, `/send` and `/message send`: the member needs Manage Messages
    // in the SERVER (what Discord's own default permission of the command means; a permission that only one channel grants does not count), found on a real
    // member of the server. A member that cannot be found, or whose permissions cannot be read, is a member who may not: nothing here ever allows by default.
    const member = await guildMemberOf(interaction, guild);
    if (!memberHas(member, PermissionFlagsBits.ManageMessages)) {
      return fail('core.moderate.youNeed', { permission: permissionLabels(PermissionFlagsBits.ManageMessages, lang) });
    }

    // A channel that was written but cannot be found is said, never replaced by the channel of the command.
    const missing = interaction.options.getString('channel_missing');
    if (missing) return fail('embeds.send.channelNotFound', { channel: missing.replace(/[`*_~|]/g, '').slice(0, 100) });
    const picked = interaction.options.getChannel('channel');
    const channel = picked ? await channelOf(guild, picked) : interaction.channel;
    if (picked && !channel) return fail('embeds.send.channelNotFound', { channel: typeof picked === 'string' ? `<#${picked}>` : `<#${picked.id}>` });
    if (!channel || channel.guildId !== guild.id) return fail('embeds.send.noChannel');
    if (!channel.isTextBased?.()) return fail('embeds.send.notText', { channel: `<#${channel.id}>` });
    const thread = channel.isThread?.() ?? false;
    const write = thread ? PermissionFlagsBits.SendMessagesInThreads : PermissionFlagsBits.SendMessages;

    // In that channel the member must also see it, write in it and have Manage Messages there (an overwrite can take it away).
    const mine = channel.permissionsFor?.(member) ?? null;
    if (!mine?.has?.(PermissionFlagsBits.ViewChannel) || !mine.has(write) || !mine.has(PermissionFlagsBits.ManageMessages)) {
      return fail('embeds.send.noPermission', { channel: `<#${channel.id}>`, permission: t(lang, 'core.perm.ManageMessages') });
    }

    const text = (interaction.options.getString('message') ?? '').trim();
    const attachments = interaction.rawMessage?.attachments ? [...interaction.rawMessage.attachments.values()] : [interaction.options.getAttachment('file')].filter(Boolean);
    if (!text && !attachments.length) return fail('embeds.send.nothing');
    if (attachments.length > MAX_FILES) return fail('embeds.send.tooManyFiles', { max: MAX_FILES });

    const bots = channel.permissionsFor(guild.members.me);
    if (!bots?.has(PermissionFlagsBits.ViewChannel) || !bots.has(write)) return fail('embeds.send.botCannot', { channel: `<#${channel.id}>` });
    // A thread that is locked and archived, or a private one Petto is not in, does not take messages even with the permissions.
    if (thread && channel.sendable === false) return fail('embeds.send.botCannot', { channel: `<#${channel.id}>` });
    if (attachments.length && !bots.has(PermissionFlagsBits.AttachFiles)) return fail('embeds.send.botNoFiles', { channel: `<#${channel.id}>` });

    // Everything that can be refused has been: the rest (building the message) can take a while.
    await interaction.deferReply({ flags: PRIVATE_FLAGS });
    const ctx = { member, user: interaction.user, guild, channel, message: interaction.rawMessage, args: '', argTokens: [], commandName: 'send', lang };
    let payload;
    let warnings = [];
    if (looksLikeScript(text)) {
      const problem = await buttonProblem(member, guild, parseEmbedScript(text, lang).buttons, lang);
      if (problem) return interaction.editReply({ components: [textCard(problem, RED)], flags: PRIVATE_FLAGS });
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
    // Sent where the command was typed: how to choose another channel, in case that was meant.
    if (!picked && interaction.rawMessage) lines.push(`-# ${t(lang, 'embeds.send.hint')}`);
    return interaction.editReply({ components: [textCard(lines.join('\n'), 0xa5ea7a)], flags: REPLY_FLAGS });
  },
};
