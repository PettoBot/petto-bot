// Reminds the support roles of a ticket that nobody has claimed after the minutes the server chose. Once per ticket.
const { MessageFlags } = require('discord.js');
const { COLORS } = require('../utils/colors');
const db = require('../db/tickets');
const settingsDb = require('../db/ticketSettings');
const { dueForReminder } = require('../utils/ticketReminders');
const { textCard } = require('../utils/caseCard');
const { forEachWithConcurrency } = require('../utils/concurrency');
const { exclusiveTask } = require('../utils/concurrency');
const config = require('../config');
const logger = require('../utils/logger');
const { t, guildLanguage } = require('../i18n');

const POLL_INTERVAL_MS = 5 * 60_000;

async function checkTicketReminders(client) {
  const guilds = await settingsDb.listReminderEnabled();
  await forEachWithConcurrency(guilds, async (row) => {
    const guild = client.guilds.cache.get(row.guild_id);
    if (!guild) return;
    const lang = await guildLanguage(guild.id);
    const tickets = await db.listOpenTicketsForGuild(guild.id).catch((err) => { logger.warn(`Ticket reminders: could not list the tickets of ${guild.id}: ${err.message}`); return []; });
    for (const ticket of tickets) {
      if (!dueForReminder(ticket, row.unclaimed_reminder_minutes)) continue;
      const channel = await guild.channels.fetch(ticket.channel_id).catch(() => null);
      const category = await db.getCategoryById(ticket.category_id).catch(() => null);
      // Marked first: if the message fails, the ticket is not asked about again and again.
      await db.markReminded(ticket.id).catch(() => {});
      if (!channel?.isTextBased?.()) continue;
      const roles = (category?.support_role_ids ?? []).filter((id) => guild.roles.cache.has(id));
      const ping = roles.map((id) => `<@&${id}>`).join(' ');
      await channel.send({
        components: [textCard(`${ping ? `${ping}\n` : ''}${t(lang, 'tickets.reminder.unclaimed', { minutes: row.unclaimed_reminder_minutes })}`, COLORS.YELLOW)],
        flags: MessageFlags.IsComponentsV2,
        allowedMentions: { roles },
      }).catch((err) => logger.warn(`Ticket #${ticket.ticket_number}: the reminder could not be sent: ${err.message}`));
    }
  }, config.jobConcurrency);
}

function startTicketReminderJob(client) {
  const run = exclusiveTask(() => checkTicketReminders(client));
  setInterval(() => run().catch((err) => logger.error('Ticket reminder job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Ticket reminder job started (checking every 5m).');
}

module.exports = { startTicketReminderJob, checkTicketReminders };
