// The two timers of requests, both free and off by default:
//  - a claimed request that is not finished in the time the server chose goes back to open, so another staff member can take it (`unclaim`);
//  - a request nobody claimed for the time the server chose is reminded once to the staff, in the request channel (`reminder`).
// Each request gets one action: the claim of the action is a conditional write (a request that changed in between is left alone), so a restart or
// two runs at the same time never repeat it. A server that cannot be reached is logged once, not on every run.
const { MessageFlags } = require('discord.js');
const requestsDb = require('../db/requests');
const { requestCard } = require('./requestCards');
const logger = require('./logger');
const { t, tn, guildLanguage } = require('../i18n');

const HOUR_MS = 3_600_000;
const MAX_HOURS = 720;
const warned = new Set();

/** Hours from `12`, `12h`, `off`, `none` or `0` (0 is off); null when it is not one. */
function parseHours(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (/^(0|off|none|no)$/.test(value)) return 0;
  const match = /^(\d{1,3})\s*h?$/.exec(value);
  const hours = match ? Number(match[1]) : NaN;
  return hours >= 1 && hours <= MAX_HOURS ? hours : null;
}

/** True the first time for a key (a failing server is logged once, not at every run). */
function firstTime(key) {
  if (warned.has(key)) return false;
  if (warned.size > 500) warned.clear();
  warned.add(key);
  return true;
}

const channelOf = (client, request) => (request.channel_id ? client.channels.fetch(request.channel_id).catch(() => null) : Promise.resolve(null));

async function unclaimLate(client) {
  const configs = await requestsDb.listConfigsWithTimeout();
  let count = 0;
  for (const config of configs) {
    try {
      const before = new Date(Date.now() - config.completion_hours * HOUR_MS);
      const late = await requestsDb.listClaimedBefore(config.guild_id, before);
      // A job runs outside of any server, so each server's language is looked up.
      const lang = late.length ? await guildLanguage(config.guild_id) : null;
      for (const request of late) {
        const claimer = request.claimed_by;
        const updated = await requestsDb.releaseClaim(config.guild_id, request.number, claimer, before);
        if (!updated) continue;
        count += 1;
        try {
          const channel = await channelOf(client, updated);
          const message = channel && updated.message_id ? await channel.messages.fetch(updated.message_id).catch(() => null) : null;
          if (message) await message.edit({ components: [requestCard(updated, lang)], flags: MessageFlags.IsComponentsV2 }).catch(() => null);
          if (channel) await channel.send({ content: tn(lang, 'requests.timeout.notice', config.completion_hours, { count: config.completion_hours, number: updated.number, user: `<@${claimer}>` }), allowedMentions: { users: [claimer] } }).catch(() => null);
        } catch (error) {
          if (firstTime(`unclaim:${config.guild_id}`)) logger.warn(`Request timeout notice failed in guild ${config.guild_id}: ${error.message}`);
        }
      }
    } catch (error) {
      if (firstTime(`unclaim-run:${config.guild_id}`)) logger.warn(`Request timeout failed in guild ${config.guild_id}: ${error.message}`);
    }
  }
  return count;
}

/** Reminds the staff, once, of each request that nobody claimed in `reminder_hours`. Returns how many reminders were sent. */
async function remindUnclaimed(client) {
  const configs = await requestsDb.listConfigsWithReminder();
  let count = 0;
  for (const config of configs) {
    try {
      const open = await requestsDb.listUnremindedBefore(config.guild_id, new Date(Date.now() - config.reminder_hours * HOUR_MS));
      const lang = open.length ? await guildLanguage(config.guild_id) : null;
      const roleId = config.staff_role_id ?? config.ping_role_id ?? null;
      for (const request of open) {
        // Marked first: whoever marks it is the one that sends it, so it is sent once.
        const marked = await requestsDb.markReminded(config.guild_id, request.number);
        if (!marked) continue;
        const channel = await channelOf(client, marked) ?? (config.channel_id ? await client.channels.fetch(config.channel_id).catch(() => null) : null);
        if (!channel?.send) continue;
        const link = marked.channel_id && marked.message_id ? `https://discord.com/channels/${config.guild_id}/${marked.channel_id}/${marked.message_id}` : '';
        const content = `${roleId ? `<@&${roleId}> ` : ''}${tn(lang, 'requests.reminder.notice', config.reminder_hours, { count: config.reminder_hours, number: marked.number, user: `<@${marked.user_id}>`, link })}`.trim().slice(0, 2000);
        const sent = await channel.send({ content, allowedMentions: { roles: roleId ? [roleId] : [], users: [] } }).catch(() => null);
        if (sent) count += 1;
        else if (firstTime(`remind:${config.guild_id}`)) logger.warn(`Could not send a request reminder in guild ${config.guild_id}.`);
      }
    } catch (error) {
      if (firstTime(`remind-run:${config.guild_id}`)) logger.warn(`Request reminder failed in guild ${config.guild_id}: ${error.message}`);
    }
  }
  return count;
}

/** Both timers, one after the other (the job calls this). */
async function runRequestTimers(client) {
  const released = await unclaimLate(client).catch((error) => { if (firstTime('unclaim-all')) logger.warn(`Request timeout job: ${error.message}`); return 0; });
  const reminded = await remindUnclaimed(client).catch((error) => { if (firstTime('remind-all')) logger.warn(`Request reminder job: ${error.message}`); return 0; });
  return { released, reminded };
}

module.exports = { unclaimLate, remindUnclaimed, runRequestTimers, parseHours, MAX_HOURS };
