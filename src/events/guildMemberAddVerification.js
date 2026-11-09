const { Events, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const { getConfig } = require('../db/verificationConfig');
const { ensureUnverifiedRole } = require('../utils/verifyRole');
const { verifyLinkFor } = require('../utils/verifyLink');
const { sendVerifyDM } = require('../utils/verifyMessage');
const config = require('../config');
const { methodOf, usesLink } = require('../utils/verifyMethod');
const logger = require('../utils/logger');
const { t, peekGuildLanguage } = require('../i18n');

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    if (member.user.bot) return;

    try {
      await ensureGuild(member.guild.id);
      const verifyConfig = await getConfig(member.guild.id);
      if (!verifyConfig?.enabled) return;
      const lang = peekGuildLanguage(member.guild.id);

      // A member who comes back is gated again, even one who verified before: leaving and joining again is how an account that was taken over
      // would get in, so nobody keeps their verification from an earlier stay. (The verified role is not given back either: events/guildMemberAddStickyRoles.js.)

      const method = methodOf(verifyConfig);
      // Without a link that opens (VERIFY_BASE_URL missing or not public), the letters inside Discord take its place when they can.
      const made = usesLink(method) ? verifyLinkFor(member.id, member.guild.id) : null;
      if (made?.problem && !config.verifyTokenSecret) {
        logger.warn(`Verification is enabled in guild ${member.guild.id} but no verification link can be given (${made.problem}) — skipping gate.`);
        return;
      }

      const role = await ensureUnverifiedRole(member.guild, verifyConfig);
      await member.roles.add(role, t(lang, 'verify.reason.newMember')).catch((err) => logger.warn(`Could not gate ${member.id} on join:`, err.message));

      // A server that verifies only inside Discord has no link: the DM has the button.
      const link = made?.url ?? null;

      await sendVerifyDM(member, { guild: member.guild, link, lang })
        .catch(() => logger.warn(`Could not DM verification link to ${member.id} in guild ${member.guild.id} — they may have DMs closed.`));
    } catch (err) {
      logger.error(`Verification gate failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
};
