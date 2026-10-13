// Follows the dashboard: when a server picks a channel for the verification panel (or asks to post it again), Petto puts it there;
// when the channel is taken away, the panel goes too.
const { listWithPanel, upsertConfig } = require('../db/verificationConfig');
const { postPanel, removePanel } = require('../utils/verifyPanel');
const logger = require('../utils/logger');
const { exclusiveTask } = require('../utils/concurrency');

const POLL_INTERVAL_MS = 2 * 60_000;

async function processPanels(client) {
  for (const settings of await listWithPanel()) {
    const guild = client.guilds.cache.get(settings.guild_id);
    if (!guild) continue;
    try {
      if (!settings.panel_channel_id) {
        await removePanel(guild, settings);
        await upsertConfig(guild.id, { panel_message_id: null, panel_posted_channel_id: null });
        continue;
      }
      const standing = settings.panel_message_id && settings.panel_posted_channel_id === settings.panel_channel_id;
      if (standing) continue;
      await postPanel(guild, settings, await guild.channels.fetch(settings.panel_channel_id).catch(() => null));
    } catch (err) {
      // Asked once: if it cannot be done (no permission), the choice is cleared so the job does not try every two minutes.
      logger.warn(`Verification panel failed in ${settings.guild_id}: ${err.message}`);
      await upsertConfig(settings.guild_id, { panel_channel_id: settings.panel_posted_channel_id ?? null }).catch(() => {});
    }
  }
}

function startVerifyPanelJob(client) {
  const run = exclusiveTask(() => processPanels(client));
  setTimeout(() => run().catch((err) => logger.error('Verify panel job error:', err)), 45_000).unref?.();
  setInterval(() => run().catch((err) => logger.error('Verify panel job error:', err)), POLL_INTERVAL_MS).unref?.();
}

module.exports = { startVerifyPanelJob, processPanels };
