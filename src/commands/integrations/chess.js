const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, plain, dateTag } = require('../../utils/integrations');
const { t, formatNumber, languageOf } = require('../../i18n');

const CACHE_MS = 5 * 60_000;
const COOLDOWN = { name: 'chess', ms: 3000 };
const NAME = /^[a-z0-9_-]{2,30}$/i;

/** The name of a player from what was typed or a link to the profile, or null. */
function parsePlayer(input) {
  const text = String(input ?? '').trim().replace(/^https?:\/\/(www\.)?(chess\.com\/member|lichess\.org\/@)\//i, '').replace(/^@/, '').replace(/[/?#].*$/, '');
  return NAME.test(text) ? text : null;
}

/** The flag of a country from its two letters (the two regional indicator letters make the flag), or an empty text. */
function flagOf(code) {
  const upper = String(code ?? '').toUpperCase();
  return /^[A-Z]{2}$/.test(upper) ? String.fromCodePoint(...[...upper].map((letter) => 0x1f1e6 + letter.charCodeAt(0) - 65)) : '';
}

const MODES = [['chess_rapid', 'rapid'], ['chess_blitz', 'blitz'], ['chess_bullet', 'bullet'], ['chess_daily', 'daily']];

async function chessCom(name) {
  return cached(`chesscom:${name.toLowerCase()}`, CACHE_MS, async () => {
    const [profile, stats] = await Promise.all([
      fetchJson(`https://api.chess.com/pub/player/${encodeURIComponent(name.toLowerCase())}`),
      fetchJson(`https://api.chess.com/pub/player/${encodeURIComponent(name.toLowerCase())}/stats`).catch(() => null),
    ]);
    if (!profile?.username) throw new IntegrationError('notFound');
    return { profile, stats };
  });
}

async function lichess(name) {
  return cached(`lichess:${name.toLowerCase()}`, CACHE_MS, async () => {
    const user = await fetchJson(`https://lichess.org/api/user/${encodeURIComponent(name)}`);
    if (!user?.username) throw new IntegrationError('notFound');
    return user;
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('chess')
    .setDescription('Look up a chess player on Chess.com or Lichess: ratings, games and since when.')
    .addSubcommand((s) => s
      .setName('chesscom')
      .setDescription('A player of Chess.com: ratings by mode, followers and title.')
      .addStringOption((o) => o.setName('player').setDescription('The username, for example hikaru').setMaxLength(100).setRequired(true)))
    .addSubcommand((s) => s
      .setName('lichess')
      .setDescription('A player of Lichess: ratings by mode and games.')
      .addStringOption((o) => o.setName('player').setDescription('The username, for example DrNykterstein').setMaxLength(100).setRequired(true))),

  // `!chess hikaru` is Chess.com.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'chesscom' : null),
  prefixSubcommandAliases: { com: 'chesscom', cc: 'chesscom', chess: 'chesscom', li: 'lichess', lc: 'lichess' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    const typed = interaction.options.getString('player', true);
    const number = (value) => formatNumber(lang, Number(value ?? 0));
    await lookup(interaction, lang, sub === 'lichess' ? 'Lichess' : 'Chess.com', async () => {
      const name = parsePlayer(typed);
      if (!name) throw new IntegrationError('badInput');

      if (sub === 'lichess') {
        const user = await lichess(name);
        if (user.closed || user.disabled) throw new IntegrationError('notFound');
        const perfs = Object.entries(user.perfs ?? {}).filter(([, perf]) => perf?.rating && perf.games > 0).sort((a, b) => b[1].games - a[1].games).slice(0, 5)
          .map(([mode, perf]) => row(t(lang, `integrations.chess.mode.${mode}`) === `integrations.chess.mode.${mode}` ? plain(mode, 20) : t(lang, `integrations.chess.mode.${mode}`), `${number(perf.rating)} · ${t(lang, 'integrations.chess.games', { count: number(perf.games) })}`));
        const count = user.count ?? {};
        return infoPayload({
          accent: null,
          title: `${user.title ? `${plain(user.title, 6)} ` : ''}${plain(user.username, 40)}`,
          subtitle: user.profile?.bio ? [plain(user.profile.bio, 250)] : [],
          sections: [
            { lines: perfs },
            {
              lines: [
                count.all ? row(t(lang, 'integrations.chess.total'), `${number(count.all)} (${number(count.win)} ${t(lang, 'integrations.chess.wins')} · ${number(count.draw)} ${t(lang, 'integrations.chess.draws')} · ${number(count.loss)} ${t(lang, 'integrations.chess.losses')})`) : null,
                user.createdAt ? row(t(lang, 'integrations.chess.joined'), dateTag(user.createdAt)) : null,
                user.seenAt ? row(t(lang, 'integrations.chess.seen'), dateTag(user.seenAt, 'R')) : null,
              ],
            },
          ].filter((section) => section.lines.some(Boolean)),
          footer: 'Lichess', // i18n-ignore: a brand name
          buttons: [{ label: t(lang, 'integrations.chess.open'), url: user.url ?? `https://lichess.org/@/${user.username}` }],
        });
      }

      const { profile, stats } = await chessCom(name);
      const country = String(profile.country ?? '').split('/').pop();
      const modes = MODES.map(([key, mode]) => (stats?.[key]?.last?.rating ? row(t(lang, `integrations.chess.mode.${mode}`), number(stats[key].last.rating)) : null));
      const extra = [
        stats?.tactics?.highest?.rating ? row(t(lang, 'integrations.chess.tactics'), number(stats.tactics.highest.rating)) : null,
        stats?.fide ? row('FIDE', number(stats.fide)) : null, // i18n-ignore: the name of an organization
      ];
      return infoPayload({
        accent: null,
        title: `${profile.title ? `${plain(profile.title, 6)} ` : ''}${plain(profile.name || profile.username, 60)}${flagOf(country) ? ` ${flagOf(country)}` : ''}`,
        subtitle: [`@${plain(profile.username, 40)}`],
        thumbnail: profile.avatar ?? null,
        sections: [
          { lines: [...modes, ...extra] },
          {
            lines: [
              row(t(lang, 'integrations.chess.followers'), number(profile.followers)),
              profile.league ? row(t(lang, 'integrations.chess.league'), plain(profile.league, 30)) : null,
              profile.joined ? row(t(lang, 'integrations.chess.joined'), dateTag(profile.joined * 1000)) : null,
              profile.last_online ? row(t(lang, 'integrations.chess.seen'), dateTag(profile.last_online * 1000, 'R')) : null,
              profile.is_streamer ? `-# ${t(lang, 'integrations.chess.streamer')}` : null,
            ],
          },
        ].filter((section) => section.lines.some(Boolean)),
        footer: 'Chess.com', // i18n-ignore: a brand name
        buttons: [{ label: t(lang, 'integrations.chess.open'), url: profile.url }],
      });
    }, COOLDOWN);
  },
};

module.exports.parsePlayer = parsePlayer;
module.exports.flagOf = flagOf;
