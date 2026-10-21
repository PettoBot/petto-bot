// When the channel of an open ticket is gone (deleted by hand, by another bot, or while Petto was offline), the ticket is closed
// with "the channel was deleted" as its reason, so it stops counting as open (the member can open a new one) and the dashboard
// stops showing it. There is no transcript to make, the messages went with the channel; a transcript saved earlier is kept.
// Two ways in: the channelDelete event (with who deleted it, from the audit log, when Petto can see it) and a check on start and
// every 30 minutes that only closes a ticket when Discord answers "Unknown Channel" (10003), never on an outage or a timeout.
const { AuditLogEvent, MessageFlags } = require('discord.js');
const logger = require('./logger');

const UNKNOWN_CHANNEL = 10003;
// A ticket row exists a moment before its channel does (the number comes first); one without a channel this old is left over.
const NO_CHANNEL_GRACE_MS = 30 * 60_000;

function defaultDeps() {
  const { t, guildLanguage } = require('../i18n');
  const { sendLog, fetchEntry } = require('../logging/engine');
  const { textCard } = require('./caseCard');
  const { EMOJI } = require('./emojis');
  return {
    db: require('../db/tickets'),
    settingsDb: require('../db/ticketSettings'),
    t,
    guildLanguage,
    sendLog,
    fetchEntry,
    textCard,
    EMOJI,
  };
}

const isUnknownChannel = (error) => Number(error?.code) === UNKNOWN_CHANNEL;

/**
 * Closes an open ticket whose channel no longer exists and logs it like a close. Returns the closed row, or null when the ticket
 * was already closed (by hand a moment before, or by the other path).
 */
async function closeTicketWithoutChannel({ guild, client, ticket, executorId = null, missing = false }, deps = defaultDeps()) {
  if (!ticket || ticket.status !== 'open') return null;
  const lang = await deps.guildLanguage(guild.id);
  const reason = deps.t(lang, missing ? 'tickets.channelGone.missingReason' : 'tickets.channelGone.reason');
  const closed = await deps.db.closeOpenTicket(ticket.id, { closedBy: executorId ?? null, reason, clearChannel: true });
  if (!closed) return null;

  const settings = await deps.settingsDb.getSettings(guild.id).catch(() => ({}));
  const byLine = executorId && !settings.hide_closing_user ? `\n${deps.t(lang, 'tickets.channelGone.by', { user: executorId })}` : '';
  const description = `${deps.EMOJI.DENY} ${deps.t(lang, missing ? 'tickets.channelGone.missingLog' : 'tickets.channelGone.log', { number: ticket.ticket_number })}${byLine}\n${deps.t(lang, 'tickets.log.reason', { reason })}`;

  await deps.sendLog(client, guild.id, 'tickets', {
    author: { name: deps.t(lang, 'tickets.log.closed.title', { number: ticket.ticket_number }) },
    description,
    color: 0xfe6465,
    footer: { text: deps.t(lang, 'tickets.log.openedBy', { user: ticket.opener_id }) },
    timestamp: new Date().toISOString(),
  }).catch((error) => logger.warn(`Ticket #${ticket.ticket_number}: the log of the deleted channel failed: ${error?.message ?? error}`));

  if (settings.closed_log_channel_id) {
    const logChannel = await guild.channels.fetch(settings.closed_log_channel_id).catch(() => null);
    if (logChannel?.isTextBased?.()) {
      await logChannel.send({ components: [deps.textCard(description, 0xfe6465)], flags: MessageFlags.IsComponentsV2 }).catch(() => {});
    }
  }
  logger.info({ guildId: guild.id, action: 'ticket-channel-gone' }, `Ticket #${ticket.ticket_number} closed: its channel ${ticket.channel_id ?? '(none)'} is gone.`);
  return closed;
}

/** The channelDelete event: the ticket of that channel, if it was open, is closed (with who deleted it, when the audit log says). */
async function handleTicketChannelDelete(channel, deps = defaultDeps()) {
  const guild = channel?.guild;
  if (!guild || !channel.id) return null;
  const ticket = await deps.db.getTicketByChannel(channel.id);
  if (!ticket || ticket.guild_id !== guild.id) return null;
  if (ticket.status !== 'open') {
    // A closed ticket keeps its row and transcript; only the channel id goes, so the auto delete job does not look for it.
    await deps.db.setTicketChannel(ticket.id, null).catch(() => {});
    return null;
  }
  const entry = await deps.fetchEntry(guild, AuditLogEvent.ChannelDelete, channel.id, { maxAgeMs: 30_000 });
  const executorId = entry?.executor?.id ?? entry?.executorId ?? null;
  return closeTicketWithoutChannel({ guild, client: channel.client, ticket, executorId }, deps);
}

/**
 * Whether the channel of a ticket is surely gone: the server is available, the channel is not in its cache and Discord answers
 * 10003 Unknown Channel. Anything else (missing access, a timeout, a 5xx) is "not sure", and the ticket is left alone.
 */
async function channelIsGone(guild, channelId) {
  if (guild.channels.cache.has(channelId)) return false;
  try {
    const channel = await guild.channels.fetch(channelId, { force: true });
    return !channel;
  } catch (error) {
    return isUnknownChannel(error);
  }
}

/** Closes every open ticket whose channel is gone, in the servers Petto can see right now. Returns how many it closed. */
async function reconcileTicketChannels(client, deps = defaultDeps(), { now = Date.now() } = {}) {
  const open = await deps.db.listAllOpenTickets();
  let closedCount = 0;
  for (const ticket of open) {
    const guild = client.guilds.cache.get(ticket.guild_id);
    // A server in an outage (or that Petto left) is not checked: its channels cannot be trusted to be missing.
    if (!guild || guild.available === false) continue;
    try {
      let gone;
      if (!ticket.channel_id) gone = now - new Date(ticket.created_at).getTime() > NO_CHANNEL_GRACE_MS;
      else gone = await channelIsGone(guild, ticket.channel_id);
      if (!gone) continue;
      const closed = await closeTicketWithoutChannel({ guild, client, ticket, missing: true }, deps);
      if (closed) closedCount += 1;
    } catch (error) {
      logger.warn(`Ticket #${ticket.ticket_number} in ${ticket.guild_id}: the channel check failed: ${error?.message ?? error}`);
    }
  }
  return closedCount;
}

module.exports = { closeTicketWithoutChannel, handleTicketChannelDelete, reconcileTicketChannels, channelIsGone, isUnknownChannel, UNKNOWN_CHANNEL };
