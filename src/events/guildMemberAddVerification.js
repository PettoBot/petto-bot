const { Events, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { getConfig } = require('../db/verificationConfig');
const { hasEverVerified } = require('../db/verificationRedemptions');
const { ensureUnverifiedRole } = require('../utils/verifyRole');
const { createToken } = require('../utils/verifyToken');
const { sendVerifyDM } = require('../utils/verifyMessage');
const config = require('../config');
const { methodOf, usesLink } = require('../utils/verifyMethod');
const logger = require('../utils/logger');
const { t, guildLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return;

    try {
      await ensureGuild(member.guild.id);
      const verifyConfig = await getConfig(member.guild.id);
      if (!verifyConfig?.enabled) return;
      const lang = await guildLanguage(member.guild.id);

      // Returning member who already passed verification before — don't re-gate them.
      if (await hasEverVerified(member.guild.id, member.id)) {
        if (verifyConfig.verified_role_id) {
          await member.roles.add(verifyConfig.verified_role_id, t(lang, 'verify.reason.returning')).catch((err) => logger.warn(`Could not re-grant verified role to ${member.id}:`, err.message));
        }
        return;
      }

      const method = methodOf(verifyConfig);
      if (usesLink(method) && !config.verifyBaseUrl) {
        logger.warn(`Verification is enabled in guild ${member.guild.id} but VERIFY_BASE_URL is not set — skipping gate.`);
        return;
      }

      const role = await ensureUnverifiedRole(member.guild, verifyConfig);
      await member.roles.add(role, t(lang, 'verify.reason.newMember')).catch((err) => logger.warn(`Could not gate ${member.id} on join:`, err.message));

      // A server that verifies only inside Discord has no link: the DM has the button.
      const link = usesLink(method) ? `${config.verifyBaseUrl}/verify/${createToken({ userId: member.id, guildId: member.guild.id })}` : null;

      await sendVerifyDM(member, { guild: member.guild, link, lang })
        .catch(() => logger.warn(`Could not DM verification link to ${member.id} in guild ${member.guild.id} — they may have DMs closed.`));
    } catch (err) {
      logger.error(`Verification gate failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};
