const { MessageFlags } = require('discord.js');
const { upsertConfig, getConfigByChannel, getDueReminders } = require('../db/bumpReminders');
const { resolve } = require('./embedVariables');
const { textCard } = require('./caseCard');
const { EMOJI } = require('./emojis');
const logger = require('./logger');

const DISBOARD_ID = '302050872383242240';
const BUMP_COOLDOWN_MS = 2 * 60 * 60 * 1000; // 2 hours — DISBOARD's own cooldown between bumps

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

  if (config.thankyou) {
    const text = await applyBumpVars(config.thankyou, { guild: message.guild, channel: message.channel, bumper, nextBumpAt });
    await message.channel
      .send({ components: [textCard(text, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: ['users', 'roles'] } })
      .catch((err) => logger.error('Bump thank-you send failed:', err));
  }

  if (config.autolock) {
    await message.channel.permissionOverwrites.edit(message.guild.roles.everyone, { SendMessages: false }).catch(() => {});
  }
}

/** Polled by the bump reminder job — sends the reminder for every guild whose cooldown has elapsed. */
async function checkBumpReminders(client) {
  const due = await getDueReminders();

  for (const config of due) {
    try {
      const guild = await client.guilds.fetch(config.guild_id).catch(() => null);
      const channel = guild ? await guild.channels.fetch(config.channel_id).catch(() => null) : null;
      if (!guild || !channel) continue;

      const bumper = config.last_bumper_id ? await client.users.fetch(config.last_bumper_id).catch(() => null) : null;
      const text = await applyBumpVars(config.message, { guild, channel, bumper, nextBumpAt: null });

      await channel
        .send({ components: [textCard(`${EMOJI.ALERT}  ${text}`, 0xfed53c)], flags: MessageFlags.IsComponentsV2, allowedMentions: config.pingable ? { parse: ['users', 'roles'] } : { parse: [] } })
        .catch((err) => logger.error('Bump reminder send failed:', err));

      if (config.autolock) {
        await channel.permissionOverwrites.edit(guild.roles.everyone, { SendMessages: null }).catch(() => {});
      }

      await upsertConfig(config.guild_id, { next_bump_at: null });
    } catch (err) {
      logger.error(`Bump reminder check failed for guild ${config.guild_id}:`, err);
    }
  }
}

/** Deletes non-bot chatter in a bump channel that has autoclean on — keeps it a pure bump-command channel. */
async function handleBumpAutoclean(message) {
  if (message.author.bot || !message.guild) return;
  const config = await getConfigByChannel(message.guild.id, message.channel.id);
  if (!config?.autoclean) return;
  await message.delete().catch(() => {});
}

module.exports = { handleBumpMessage, checkBumpReminders, handleBumpAutoclean };
