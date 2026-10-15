// Celebrates birthdays: once a day, at the hour a server chose (in its own time zone), Petto announces who has a birthday and can
// give them a role, which is taken back a day later.
const birthdaysDb = require('../db/birthdays');
const { sendMemberEvent } = require('../utils/memberEventMessage');
const { celebratesOn, localDate, ageOn } = require('../utils/birthdays');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');
const { t, guildLanguage } = require('../i18n');

const POLL_INTERVAL_MS = 5 * 60_000;
const ROLE_LASTS_MS = 24 * 3_600_000;
const MAX_PER_DAY = 25;
const BIRTHDAY_COLOR = 0xf78fb3;
// The message a server has until it writes its own (stored in English); it is sent in the language of the server.
const DEFAULT_BIRTHDAY_MESSAGE = t('en', 'birthdays.default.message');

/** The people to celebrate on `local`: their saved day is today, or 29 February on a 28 February with no 29th. */
async function peopleOn(guildId, local) {
  const rows = await birthdaysDb.onDay(guildId, local.month, local.day);
  if (local.month === 2 && local.day === 28) rows.push(...(await birthdaysDb.onDay(guildId, 2, 29)));
  return rows.filter((row) => celebratesOn(row, local)).slice(0, MAX_PER_DAY);
}

async function celebrate(client, config, local) {
  const guild = client.guilds.cache.get(config.guild_id);
  if (!guild) return;
  const channel = config.channel_id ? await guild.channels.fetch(config.channel_id).catch(() => null) : null;
  const role = config.role_id ? guild.roles.cache.get(config.role_id) ?? null : null;
  if (!channel?.isTextBased?.() && !role) return;
  // A job runs outside of any server: each one is announced in its own language.
  const lang = await guildLanguage(guild.id);
  const usual = String(config.message ?? '').trim() === DEFAULT_BIRTHDAY_MESSAGE;
  const message = usual ? t(lang, 'birthdays.default.message') : String(config.message ?? '');

  for (const row of await peopleOn(guild.id, local)) {
    const member = await guild.members.fetch(row.user_id).catch(() => null);
    if (!member || member.user.bot) continue;
    const age = ageOn(row, local);
    if (channel?.isTextBased?.()) {
      // {age} is the age they turn, left out when they did not say the year.
      const text = message.replaceAll('{age}', age === null ? '' : String(age));
      await sendMemberEvent({
        guild, channel, kind: 'birthday', messageText: text, embedTemplateName: config.embed_template,
        // The message nobody changed is sent as a pink card; one the server wrote stays as it wrote it.
        asCard: usual ? BIRTHDAY_COLOR : false,
        ctx: { member, guild, channel, user: member.user },
      });
    }
    if (role && role.editable) {
      const added = await member.roles.add(role, t(lang, 'birthdays.reason.birthday')).then(() => true).catch(() => false);
      if (added) await birthdaysDb.rememberRole(guild.id, member.id, role.id, new Date(Date.now() + ROLE_LASTS_MS)).catch(() => {});
    }
  }
}

async function takeBackRoles(client) {
  for (const due of await birthdaysDb.listDueRoles()) {
    try {
      const guild = client.guilds.cache.get(due.guild_id);
      const member = guild ? await guild.members.fetch(due.user_id).catch(() => null) : null;
      if (member) await member.roles.remove(due.role_id, t(await guildLanguage(guild.id), 'birthdays.reason.over')).catch(() => {});
      await birthdaysDb.forgetRole(due.guild_id, due.user_id);
    } catch (err) {
      logger.warn(`Could not take back a birthday role in ${due.guild_id}: ${err.message}`);
    }
  }
}

async function processBirthdays(client, now = new Date()) {
  await takeBackRoles(client);
  for (const config of await birthdaysDb.listEnabledConfigs()) {
    try {
      const local = localDate(now, config.utc_offset_minutes ?? -300);
      if (local.hour < config.hour || !client.guilds.cache.has(config.guild_id)) continue;
      // Claimed first, so two processes (or two passes) never announce the same day twice.
      if (String(config.last_announced ?? '').slice(0, 10) === local.iso || !(await birthdaysDb.claimDay(config.guild_id, local.iso))) continue;
      await celebrate(client, config, local);
    } catch (err) {
      logger.error(`Birthday messages failed in guild ${config.guild_id}:`, err);
    }
  }
}

function startBirthdayJob(client) {
  const run = exclusiveTask(() => processBirthdays(client));
  setTimeout(() => run().catch((err) => logger.error('Birthday job error:', err)), 60_000).unref?.();
  setInterval(() => run().catch((err) => logger.error('Birthday job error:', err)), POLL_INTERVAL_MS).unref?.();
  logger.info('Birthday job started (checking every 5 minutes).');
}

module.exports = { startBirthdayJob, processBirthdays, peopleOn };
