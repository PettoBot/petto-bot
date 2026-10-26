// Checks the second set of lookup commands and the new subcommands of the first: Minecraft servers, GitHub commits, issues and languages, Roblox avatars
// and groups, Steam games, Twitch clips and top, YouTube latest and search, Last.fm albums, artists, compare and who knows, and Deezer, Apple, Wikipedia,
// AniList, Pokémon, npm, PyPI and TMDB. The services are replaced by a fake fetch; nothing leaves this machine.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
const assert = require('node:assert/strict');
const path = require('node:path');

function stub(relative, exports) {
  const resolved = require.resolve(path.join(__dirname, '..', relative));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}
const logged = [];
stub('src/utils/logger.js', { info() {}, warn() {}, error(...args) { logged.push(args); } });
const links = new Map();
stub('src/db/lastfmLinks.js', {
  getLink: async (id) => links.get(id) ?? null,
  getLinks: async (ids) => new Map(ids.filter((id) => links.has(id)).map((id) => [id, links.get(id)])),
  setLink: async (id, name) => { links.set(id, name); },
  removeLink: async (id) => links.delete(id),
});

// The covers are not downloaded: a plain square stands for each one.
const { createCanvas, loadImage } = require('@napi-rs/canvas');
const coversAsked = [];
stub('src/utils/safeImage.js', {
  loadImageFromLink: async (url) => { coversAsked.push(url); const canvas = createCanvas(300, 300); const ctx = canvas.getContext('2d'); ctx.fillStyle = '#c0392b'; ctx.fillRect(0, 0, 300, 300); return canvas; },
});
const config = require('../src/config');
const integrations = require('../src/utils/integrations');
const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
const cmd = (name) => require(`../src/commands/integrations/${name}`);
const [minecraft, github, roblox, steam, twitch, youtube, lastfm, deezer, itunes, wikipedia, anilist, pokemon, pkg, tmdb, chess, modrinth, crypto, currency, animal] = ['minecraft', 'github', 'roblox', 'steam', 'twitch', 'youtube', 'lastfm', 'deezer', 'itunes', 'wikipedia', 'anilist', 'pokemon', 'package', 'tmdb', 'chess', 'modrinth', 'crypto', 'currency', 'animal'].map(cmd);
for (const key of ['githubToken', 'lastfmApiKey', 'steamApiKey', 'twitchClientId', 'twitchClientSecret', 'youtubeApiKey', 'tmdbApiKey']) config[key] = null; // whatever the machine has

// --- the fake internet ---------------------------------------------------------------------------------------------------------------------
let routes = [];
const calls = [];
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  for (const [pattern, handler] of routes) {
    if (pattern.test(String(url))) return typeof handler === 'function' ? handler(String(url), init) : handler.clone();
  }
  return json({}, 404);
};
const called = (pattern) => calls.filter((call) => pattern.test(call.url)).length;

let nextUser = 0;
function fake({ sub = null, strings = {}, users = {}, lang = 'en', guild = null, nsfw = false, userId = null } = {}) {
  const sent = { replies: [], edits: [] };
  return {
    pettoLang: lang,
    guild,
    channel: { nsfw },
    user: { id: userId ?? `u${nextUser += 1}`, username: 'liam' },
    options: {
      getSubcommand: () => sub,
      getString: (name, required) => {
        if (strings[name] === undefined && required) { const error = new Error(`missing ${name}`); error.userFacing = true; error.missingOption = name; throw error; }
        return strings[name] ?? null;
      },
      getUser: (name, required) => {
        if (!users[name] && required) { const error = new Error(`missing ${name}`); error.userFacing = true; error.missingOption = name; throw error; }
        return users[name] ?? null;
      },
    },
    reply: async (payload) => { sent.replies.push(payload); },
    deferReply: async () => {},
    editReply: async (payload) => { sent.edits.push(payload); },
    sent,
  };
}
const textOf = (payload) => JSON.stringify((payload.components ?? []).map((component) => component.toJSON()));
async function ask(command, options) {
  integrations.clearCache();
  const interaction = fake(options);
  await command.execute(interaction);
  const payload = interaction.sent.edits.at(-1) ?? interaction.sent.replies.at(-1);
  assert.ok(payload, 'the command answered');
  const text = textOf(payload);
  assert.doesNotMatch(text, /integrations\.[a-z]+\.[a-z]/i, `no text is missing from the catalog: ${text.slice(0, 300)}`);
  assert.doesNotMatch(text, /undefined|\[object Object\]|NaN|null/, `nothing is printed as undefined: ${text.slice(0, 400)}`);
  const card = payload.components[0].toJSON();
  assert.ok(card.accent_color === undefined || [0xa5ea7a, 0xfe6465, 0xfed53c].includes(card.accent_color), 'a card has no color except green, red or yellow');
  assert.ok(text.length < 7000, 'the card fits in a message');
  // A song, album or artist card has its picture attached: one PNG, as wide as the card is drawn.
  if (payload.files?.length) {
    assert.equal(payload.files.length, 1); assert.equal(payload.files[0].name, 'song.png');
    const picture = await loadImage(payload.files[0].attachment);
    assert.equal(picture.width, 1000); assert.equal(picture.height, 260);
  }
  return { text, payload, card };
}
const buttonsOf = (payload) => payload.components[0].toJSON().components.filter((component) => component.type === 1).flatMap((component) => component.components);
const typed = async (command, text) => {
  const message = { guild: { id: 'g', members: { cache: new Map(), fetch: async () => null, search: async () => new Map() } }, channel: { id: 'c' }, author: { id: 'u' }, client: { users: { cache: new Map(), fetch: async () => null } }, content: text, attachments: { first: () => null } };
  const built = await buildInteractionFromMessage(message, command, text);
  return built ? built.options.getSubcommand(false) : null;
};

(async () => {
  // --- Minecraft servers -------------------------------------------------------------------------------------------------------------------
  assert.equal(minecraft.parseAddress('Hypixel.net'), 'hypixel.net'); assert.equal(minecraft.parseAddress('play.x.com:25566'), 'play.x.com:25566'); assert.equal(minecraft.parseAddress('https://mc.example.com/x'), 'mc.example.com');
  assert.equal(minecraft.parseAddress('x.com:99999'), null); assert.equal(minecraft.parseAddress('a b'), null); assert.equal(minecraft.parseAddress('-bad.com'), null);
  assert.equal(await typed(minecraft, 'hypixel.net'), 'server'); assert.equal(await typed(minecraft, 'Notch'), 'user'); assert.equal(await typed(minecraft, 'status mc.x.com'), 'server');
  routes = [
    [/mcsrvstat\.us\/3\/mc\.hypixel\.net$/, json({ online: true, ip: '172.65.1.1', port: 25565, hostname: 'mc.hypixel.net', version: '1.8-1.21', software: 'Paper', motd: { clean: ['Hypixel Network', 'SKYBLOCK 1.0'] }, players: { online: 14786, max: 200000, list: [{ name: 'Alex' }, { name: 'Steve_99' }] } })],
    [/mcsrvstat\.us\/3\/down\.example\.com$/, json({ online: false, ip: '1.2.3.4', port: 25565, hostname: 'down.example.com' })],
    [/mcsrvstat\.us\/3\/blocked\.example\.com$/, json({ online: true, hostname: 'blocked.example.com', eula_blocked: true, players: { online: 1, max: 2 } })],
  ];
  let out = await ask(minecraft, { sub: 'server', strings: { address: 'MC.Hypixel.net' } });
  assert.match(out.text, /mc\.hypixel\.net/); assert.match(out.text, /Hypixel Network\\nSKYBLOCK 1\.0/); assert.match(out.text, /14,786 \/ 200,000/); assert.match(out.text, /Paper/); assert.match(out.text, /`Alex`/); assert.match(out.text, /mcsrvstat\.us\/icon\/mc\.hypixel\.net/);
  out = await ask(minecraft, { sub: 'server', strings: { address: 'down.example.com' } });
  assert.match(out.text, /Offline/); assert.doesNotMatch(out.text, /Players/); assert.doesNotMatch(out.text, /\/icon\//);
  out = await ask(minecraft, { sub: 'server', strings: { address: 'blocked.example.com' } });
  assert.match(out.text, /Mojang blocked/);
  out = await ask(minecraft, { sub: 'server', strings: { address: 'no such' } });
  assert.match(out.text, /does not look right/);

  // --- GitHub: commits, issues, pulls, languages, contributors -----------------------------------------------------------------------------
  assert.equal(await typed(github, 'commits PettoBot/petto-bot'), 'commits'); assert.equal(await typed(github, 'langs a/b'), 'languages'); assert.equal(await typed(github, 'top a/b'), 'contributors');
  routes = [
    [/repos\/PettoBot\/petto-bot\/commits\?per_page=5$/, json([{ sha: 'abcdef1234567', html_url: 'https://github.com/x/commit/abcdef1', commit: { message: 'Fix the counters\n\nlong body', author: { name: 'Liam', date: '2026-10-25T00:00:00Z' } }, author: { login: 'liam' } }])],
    [/repos\/PettoBot\/petto-bot\/issues\?state=open&per_page=30$/, json([{ number: 5, title: 'A pull request', html_url: 'https://github.com/x/pull/5', pull_request: {}, user: { login: 'a' }, created_at: '2026-10-01T00:00:00Z' }, { number: 4, title: 'A real issue', html_url: 'https://github.com/x/issues/4', user: { login: 'bob' }, created_at: '2026-10-02T00:00:00Z' }])],
    [/repos\/PettoBot\/petto-bot\/pulls\?state=open&per_page=5$/, json([{ number: 7, title: 'Add feeds', html_url: 'https://github.com/x/pull/7', user: { login: 'liam' }, created_at: '2026-10-03T00:00:00Z' }])],
    [/repos\/PettoBot\/petto-bot\/languages$/, json({ JavaScript: 900000, SQL: 90000, HTML: 10000 })],
    [/repos\/PettoBot\/petto-bot\/contributors\?per_page=10$/, json([{ login: 'liam', contributions: 321, html_url: 'https://github.com/liam' }, { login: 'bot', contributions: 1, html_url: 'https://github.com/bot' }])],
    [/repos\/a\/empty\/(issues|pulls)/, json([])],
    [/repos\/a\/empty\/contributors/, new Response(null, { status: 204 })],
    [/repos\/a\/empty\/commits/, json([])],
  ];
  out = await ask(github, { sub: 'commits', strings: { repository: 'PettoBot/petto-bot' } });
  assert.match(out.text, /`abcdef1`/); assert.match(out.text, /Fix the counters/); assert.doesNotMatch(out.text, /long body/);
  out = await ask(github, { sub: 'issues', strings: { repository: 'PettoBot/petto-bot' } });
  assert.match(out.text, /A real issue/); assert.doesNotMatch(out.text, /A pull request/, 'pull requests are not issues');
  out = await ask(github, { sub: 'pulls', strings: { repository: 'PettoBot/petto-bot' } });
  assert.match(out.text, /Add feeds/);
  out = await ask(github, { sub: 'languages', strings: { repository: 'PettoBot/petto-bot' } });
  assert.match(out.text, /JavaScript\*\* 90\.0%/); assert.match(out.text, /▰▰▰▰▰▰▰▰▰▱/); assert.match(out.text, /HTML\*\* 1\.0%/);
  out = await ask(github, { sub: 'contributors', strings: { repository: 'PettoBot/petto-bot' } });
  assert.match(out.text, /\*\*1\.\*\* \[liam\].*321 commits/); assert.match(out.text, /1 commit[^s]/);
  out = await ask(github, { sub: 'issues', strings: { repository: 'a/empty' } });
  assert.match(out.text, /No open issues/); assert.equal(out.card.accent_color, 0xa5ea7a, 'good news is green');
  out = await ask(github, { sub: 'pulls', strings: { repository: 'a/empty' } });
  assert.match(out.text, /No open pull requests/);
  out = await ask(github, { sub: 'contributors', strings: { repository: 'a/empty' } });
  assert.match(out.text, /nothing to show/);
  out = await ask(github, { sub: 'commits', strings: { repository: 'a/empty' } });
  assert.match(out.text, /nothing to show/);

  // --- Roblox: avatar and group -------------------------------------------------------------------------------------------------------------
  assert.deepEqual(roblox.parseGroup('1200769'), { id: '1200769' }); assert.deepEqual(roblox.parseGroup('https://www.roblox.com/groups/1200769/Official'), { id: '1200769' }); assert.deepEqual(roblox.parseGroup('https://www.roblox.com/communities/1200769/x'), { id: '1200769' });
  assert.deepEqual(roblox.parseGroup('Roblox Fans'), { name: 'Roblox Fans' }); assert.equal(roblox.parseGroup('ab'), null);
  assert.equal(await typed(roblox, 'Builderman'), 'user'); assert.equal(await typed(roblox, 'group 1200769'), 'group'); assert.equal(await typed(roblox, 'body Builderman'), 'avatar');
  routes = [
    [/users\.roblox\.com\/v1\/usernames\/users$/, json({ data: [{ id: 156 }] })],
    [/users\.roblox\.com\/v1\/users\/156$/, json({ id: 156, name: 'builderman', displayName: 'Builder', created: '2006-03-08T00:00:00Z' })],
    [/friends\.roblox\.com/, json({ count: 1 })], [/thumbnails\.roblox\.com\/v1\/users\/avatar-headshot/, json({ data: [{ state: 'Completed', imageUrl: 'https://tr/h.png' }] })], [/groups\.roblox\.com\/v2\/users/, json({ data: [] })],
    [/thumbnails\.roblox\.com\/v1\/users\/avatar\?userIds=156/, json({ data: [{ state: 'Completed', imageUrl: 'https://tr/full.png' }] })],
    [/groups\.roblox\.com\/v1\/groups\/search\?keyword=Roblox%20Fans/, json({ data: [{ id: 1200769 }] })],
    [/groups\.roblox\.com\/v1\/groups\/search/, json({ data: [] })],
    [/groups\.roblox\.com\/v1\/groups\/1200769$/, json({ id: 1200769, name: 'Official Group of Roblox', description: 'The official group', owner: { username: 'Games' }, memberCount: 2821, shout: { body: 'Hello players' }, publicEntryAllowed: false, hasVerifiedBadge: true })],
    [/thumbnails\.roblox\.com\/v1\/groups\/icons/, json({ data: [{ state: 'Completed', imageUrl: 'https://tr/g.png' }] })],
  ];
  out = await ask(roblox, { sub: 'avatar', strings: { user: 'Builderman' } });
  assert.match(out.text, /full\.png/); assert.match(out.text, /Builder \(@builderman\)/);
  out = await ask(roblox, { sub: 'group', strings: { group: '1200769' } });
  assert.match(out.text, /Official Group of Roblox ✔/); assert.match(out.text, /2,821/); assert.match(out.text, /@Games/); assert.match(out.text, /Needs approval/); assert.match(out.text, /Hello players/); assert.match(out.text, /communities\/1200769/);
  out = await ask(roblox, { sub: 'group', strings: { group: 'Roblox Fans' } });
  assert.match(out.text, /Official Group of Roblox/, 'a group found by its name');
  out = await ask(roblox, { sub: 'group', strings: { group: 'Nothing Here' } });
  assert.match(out.text, /Nothing found on Roblox/);

  // --- Steam: games --------------------------------------------------------------------------------------------------------------------------
  config.steamApiKey = 'KEY';
  let publicProfile = true; let hideGames = false;
  routes = [
    [/GetPlayerSummaries/, () => json({ response: { players: [{ personaname: 'Gabe', avatarfull: 'https://a/s.jpg', profileurl: 'https://steamcommunity.com/id/gaben/', personastate: 1, communityvisibilitystate: publicProfile ? 3 : 1 }] } })],
    [/GetSteamLevel|GetRecentlyPlayed/, json({ response: {} })],
    [/GetOwnedGames/, () => json({ response: hideGames ? {} : { game_count: 3, games: [{ name: 'Portal 2', playtime_forever: 1200 }, { name: 'Half-Life', playtime_forever: 6000 }, { name: 'Never played', playtime_forever: 0 }] } })],
  ];
  assert.equal(await typed(steam, 'gaben'), 'profile'); assert.equal(await typed(steam, 'top gaben'), 'games');
  out = await ask(steam, { sub: 'games', strings: { user: '76561198000000000' } });
  assert.ok(out.text.indexOf('Half-Life') < out.text.indexOf('Portal 2'), 'the most played first'); assert.match(out.text, /100\.0 h/); assert.match(out.text, /3 games · 120\.0 h in total/); assert.doesNotMatch(out.text, /Never played/);
  hideGames = true;
  out = await ask(steam, { sub: 'games', strings: { user: '76561198000000000' } });
  assert.match(out.text, /profile is private/, 'games hidden on a public profile');
  hideGames = false; publicProfile = false;
  out = await ask(steam, { sub: 'games', strings: { user: '76561198000000000' } });
  assert.match(out.text, /profile is private/);
  config.steamApiKey = null;

  // --- Twitch: clips and top -----------------------------------------------------------------------------------------------------------------
  config.twitchClientId = 'cid'; config.twitchClientSecret = 'secret'; twitch.resetToken();
  let hasClips = true;
  routes = [
    [/oauth2\/token$/, json({ access_token: 'tok', expires_in: 5000000 })],
    [/helix\/users\?login=ibai$/, json({ data: [{ id: '40', login: 'ibai', display_name: 'Ibai', broadcaster_type: 'partner', profile_image_url: 'https://a/i.png', created_at: '2012-01-01T00:00:00Z' }] })],
    [/helix\/streams\?user_login=ibai$/, json({ data: [] })],
    [/helix\/clips\?broadcaster_id=40&first=5$/, () => json({ data: hasClips ? [{ title: 'The best clip', url: 'https://clips.twitch.tv/x', view_count: 1, creator_name: 'fan', created_at: '2026-10-01T00:00:00Z', thumbnail_url: 'https://a/clip.jpg' }, { title: 'Second', url: 'https://clips.twitch.tv/y', view_count: 9000, creator_name: 'fan2', created_at: '2026-10-02T00:00:00Z', thumbnail_url: 'https://a/c2.jpg' }] : [] })],
    [/helix\/streams\?first=10$/, json({ data: [{ user_name: 'Kai', user_login: 'kai', game_name: 'Minecraft', viewer_count: 120000 }, { user_name: 'Zed', user_login: 'zed', game_name: '', viewer_count: 1 }] })],
  ];
  assert.equal(await typed(twitch, 'ibai'), 'channel'); assert.equal(await typed(twitch, 'top'), 'top'); assert.equal(await typed(twitch, 'clips ibai'), 'clips');
  out = await ask(twitch, { sub: 'clips', strings: { channel: 'ibai' } });
  assert.match(out.text, /The best clip/); assert.match(out.text, /1 view[^s]/); assert.match(out.text, /9,000 views/); assert.match(out.text, /clip\.jpg/);
  hasClips = false;
  out = await ask(twitch, { sub: 'clips', strings: { channel: 'ibai' } });
  assert.match(out.text, /Ibai has no clips yet/);
  out = await ask(twitch, { sub: 'top' });
  assert.match(out.text, /\*\*1\.\*\* \[Kai\]\(https:\/\/www\.twitch\.tv\/kai\) · Minecraft · 120,000 viewers/); assert.match(out.text, /1 viewer[^s]/);
  config.twitchClientId = null; config.twitchClientSecret = null;
  out = await ask(twitch, { sub: 'top' });
  assert.match(out.text, /not set up/);

  // --- YouTube: latest and search -------------------------------------------------------------------------------------------------------------
  config.youtubeApiKey = 'YT';
  routes = [
    [/youtube\/v3\/channels\?/, json({ items: [{ id: 'UCX6OQ3DkcsbYNE6H8uQQuVA', snippet: { title: 'MrBeast', customUrl: '@mrbeast', publishedAt: '2012-02-20T00:00:00Z' }, statistics: { subscriberCount: '400000000', videoCount: '800', viewCount: '9' }, contentDetails: { relatedPlaylists: { uploads: 'UUX6OQ3DkcsbYNE6H8uQQuVA' } } }] })],
    [/youtube\/v3\/playlistItems\?.*playlistId=UUX6OQ3DkcsbYNE6H8uQQuVA/, json({ items: [{ contentDetails: { videoId: 'dQw4w9WgXcQ' } }] })],
    [/youtube\/v3\/videos\?/, json({ items: [{ id: 'dQw4w9WgXcQ', snippet: { title: 'The newest video', channelTitle: 'MrBeast', channelId: 'UCX6OQ3DkcsbYNE6H8uQQuVA', publishedAt: '2026-10-25T00:00:00Z', thumbnails: { high: { url: 'https://i.ytimg.com/h.jpg' } } }, statistics: { viewCount: '10' }, contentDetails: { duration: 'PT10M' } }] })],
    [/youtube\/v3\/search\?/, json({ items: [1, 2, 3].map((n) => ({ id: { videoId: `video${n}aaaaaa` }, snippet: { title: `Result ${n}`, channelTitle: `Channel ${n}` } })).concat([{ id: { channelId: 'x' }, snippet: { title: 'A channel, not a video', channelTitle: 'c' } }]) })],
  ];
  assert.equal(await typed(youtube, 'latest @MrBeast'), 'latest'); assert.equal(await typed(youtube, 'find minecraft'), 'search');
  out = await ask(youtube, { sub: 'latest', strings: { channel: '@MrBeast' } });
  assert.match(out.text, /The newest video/); assert.match(out.text, /10:00/); assert.match(out.text, /watch\?v=dQw4w9WgXcQ/);
  out = await ask(youtube, { sub: 'search', strings: { query: 'minecraft house' } });
  assert.match(out.text, /Videos for \\"minecraft house\\"/); assert.match(out.text, /\*\*3\.\*\* \[Result 3\]/); assert.doesNotMatch(out.text, /not a video/); assert.match(out.text, /results\?search_query=minecraft%20house/);
  config.youtubeApiKey = null;

  // --- Last.fm: albums, artist, compare, who knows -----------------------------------------------------------------------------------------------
  config.lastfmApiKey = 'FM';
  assert.equal(await typed(lastfm, 'albums'), 'topalbums'); assert.equal(await typed(lastfm, 'wk radiohead'), 'whoknows'); assert.equal(await typed(lastfm, 'match @liam'), 'compare');
  links.set('me', 'rj'); links.set('other', 'bob'); links.set('m3', 'cat'); links.set('m4', 'dan'); links.set('outsider', 'eve');
  const artistFor = (who) => ({ artist: { name: 'Radiohead', url: 'https://www.last.fm/music/Radiohead', image: [{ '#text': 'https://lastfm/r.png' }], stats: { listeners: '5000000', playcount: '300000000', ...(who ? { userplaycount: { rj: '812', bob: '12', cat: '0', dan: '40' }[who.toLowerCase()] ?? '0' } : {}) }, tags: { tag: [{ name: 'alternative' }, { name: 'rock' }] }, similar: { artist: [{ name: 'Muse' }, { name: 'Thom Yorke' }] }, bio: { summary: 'Radiohead are an English <b>rock</b> band. <a href="https://www.last.fm/music/Radiohead">Read more on Last.fm</a>' } } });
  routes = [
    [/method=user\.gettopalbums&user=rj&period=1month/i, json({ topalbums: { album: [{ name: 'OK Computer', artist: { name: 'Radiohead' }, playcount: '77', image: [{ '#text': 'https://lastfm/cover.png' }] }] } })],
    [/method=artist\.getinfo&artist=Radiohead&autocorrect=1&username=(\w+)&/i, (url) => json(artistFor(/username=(\w+)/.exec(url)[1]))],
    [/method=artist\.getinfo&artist=radiohead&autocorrect=1&api_key/i, json(artistFor(null))],
    [/method=artist\.getinfo&artist=Nobody/i, json({ error: 6, message: 'The artist you supplied could not be found' }, 404)],
    [/method=tasteometer\.compare/, json({ comparison: { result: { score: '0.734', artists: { artist: [{ name: 'Radiohead' }, { name: 'Muse' }] } } } })],
    [/method=user\.getrecenttracks&user=rj&limit=1&/i, json({ recenttracks: { track: { name: 'Creep', artist: { '#text': 'Radiohead' }, '@attr': { nowplaying: 'true' } } } })],
  ];
  const lastfmAs = (sub, extra = {}) => ask(lastfm, { sub, userId: 'me', ...extra });
  out = await lastfmAs('topalbums');
  assert.match(out.text, /Top albums of rj/); assert.match(out.text, /OK Computer\*\* — Radiohead · 77 plays/); assert.match(out.text, /cover\.png/);
  out = await lastfmAs('artist', { strings: { name: 'Radiohead' } });
  assert.match(out.text, /5,000,000/); assert.match(out.text, /Your plays\*\* 812/); assert.match(out.text, /`alternative`/); assert.match(out.text, /Muse, Thom Yorke/); assert.match(out.text, /Radiohead are an English rock band\./); assert.doesNotMatch(out.text, /Read more/);
  out = await ask(lastfm, { sub: 'artist', userId: 'nolink', strings: { name: 'radiohead' } });
  assert.doesNotMatch(out.text, /Your plays/, 'a person without a linked name has no plays to show');
  out = await lastfmAs('artist', { strings: { name: 'Nobody' } });
  assert.match(out.text, /Nothing found on Last\.fm/);
  out = await lastfmAs('compare', { users: { user: { id: 'other', username: 'bob' } } });
  assert.match(out.text, /rj and bob/); assert.match(out.text, /\*\*73%\*\*/); assert.match(out.text, /▰▰▰▰▰▰▰▱▱▱/); assert.match(out.text, /Radiohead, Muse/);
  out = await lastfmAs('compare', { users: { user: { id: 'stranger', username: 'ana', displayName: 'Ana' } } });
  assert.match(out.text, /Ana has not linked/);
  out = await ask(lastfm, { sub: 'compare', userId: 'nolink', users: { user: { id: 'other', username: 'bob' } } });
  assert.match(out.text, /You have not linked/);
  links.set('twin', 'RJ');
  out = await lastfmAs('compare', { users: { user: { id: 'twin', username: 't' } } });
  assert.match(out.text, /your own Last\.fm name/);
  const guild = { members: { cache: new Map(['me', 'other', 'm3', 'm4', 'nolink'].map((id) => [id, {}])) } };
  out = await lastfmAs('whoknows', { guild, strings: { artist: 'Radiohead' } });
  assert.ok(out.text.indexOf('<@me>') < out.text.indexOf('<@m4>') && out.text.indexOf('<@m4>') < out.text.indexOf('<@other>'), 'the biggest listener first');
  assert.match(out.text, /812 plays/); assert.doesNotMatch(out.text, /<@m3>/, 'someone with no plays is not listed'); assert.doesNotMatch(out.text, /<@outsider>/, 'nor someone who is not in this server');
  out = await lastfmAs('whoknows', { guild });
  assert.match(out.text, /Who listens to Radiohead here/, 'with no artist it is the one that is playing');
  out = await lastfmAs('whoknows', { guild: { members: { cache: new Map([['nolink', {}]]) } }, strings: { artist: 'Radiohead' } });
  assert.match(out.text, /Nobody in this server has linked/);
  out = await lastfmAs('whoknows', { strings: { artist: 'Radiohead' } });
  assert.match(out.text, /only works in a server/);
  config.lastfmApiKey = null;

  // --- Deezer --------------------------------------------------------------------------------------------------------------------------------
  assert.equal(await typed(deezer, 'creep radiohead'), 'track'); assert.equal(await typed(deezer, 'band radiohead'), 'artist');
  const track = (n, name) => ({ title: name, link: `https://www.deezer.com/track/${n}`, duration: 238, rank: 978547, preview: `https://cdn/p${n}.mp3`, explicit_lyrics: n === 1, artist: { name: 'Radiohead' }, album: { title: 'Pablo Honey', cover_xl: 'https://cdn/cover.jpg' } });
  routes = [
    [/api\.deezer\.com\/search\/track\?q=creep%20radiohead&limit=5$/, json({ data: [track(1, 'Creep'), track(2, 'Creep (Acoustic)'), track(3, 'Creep (Live)')] })],
    [/api\.deezer\.com\/search\/artist/, json({ data: [{ id: 399, name: 'Radiohead' }] })],
    [/api\.deezer\.com\/artist\/399$/, json({ id: 399, name: 'Radiohead', picture_xl: 'https://cdn/a.jpg', nb_fan: 6000000, nb_album: 40, link: 'https://www.deezer.com/artist/399' })],
    [/api\.deezer\.com\/artist\/399\/top\?limit=5$/, json({ data: [track(1, 'Creep'), track(4, 'Karma Police')] })],
    [/api\.deezer\.com\/search\/album/, json({ data: [{ id: 7 }] })],
    [/api\.deezer\.com\/album\/7$/, json({ id: 7, title: 'OK Computer', link: 'https://www.deezer.com/album/7', cover_xl: 'https://cdn/ok.jpg', release_date: '1997-05-21', label: 'Parlophone', duration: 3200, fans: 900000, nb_tracks: 12, artist: { name: 'Radiohead' }, genres: { data: [{ name: 'Alternative' }] }, tracks: { data: [{ title: 'Airbag', duration: 284 }, { title: 'Paranoid Android', duration: 383 }] } })],
    [/api\.deezer\.com\/search\/track\?q=nothing/, json({ data: [] })],
    [/api\.deezer\.com\/search\/track\?q=broken/, json({ error: { type: 'Exception', code: 4 } })],
  ];
  out = await ask(deezer, { sub: 'track', strings: { query: 'creep radiohead' } });
  assert.match(out.text, /"description":"Creep"/, 'the title is on the picture'); assert.equal(out.payload.files.length, 1); assert.ok(coversAsked.includes('https://cdn/cover.jpg'), 'the cover of the album is drawn'); assert.match(out.text, /3:58/); assert.match(out.text, /978,547/); assert.match(out.text, /Creep \(Acoustic\)/); assert.match(out.text, /Explicit lyrics/);
  assert.ok(buttonsOf(out.payload).some((button) => button.url === 'https://cdn/p1.mp3'), 'the 30 second preview'); assert.ok(buttonsOf(out.payload).some((button) => button.url === 'https://www.deezer.com/track/1'));
  out = await ask(deezer, { sub: 'artist', strings: { query: 'radiohead' } });
  assert.match(out.text, /"description":"Radiohead"/); assert.match(out.text, /6,000,000/); assert.match(out.text, /Karma Police/); assert.ok(coversAsked.includes('https://cdn/a.jpg'), 'the photo of the artist');
  out = await ask(deezer, { sub: 'album', strings: { query: 'ok computer' } });
  assert.match(out.text, /Parlophone/); assert.match(out.text, /Alternative/); assert.match(out.text, /Paranoid Android · 6:23/); assert.match(out.text, /and 10 more/); assert.match(out.text, /Tracks \(12\)/);
  out = await ask(deezer, { sub: 'track', strings: { query: 'nothing' } });
  assert.match(out.text, /Nothing found on Deezer/);
  out = await ask(deezer, { sub: 'track', strings: { query: 'broken' } });
  assert.match(out.text, /not answering/, 'an error of Deezer');

  // --- Apple ---------------------------------------------------------------------------------------------------------------------------------
  assert.equal(await typed(itunes, 'creep'), 'song'); assert.equal(await typed(itunes, 'app minecraft'), 'app');
  const song = (n) => ({ trackName: `Creep ${n}`, artistName: 'Radiohead', collectionName: 'Pablo Honey', trackViewUrl: `https://music.apple.com/t/${n}`, previewUrl: `https://audio/p${n}.m4a`, artworkUrl100: 'https://is1/x/100x100bb.jpg', primaryGenreName: 'Alternative', releaseDate: '1993-02-22T08:00:00Z', trackTimeMillis: 238000, trackExplicitness: 'explicit' });
  routes = [
    [/itunes\.apple\.com\/search\?.*entity=song/, json({ resultCount: 2, results: [song(1), song(2)] })],
    [/itunes\.apple\.com\/search\?.*entity=album/, json({ results: [{ collectionName: 'OK Computer', artistName: 'Radiohead', collectionViewUrl: 'https://music.apple.com/a/1', artworkUrl100: 'https://is1/x/100x100bb.jpg', releaseDate: '1997-05-21T07:00:00Z', primaryGenreName: 'Alternative', trackCount: 12, collectionExplicitness: 'notExplicit' }] })],
    [/itunes\.apple\.com\/search\?.*entity=musicArtist/, json({ results: [{ artistName: 'Radiohead', primaryGenreName: 'Alternative', artistLinkUrl: 'https://music.apple.com/ar/1' }, { artistName: 'Radiohead Tribute' }] })],
    [/itunes\.apple\.com\/search\?.*entity=software/, json({ results: [{ trackName: 'Minecraft', sellerName: 'Mojang', description: '<b>Build</b> and explore', artworkUrl512: 'https://is1/app.png', averageUserRating: 4.54321, userRatingCount: 123456, formattedPrice: '$6.99', primaryGenreName: 'Games', version: '1.21', contentAdvisoryRating: '9+', currentVersionReleaseDate: '2026-10-01T00:00:00Z', trackViewUrl: 'https://apps.apple.com/app/1' }] })],
    [/itunes\.apple\.com\/search\?.*entity=podcast/, json({ results: [{ collectionName: 'The Podcast', artistName: 'Host', artworkUrl600: 'https://is1/pod.jpg', primaryGenreName: 'Comedy', trackCount: 250, releaseDate: '2026-10-20T00:00:00Z', collectionViewUrl: 'https://podcasts.apple.com/p/1' }] })],
  ];
  routes.unshift([/itunes\.apple\.com\/search\?.*term=nothing/, json({ resultCount: 0, results: [] })]);
  out = await ask(itunes, { sub: 'song', strings: { query: 'creep' } });
  assert.match(out.text, /"description":"Creep 1"/); assert.match(out.text, /3:58/); assert.ok(coversAsked.includes('https://is1/x/600x600bb.jpg'), 'the big cover'); assert.equal(out.payload.files.length, 1); assert.match(out.text, /Creep 2/); assert.ok(buttonsOf(out.payload).some((button) => button.url.includes('p1.m4a')));
  out = await ask(itunes, { sub: 'album', strings: { query: 'ok computer' } });
  assert.match(out.text, /"description":"OK Computer"/); assert.match(out.text, /12/);
  out = await ask(itunes, { sub: 'artist', strings: { query: 'radiohead' } });
  assert.match(out.text, /Radiohead Tribute/);
  out = await ask(itunes, { sub: 'app', strings: { query: 'minecraft' } });
  assert.match(out.text, /4\.5 ★ \(123,456\)/); assert.match(out.text, /\$6\.99/); assert.match(out.text, /Build and explore/); assert.match(out.text, /9\+/);
  out = await ask(itunes, { sub: 'podcast', strings: { query: 'the podcast' } });
  assert.match(out.text, /250/); assert.match(out.text, /Comedy/);
  out = await ask(itunes, { sub: 'song', strings: { query: 'nothing' } });
  assert.match(out.text, /Nothing found on Apple/);

  // --- Wikipedia -----------------------------------------------------------------------------------------------------------------------------
  routes = [
    [/en\.wikipedia\.org\/w\/rest\.php\/v1\/search\/title\?q=minecraft&limit=1$/i, json({ pages: [{ key: 'Minecraft', title: 'Minecraft' }] })],
    [/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Minecraft$/, json({ title: 'Minecraft', description: 'Sandbox video game', extract: 'Minecraft is a sandbox video game developed by Mojang Studios.', thumbnail: { source: 'https://upload/mc.png' }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Minecraft' } }, timestamp: '2026-10-25T02:24:54Z', type: 'standard' })],
    [/es\.wikipedia\.org\/w\/rest\.php\/v1\/search\/title\?q=mercurio/, json({ pages: [{ key: 'Mercurio' }] })],
    [/es\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Mercurio$/, json({ title: 'Mercurio', extract: 'Mercurio puede referirse a:', type: 'disambiguation', content_urls: { desktop: { page: 'https://es.wikipedia.org/wiki/Mercurio' } } })],
    [/wikipedia\.org\/w\/rest\.php\/v1\/search\/title\?q=zzzz/, json({ pages: [] })],
    [/en\.wikipedia\.org\/w\/rest\.php\/v1\/search\/title\?q=empty/, json({ pages: [{ key: 'Empty' }] })],
    [/en\.wikipedia\.org\/api\/rest_v1\/page\/summary\/Empty$/, json({ title: 'Empty', extract: '' })],
  ];
  out = await ask(wikipedia, { strings: { query: 'Minecraft' } });
  assert.match(out.text, /Sandbox video game/); assert.match(out.text, /developed by Mojang Studios/); assert.match(out.text, /mc\.png/); assert.match(out.text, /Wikipedia · updated <t:/); assert.match(out.text, /Read the article/);
  out = await ask(wikipedia, { strings: { query: 'mercurio' }, lang: 'es' });
  assert.match(out.text, /Mercurio puede referirse a/); assert.match(out.text, /Hay varios artículos/); assert.match(out.text, /Leer el artículo/); assert.ok(calls.some((call) => new URL(call.url).hostname === 'es.wikipedia.org'), 'the encyclopedia of the language of the server');
  out = await ask(wikipedia, { strings: { query: 'zzzz' } });
  assert.match(out.text, /Nothing found on Wikipedia/);
  out = await ask(wikipedia, { strings: { query: 'empty' } });
  assert.match(out.text, /has no summary to show/);

  // --- AniList -------------------------------------------------------------------------------------------------------------------------------
  assert.equal(anilist.cleanDescription('Hello<br>world ~!a secret!~ <i>end</i>'), 'Hello world end'); assert.equal(anilist.cleanDescription('a <scr<b>ipt>x</scr</b>ipt> b'), 'a x b'); assert.doesNotMatch(anilist.cleanDescription('1 < 2 > 0 <script'), /[<>]/); assert.ok(anilist.cleanDescription('x'.repeat(900)).length <= 450);
  assert.equal(await typed(anilist, 'frieren'), 'anime'); assert.equal(await typed(anilist, 'char Frieren'), 'character');
  const media = (extra = {}) => ({ id: 1, title: { romaji: 'Sousou no Frieren', english: 'Frieren: Beyond Journey\'s End' }, format: 'TV', status: 'FINISHED', episodes: 28, chapters: 140, volumes: 14, averageScore: 91, genres: ['Adventure', 'Fantasy'], startDate: { year: 2023, month: 9, day: 29 }, description: 'An elf <br>goes on a journey. ~!She dies!~', coverImage: { extraLarge: 'https://s4/cover.png' }, bannerImage: 'https://s4/banner.png', siteUrl: 'https://anilist.co/anime/1', isAdult: false, studios: { nodes: [{ name: 'Madhouse' }] }, ...extra });
  let mediaAnswer = media();
  routes = [
    [/graphql\.anilist\.co$/, (url, init) => {
      const body = JSON.parse(init.body);
      assert.equal(init.method, 'POST'); assert.equal(init.headers['Content-Type'], 'application/json');
      if (body.query.includes('Character(')) return body.variables.search === 'Nobody' ? json({ errors: [{ status: 404, message: 'Not Found.' }], data: { Character: null } }, 404) : json({ data: { Character: { name: { full: 'Frieren', native: 'フリーレン' }, image: { large: 'https://s4/char.png' }, description: 'An elf mage.', gender: 'Female', age: '1000+', dateOfBirth: { month: 2, day: 14 }, favourites: 5000, siteUrl: 'https://anilist.co/character/1', media: { nodes: [{ title: { english: 'Frieren' } }] } } } });
      assert.equal(body.variables.type, body.query.includes('type: $type') ? body.variables.type : body.variables.type);
      return body.variables.search === 'Nobody' ? json({ errors: [{ status: 404, message: 'Not Found.' }], data: { Media: null } }, 404) : json({ data: { Media: mediaAnswer } });
    }],
  ];
  out = await ask(anilist, { sub: 'anime', strings: { title: 'Frieren' } });
  assert.match(out.text, /Frieren: Beyond Journey/); assert.match(out.text, /91\/100/); assert.match(out.text, /Finished/); assert.match(out.text, /\*\*Episodes\*\* 28/); assert.match(out.text, /Madhouse/); assert.match(out.text, /2023-9-29/); assert.match(out.text, /An elf goes on a journey\./); assert.doesNotMatch(out.text, /She dies/, 'spoilers are cut');
  out = await ask(anilist, { sub: 'manga', strings: { title: 'Frieren' } });
  assert.match(out.text, /Chapters\*\* 140/); assert.doesNotMatch(out.text, /Episodes/);
  out = await ask(anilist, { sub: 'character', strings: { name: 'Frieren' } });
  assert.match(out.text, /フリーレン/); assert.match(out.text, /14\/2/); assert.match(out.text, /5,000/); assert.match(out.text, /char\.png/);
  out = await ask(anilist, { sub: 'anime', strings: { title: 'Nobody' } });
  assert.match(out.text, /Nothing found on AniList/);
  mediaAnswer = media({ isAdult: true });
  out = await ask(anilist, { sub: 'anime', strings: { title: 'Frieren' }, nsfw: false });
  assert.match(out.text, /for adults/); assert.doesNotMatch(out.text, /Madhouse/);
  out = await ask(anilist, { sub: 'anime', strings: { title: 'Frieren' }, nsfw: true });
  assert.match(out.text, /Madhouse/, 'an age-restricted channel may see it');

  // --- Pokémon -------------------------------------------------------------------------------------------------------------------------------
  assert.equal(pokemon.parsePokemon('Mr. Mime'), 'mr-mime'); assert.equal(pokemon.parsePokemon('#25'), '25'); assert.equal(pokemon.parsePokemon('Farfetch\'d'), 'farfetchd'); assert.equal(pokemon.parsePokemon('a/b'), null); assert.equal(pokemon.parsePokemon(''), null);
  routes = [
    [/pokeapi\.co\/api\/v2\/pokemon\/(pikachu|25)$/, json({ id: 25, name: 'pikachu', height: 4, weight: 60, types: [{ type: { name: 'electric' } }], abilities: [{ ability: { name: 'static' }, is_hidden: false }, { ability: { name: 'lightning-rod' }, is_hidden: true }], stats: [{ base_stat: 35, stat: { name: 'hp' } }, { base_stat: 90, stat: { name: 'speed' } }], sprites: { other: { 'official-artwork': { front_default: 'https://sprites/25.png' } } }, species: { name: 'pikachu', url: 'https://pokeapi.co/api/v2/pokemon-species/25/' } })],
    [/pokeapi\.co\/api\/v2\/pokemon-species\/25\/?$/, json({ genera: [{ genus: 'Mouse Pokémon', language: { name: 'en' } }, { genus: 'Pokémon Ratón', language: { name: 'es' } }], flavor_text_entries: [{ flavor_text: 'When several of\nthese gather.', language: { name: 'en' } }, { flavor_text: 'Cuando varios\fse juntan.', language: { name: 'es' } }], is_legendary: false, is_mythical: false })],
  ];
  out = await ask(pokemon, { strings: { pokemon: 'Pikachu' } });
  assert.match(out.text, /#25 Pikachu/); assert.match(out.text, /Mouse Pokémon/); assert.match(out.text, /When several of these gather\./); assert.match(out.text, /`Electric`/); assert.match(out.text, /0\.4 m/); assert.match(out.text, /6\.0 kg/); assert.match(out.text, /Lightning Rod \(hidden\)/); assert.match(out.text, /Base stats \(total 125\)/); assert.match(out.text, /`HP    ` ▰▱▱▱▱▱▱▱▱▱ 35/); assert.match(out.text, /25\.png/);
  out = await ask(pokemon, { strings: { pokemon: '25' }, lang: 'es' });
  assert.match(out.text, /Pokémon Ratón/); assert.match(out.text, /Cuando varios se juntan/);
  out = await ask(pokemon, { strings: { pokemon: 'notapokemon' } });
  assert.match(out.text, /Nothing found on PokéAPI/);

  // --- npm and PyPI ---------------------------------------------------------------------------------------------------------------------------
  assert.equal(pkg.parseNpm('discord.js'), 'discord.js'); assert.equal(pkg.parseNpm('@napi-rs/canvas'), '@napi-rs/canvas'); assert.equal(pkg.parseNpm('https://www.npmjs.com/package/@napi-rs/canvas/v/1.0.13'), '@napi-rs/canvas'); assert.equal(pkg.parseNpm('bad name'), null); assert.equal(pkg.parseNpm('-x'), null);
  assert.equal(pkg.parsePypi('requests'), 'requests'); assert.equal(pkg.parsePypi('https://pypi.org/project/requests/2.0/'), 'requests'); assert.equal(pkg.parsePypi('a b'), null);
  assert.equal(pkg.repositoryLink('git+https://github.com/discordjs/discord.js.git'), 'https://github.com/discordjs/discord.js'); assert.equal(pkg.repositoryLink({ url: 'git@gitlab.com:a/b.git' }), 'https://gitlab.com/a/b'); assert.equal(pkg.repositoryLink('https://example.com/x'), null);
  assert.equal(await typed(pkg, 'discord.js'), 'npm'); assert.equal(await typed(pkg, 'py requests'), 'pypi');
  routes = [
    [/registry\.npmjs\.org\/@napi-rs%2fcanvas\/latest$/, json({ name: '@napi-rs/canvas', version: '1.0.13', description: 'Canvas for Node', license: 'MIT', repository: { url: 'git+https://github.com/Brooooooklyn/canvas.git' }, keywords: ['canvas', 'skia'], dependencies: { a: '1', b: '2' }, dist: { unpackedSize: 2048000 } })],
    [/api\.npmjs\.org\/downloads\/point\/last-week\/@napi-rs\/canvas$/, json({ downloads: 860596 })],
    [/registry\.npmjs\.org\/nopackage\/latest$/, json({}, 404)],
    [/pypi\.org\/pypi\/requests\/json$/, json({ info: { name: 'requests', version: '2.32.0', summary: 'Python HTTP for Humans.', license: 'Apache-2.0', requires_python: '>=3.8', author: 'Kenneth Reitz', package_url: 'https://pypi.org/project/requests/', project_urls: { Source: 'https://github.com/psf/requests' } }, releases: { '2.31.0': [], '2.32.0': [] }, urls: [{ upload_time_iso_8601: '2026-05-01T00:00:00Z' }] })],
    [/pypi\.org\/pypi\/nothing\/json$/, json({}, 404)],
  ];
  out = await ask(pkg, { sub: 'npm', strings: { package: '@napi-rs/canvas' } });
  assert.match(out.text, /@napi-rs\/canvas 1\.0\.13/); assert.match(out.text, /860,596/); assert.match(out.text, /MIT/); assert.match(out.text, /2,000 kB/); assert.match(out.text, /npm i @napi-rs\/canvas/); assert.ok(buttonsOf(out.payload).some((button) => button.url === 'https://github.com/Brooooooklyn/canvas'));
  out = await ask(pkg, { sub: 'npm', strings: { package: 'nopackage' } });
  assert.match(out.text, /Nothing found on npm/);
  out = await ask(pkg, { sub: 'pypi', strings: { package: 'requests' } });
  assert.match(out.text, /requests 2\.32\.0/); assert.match(out.text, /Apache-2\.0/); assert.match(out.text, /Kenneth Reitz/); assert.match(out.text, /pip install requests/); assert.match(out.text, /\*\*Versions\*\* 2/); assert.ok(buttonsOf(out.payload).some((button) => button.url === 'https://github.com/psf/requests'));
  out = await ask(pkg, { sub: 'pypi', strings: { package: 'nothing' } });
  assert.match(out.text, /Nothing found on PyPI/);

  // --- TMDB ----------------------------------------------------------------------------------------------------------------------------------
  out = await ask(tmdb, { sub: 'movie', strings: { title: 'Interstellar' } });
  assert.match(out.text, /not set up/);
  assert.equal(await typed(tmdb, 'interstellar'), 'movie'); assert.equal(await typed(tmdb, 'show dark'), 'tv');
  routes = [
    [/api\.themoviedb\.org\/3\/search\/movie\?/, (url, init) => json({ results: url.includes('query=Nothing') ? [] : [{ id: 157336 }] })],
    [/api\.themoviedb\.org\/3\/movie\/157336\?/, json({ id: 157336, title: 'Interstellar', original_title: 'Interstellar', tagline: 'Mankind was born on Earth.', overview: 'A team of explorers travel through a wormhole.', release_date: '2014-11-05', runtime: 169, vote_average: 8.4321, vote_count: 35000, genres: [{ name: 'Adventure' }, { name: 'Science Fiction' }], poster_path: '/poster.jpg', backdrop_path: '/back.jpg' })],
    [/api\.themoviedb\.org\/3\/search\/tv\?/, json({ results: [{ id: 70523 }] })],
    [/api\.themoviedb\.org\/3\/tv\/70523\?/, json({ id: 70523, name: 'Dark', original_name: 'Dark', overview: 'A missing child.', first_air_date: '2017-12-01', episode_run_time: [60], number_of_seasons: 3, number_of_episodes: 26, status: 'Ended', networks: [{ name: 'Netflix' }], vote_average: 8.4, vote_count: 6000, genres: [{ name: 'Drama' }], poster_path: '/dp.jpg' })],
  ];
  config.tmdbApiKey = 'abc123v3key';
  out = await ask(tmdb, { sub: 'movie', strings: { title: 'Interstellar' } });
  assert.match(out.text, /Interstellar/); assert.match(out.text, /8\.4\/10 \(35,000\)/); assert.match(out.text, /169 min/); assert.match(out.text, /Science Fiction/); assert.match(out.text, /Mankind was born on Earth/); assert.match(out.text, /w342\/poster\.jpg/); assert.match(out.text, /w780\/back\.jpg/); assert.match(out.text, /themoviedb\.org\/movie\/157336/);
  assert.ok(calls.some((call) => call.url.includes('api_key=abc123v3key') && call.url.includes('language=en-US')), 'a v3 key goes in the address');
  out = await ask(tmdb, { sub: 'movie', strings: { title: 'Interstellar' }, lang: 'es' });
  assert.ok(calls.some((call) => call.url.includes('language=es-MX')), 'asked in the language of the server');
  out = await ask(tmdb, { sub: 'tv', strings: { title: 'Dark' } });
  assert.match(out.text, /3 · 26 episodes/); assert.match(out.text, /Netflix/); assert.match(out.text, /Ended/); assert.match(out.text, /60 min/);
  out = await ask(tmdb, { sub: 'movie', strings: { title: 'Nothing' } });
  assert.match(out.text, /Nothing found on TMDB/);
  const token = 'e'.repeat(60);
  config.tmdbApiKey = token;
  calls.length = 0;
  routes.unshift([/api\.themoviedb\.org\/3\/search\/movie\?/, (url, init) => { assert.equal(init.headers.Authorization, `Bearer ${token}`); assert.doesNotMatch(url, /api_key/); return json({ results: [{ id: 157336 }] }); }]);
  out = await ask(tmdb, { sub: 'movie', strings: { title: 'Interstellar' } });
  assert.match(out.text, /Interstellar/, 'a v4 token goes in a header and never in the address');
  config.tmdbApiKey = null;


  // --- Chess ---------------------------------------------------------------------------------------------------------------------------------
  assert.equal(chess.parsePlayer('Hikaru'), 'Hikaru'); assert.equal(chess.parsePlayer('https://www.chess.com/member/hikaru'), 'hikaru'); assert.equal(chess.parsePlayer('https://lichess.org/@/DrNykterstein'), 'DrNykterstein'); assert.equal(chess.parsePlayer('a'), null); assert.equal(chess.parsePlayer('bad name'), null);
  assert.equal(chess.flagOf('us'), '🇺🇸'); assert.equal(chess.flagOf('x'), '');
  assert.equal(await typed(chess, 'hikaru'), 'chesscom'); assert.equal(await typed(chess, 'li DrNykterstein'), 'lichess');
  routes = [
    [/api\.chess\.com\/pub\/player\/hikaru\/stats$/, json({ chess_rapid: { last: { rating: 2838 } }, chess_blitz: { last: { rating: 3470 } }, chess_bullet: { last: { rating: 3397 } }, tactics: { highest: { rating: 2730 } }, fide: 2814 })],
    [/api\.chess\.com\/pub\/player\/hikaru$/, json({ username: 'hikaru', name: 'Hikaru Nakamura', title: 'GM', avatar: 'https://images/a.png', url: 'https://www.chess.com/member/Hikaru', followers: 1419989, country: 'https://api.chess.com/pub/country/US', joined: 1389043258, last_online: 1792968511, league: 'Legend', is_streamer: true })],
    [/lichess\.org\/api\/user\/DrNykterstein$/, json({ id: 'drnykterstein', username: 'DrNykterstein', title: 'GM', perfs: { ultraBullet: { rating: 2406, games: 5 }, bullet: { rating: 3263, games: 4000 }, blitz: { rating: 3194, games: 3000 }, rapid: { rating: 2500, games: 0 } }, count: { all: 10455, win: 7212, loss: 2409, draw: 834 }, createdAt: 1544100290814, seenAt: 1792000750356, url: 'https://lichess.org/@/DrNykterstein' })],
    [/lichess\.org\/api\/user\/Closed$/, json({ id: 'closed', username: 'Closed', closed: true })],
  ];
  out = await ask(chess, { sub: 'chesscom', strings: { player: 'Hikaru' } });
  assert.match(out.text, /GM Hikaru Nakamura 🇺🇸/); assert.match(out.text, /Blitz\*\* 3,470/); assert.match(out.text, /Rapid\*\* 2,838/); assert.match(out.text, /FIDE\*\* 2,814/); assert.match(out.text, /1,419,989/); assert.match(out.text, /Legend/); assert.match(out.text, /streams/);
  out = await ask(chess, { sub: 'lichess', strings: { player: 'DrNykterstein' } });
  assert.ok(out.text.indexOf('Bullet') < out.text.indexOf('Blitz'), 'the mode played most first'); assert.doesNotMatch(out.text, /Rapid\*\*/, 'a mode never played is not shown'); assert.match(out.text, /10,455 \(7,212 wins · 834 draws · 2,409 losses\)/);
  out = await ask(chess, { sub: 'lichess', strings: { player: 'Closed' } });
  assert.match(out.text, /Nothing found on Lichess/);
  out = await ask(chess, { sub: 'chesscom', strings: { player: 'nobodyhere' } });
  assert.match(out.text, /Nothing found on Chess\.com/);

  // --- Modrinth ------------------------------------------------------------------------------------------------------------------------------
  routes = [
    [/api\.modrinth\.com\/v2\/search\?query=sodium&limit=1$/, json({ hits: [{ slug: 'sodium', title: 'Sodium', description: 'A performance-focused rendering engine.', downloads: 254921362, follows: 42176, icon_url: 'https://cdn/icon.webp', project_type: 'mod', display_categories: ['fabric', 'optimization'], author: 'jellysquid3', versions: ['1.20', '1.21', '1.21.1', '1.21.2', '1.21.3'], client_side: 'required', server_side: 'unsupported', date_modified: '2026-10-15T17:51:36Z', gallery: ['https://cdn/g.webp'] }] })],
    [/api\.modrinth\.com\/v2\/search\?query=bsl&limit=1&facets=%5B%5B%22project_type%3Ashader%22%5D%5D$/, json({ hits: [{ slug: 'bsl-shaders', title: 'BSL Shaders', description: 'Shaders.', downloads: 5, follows: 1, project_type: 'shader', versions: ['1.21'], client_side: 'required', server_side: 'unsupported' }] })],
    [/api\.modrinth\.com\/v2\/search\?query=nothing/, json({ hits: [] })],
  ];
  out = await ask(modrinth, { strings: { query: 'sodium' } });
  assert.match(out.text, /Sodium/); assert.match(out.text, /254,921,362/); assert.match(out.text, /`1\.21\.3` `1\.21\.2` `1\.21\.1` `1\.21`/); assert.match(out.text, /Client\*\* Required/); assert.match(out.text, /Server\*\* Not supported/); assert.ok(buttonsOf(out.payload).some((button) => button.url === 'https://modrinth.com/mod/sodium'));
  out = await ask(modrinth, { strings: { query: 'shader bsl' } });
  assert.match(out.text, /BSL Shaders/); assert.match(out.text, /Shader/); assert.ok(buttonsOf(out.payload).some((button) => button.url === 'https://modrinth.com/shader/bsl-shaders'));
  out = await ask(modrinth, { strings: { query: 'nothing here' } });
  assert.match(out.text, /Nothing found on Modrinth/);

  // --- Crypto --------------------------------------------------------------------------------------------------------------------------------
  assert.equal(crypto.dollars('en', 67234.5), '$67,234.5'); assert.equal(crypto.dollars('en', 1), '$1'); assert.equal(crypto.dollars('en', 0.0000123), '$0.0000123'); assert.equal(crypto.dollars('en', 0.5), '$0.5');
  routes = [
    [/api\.coingecko\.com\/api\/v3\/search\?query=bitcoin$/, json({ coins: [{ id: 'bitcoin', name: 'Bitcoin', symbol: 'BTC' }] })],
    [/api\.coingecko\.com\/api\/v3\/search\?query=dumpcoin$/, json({ coins: [{ id: 'dumpcoin' }] })],
    [/coins\/markets\?vs_currency=usd&ids=bitcoin&/, json([{ id: 'bitcoin', symbol: 'btc', name: 'Bitcoin', image: 'https://cg/b.png', current_price: 67234.5, market_cap: 1330000000000, market_cap_rank: 1, total_volume: 30000000000, high_24h: 68000, low_24h: 66000, price_change_percentage_24h: 2.345, ath: 73000, ath_date: '2024-03-14T00:00:00Z', circulating_supply: 19700000.4, last_updated: '2026-10-26T00:00:00Z' }])],
    [/coins\/markets\?vs_currency=usd&ids=dumpcoin&/, json([{ id: 'dumpcoin', symbol: 'dmp', name: 'Dump', current_price: 0.000051, price_change_percentage_24h: -12.5 }])],
    [/api\.coingecko\.com\/api\/v3\/search\?query=limited$/, json({}, 429)],
    [/api\.coingecko\.com\/api\/v3\/search\?query=nothing$/, json({ coins: [] })],
  ];
  out = await ask(crypto, { strings: { coin: 'bitcoin' } });
  assert.match(out.text, /Bitcoin \(BTC\)/); assert.match(out.text, /\*\*\$67,234\.5\*\* ▲ 2\.35%/); assert.match(out.text, /#1/); assert.match(out.text, /\$1,330,000,000,000/); assert.match(out.text, /\$66,000 – \$68,000/); assert.match(out.text, /coingecko\.com\/en\/coins\/bitcoin/);
  out = await ask(crypto, { strings: { coin: 'dumpcoin' } });
  assert.match(out.text, /\$0\.000051\*\* ▼ 12\.50%/); assert.doesNotMatch(out.text, /Rank/, 'a coin with no rank shows none');
  out = await ask(crypto, { strings: { coin: 'limited' } });
  assert.match(out.text, /too many requests/);
  out = await ask(crypto, { strings: { coin: 'nothing' } });
  assert.match(out.text, /Nothing found on CoinGecko/);

  // --- Currency ------------------------------------------------------------------------------------------------------------------------------
  assert.deepEqual(currency.parseConversion('100 usd cop'), { amount: 100, from: 'USD', to: ['COP'] });
  assert.deepEqual(currency.parseConversion('1,5 eur to mxn brl'), { amount: 1.5, from: 'EUR', to: ['MXN', 'BRL'] });
  assert.deepEqual(currency.parseConversion('usd'), { amount: 1, from: 'USD', to: ['EUR', 'COP', 'MXN'] });
  assert.deepEqual(currency.parseConversion('50 cop -> usd'), { amount: 50, from: 'COP', to: ['USD'] });
  assert.deepEqual(currency.parseConversion('10 usd usd eur'), { amount: 10, from: 'USD', to: ['EUR'] }, 'the same currency and repeats are dropped');
  assert.equal(currency.parseConversion('0 usd cop'), null); assert.equal(currency.parseConversion('hello world'), null); assert.equal(currency.parseConversion(''), null); assert.equal(currency.parseConversion('100 us cop'), null);
  routes = [
    [/open\.er-api\.com\/v6\/latest\/USD$/, json({ result: 'success', time_last_update_unix: 1792900000, base_code: 'USD', rates: { USD: 1, COP: 3170.487231, EUR: 0.89213, MXN: 18.723111 } })],
    [/open\.er-api\.com\/v6\/latest\/ZZZ$/, json({ result: 'error', 'error-type': 'unsupported-code' })],
  ];
  out = await ask(currency, { strings: { conversion: '100 usd cop eur' } });
  assert.match(out.text, /100 USD/); assert.match(out.text, /COP\*\* 317,048\.72/); assert.match(out.text, /EUR\*\* 89\.213/); assert.match(out.text, /Rates updated <t:/); assert.ok(buttonsOf(out.payload).some((button) => button.url === 'https://www.exchangerate-api.com'), 'the provider is credited');
  out = await ask(currency, { strings: { conversion: '100 usd xyz' } });
  assert.match(out.text, /Nothing found on ExchangeRate-API/);
  out = await ask(currency, { strings: { conversion: '100 zzz cop' } });
  assert.match(out.text, /Nothing found on ExchangeRate-API/);
  out = await ask(currency, { strings: { conversion: 'what is this' } });
  assert.match(out.text, /does not look right/);
  assert.equal(await typed(currency, '100 usd cop'), null, 'a command with no subcommands is typed as it is');

  // --- Animals -------------------------------------------------------------------------------------------------------------------------------
  assert.equal(await typed(animal, 'gato'), 'cat'); assert.equal(await typed(animal, 'perro'), 'dog');
  routes = [
    [/thecatapi\.com\/v1\/images\/search$/, json([{ id: 'x', url: 'https://cdn2.thecatapi.com/images/x.jpg', width: 500, height: 400 }])],
    [/dog\.ceo\/api\/breeds\/image\/random$/, json({ message: 'https://images.dog.ceo/breeds/spitz-japanese/tofu.jpg', status: 'success' })],
    [/randomfox\.ca\/floof\/$/, json({ image: 'http://insecure.example/fox.jpg', link: 'https://randomfox.ca' })],
  ];
  out = await ask(animal, { sub: 'cat' });
  assert.match(out.text, /A cat/); assert.match(out.text, /thecatapi\.com\/images\/x\.jpg/);
  out = await ask(animal, { sub: 'dog' });
  assert.match(out.text, /A dog/); assert.match(out.text, /tofu\.jpg/);
  out = await ask(animal, { sub: 'fox' });
  assert.match(out.text, /not answering/, 'a picture that is not https is not used');

  // --- nothing was reported as an error ------------------------------------------------------------------------------------------------------
  assert.equal(logged.length, 0, `nothing was logged as a bug: ${JSON.stringify(logged).slice(0, 300)}`);
  console.log('More integrations checks passed.');
})().catch((error) => { console.error(error); process.exit(1); });
