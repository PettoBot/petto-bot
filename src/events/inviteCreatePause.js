const { Events } = require('discord.js');
const { ensureGuild, updateGuild } = require('../db/guilds');
const logger = require('../utils/logger');
const { t, currentLanguage } = require('../i18n');

module.exports = {
  name: Events.InviteCreate,
  async execute(invite) {
    if (!invite.guild) return;

    try {
      const guild = await ensureGuild(invite.guild.id);
      if (!guild.invites_paused_until) return;

      const until = new Date(guild.invites_paused_until);
      if (until <= new Date()) {
        // Pause expired — clear it lazily instead of needing a scheduled job.
        await updateGuild(invite.guild.id, { invites_paused_until: null });
        return;
      }

      await invite.delete(t(currentLanguage(), 'moderation.pauseInvites.audit.paused')).catch(() => {});
    } catch (err) {
      logger.error('[inviteCreatePause]', err);
    }
  },
};
