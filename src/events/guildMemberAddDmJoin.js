const { Events } = require('discord.js');
const { getConfig } = require('../db/memberEvents');
const { sendMemberEvent, NO_MUTUAL_SERVER } = require('../utils/memberEventMessage');
const { inviteInfoFor } = require('../utils/inviteContext');
const { runWithLanguage, peekGuildLanguage } = require('../i18n');
const logger = require('../utils/logger');

// The direct message of a join is sent a few seconds after the join, not in the same instant: Discord needs a moment to count the new member as someone who shares a
// server with Petto, and before that it refuses the message (code 50278, "no mutual guilds"). When it refuses anyway the message is tried again a few times while the
// member is still in the server (they may need longer when they have to accept the rules first). It is not held with the welcome (`welcome_wait`): this message often carries the
// rules, so it goes out even before the member accepts them. JOIN_DM_DELAY_MS (0 to 60000, 5000 by default) is the first wait.
const DELAY_MS = Math.min(60_000, Math.max(0, Number.isFinite(Number(process.env.JOIN_DM_DELAY_MS)) && process.env.JOIN_DM_DELAY_MS !== undefined && process.env.JOIN_DM_DELAY_MS !== '' ? Math.floor(Number(process.env.JOIN_DM_DELAY_MS)) : 5_000));
const RETRY_MS = [30_000, 120_000, 600_000]; // after the first try: 30 seconds, 2 minutes and 10 minutes
const MAX_RETRYING = 500; // a raid can fill the queue: past this the extra messages are not tried again
let retrying = 0;

const hasDm = (config) => Boolean(config?.dm_join_message || config?.dm_join_embed_template);
const wait = (ms, { background = false } = {}) => new Promise((resolve) => { const timer = setTimeout(resolve, ms); if (background) timer.unref?.(); }); // a retry in the background never keeps the process alive

/** The member as they are now, or null when they left or were removed. */
const stillHere = (member) => member.guild.members.fetch(member.id).catch(() => null);

/** One try. Returns the code Discord refused it with when it is worth trying again, otherwise nothing. */
async function attempt(member, config, { recorded }) {
  const dm = await member.createDM().catch(() => null);
  if (!dm) return undefined; // DMs closed: nothing else to do
  const result = await sendMemberEvent({
    guild: member.guild,
    channel: dm,
    kind: 'welcome',
    dmOrigin: { guild: member.guild, kind: 'welcome' },
    messageText: config.dm_join_message,
    embedTemplateName: config.dm_join_embed_template,
    ctx: { member, guild: member.guild, channel: dm, invite: await inviteInfoFor(member, { recorded }) },
  });
  return result?.failed === NO_MUTUAL_SERVER ? NO_MUTUAL_SERVER : undefined;
}

/** The retries: each one looks again at the member (still here?) and at the settings (still on?), and runs in the language of the server. */
function retryLater(member, step) {
  if (step >= RETRY_MS.length || retrying >= MAX_RETRYING) return;
  retrying += 1;
  wait(RETRY_MS[step], { background: true }).then(async () => {
    try {
      const current = await stillHere(member);
      const config = current ? await getConfig(member.guild.id) : null;
      if (!current || !hasDm(config)) return;
      const refused = await runWithLanguage(peekGuildLanguage(member.guild.id), () => attempt(current, config, { recorded: true }));
      if (refused) retryLater(current, step + 1);
    } catch (err) {
      logger.warn(`Join DM: the retry for ${member.id} in guild ${member.guild.id} failed: ${err.message}`); // i18n-ignore: a log line for the operator
    }
  }).finally(() => { retrying -= 1; });
}

module.exports = {
  name: Events.GuildMemberAdd,
  async execute(member) {
    try {
      const config = await getConfig(member.guild.id);
      if (!hasDm(config)) return;
      let current = member;
      if (DELAY_MS > 0) {
        await wait(DELAY_MS);
        current = await stillHere(member);
        if (!current) return; // they left in the meantime: nobody to write to
      }
      const refused = await attempt(current, config, { recorded: false });
      if (refused) retryLater(current, 0);
    } catch (err) {
      logger.error(`Join DM failed for ${member.id} in guild ${member.guild.id}:`, err);
    }
  },
  DELAY_MS,
  RETRY_MS,
};
