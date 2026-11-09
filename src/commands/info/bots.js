const { SlashCommandBuilder, UserFlagsBitField, escapeMarkdown } = require('discord.js');
const { register, sendPager } = require('../../utils/pager');
const { t } = require('../../i18n');
const { EMOJI } = require('../../utils/emojis');

// A server with more members than this is never read from Discord to find its bots: only the ones Petto already knows (the member cache) are listed.
const MEMBER_FETCH_UP_TO = 2000;
// The members of a server are asked for once in a while, not at each page: the buttons of the list read what is already known.
const FETCH_EVERY_MS = 10 * 60_000;
const FETCH_TIMEOUT_MS = 15_000;
const lastFetch = new Map();

/** Whether the members of this server are all known (the cache holds every one of them). */
const knowsEveryone = (guild) => guild.members.cache.size >= (guild.memberCount ?? 0);

/** The bots of a server, the oldest in it first, and whether the list is surely complete (a big server is only read from the cache). */
async function botsOf(guild) {
  let complete = knowsEveryone(guild);
  if (!complete) {
    const recently = Date.now() - (lastFetch.get(guild.id) ?? 0) < FETCH_EVERY_MS;
    if (!recently && (guild.memberCount ?? 0) <= MEMBER_FETCH_UP_TO) {
      lastFetch.set(guild.id, Date.now());
      await guild.members.fetch({ time: FETCH_TIMEOUT_MS }).catch(() => {});
      complete = knowsEveryone(guild);
    }
  }
  const bots = [...guild.members.cache.values()]
    .filter((member) => member.user?.bot)
    .sort((a, b) => (a.joinedTimestamp ?? Infinity) - (b.joinedTimestamp ?? Infinity));
  return { bots, complete };
}

/** A name that shows as it is: no markdown, and an @ that cannot become a mention. */
const plain = (value) => escapeMarkdown(String(value ?? '')).replace(/@/g, '@​');

const isVerified = (user) => {
  try { return Boolean(user?.flags?.has?.(UserFlagsBitField.Flags.VerifiedBot)); } catch { return false; }
};

/** One line of the list: name and tag, the ID, Petto marked, the verified flag and when it joined. */
function botLine(member, lang, petto) {
  const user = member.user;
  const name = plain(member.displayName ?? user.globalName ?? user.username);
  const tag = plain(user.tag ?? user.username);
  const parts = [`**${name}**${tag && tag !== name ? ` (${tag})` : ''}`, `\`${member.id}\``];
  if (member.id === petto) parts.push(`${EMOJI.STAR} ${t(lang, 'info.bots.petto')}`);
  if (isVerified(user)) parts.push(`${EMOJI.CHECK} ${t(lang, 'info.bots.verified')}`);
  if (member.joinedTimestamp) parts.push(t(lang, 'info.bots.joined', { when: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` }));
  return parts.join(' · ');
}

register('bots', {
  perPage: 10,
  async load(guild, { lang }) {
    const { bots, complete } = await botsOf(guild);
    return {
      title: t(lang, 'info.bots.title', { count: `${bots.length}${complete ? '' : '+'}` }),
      subtitle: complete ? undefined : [t(lang, 'info.bots.incomplete')],
      thumbnail: guild.iconURL?.({ size: 256 }) ?? null,
      items: bots.map((member) => botLine(member, lang, guild.client?.user?.id)),
      empty: complete ? t(lang, 'info.bots.empty') : `${t(lang, 'info.bots.empty')}\n${t(lang, 'info.bots.incomplete')}`,
    };
  },
});

/** Lists the bots of this server for anybody (nothing is asked of the member): a page at a time, the oldest first. */
module.exports = {
  aliases: ['botlist'],
  botsOf,
  data: new SlashCommandBuilder()
    .setName('bots')
    .setDescription('Lists the bots of this server, the oldest first, a page at a time.')
    .setDMPermission(false),

  async execute(interaction) {
    await sendPager(interaction, 'bots');
  },
};
