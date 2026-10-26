const { SlashCommandBuilder } = require('discord.js');
const config = require('../../config');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, plain, dateTag } = require('../../utils/integrations');
const { t, formatNumber, formatDecimal, languageOf } = require('../../i18n');

const API = 'https://api.steampowered.com';
const CACHE_MS = 5 * 60_000;
const COOLDOWN = { name: 'steam', ms: 4000 };
const STEAM_ID = /^7656119\d{10}$/;
const VANITY = /^[\w-]{2,32}$/;
const PERSONA_STATES = ['offline', 'online', 'busy', 'away', 'snooze', 'lookingToTrade', 'lookingToPlay'];
const GAMES_SHOWN = 5;
const GAMES_TOP = 10;

/** `{ id }` (a 64-bit Steam id) or `{ vanity }` from an id, a profile link or the custom name, or null. */
function parseProfile(input) {
  const text = String(input ?? '').trim();
  const link = /steamcommunity\.com\/(id|profiles)\/([^/?#]+)/i.exec(text);
  if (link) return link[1].toLowerCase() === 'profiles' ? (STEAM_ID.test(link[2]) ? { id: link[2] } : null) : (VANITY.test(link[2]) ? { vanity: link[2] } : null);
  if (STEAM_ID.test(text)) return { id: text };
  if (VANITY.test(text)) return { vanity: text };
  return null;
}

const call = (path, params) => fetchJson(`${API}${path}?${new URLSearchParams({ key: config.steamApiKey, format: 'json', ...params })}`);

async function idOf(target) {
  if (target.id) return target.id;
  const { response } = await call('/ISteamUser/ResolveVanityURL/v1/', { vanityurl: target.vanity });
  if (response?.success !== 1 || !response.steamid) throw new IntegrationError('notFound');
  return response.steamid;
}

/** The profile (required) and, when the profile is public, the level and the games. */
async function findProfile(target) {
  if (!config.steamApiKey) throw new IntegrationError('notConfigured');
  const id = await idOf(target);
  return cached(`steam:${id}`, CACHE_MS, async () => {
    const summary = await call('/ISteamUser/GetPlayerSummaries/v2/', { steamids: id });
    const player = summary?.response?.players?.[0];
    if (!player) throw new IntegrationError('notFound');
    const isPublic = player.communityvisibilitystate === 3;
    const [level, owned, recent] = isPublic
      ? await Promise.all([
        call('/IPlayerService/GetSteamLevel/v1/', { steamid: id }).catch(() => null),
        call('/IPlayerService/GetOwnedGames/v1/', { steamid: id }).catch(() => null),
        call('/IPlayerService/GetRecentlyPlayedGames/v1/', { steamid: id, count: String(GAMES_SHOWN) }).catch(() => null),
      ])
      : [null, null, null];
    return {
      id,
      name: player.personaname,
      avatar: player.avatarfull,
      url: player.profileurl,
      state: PERSONA_STATES[player.personastate] ?? 'offline',
      playing: player.gameextrainfo ?? null,
      created: player.timecreated ? player.timecreated * 1000 : null,
      country: player.loccountrycode ?? null,
      isPublic,
      level: level?.response?.player_level ?? null,
      games: owned?.response?.game_count ?? null,
      recent: (recent?.response?.games ?? []).map((game) => ({ name: game.name, hours: Math.round((game.playtime_2weeks ?? 0) / 6) / 10 })),
    };
  });
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('steam')
    .setDescription('Look up a Steam profile or the games someone has played the most.')
    .addSubcommand((s) => s
      .setName('profile')
      .setDescription('A profile: level, games and what they are playing.')
      .addStringOption((o) => o.setName('user').setDescription('The custom name, the Steam id or the link to the profile').setMaxLength(150).setRequired(true)))
    .addSubcommand((s) => s
      .setName('games')
      .setDescription('The games someone has played the most.')
      .addStringOption((o) => o.setName('user').setDescription('The custom name, the Steam id or the link to the profile').setMaxLength(150).setRequired(true))),

  // `!steam gaben` is the profile.
  prefixDefaultSubcommand: (tokens) => (tokens.length ? 'profile' : null),
  prefixSubcommandAliases: { user: 'profile', p: 'profile', top: 'games', library: 'games' },

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const number = (value) => formatNumber(lang, value);
    const sub = interaction.options.getSubcommand();
    await lookup(interaction, lang, 'Steam', async () => {
      const target = parseProfile(interaction.options.getString('user', true));
      if (!target) throw new IntegrationError('badInput');
      const profile = await findProfile(target);
      if (sub === 'games') {
        if (!profile.isPublic) throw new IntegrationError('private');
        const owned = await cached(`steam:owned:${profile.id}`, CACHE_MS, () => call('/IPlayerService/GetOwnedGames/v1/', { steamid: profile.id, include_appinfo: '1' }));
        const games = (owned?.response?.games ?? []).filter((game) => game.playtime_forever > 0).sort((a, b) => b.playtime_forever - a.playtime_forever);
        if (!games.length) throw new IntegrationError('private'); // the list of games is hidden even when the profile is public
        const hours = (minutes) => formatDecimal(lang, minutes / 60, 1);
        const total = games.reduce((sum, game) => sum + game.playtime_forever, 0);
        return infoPayload({
          accent: null,
          title: t(lang, 'integrations.steam.gamesTitle', { name: plain(profile.name, 60) }),
          subtitle: [t(lang, 'integrations.steam.gamesTotal', { games: number(owned.response.game_count ?? games.length), hours: hours(total) })],
          thumbnail: profile.avatar,
          sections: [{ lines: games.slice(0, GAMES_TOP).map((game, index) => `**${index + 1}.** ${plain(game.name, 60)} · ${t(lang, 'integrations.steam.hoursTotal', { hours: hours(game.playtime_forever) })}`), limit: 1500 }],
          footer: t(lang, 'info.card.id', { id: profile.id }),
          buttons: [{ label: t(lang, 'integrations.steam.open'), url: profile.url }],
        });
      }
      const recent = profile.recent.map((game) => `${plain(game.name, 60)} · ${t(lang, 'integrations.steam.hours', { hours: game.hours })}`);
      return infoPayload({
        accent: null,
        title: plain(profile.name, 80),
        thumbnail: profile.avatar,
        sections: [
          {
            lines: [
              row(t(lang, 'integrations.steam.status'), profile.playing ? t(lang, 'integrations.steam.playing', { game: plain(profile.playing, 80) }) : t(lang, `integrations.steam.state.${profile.state}`)),
              profile.level !== null ? row(t(lang, 'integrations.steam.level'), number(profile.level)) : null,
              profile.games !== null ? row(t(lang, 'integrations.steam.games'), number(profile.games)) : null,
              profile.created ? row(t(lang, 'integrations.steam.joined'), dateTag(profile.created)) : null,
              profile.isPublic ? null : `-# ${t(lang, 'integrations.steam.private')}`,
            ],
          },
          recent.length ? { title: t(lang, 'integrations.steam.recent'), lines: recent } : null,
        ].filter(Boolean),
        footer: t(lang, 'info.card.id', { id: profile.id }),
        buttons: [{ label: t(lang, 'integrations.steam.open'), url: profile.url }],
      });
    }, COOLDOWN);
  },
};

module.exports.parseProfile = parseProfile;
module.exports.findProfile = findProfile;
