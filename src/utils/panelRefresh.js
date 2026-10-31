// Redraws the messages Petto posted and keeps standing in a server (panels, active giveaways) in the language the server uses now.
// A panel is a message posted once (by `!voicemaster setup`, `!ticket panel`, `!verify`…) that stays: changing the language does
// not change a message that is already in the channel. This runs when `!language` sets a language and when the dashboard says it
// changed it, and edits each of those messages in place: the same buttons and customIds, only the words change. Nothing is posted
// or deleted, and a message that is gone, or that Petto did not write, is left alone.
const logger = require('./logger');

async function fetchOwnMessage(guild, channelId, messageId) {
  if (!channelId || !messageId) return null;
  const channel = await guild.channels.fetch(channelId).catch(() => null);
  if (!channel?.isTextBased?.()) return null;
  const message = await channel.messages.fetch(messageId).catch(() => null);
  if (!message || (guild.client?.user?.id && message.author?.id !== guild.client.user.id)) return null;
  return { channel, message };
}

// Each one finds its messages and redraws them; it returns how many it changed. They are required when they run, so loading this
// file does not load every module.
const REFRESHERS = {
  async voicemaster(guild, lang) {
    const row = await require('../db/voiceMaster').getConfig(guild.id);
    const found = await fetchOwnMessage(guild, row?.panel_channel_id, row?.panel_message_id);
    if (!found) return 0;
    await found.message.edit(require('../commands/automation/voicemaster').buildPanelPayload(lang));
    return 1;
  },

  async tickets(guild, lang) {
    const db = require('../db/tickets');
    const { renderPanelMessage } = require('../commands/tickets/ticket');
    let count = 0;
    for (const panel of await db.listPanels(guild.id)) {
      const found = await fetchOwnMessage(guild, panel.channel_id, panel.message_id);
      if (!found) continue;
      const categories = await db.listCategories(guild.id, panel.id);
      await found.message.edit(await renderPanelMessage(guild, panel, categories, found.channel, lang));
      count += 1;
    }
    return count;
  },

  async forums(guild, lang) {
    const { refreshPanel } = require('./forumActions');
    let count = 0;
    for (const setup of await require('../db/forums').listSetups(guild.id)) if (await refreshPanel(guild, setup, lang)) count += 1;
    return count;
  },

  async verification(guild, lang) {
    const settings = await require('../db/verificationConfig').getConfig(guild.id);
    const found = await fetchOwnMessage(guild, settings?.panel_posted_channel_id ?? settings?.panel_channel_id, settings?.panel_message_id);
    if (!found) return 0;
    const { buildPanel } = require('../interactions/verifyLetters');
    const { methodOf } = require('./verifyMethod');
    await found.message.edit(buildPanel({ guild, method: methodOf(settings), lang }));
    return 1;
  },

  async confessions(guild, lang) {
    const config = await require('../db/confessions').getConfig(guild.id);
    const found = await fetchOwnMessage(guild, config?.panel_channel_id, config?.panel_message_id);
    if (!found) return 0;
    await found.message.edit(require('./confessions').buildPanel(guild, config, lang));
    return 1;
  },

  async honeypots(guild, lang) {
    const { renderPanel } = require('./honeypot');
    let count = 0;
    for (const row of await require('../db/honeypot').listHoneypots(guild.id)) {
      const found = await fetchOwnMessage(guild, row.channel_id, row.panel_message_id);
      if (!found) continue;
      const payload = await renderPanel(found.channel, row, lang);
      if (!payload) continue;
      // The picture is sent again, so the one already on the message goes (as when the panel is updated after a catch).
      await found.message.edit(payload.files?.length ? { ...payload, attachments: [] } : payload);
      count += 1;
    }
    return count;
  },

  // Giveaways that are still running: their card and Enter button. They are redrawn in the language of the server, which the
  // cache already has by now.
  async giveaways(guild) {
    const { refreshGiveawayMessage } = require('./giveawayEngine');
    let count = 0;
    for (const giveaway of await require('../db/giveaways').listActiveForGuild(guild.id)) {
      const channel = await guild.channels.fetch(giveaway.channel_id).catch(() => null);
      if (!channel?.isTextBased?.() || !giveaway.message_id) continue;
      await refreshGiveawayMessage(channel, giveaway);
      count += 1;
    }
    return count;
  },
};

/**
 * Redraws every standing message of `guild` in `lang`, one module after the other. A module that fails is logged and skipped,
 * never stopping the others. Returns { total, modules: { name: count }, failed: [name] }.
 */
async function refreshGuildPanels(guild, lang, refreshers = REFRESHERS) {
  const result = { total: 0, modules: {}, failed: [] };
  if (!guild) return result;
  for (const [name, refresh] of Object.entries(refreshers)) {
    try {
      const count = await refresh(guild, lang);
      result.modules[name] = count;
      result.total += count;
    } catch (err) {
      result.failed.push(name);
      logger.warn(`Could not redraw the ${name} messages of guild ${guild.id} in ${lang}: ${err?.message ?? err}`);
    }
  }
  return result;
}

module.exports = { refreshGuildPanels, REFRESHERS };
