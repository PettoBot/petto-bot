const { isWithinHours, outsideHoursText } = require('./ticketHours');
const { ChannelType, PermissionFlagsBits, MessageFlags, AttachmentBuilder } = require('discord.js');
const { sendAs } = require('./senderIdentity');
const { describeTicketOpenError } = require('./ticketErrors');
const db = require('../db/tickets');
const formsDb = require('../db/ticketForms');
const accessDb = require('../db/ticketAccess');
const settingsDb = require('../db/ticketSettings');
const ratingsDb = require('../db/ticketRatings');
const { getTemplate } = require('../db/embedTemplates');
const { build } = require('./embedBuilder');
const { formatTicketChannelName, sanitizeChannelName } = require('./ticketName');
const { buildTranscript } = require('./ticketTranscript');
const { transcriptParts } = require('./transcriptDelivery');
const { createTranscriptToken } = require('./transcriptToken');
const { buildTicketControlRow, buildTicketMemberRow, buildClosedControlRow, buildWelcomeFallbackCard, buildTranscriptLinkRow, buildTicketClosedCard, buildRatingRow } = require('./ticketCards');
const { textCard } = require('./caseCard');
const { sendLog } = require('../logging/engine');
const { EMOJI } = require('./emojis');
const config = require('../config');
const logger = require('./logger');
const { t, tn, guildLanguage, languageOf, defaultText } = require('../i18n');

const STAFF_OVERWRITE_PERMS = [
  PermissionFlagsBits.ViewChannel,
  PermissionFlagsBits.SendMessages,
  PermissionFlagsBits.ReadMessageHistory,
  PermissionFlagsBits.ManageMessages,
  PermissionFlagsBits.AttachFiles,
  PermissionFlagsBits.EmbedLinks,
];

const MEMBER_OVERWRITE_PERMS = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.ReadMessageHistory, PermissionFlagsBits.AttachFiles, PermissionFlagsBits.EmbedLinks];

function buildOpenOverwrites({ guild, opener, category }) {
  const overwrites = [
    { id: guild.id, deny: [PermissionFlagsBits.ViewChannel] },
    { id: opener.id, allow: MEMBER_OVERWRITE_PERMS },
    { id: guild.members.me.id, allow: [...STAFF_OVERWRITE_PERMS, PermissionFlagsBits.ManageChannels] },
  ];
  for (const roleId of category.support_role_ids ?? []) {
    overwrites.push({ id: roleId, allow: STAFF_OVERWRITE_PERMS });
  }
  return overwrites;
}

function isStaffForCategory(member, category) {
  if (member.permissions.has(PermissionFlagsBits.ManageGuild)) return true;
  return (category.support_role_ids ?? []).some((id) => member.roles.cache.has(id));
}

function isStaffAllowedForTicket(member, category, ticket, settings) {
  if (!isStaffForCategory(member, category)) return false;
  if (settings?.claim_mode !== 'exclusive' || !ticket?.claimed_by) return true;
  return ticket.claimed_by === member.id || member.permissions.has(PermissionFlagsBits.ManageGuild);
}

/**
 * Resolves a category's welcome message: a saved /embed template (rendered with variables) if
 * set, otherwise a plain fallback card. `pingText` (support-role mentions) has to be threaded in
 * here rather than sent as a separate top-level `content` field, since Components V2 messages
 * can't combine `content` with a V2 component tree — only the classic (embed-template) branch can.
 */
async function buildWelcomePayload({ category, guild, channel, opener, ticketId, ticketNumber, pingText, lang }) {
  if (category.welcome_embed_template) {
    const doc = await getTemplate(guild.id, category.welcome_embed_template);
    if (doc) {
      const payload = await build(doc.data, { user: opener, guild, channel });
      const content = [pingText, payload.content].filter(Boolean).join('\n') || undefined;
      const controlRows = [buildTicketControlRow(ticketId, lang), buildTicketMemberRow(ticketId, lang)];
      const templateRows = (payload.components ?? []).slice(0, 5 - controlRows.length);
      return { content, embeds: payload.embeds, files: payload.files, components: [...templateRows, ...controlRows] };
    }
  }
  return {
    components: [buildWelcomeFallbackCard({ opener, categoryLabel: category.label, pingText, welcomeMessage: category.welcome_message, guildName: guild.name, ticketNumber, lang }), buildTicketControlRow(ticketId, lang), buildTicketMemberRow(ticketId, lang)],
    flags: MessageFlags.IsComponentsV2,
  };
}

/** Creates the ticket's private channel, DB row, and welcome message. Throws on failure (caller replies with the error). */
async function openTicket({ guild, client, category, opener, formAnswers = null }) {
  const lang = await guildLanguage(guild.id);
  const settings = await settingsDb.getSettings(guild.id);
  const member = await guild.members.fetch(opener.id).catch(() => null);
  const roleIds = member ? [...member.roles.cache.keys()] : [];
  if (settings.blocked_role_ids.length > 0) {
    if (member && settings.blocked_role_ids.some((id) => member.roles.cache.has(id))) {
      const err = new Error(t(lang, 'tickets.open.notAllowed'));
      err.userFacing = true;
      throw err;
    }
  }

  const blacklistEntry = await accessDb.isBlacklisted(guild.id, opener.id, roleIds);
  if (blacklistEntry) {
    const err = new Error(t(lang, 'tickets.open.notAllowed'));
    err.userFacing = true;
    throw err;
  }

  const requiredRoleIds = category.required_role_ids ?? [];
  if (requiredRoleIds.length && (!member || !requiredRoleIds.every((id) => member.roles.cache.has(id)))) {
    const err = new Error(t(lang, 'tickets.open.needRoles', { roles: requiredRoleIds.map((id) => `<@&${id}>`).join(', ') }));
    err.userFacing = true;
    throw err;
  }

  const openCount = await db.countOpenTickets(guild.id, category.id, opener.id);
  if (openCount >= category.max_open_per_user) {
    const err = new Error(t(lang, 'tickets.open.categoryLimit', { count: openCount, limit: category.max_open_per_user }));
    err.userFacing = true;
    throw err;
  }

  // The limit of the whole server: the most tickets a member can have open at once, whatever the type (0 is no limit).
  if (settings.global_limit > 0) {
    const open = await db.countOpenTicketsForMember(guild.id, opener.id);
    if (open >= settings.global_limit) {
      const err = new Error(tn(lang, 'tickets.open.serverLimit', open, { count: open, limit: settings.global_limit }));
      err.userFacing = true;
      throw err;
    }
  }

  // The hours of the staff: outside them the ticket is refused, or it opens with a note that says when they answer.
  const onDuty = isWithinHours(settings);
  if (!onDuty && settings.hours_block) {
    const err = new Error(outsideHoursText(settings, lang));
    err.userFacing = true;
    throw err;
  }

  const ticket = await db.createTicket({ guildId: guild.id, categoryId: category.id, openerId: opener.id });

  let channel;
  try {
    if (category.form_id && formAnswers) await db.setTicketFormData(ticket.id, { formId: category.form_id, answers: formAnswers });
    channel = await guild.channels.create({
      name: formatTicketChannelName(category.naming_pattern, { number: ticket.ticket_number, username: opener.username, userId: opener.id, category: category.label }),
      type: ChannelType.GuildText,
      parent: category.parent_channel_id || undefined,
      topic: t(lang, 'tickets.open.topic', { number: String(ticket.ticket_number).padStart(4, '0'), category: category.label, user: opener.username ?? opener.id, id: opener.id }).slice(0, 1000),
      permissionOverwrites: buildOpenOverwrites({ guild, opener, category }),
      reason: t(lang, 'tickets.audit.opened', { number: ticket.ticket_number, user: opener.tag ?? opener.username }),
    });
  } catch (err) {
    await db.deleteTicketRow(ticket.id);
    throw err;
  }

  await db.setTicketChannel(ticket.id, channel.id);

  const pingRoleIds = category.ping_role_ids ?? [];
  const pingText = pingRoleIds.map((id) => `<@&${id}>`).join(' ');
  const welcome = await buildWelcomePayload({ category, guild, channel, opener, ticketId: ticket.id, ticketNumber: ticket.ticket_number, pingText, lang });

  // The bot's client-level default suppresses all mentions (see index.js) — this is the one ticket
  // message that's actually meant to notify people, so it opts back in for just the configured roles.
  await sendAs(channel, 'tickets', { ...welcome, allowedMentions: { roles: pingRoleIds } }).catch((err) => logger.warn(`Ticket #${ticket.ticket_number}: failed to send welcome message:`, err.message));

  if (!onDuty) {
    await sendAs(channel, 'tickets', { components: [textCard(`${EMOJI.WARNING}  ${outsideHoursText(settings, lang)}`, 0xffd563)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }

  if (formAnswers && Object.keys(formAnswers).length) {
    const answerLines = Object.entries(formAnswers).map(([label, answer]) => `**${label}:** ${String(answer).slice(0, 1000)}`);
    await sendAs(channel, 'tickets', { components: [textCard(`${t(lang, 'tickets.open.submittedForm')}\n${answerLines.join('\n')}`, 0x4b4f59)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
  }

  await sendLog(client, guild.id, 'tickets', {
    author: { name: t(lang, 'tickets.log.opened.title', { number: ticket.ticket_number }) },
    description: t(lang, 'tickets.log.opened.description', { emoji: EMOJI.APPROVE, user: opener.id, category: category.label, channel: channel.id }),
    color: 0xa5ea7a,
    footer: { text: t(lang, 'tickets.log.userId', { id: opener.id }) },
    timestamp: new Date().toISOString(),
  }).catch((err) => logger.error('Ticket log (open) failed:', err));

  if (settings.opened_log_channel_id) {
    const logChannel = await guild.channels.fetch(settings.opened_log_channel_id).catch(() => null);
    if (logChannel) {
      await logChannel
        .send({ components: [textCard(t(lang, 'tickets.log.opened.channel', { emoji: EMOJI.APPROVE, number: ticket.ticket_number, category: category.label, user: opener.id, channel: channel.id }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 })
        .catch(() => {});
    }
  }

  return { ticket: { ...ticket, channel_id: channel.id }, channel };
}

async function claimTicket({ guild, client, channel, ticket, actor }) {
  const lang = await guildLanguage(guild.id);
  const settings = await settingsDb.getSettings(guild.id);
  const updated = await db.setClaim(ticket.id, actor.id);

  if (channel && settings.roles_to_add_on_claim.length > 0) {
    for (const roleId of settings.roles_to_add_on_claim) {
      await channel.permissionOverwrites.edit(roleId, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true }).catch(() => {});
    }
  }
  if (channel && settings.ping_on_claim) {
    await sendAs(channel, 'tickets', { content: t(lang, 'tickets.claim.ping', { opener: ticket.opener_id, user: actor.id }), allowedMentions: { users: [ticket.opener_id] } })
      .catch(() => {});
  }

  await sendLog(client, guild.id, 'tickets', {
    description: t(lang, 'tickets.log.claimed', { emoji: EMOJI.STAR, number: ticket.ticket_number, user: actor.id }),
    color: 0x4b4f59,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
  return updated;
}

async function unclaimTicket({ guild, client, ticket, actor }) {
  const lang = await guildLanguage(guild.id);
  const updated = await db.setClaim(ticket.id, null);
  await sendLog(client, guild.id, 'tickets', {
    description: t(lang, 'tickets.log.unclaimed', { number: ticket.ticket_number, user: actor.id }),
    color: 0x4b4f59,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
  return updated;
}

/** Signed link to the web transcript viewer, or null if the web server isn't configured (see /verify's env vars — this route lives on the same server, just under its own optional hostname). */
function buildTranscriptLink({ guild, ticket }) {
  const baseUrl = config.transcriptBaseUrl ?? config.verifyBaseUrl;
  if (!baseUrl || !config.verifyTokenSecret) return null;
  const token = createTranscriptToken({ ticketId: ticket.id, guildId: guild.id });
  return `${baseUrl}/transcript/${guild.id}/${ticket.ticket_number}/${token}`;
}

/** Builds the transcript HTML, persists it (so the web viewer survives channel deletion), and returns it plus a shareable link. */
async function generateAndStoreTranscript({ guild, channel, ticket, opener, lang }) {
  const { html, messageCount } = await buildTranscript(channel, { ticketNumber: ticket.ticket_number, openerTag: opener?.username, lang });
  await db.saveTranscriptHtml(ticket.id, html).catch((err) => logger.error(`Ticket #${ticket.ticket_number}: failed to persist transcript:`, err));
  const link = buildTranscriptLink({ guild, ticket });
  return { html, messageCount, link };
}

/** The link row and the file of a transcript, as the server chose to send them (see transcriptDelivery.js). */
function transcriptDelivery(settings, link, html, ticketNumber, lang) {
  const parts = transcriptParts(settings.transcript_mode, Boolean(link));
  const fileName = `ticket-${ticketNumber}-transcript.html`;
  return {
    linkRow: parts.link ? buildTranscriptLinkRow(link, lang) : null,
    fileBuffer: parts.file ? Buffer.from(html, 'utf8') : null,
    fileName,
  };
}

/** Sends the transcript to the channel set for transcripts, if there is one (best effort, a missing channel or permission never blocks a close). */
async function sendToTranscriptChannel({ guild, settings, ticket, messageCount, link, delivery, opener, lang }) {
  if (!settings.transcript_channel_id) return;
  const channel = await guild.channels.fetch(settings.transcript_channel_id).catch(() => null);
  if (!channel?.isTextBased?.()) return;
  const desc = `${t(lang, 'tickets.transcript.channelPost', { emoji: EMOJI.STAR, number: ticket.ticket_number, count: messageCount, opener: `<@${opener ? opener.id : ticket.opener_id}>` })}${link && delivery.linkRow ? `\n${t(lang, 'tickets.transcript.viewOnline', { link })}` : ''}`;
  await channel
    .send({
      components: [textCard(desc, 0xffd563), ...(delivery.linkRow ? [delivery.linkRow] : [])],
      flags: MessageFlags.IsComponentsV2,
      ...(delivery.fileBuffer ? { files: [{ attachment: delivery.fileBuffer, name: delivery.fileName }] } : {}),
    })
    .catch((err) => logger.warn(`Ticket #${ticket.ticket_number}: could not post the transcript in the transcripts channel: ${err.message}`));
}

/** Generates and delivers a transcript (log channel + best-effort DM to the opener), without closing anything. */
async function postTranscript({ guild, client, channel, ticket }) {
  const lang = await guildLanguage(guild.id);
  const settings = await settingsDb.getSettings(guild.id);
  const opener = await client.users.fetch(ticket.opener_id).catch(() => null);
  const { html, messageCount, link } = await generateAndStoreTranscript({ guild, channel, ticket, opener, lang });
  const delivery = transcriptDelivery(settings, link, html, ticket.ticket_number, lang);

  await sendLog(
    client,
    guild.id,
    'tickets',
    {
      description: `${t(lang, 'tickets.log.transcript', { emoji: EMOJI.STAR, number: ticket.ticket_number, count: messageCount })}${link ? `\n${t(lang, 'tickets.transcript.viewOnline', { link })}` : ''}`,
      color: 0x4b4f59,
      timestamp: new Date().toISOString(),
    },
    {
      ...(delivery.linkRow ? { components: [delivery.linkRow] } : {}),
      ...(delivery.fileBuffer ? { files: [{ data: delivery.fileBuffer, name: delivery.fileName }] } : {}),
    },
  ).catch((err) => logger.error('Ticket log (transcript) failed:', err));
  await sendToTranscriptChannel({ guild, settings, ticket, messageCount, link, delivery, opener, lang });

  return { link };
}

/** Closes (locks) a ticket: removes send access from the opener/added members, posts + delivers a transcript, marks it closed in the DB. */
async function closeTicket({ guild, client, channel, ticket, actor, reason }) {
  const lang = await guildLanguage(guild.id);
  const settings = await settingsDb.getSettings(guild.id);

  if (settings.close_requires_reason && !reason?.trim()) {
    const err = new Error(t(lang, 'tickets.close.reasonRequired'));
    err.userFacing = true;
    throw err;
  }
  const finalReason = reason?.trim() || settings.default_close_reason || t(lang, 'tickets.close.noReason');

  const opener = await client.users.fetch(ticket.opener_id).catch(() => null);

  // Lock the channel — keep read access for everyone who had it, drop send access from non-staff.
  for (const overwrite of channel.permissionOverwrites.cache.values()) {
    if (overwrite.id === guild.id) continue;
    if (overwrite.allow.has(PermissionFlagsBits.SendMessages)) {
      await channel.permissionOverwrites.edit(overwrite.id, { SendMessages: false }).catch(() => {});
    }
  }

  const closed = await db.closeTicket(ticket.id, { closedBy: actor.id, reason: finalReason });

  const { html, messageCount, link } = await generateAndStoreTranscript({ guild, channel, ticket, opener, lang });
  const delivery = transcriptDelivery(settings, link, html, ticket.ticket_number, lang);

  const closedByLine = settings.hide_closing_user ? t(lang, 'tickets.close.byStaff') : t(lang, 'tickets.close.byUser', { user: actor.id });
  const staffCountLine = settings.log_staff_message_counts ? `\n${t(lang, 'tickets.log.staffReplies', { count: ticket.staff_message_count ?? 0 })}` : '';
  const detailLines = `${t(lang, 'tickets.log.reason', { reason: finalReason })}\n${t(lang, 'tickets.log.messages', { count: messageCount })}${staffCountLine}${link ? `\n${t(lang, 'tickets.log.viewTranscriptOnline', { link })}` : ''}`;

  await sendLog(
    client,
    guild.id,
    'tickets',
    {
      author: { name: t(lang, 'tickets.log.closed.title', { number: ticket.ticket_number }) },
      description: `${EMOJI.DENY} ${closedByLine}\n${detailLines}`,
      color: 0xfe6465,
      footer: { text: t(lang, 'tickets.log.openedBy', { user: opener?.username ?? ticket.opener_id }) },
      timestamp: new Date().toISOString(),
    },
    {
      ...(delivery.linkRow ? { components: [delivery.linkRow] } : {}),
      ...(delivery.fileBuffer ? { files: [{ data: delivery.fileBuffer, name: delivery.fileName }] } : {}),
    },
  ).catch((err) => logger.error('Ticket log (close) failed:', err));

  if (settings.closed_log_channel_id) {
    const logChannel = await guild.channels.fetch(settings.closed_log_channel_id).catch(() => null);
    if (logChannel) {
      const desc = `${t(lang, 'tickets.log.closed.channel', { emoji: EMOJI.DENY, number: ticket.ticket_number, closedBy: closedByLine })}\n${detailLines}`;
      const payload = {
        components: [textCard(desc, 0xfe6465), ...(delivery.linkRow ? [delivery.linkRow] : [])],
        flags: MessageFlags.IsComponentsV2,
        ...(delivery.fileBuffer ? { files: [{ attachment: delivery.fileBuffer, name: delivery.fileName }] } : {}),
      };
      await logChannel
        .send(payload)
        .catch(() => {});
    }
  }

  await sendToTranscriptChannel({ guild, settings, ticket, messageCount, link, delivery, opener, lang });

  if (opener && settings.dm_user_on_close) {
    const linkRow = delivery.linkRow;
    const card = buildTicketClosedCard({ ticket, guild, actor, reason: finalReason, channel, hideCloser: settings.hide_closing_user, lang });
    const rows = [card];
    if (settings.rating_enabled) rows.push(buildRatingRow(ticket.id));
    if (linkRow) rows.push(linkRow);

    // With "auto" and a web link, the raw .html attachment is skipped in the DM (Discord previews small text files as a code block,
    // which looks noisy); the file goes when the server chose it or when there is no link.
    const dmPayload = { components: rows, flags: MessageFlags.IsComponentsV2, ...(delivery.fileBuffer ? { files: [new AttachmentBuilder(delivery.fileBuffer, { name: delivery.fileName })] } : {}) };

    await opener.send(dmPayload).catch(() => logger.warn(`Ticket #${ticket.ticket_number}: could not DM transcript to opener.`));
  }

  const closeCard = textCard(
    [t(lang, 'tickets.close.card', { emoji: EMOJI.DENY, closedBy: closedByLine }), t(lang, 'tickets.log.reason', { reason: finalReason }), t(lang, 'tickets.close.cardHint')].join('\n'),
    0xfe6465,
  );
  await sendAs(channel, 'tickets', { components: [closeCard, buildClosedControlRow(ticket.id, link, lang)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});

  return closed;
}

/** Records a member's 1-5 star rating for a closed ticket (from the DM rating buttons), and best-effort logs it if a rating log channel is configured. */
async function rateTicket({ guild, client, ticket, user, rating, comment }) {
  await ratingsDb.addRating(guild.id, ticket.id, user.id, rating, comment);

  const settings = await settingsDb.getSettings(guild.id);
  if (settings.rating_log_channel_id) {
    const logChannel = await guild.channels.fetch(settings.rating_log_channel_id).catch(() => null);
    if (logChannel) {
      const lang = await guildLanguage(guild.id);
      const stars = '⭐'.repeat(rating) + '☆'.repeat(5 - rating);
      await logChannel
        .send({
          components: [textCard(`${t(lang, 'tickets.log.rated', { number: ticket.ticket_number, stars, user: user.id })}${comment ? `\n${t(lang, 'tickets.log.comment', { comment })}` : ''}`, 0xfed53c)],
          flags: MessageFlags.IsComponentsV2,
        })
        .catch(() => {});
    }
  }
}

async function reopenTicket({ guild, client, channel, ticket, actor }) {
  const lang = await guildLanguage(guild.id);
  await channel.permissionOverwrites.edit(ticket.opener_id, { SendMessages: true }).catch(() => {});

  const category = await db.getCategoryById(ticket.category_id);
  for (const roleId of category?.support_role_ids ?? []) {
    await channel.permissionOverwrites.edit(roleId, { SendMessages: true }).catch(() => {});
  }

  const reopened = await db.reopenTicket(ticket.id);

  await sendLog(client, guild.id, 'tickets', {
    description: t(lang, 'tickets.log.reopened', { emoji: EMOJI.APPROVE, number: ticket.ticket_number, user: actor.id }),
    color: 0xa5ea7a,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  const card = textCard(t(lang, 'tickets.reopen.card', { emoji: EMOJI.APPROVE, user: actor.id }), 0xa5ea7a);
  await channel.send({ components: [card, buildTicketControlRow(ticket.id, lang), buildTicketMemberRow(ticket.id, lang)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});

  return reopened;
}

async function deleteTicketChannel({ guild, client, channel, ticket, actor }) {
  const lang = await guildLanguage(guild.id);
  await sendLog(client, guild.id, 'tickets', {
    description: t(lang, 'tickets.log.deleted', { emoji: EMOJI.HAMMER, number: ticket.ticket_number, user: actor.id }),
    color: 0xfe6465,
    timestamp: new Date().toISOString(),
  }).catch(() => {});

  await db.setTicketChannel(ticket.id, null);
  await channel.delete(t(lang, 'tickets.audit.deleted', { number: ticket.ticket_number, user: actor.tag ?? actor.username }));
}

async function addMember({ guild, client, channel, ticket, actor, targetUser }) {
  await channel.permissionOverwrites.edit(targetUser.id, { ViewChannel: true, SendMessages: true, ReadMessageHistory: true });
  const lang = await guildLanguage(guild.id);
  await sendLog(client, guild.id, 'tickets', {
    description: t(lang, 'tickets.log.memberAdded', { emoji: EMOJI.APPROVE, target: targetUser.id, number: ticket.ticket_number, user: actor.id }),
    color: 0xa5ea7a,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

async function removeMember({ guild, client, channel, ticket, actor, targetUser }) {
  await channel.permissionOverwrites.delete(targetUser.id).catch(() => {});
  const lang = await guildLanguage(guild.id);
  await sendLog(client, guild.id, 'tickets', {
    description: t(lang, 'tickets.log.memberRemoved', { emoji: EMOJI.DENY, target: targetUser.id, number: ticket.ticket_number, user: actor.id }),
    color: 0xfe6465,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
}

async function renameTicket({ guild, client, channel, ticket, actor, newName }) {
  const lang = await guildLanguage(guild.id);
  const sanitized = sanitizeChannelName(newName) || channel.name;
  await channel.setName(sanitized, t(lang, 'tickets.audit.renamed', { number: ticket.ticket_number, user: actor.tag ?? actor.username }));
  await sendLog(client, guild.id, 'tickets', {
    description: t(lang, 'tickets.log.renamed', { number: ticket.ticket_number, name: sanitized, user: actor.id }),
    color: 0x4b4f59,
    timestamp: new Date().toISOString(),
  }).catch(() => {});
  return sanitized;
}

/** Shared "open a ticket from an interaction" flow — used by both the /ticket open slash command and panel buttons/select menus. */
async function openTicketInteractive(interaction, category, lang) {
  lang ??= await languageOf(interaction);
  if (category.form_id && (interaction.isButton?.() || interaction.isStringSelectMenu?.())) {
    const form = await formsDb.getFormById(category.form_id);
    if (!form) {
      await interaction.reply({ content: t(lang, 'tickets.open.formMissing'), flags: MessageFlags.Ephemeral });
      return;
    }
    const { ModalBuilder, ActionRowBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
    const modal = new ModalBuilder().setCustomId(`tk_form::${category.id}::${form.id}`).setTitle(defaultText(lang, form.title, 'tickets.form.defaultTitle') || t(lang, 'tickets.form.defaultTitle'));
    for (const field of form.fields ?? []) {
      const input = new TextInputBuilder().setCustomId(`field::${field.id}`).setLabel(field.label).setStyle(field.type === 'long_text' ? TextInputStyle.Paragraph : TextInputStyle.Short).setRequired(field.required !== false);
      if (field.placeholder) input.setPlaceholder(field.placeholder);
      modal.addComponents(new ActionRowBuilder().addComponents(input));
    }
    await interaction.showModal(modal);
    return;
  }
  if (category.form_id) {
    await interaction.reply({ content: t(lang, 'tickets.open.formRequired'), flags: MessageFlags.Ephemeral });
    return;
  }
  await interaction.deferReply({ flags: MessageFlags.Ephemeral });
  try {
    const { channel } = await openTicket({ guild: interaction.guild, client: interaction.client, category, opener: interaction.user });
    await interaction.editReply({ content: t(lang, 'tickets.open.done', { emoji: EMOJI.APPROVE, channel: `${channel}` }) });
  } catch (err) {
    await interaction.editReply({ content: describeTicketOpenError(err, lang) });
    if (!err.userFacing) logger.error('Ticket open failed:', err);
  }
}

module.exports = {
  isStaffForCategory,
  isStaffAllowedForTicket,
  openTicket,
  openTicketInteractive,
  claimTicket,
  unclaimTicket,
  closeTicket,
  rateTicket,
  reopenTicket,
  deleteTicketChannel,
  addMember,
  removeMember,
  renameTicket,
  postTranscript,
  buildTranscriptLink,
};
