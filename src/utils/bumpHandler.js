const { upsertConfig, getConfigByChannel, getDueReminders } = require('../db/bumpReminders');
const { sendAs } = require('./senderIdentity');
const { resolve } = require('./embedVariables');
const { extractReactReplies, applyReactReplies } = require('./messageFlags');
const logger = require('./logger');
const config = require('../config');
const { templatePayload } = require('./templatedMessage');
const { forEachWithConcurrency } = require('./concurrency');
const { t, guildLanguage } = require('../i18n');

const DISBOARD_ID = '302050872383242240';
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours — DISBOARD's own cooldown between bumps

/**
 * The reminder and thank-you texts a server did not write are stored in English (the column defaults of bump_reminders); they are
 * sent and shown in the server's language. `which` is `reminder` or `thankyou`. A text the server wrote stays as it is.
 */
function localizeBumpDefault(which, text, lang) {
  const key = `welcome.bump.default.${which}`;
  return text === t('en', key) ? t(lang, key) : text;
}

/** `{nextBump}` is bump-reminder-specific (not part of the general /embed variable set), so it's substituted before handing off to the shared resolve() engine for everything else. */
async function applyBumpVars(text, { guild, channel, bumper, nextBumpAt }) {
  const nextBumpTag = nextBumpAt ? `<t:${Math.floor(nextBumpAt.getTime() / 1000)}:R>` : '';
  const withNextBump = text.replace(/\{nextBump\}/gi, nextBumpTag);
  return resolve(withNextBump, { guild, channel, user: bumper ?? undefined });
}

/** Detects a successful DISBOARD /bump confirmation and starts the cooldown + thank-you + autolock. */
async function handleBumpMessage(message) {
  if (message.author.id !== DISBOARD_ID || !message.guild) return;

  const isBump =
    message.embeds.some((e) => {
      const text = `${e.description ?? ''} ${e.title ?? ''}`.toLowerCase();
      return text.includes('bump done') || text.includes('bumped') || text.includes('check back in 2');
    }) || /bump done/i.test(message.content ?? '');
  if (!isBump) return;

  const config = await getConfigByChannel(message.guild.id, message.channel.id);
  if (!config) return;

  const bumper = message.interaction?.user ?? null;
  const nextBumpAt = new Date(Date.now() + BUMP_COOLDOWN_MS);
  await upsertConfig(message.guild.id, { next_bump_at: nextBumpAt.toISOString(), last_bumper_id: bumper?.id ?? null });

  const customThanks = await templatePayload(message.guild.id, config.thankyou_embed_template, {
    guild: message.guild, channel: message.channel, user: bumper ?? undefined, bump: { nextUnix: Math.floor(nextBumpAt.getTime() / 1000) },
  });
  if (customThanks) {
    await sendAs(message.channel, 'bump', { ...customThanks, allowedMentions: { parse: ['users', 'roles'] } }).catch((err) => logger.error('Bump thank-you send failed:', err));
  } else if (config.thankyou) {
    const lang = await guildLanguage(message.guild.id);
    const { text: cleanedText, emojis: reactReplies } = extractReactReplies(localizeBumpDefault('thankyou', config.thankyou, lang));
    const text = await applyBumpVars(cleanedText, { guild: message.guild, channel: message.channel, bumper, nextBumpAt });
    if (text) {
      const sent = await sendAs(message.channel, 'bump', { content: text, allowedMentions: { parse: ['users', 'roles'] } })
        .catch((err) => { logger.error('Bump thank-you send failed:', err); return null; });
      if (sent && reactReplies.length) await applyReactReplies(sent, reactReplies);
    } else if (reactReplies.length) {
      await applyReactReplies(message, reactReplies);
    }
  }

  if (config.autolock) {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {});
  }
}

/** Polled by the bump reminder job — sends the reminder for every guild whose cooldown has elapsed. */
async function checkBumpReminders(client) {
  const due = await getDueReminders();

  await forEachWithConcurrency(due, async (reminder) => {
    try {
      const guild = await client.guilds.fetch(reminder.guild_id).catch(() => null);
      const channel = guild ? await guild.channels.fetch(reminder.channel_id).catch(() => null) : null;
      if (!guild || !channel) return;

      const bumper = reminder.last_bumper_id ? await client.users.fetch(reminder.last_bumper_id).catch(() => null) : null;
      // A job runs outside of any server's language: each server's is looked up.
      const lang = await guildLanguage(guild.id);
      const { text: cleanedText, emojis: reactReplies } = extractReactReplies(localizeBumpDefault('reminder', reminder.message, lang));
      const text = await applyBumpVars(cleanedText, { guild, channel, bumper, nextBumpAt: null });

      const customReminder = await templatePayload(guild.id, reminder.reminder_embed_template, { guild, channel, user: bumper ?? undefined, bump: {} });
      if (customReminder) {
        await sendAs(channel, 'bump', { ...customReminder, allowedMentions: reminder.pingable ? { parse: ['users', 'roles'] } : { parse: [] } }).catch((err) => logger.error('Bump reminder send failed:', err));
      } else if (text) {
        const sent = await sendAs(channel, 'bump', { content: text, allowedMentions: reminder.pingable ? { parse: ['users', 'roles'] } : { parse: [] } })
          .catch((err) => { logger.error('Bump reminder send failed:', err); return null; });
        if (sent && reactReplies.length) await applyReactReplies(sent, reactReplies);
      }

      if (reminder.autolock) {
        await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(() => {});
      }

      await upsertConfig(reminder.guild_id, { next_bump_at: null });
    } catch (err) {
      logger.error(`Bump reminder check failed for guild ${reminder.guild_id}:`, err);
    }
  }, config.jobConcurrency);
}

/** Deletes non-bot chatter in a bump channel that has autoclean on — keeps it a pure bump-command channel. */
async function handleBumpAutoclean(message) {
  if (message.author.bot || !message.guild) return;
  const config = await getConfigByChannel(message.guild.id, message.channel.id);
  if (!config?.autoclean) return;
  await message.delete().catch(() => {});
}

module.exports = { handleBumpMessage, checkBumpReminders, handleBumpAutoclean };
