// Checks the lookup commands (/minecraft, /github, /roblox, /steam, /twitch, /youtube, /lastfm): what each one understands from what is typed,
// the cards it answers with, and every way a lookup can fail. The services are replaced by a fake fetch; nothing leaves this machine.
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
  setLink: async (id, name) => { links.set(id, name); },
  removeLink: async (id) => links.delete(id),
});

// The covers are not downloaded: a plain square stands for each one.
const { createCanvas } = require('@napi-rs/canvas');
const coversAsked = [];
stub('src/utils/safeImage.js', { loadImageFromLink: async (url) => { coversAsked.push(url); return createCanvas(300, 300); } });
const config = require('../src/config');
const integrations = require('../src/utils/integrations');
const minecraft = require('../src/commands/integrations/minecraft');
const github = require('../src/commands/integrations/github');
const roblox = require('../src/commands/integrations/roblox');
const steam = require('../src/commands/integrations/steam');
const twitch = require('../src/commands/integrations/twitch');
const youtube = require('../src/commands/integrations/youtube');
const lastfm = require('../src/commands/integrations/lastfm');

// --- the fake internet -------------------------------------------------------------------------------------------------------------------
let routes = [];
const calls = [];
const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...headers } });
globalThis.fetch = async (url, init = {}) => {
  calls.push({ url: String(url), init });
  for (const [pattern, handler] of routes) {
    if (pattern.test(String(url))) return typeof handler === 'function' ? handler(String(url), init) : handler.clone(); // a Response can be read once
  }
  return json({}, 404);
};
const called = (pattern) => calls.filter((call) => pattern.test(call.url)).length;

for (const key of ['githubToken', 'lastfmApiKey', 'steamApiKey', 'twitchClientId', 'twitchClientSecret', 'youtubeApiKey']) config[key] = null; // whatever the machine has
let nextUser = 0;
function fake({ sub = null, strings = {}, users = {}, lang = 'en' } = {}) {
  const sent = { replies: [], edits: [], deferred: false };
  return {
    pettoLang: lang,
    user: { id: `user${nextUser += 1}`, username: 'liam' },
    options: { getSubcommand: () => sub, getString: (name, required) => {
      if (strings[name] === undefined && required) { const error = new Error(`missing ${name}`); error.userFacing = true; error.missingOption = name; throw error; }
      return strings[name] ?? null;
    }, getUser: (name) => users[name] ?? null },
    reply: async (payload) => { sent.replies.push(payload); },
    deferReply: async () => { sent.deferred = true; },
    editReply: async (payload) => { sent.edits.push(payload); },
    sent,
  };
}
const textOf = (payload) => JSON.stringify((payload.components ?? []).map((component) => component.toJSON()));
const answerOf = async (command, options) => {
  const interaction = fake(options);
  await command.execute(interaction);
  const payload = interaction.sent.edits.at(-1) ?? interaction.sent.replies.at(-1);
  assert.ok(payload, 'the command answered');
  const text = textOf(payload);
  assert.doesNotMatch(text, /integrations\.[a-z]+\.[a-z]/i, 'no text is missing from the catalog');
  assert.doesNotMatch(text, /undefined|\[object Object\]|NaN/, 'nothing is printed as undefined');
  const card = payload.components[0].toJSON();
  assert.ok(card.accent_color === undefined || [0xa5ea7a, 0xfe6465, 0xfed53c].includes(card.accent_color), 'a card has no color except green, red or yellow');
  return { text, payload, interaction };
};
const red = (text) => /16671844|0xfe6465/i.test(text) || text.includes('"accent_color":16671845') || text.includes('"accent_color":16671844');

(async () => {
  // --- the shared parts ------------------------------------------------------------------------------------------------------------------
  routes = [[/ok$/, json({ a: 1 })], [/gone$/, json({}, 404)], [/slow$/, json({}, 429)], [/broken$/, json({}, 500)], [/nothing$/, new Response(null, { status: 204 })], [/html$/, new Response('<p>', { status: 200 })], [/limit$/, json({}, 403, { 'x-ratelimit-remaining': '0' })]];
  assert.deepEqual(await integrations.fetchJson('https://x.test/ok'), { a: 1 });
  assert.equal(await integrations.fetchJson('https://x.test/nothing'), null, 'a 204 is null');
  assert.equal(await integrations.fetchJson('https://x.test/gone', { ok404: true }), null);
  const kindOf = async (url) => integrations.fetchJson(url).then(() => 'fine', (error) => error.kind);
  assert.equal(await kindOf('https://x.test/gone'), 'notFound');
  assert.equal(await kindOf('https://x.test/slow'), 'rateLimited');
  assert.equal(await kindOf('https://x.test/limit'), 'rateLimited', 'the exhausted limit of GitHub');
  assert.equal(await kindOf('https://x.test/broken'), 'unavailable');
  assert.equal(await kindOf('https://x.test/html'), 'unavailable', 'an answer that is not JSON');
  const original = globalThis.fetch;
  let attempts = 0;
  globalThis.fetch = async () => { attempts += 1; throw new Error('offline'); };
  assert.equal(await kindOf('https://x.test/ok'), 'unavailable', 'no connection');
  assert.equal(attempts, 2, 'a network failure at once is asked again one time');
  assert.match(await integrations.fetchJson('https://x.test/ok').catch((error) => error.message), /unavailable: offline/, 'and the error says why');
  attempts = 0;
  globalThis.fetch = async () => { attempts += 1; throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' }); };
  assert.match(await integrations.fetchJson('https://x.test/ok').catch((error) => error.message), /unavailable: timeout/, 'a timeout is told as such');
  assert.equal(attempts, 1, 'and it is not asked again (it already took its time)');
  globalThis.fetch = async () => { throw Object.assign(new Error('fetch failed'), { cause: { code: 'ENOTFOUND' } }); };
  assert.match(await integrations.fetchJson('https://x.test/ok').catch((error) => error.message), /unavailable: ENOTFOUND/, 'the code of a network error is kept');
  globalThis.fetch = original;
  assert.match(calls.at(0).init.headers['User-Agent'], /Petto/, 'every call says who it is');

  let loads = 0;
  assert.equal(await integrations.cached('k', 1000, async () => { loads += 1; return 7; }), 7);
  assert.equal(await integrations.cached('k', 1000, async () => { loads += 1; return 8; }), 7);
  assert.equal(loads, 1, 'the second one is cached');
  await assert.rejects(integrations.cached('bad', 1000, async () => { throw new Error('x'); }));
  assert.equal(await integrations.cached('bad', 1000, async () => 1), 1, 'a failure is not kept');

  assert.equal(integrations.cooldownLeft('u', 'c', 5000), 0);
  assert.ok(integrations.cooldownLeft('u', 'c', 5000) > 0, 'asking again at once waits');
  assert.equal(integrations.cooldownLeft('other', 'c', 5000), 0, 'another person does not');
  assert.equal(integrations.plain('hi @everyone [x](https://evil.test) `a`').includes('https://'), false);
  assert.match(integrations.plain('*bold* <@1>'), /\\\*bold\\\*/);
  assert.equal(integrations.short('a   b\n c', 10), 'a b c');
  assert.equal(integrations.dateTag('nonsense'), null);

  // A person who asks twice in a row is told to wait, and the service is not called.
  routes = [[/mojang/, json({})]];
  const impatient = fake({ sub: 'user', strings: { player: 'Notch' } });
  await integrations.lookup(impatient, 'en', 'X', async () => ({ components: [] }), { name: 'cd', ms: 60_000 });
  await integrations.lookup(impatient, 'en', 'X', async () => assert.fail('not called'), { name: 'cd', ms: 60_000 });
  assert.match(textOf(impatient.sent.replies.at(-1)), /Wait \d+s/);
  assert.ok(impatient.sent.replies.at(-1).flags & (1 << 6), 'and only they see it');

  // --- Minecraft -------------------------------------------------------------------------------------------------------------------------
  assert.deepEqual(minecraft.parsePlayer('Notch'), { kind: 'name', value: 'Notch' });
  assert.deepEqual(minecraft.parsePlayer('069a79f4-44e9-4726-a5be-fca90e38aaf5'), { kind: 'uuid', value: '069a79f444e94726a5befca90e38aaf5' });
  assert.equal(minecraft.parsePlayer('has space'), null);
  assert.equal(minecraft.parsePlayer('a'.repeat(17)), null, 'names have 16 characters at most');
  const textures = Buffer.from(JSON.stringify({ textures: { SKIN: { url: 'http://textures.minecraft.net/texture/abc', metadata: { model: 'slim' } }, CAPE: { url: 'http://textures.minecraft.net/texture/cape' } } })).toString('base64');
  assert.deepEqual(minecraft.texturesOf({ properties: [{ name: 'textures', value: textures }] }), { skinUrl: 'https://textures.minecraft.net/texture/abc', slim: true, capeUrl: 'https://textures.minecraft.net/texture/cape' });
  assert.deepEqual(minecraft.texturesOf({ properties: [{ name: 'textures', value: '!!!' }] }), { skinUrl: null, slim: false, capeUrl: null });
  assert.deepEqual(minecraft.texturesOf({}), { skinUrl: null, slim: false, capeUrl: null });

  const MC_ID = '069a79f444e94726a5befca90e38aaf5';
  routes = [
    [/api\.mojang\.com\/users\/profiles\/minecraft\/Notch$/, json({ id: MC_ID, name: 'Notch' })],
    [new RegExp(`sessionserver\\.mojang\\.com/session/minecraft/profile/${MC_ID}$`), json({ id: MC_ID, name: 'Notch', properties: [{ name: 'textures', value: textures }] })],
  ];
  let out = await answerOf(minecraft, { sub: 'user', strings: { player: 'Notch' } });
  assert.match(out.text, /069a79f4-44e9-4726-a5be-fca90e38aaf5/, 'the UUID with dashes');
  assert.match(out.text, /Slim/); assert.match(out.text, /mc-heads\.net\/avatar\/069a79f4/); assert.match(out.text, /NameMC/); assert.match(out.text, /Download skin/);
  assert.equal(out.interaction.sent.deferred, true);
  out = await answerOf(minecraft, { sub: 'skin', strings: { player: 'Notch' } });
  assert.match(out.text, /mc-heads\.net\/body\//); assert.match(out.text, /textures\.minecraft\.net\/texture\/abc/);
  out = await answerOf(minecraft, { sub: 'head', strings: { player: 'notch'.replace('n', 'N') } });
  assert.match(out.text, /mc-heads\.net\/head\//);
  const beforeCalls = called(/api\.mojang\.com/);
  await answerOf(minecraft, { sub: 'user', strings: { player: 'Notch' } });
  assert.equal(called(/api\.mojang\.com/), beforeCalls, 'the same player is not asked again for a few minutes');
  out = await answerOf(minecraft, { sub: 'user', strings: { player: MC_ID } });
  assert.match(out.text, /Notch/, 'a UUID works too');
  out = await answerOf(minecraft, { sub: 'user', strings: { player: 'Nobodyhere' } });
  assert.match(out.text, /Nothing found on Minecraft/); assert.ok(out.text.includes('16671844') || out.text.includes('16671845') || /accent_color/.test(out.text), 'red');
  out = await answerOf(minecraft, { sub: 'user', strings: { player: 'bad name!' } });
  assert.match(out.text, /does not look right/);

  // --- GitHub ----------------------------------------------------------------------------------------------------------------------------
  assert.deepEqual(github.parseRepo('PettoBot/petto-bot'), { owner: 'PettoBot', repo: 'petto-bot' });
  assert.deepEqual(github.parseRepo('https://github.com/PettoBot/petto-bot/issues/3'), { owner: 'PettoBot', repo: 'petto-bot' });
  assert.deepEqual(github.parseRepo('https://github.com/a/b.git'), { owner: 'a', repo: 'b' });
  for (const bad of ['petto', '', '/x', 'a/..', 'a b/c', '-a/b']) assert.equal(github.parseRepo(bad), null, bad);
  assert.equal(github.parseUser('@octocat'), 'octocat'); assert.equal(github.parseUser('https://github.com/octocat?tab=x'), 'octocat'); assert.equal(github.parseUser('bad_name'), null);
  assert.equal(github.notesOf('## Fixes\n\n\n\n- a'), 'Fixes\n\n- a', 'headings lose their marks');
  assert.ok(github.notesOf('x'.repeat(900)).length <= 700);

  routes = [
    [/api\.github\.com\/users\/octocat$/, json({ login: 'octocat', name: 'The Octocat', bio: 'Hi @everyone', avatar_url: 'https://a/o.png', html_url: 'https://github.com/octocat', public_repos: 8, followers: 12345, following: 9, created_at: '2011-01-25T18:44:36Z', type: 'User', company: '@github', location: 'SF' })],
    [/api\.github\.com\/repos\/PettoBot\/petto-bot$/, json({ full_name: 'PettoBot/petto-bot', description: 'A bot', html_url: 'https://github.com/PettoBot/petto-bot', stargazers_count: 1500, forks_count: 3, open_issues_count: 2, language: 'JavaScript', license: { spdx_id: 'AGPL-3.0' }, topics: ['discord', 'bot'], pushed_at: '2026-10-20T00:00:00Z', created_at: '2025-01-01T00:00:00Z', archived: true, owner: { avatar_url: 'https://a/p.png' } })],
    [/api\.github\.com\/repos\/PettoBot\/petto-bot\/releases\/latest$/, json({ tag_name: 'v1.2.0', name: 'Big one', html_url: 'https://github.com/x/releases/v1.2.0', published_at: '2026-10-01T00:00:00Z', body: '## New\n- jumbo', prerelease: false, author: { login: 'liam' }, assets: [{ name: 'a.zip', download_count: 4000 }] })],
  ];
  out = await answerOf(github, { sub: 'user', strings: { name: 'octocat' } });
  assert.match(out.text, /The Octocat \(octocat\)/); assert.match(out.text, /12,345/); assert.match(out.text, /Open on GitHub/);
  assert.doesNotMatch(out.text, /Hi @everyone/, 'a mention in a bio is neutralized'); assert.match(out.text, /Hi \\\\@everyone/);
  out = await answerOf(github, { sub: 'repo', strings: { repository: 'https://github.com/PettoBot/petto-bot' } });
  assert.match(out.text, /1,500/); assert.match(out.text, /AGPL-3\.0/); assert.match(out.text, /`discord`/); assert.match(out.text, /archived/);
  out = await answerOf(github, { sub: 'release', strings: { repository: 'PettoBot/petto-bot' } });
  assert.match(out.text, /v1\.2\.0/); assert.match(out.text, /jumbo/); assert.match(out.text, /a\.zip/); assert.match(out.text, /4,000/);
  assert.equal(calls.filter((call) => /api\.github\.com/.test(call.url)).every((call) => !call.init.headers.Authorization), true, 'no token, none sent');
  config.githubToken = 'ghp_test';
  await answerOf(github, { sub: 'user', strings: { name: 'octocat' } }).catch(() => {});
  routes.unshift([/api\.github\.com\/users\/other$/, (url, init) => { assert.equal(init.headers.Authorization, 'Bearer ghp_test'); return json({ login: 'other', avatar_url: 'https://a', html_url: 'https://github.com/other', created_at: '2020-01-01T00:00:00Z' }); }]);
  await answerOf(github, { sub: 'user', strings: { name: 'other' } });
  config.githubToken = null;
  out = await answerOf(github, { sub: 'release', strings: { repository: 'a/norelease' } });
  assert.match(out.text, /Nothing found on GitHub/);
  routes.unshift([/api\.github\.com\/users\/busy$/, json({}, 403, { 'x-ratelimit-remaining': '0' })]);
  out = await answerOf(github, { sub: 'user', strings: { name: 'busy' } });
  assert.match(out.text, /too many requests/);

  // --- Roblox ----------------------------------------------------------------------------------------------------------------------------
  assert.deepEqual(roblox.parseUser('Builderman'), { name: 'Builderman' });
  assert.deepEqual(roblox.parseUser('156'), { id: '156' });
  assert.deepEqual(roblox.parseUser('https://www.roblox.com/users/156/profile'), { id: '156' });
  assert.deepEqual(roblox.parseUser('https://www.roblox.com/es/users/156/profile'), { id: '156' });
  assert.equal(roblox.parseUser('a b'), null); assert.equal(roblox.parseUser('ab'), null);
  routes = [
    [/users\.roblox\.com\/v1\/usernames\/users$/, (url, init) => { assert.equal(init.method, 'POST'); const body = JSON.parse(init.body); return json({ data: body.usernames[0] === 'Builderman' ? [{ id: 156, name: 'builderman' }] : [] }); }],
    [/users\.roblox\.com\/v1\/users\/156$/, json({ id: 156, name: 'builderman', displayName: 'Builder', description: 'I make games', created: '2006-03-08T00:00:00Z', isBanned: false, hasVerifiedBadge: true })],
    [/friends\.roblox\.com\/v1\/users\/156\/friends\/count$/, json({ count: 42 })],
    [/friends\.roblox\.com\/v1\/users\/156\/followers\/count$/, json({ count: 1234567 })],
    [/thumbnails\.roblox\.com/, json({ data: [{ state: 'Completed', imageUrl: 'https://tr.rbxcdn.com/h.png' }] })],
    [/groups\.roblox\.com\/v2\/users\/156\/groups\/roles$/, json({ data: [{ group: { name: 'Roblox Fans' }, role: { name: 'Member' } }] })],
  ];
  out = await answerOf(roblox, { strings: { user: 'Builderman' } });
  assert.match(out.text, /Builder \(@builderman\)/); assert.match(out.text, /1,234,567/); assert.match(out.text, /Roblox Fans/); assert.match(out.text, /tr\.rbxcdn\.com/); assert.match(out.text, /users\/156\/profile/);
  out = await answerOf(roblox, { strings: { user: 'Nobodyatall' } });
  assert.match(out.text, /Nothing found on Roblox/);
  routes = routes.filter(([pattern]) => !/friends|thumbnails|groups/.test(pattern.source));
  integrations.clearCache();
  out = await answerOf(roblox, { strings: { user: '156' } });
  assert.match(out.text, /I make games/, 'the profile still shows when the extras fail');
  assert.doesNotMatch(out.text, /Friends/);

  // --- Steam -----------------------------------------------------------------------------------------------------------------------------
  assert.deepEqual(steam.parseProfile('76561198000000000'), { id: '76561198000000000' });
  assert.deepEqual(steam.parseProfile('https://steamcommunity.com/id/gaben/'), { vanity: 'gaben' });
  assert.deepEqual(steam.parseProfile('https://steamcommunity.com/profiles/76561198000000000'), { id: '76561198000000000' });
  assert.deepEqual(steam.parseProfile('gaben'), { vanity: 'gaben' });
  assert.equal(steam.parseProfile('x'), null); assert.equal(steam.parseProfile('https://steamcommunity.com/profiles/abc'), null);
  out = await answerOf(steam, { strings: { user: 'gaben' } });
  assert.match(out.text, /not set up/, 'without a key it says so');
  assert.equal(called(/api\.steampowered\.com/), 0, 'and does not call');
  config.steamApiKey = 'KEY';
  let steamPublic = true;
  routes = [
    [/ISteamUser\/ResolveVanityURL/, (url) => json({ response: url.includes('vanityurl=gaben') ? { success: 1, steamid: '76561198000000000' } : { success: 42 } })],
    [/ISteamUser\/GetPlayerSummaries/, () => json({ response: { players: [{ personaname: 'Gabe', avatarfull: 'https://a/s.jpg', profileurl: 'https://steamcommunity.com/id/gaben/', personastate: 1, gameextrainfo: 'Half-Life', timecreated: 1063000000, communityvisibilitystate: steamPublic ? 3 : 1 }] } })],
    [/GetSteamLevel/, json({ response: { player_level: 25 } })],
    [/GetOwnedGames/, json({ response: { game_count: 321 } })],
    [/GetRecentlyPlayedGames/, json({ response: { games: [{ name: 'Portal 2', playtime_2weeks: 600 }] } })],
  ];
  out = await answerOf(steam, { strings: { user: 'gaben' } });
  assert.match(out.text, /Gabe/); assert.match(out.text, /Playing Half-Life/); assert.match(out.text, /321/); assert.match(out.text, /Portal 2/); assert.match(out.text, /10 h in 2 weeks/);
  assert.ok(calls.some((call) => call.url.includes('key=KEY')), 'the key goes in the call');
  assert.doesNotMatch(out.text, /KEY/, 'and never in the answer');
  out = await answerOf(steam, { strings: { user: 'nobodyhere' } });
  assert.match(out.text, /Nothing found on Steam/);
  steamPublic = false;
  out = await answerOf(steam, { strings: { user: '76561198000000001' } });
  assert.match(out.text, /profile is private/);
  assert.equal(called(/GetOwnedGames.*steamid=76561198000000001/), 0, 'a private profile is not asked for its games');
  config.steamApiKey = null;

  // --- Twitch ----------------------------------------------------------------------------------------------------------------------------
  assert.equal(twitch.parseChannel('https://www.twitch.tv/Ibai?x=1'), 'ibai'); assert.equal(twitch.parseChannel('@Ibai'), 'ibai'); assert.equal(twitch.parseChannel('a b'), null);
  out = await answerOf(twitch, { strings: { channel: 'ibai' } });
  assert.match(out.text, /not set up/);
  config.twitchClientId = 'cid'; config.twitchClientSecret = 'secret';
  let tokenCalls = 0; let live = true; let refuse = false;
  routes = [
    [/id\.twitch\.tv\/oauth2\/token$/, (url, init) => { tokenCalls += 1; assert.match(String(init.body), /grant_type=client_credentials/); assert.equal(init.method, 'POST'); return json({ access_token: `tok${tokenCalls}`, expires_in: 5000000 }); }],
    [/helix\/users\?login=ibai$/, (url, init) => { if (refuse && init.headers.Authorization === 'Bearer tok1') return json({}, 401); assert.equal(init.headers['Client-Id'], 'cid'); return json({ data: [{ id: '1', login: 'ibai', display_name: 'Ibai', broadcaster_type: 'partner', description: 'Streamer', profile_image_url: 'https://a/i.png', created_at: '2012-01-01T00:00:00Z' }] }); }],
    [/helix\/streams\?user_login=ibai$/, (url, init) => (refuse && init.headers.Authorization === 'Bearer tok1' ? json({}, 401) : json({ data: live ? [{ title: 'La Velada', game_name: 'Just Chatting', viewer_count: 150000, started_at: '2026-10-25T20:00:00Z', language: 'es', thumbnail_url: 'https://a/t-{width}x{height}.jpg' }] : [] }))],
    [/helix\/users\?login=nobody$/, json({ data: [] })],
    [/helix\/streams\?user_login=nobody$/, json({ data: [] })],
  ];
  out = await answerOf(twitch, { strings: { channel: 'ibai' } });
  assert.match(out.text, /LIVE/); assert.match(out.text, /La Velada/); assert.match(out.text, /150,000/); assert.match(out.text, /t-640x360\.jpg/); assert.match(out.text, /Partner/);
  assert.equal(tokenCalls, 1, 'one token for both calls');
  await answerOf(twitch, { strings: { channel: 'nobody' } }).then((r) => assert.match(r.text, /Nothing found on Twitch/));
  assert.equal(tokenCalls, 1, 'and it is kept');
  // A refused token is replaced, once, and the lookup goes on with the new one.
  twitch.resetToken(); integrations.clearCache(); tokenCalls = 0; refuse = true; live = false;
  const found = await twitch.findChannel('ibai');
  assert.equal(found.user.display_name, 'Ibai'); assert.equal(found.stream, null, 'offline');
  assert.equal(tokenCalls, 2, 'the refused token was asked for again, once');
  integrations.clearCache(); refuse = false; live = false;
  out = await answerOf(twitch, { strings: { channel: 'ibai' } });
  assert.match(out.text, /Not live right now/);
  config.twitchClientId = null; config.twitchClientSecret = null;

  // --- YouTube ---------------------------------------------------------------------------------------------------------------------------
  assert.deepEqual(youtube.parseVideo('dQw4w9WgXcQ'), { id: 'dQw4w9WgXcQ' });
  for (const link of ['https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=3', 'https://youtu.be/dQw4w9WgXcQ?si=x', 'https://www.youtube.com/shorts/dQw4w9WgXcQ', 'https://music.youtube.com/watch?v=dQw4w9WgXcQ', 'https://www.youtube.com/live/dQw4w9WgXcQ']) assert.deepEqual(youtube.parseVideo(link), { id: 'dQw4w9WgXcQ' }, link);
  assert.deepEqual(youtube.parseVideo('never gonna give you up'), { query: 'never gonna give you up' });
  assert.equal(youtube.parseVideo('  '), null);
  assert.deepEqual(youtube.parseChannel('@MrBeast'), { handle: 'MrBeast' });
  assert.deepEqual(youtube.parseChannel('https://www.youtube.com/@MrBeast/videos'), { handle: 'MrBeast' });
  assert.deepEqual(youtube.parseChannel('https://www.youtube.com/channel/UCX6OQ3DkcsbYNE6H8uQQuVA'), { id: 'UCX6OQ3DkcsbYNE6H8uQQuVA' });
  assert.deepEqual(youtube.parseChannel('UCX6OQ3DkcsbYNE6H8uQQuVA'), { id: 'UCX6OQ3DkcsbYNE6H8uQQuVA' });
  assert.equal(youtube.parseChannel('a b'), null);
  assert.equal(youtube.durationSeconds('PT1H2M3S'), 3723); assert.equal(youtube.durationSeconds('PT45S'), 45); assert.equal(youtube.durationSeconds('P0D'), 0); assert.equal(youtube.durationSeconds('nope'), null);
  assert.equal(youtube.clock(3723), '1:02:03'); assert.equal(youtube.clock(245), '4:05'); assert.equal(youtube.clock(5), '0:05');

  out = await answerOf(youtube, { sub: 'video', strings: { video: 'dQw4w9WgXcQ' } });
  assert.match(out.text, /not set up/);
  config.youtubeApiKey = 'YT';
  let quota = false;
  routes = [
    [/youtube\/v3\/search\?/, () => (quota ? json({ error: { errors: [{ reason: 'quotaExceeded' }] } }, 403) : json({ items: [{ id: { videoId: 'dQw4w9WgXcQ' } }] }))],
    [/youtube\/v3\/videos\?/, json({ items: [{ id: 'dQw4w9WgXcQ', snippet: { title: 'Never Gonna Give You Up', channelTitle: 'Rick Astley', channelId: 'UCuAXFkgsw1L7xaCfnd5JJOw', publishedAt: '2009-10-25T06:57:33Z', thumbnails: { high: { url: 'https://i.ytimg.com/vi/x/hq.jpg' }, maxres: { url: 'https://i.ytimg.com/vi/x/max.jpg' } } }, statistics: { viewCount: '1500000000', likeCount: '18000000', commentCount: '2400000' }, contentDetails: { duration: 'PT3M33S' } }] })],
    [/youtube\/v3\/channels\?/, (url) => json({ items: url.includes('forHandle=%40MrBeast') || url.includes('id=UC') ? [{ id: 'UCX6OQ3DkcsbYNE6H8uQQuVA', snippet: { title: 'MrBeast', customUrl: '@mrbeast', description: 'SUBSCRIBE', country: 'US', publishedAt: '2012-02-20T00:00:00Z', thumbnails: { default: { url: 'https://yt3/x.jpg' } } }, statistics: { subscriberCount: '400000000', videoCount: '800', viewCount: '90000000000', hiddenSubscriberCount: false } }] : [] })],
  ];
  out = await answerOf(youtube, { sub: 'video', strings: { video: 'https://youtu.be/dQw4w9WgXcQ' } });
  assert.match(out.text, /Never Gonna Give You Up/); assert.match(out.text, /1,500,000,000/); assert.match(out.text, /3:33/); assert.match(out.text, /max\.jpg/); assert.match(out.text, /watch\?v=dQw4w9WgXcQ/);
  assert.equal(called(/youtube\/v3\/search/), 0, 'a link needs no search (the expensive call)');
  out = await answerOf(youtube, { sub: 'video', strings: { video: 'never gonna give you up' } });
  assert.match(out.text, /Rick Astley/); assert.equal(called(/youtube\/v3\/search/), 1);
  quota = true;
  out = await answerOf(youtube, { sub: 'video', strings: { video: 'another new search' } });
  assert.match(out.text, /too many requests/, 'the daily quota ending is said as such');
  out = await answerOf(youtube, { sub: 'channel', strings: { channel: '@MrBeast' } });
  assert.match(out.text, /MrBeast/); assert.match(out.text, /400,000,000/); assert.match(out.text, /channel\/UCX6OQ3DkcsbYNE6H8uQQuVA/);
  out = await answerOf(youtube, { sub: 'channel', strings: { channel: '@nobodyatall' } });
  assert.match(out.text, /Nothing found on YouTube/);
  assert.ok(calls.some((call) => call.url.includes('key=YT')));
  config.youtubeApiKey = null;

  // --- Last.fm ---------------------------------------------------------------------------------------------------------------------------
  assert.equal(lastfm.parseUsername('rj'), 'rj'); assert.equal(lastfm.parseUsername('https://www.last.fm/user/rj'), 'rj'); assert.equal(lastfm.parseUsername('https://www.last.fm/es/user/rj/library'), 'rj');
  assert.equal(lastfm.parseUsername('1abc'), null); assert.equal(lastfm.parseUsername('a'), null); assert.equal(lastfm.parseUsername('a b'), null);
  assert.equal(lastfm.errorOf(6).kind, 'notFound'); assert.equal(lastfm.errorOf(17).kind, 'private'); assert.equal(lastfm.errorOf(29).kind, 'rateLimited'); assert.equal(lastfm.errorOf(10).kind, 'notConfigured'); assert.equal(lastfm.errorOf(8).kind, 'unavailable');

  out = await answerOf(lastfm, { sub: 'link', strings: { username: 'rj' } });
  assert.match(out.text, /not set up/);
  config.lastfmApiKey = 'FM';
  routes = [
    [/method=user\.getinfo&user=rj&/i, json({ user: { name: 'RJ', realname: 'Richard', playcount: '123456', artist_count: '900', track_count: '5000', registered: { unixtime: '1100000000' }, country: 'United Kingdom', image: [{ '#text': 'https://lastfm/s.png', size: 'small' }, { '#text': 'https://lastfm/l.png', size: 'large' }] } })],
    [/method=user\.getinfo&user=ghost&/, json({ error: 6, message: 'User not found' }, 404)],
    [/method=user\.getrecenttracks&user=RJ&limit=1&/, json({ recenttracks: { track: { name: 'Karma Police', artist: { '#text': 'Radiohead' }, album: { '#text': 'OK Computer' }, url: 'https://www.last.fm/music/Radiohead/_/Karma+Police', image: [{ '#text': 'https://lastfm/2a96cbd8b46e442fc41c2b86b821562f.png' }, { '#text': 'https://lastfm/cover.png' }], '@attr': { nowplaying: 'true' } } } })],
    [/method=user\.getrecenttracks&user=RJ&limit=10&/, json({ recenttracks: { track: [{ name: 'Karma Police', artist: { '#text': 'Radiohead' }, '@attr': { nowplaying: 'true' } }, { name: 'Creep', artist: { '#text': 'Radiohead' }, date: { uts: '1760000000' } }] } })],
    [/method=user\.gettopartists&user=RJ&period=1month/, json({ topartists: { artist: [{ name: 'Radiohead', playcount: '321' }, { name: 'Muse', playcount: '1' }] } })],
    [/method=user\.gettoptracks&user=RJ&period=overall/, json({ toptracks: { track: [{ name: 'Creep', artist: { name: 'Radiohead' }, playcount: '99' }] } })],
  ];
  out = await answerOf(lastfm, { sub: 'link', strings: { username: 'ghost' } });
  assert.match(out.text, /Nothing found on Last\.fm/); assert.equal(links.size, 0, 'a name that does not exist is not saved');
  out = await answerOf(lastfm, { sub: 'link', strings: { username: 'bad name' } });
  assert.match(out.text, /does not look right/);
  const me = fake({ sub: 'link', strings: { username: 'rj' } });
  await lastfm.execute(me);
  assert.equal(links.get(me.user.id), 'RJ', 'saved as Last.fm writes it'); assert.match(textOf(me.sent.edits.at(-1)), /Done: your Last\.fm name is now \*\*RJ\*\*/);

  const asMe = (sub, extra = {}) => {
    const interaction = fake({ sub, ...extra });
    interaction.user.id = me.user.id;
    return interaction;
  };
  const run = async (sub, extra) => { integrations.cooldownLeft('reset', 'reset', 0); integrations.clearCache(); const interaction = asMe(sub, extra); await lastfm.execute(interaction); return textOf(interaction.sent.edits.at(-1) ?? interaction.sent.replies.at(-1)); };
  let text = await run('now');
  assert.match(text, /"description":"Karma Police"/); assert.match(text, /Playing now/); assert.deepEqual(coversAsked, ['https://lastfm/cover.png'], 'the cover is drawn, and the empty picture of Last.fm is not used');
  text = await run('recent');
  assert.match(text, /▶ \*\*Karma Police\*\*/); assert.match(text, /Creep/); assert.match(text, /<t:1760000000:R>/);
  text = await run('profile');
  assert.match(text, /123,456/); assert.match(text, /Richard/); assert.match(text, /l\.png/);
  text = await run('topartists');
  assert.match(text, /\*\*1\.\*\* Radiohead · 321 plays/); assert.match(text, /Muse · 1 play[^s]/); assert.match(text, /Last month/);
  text = await run('toptracks', { strings: { period: 'overall' } });
  assert.match(text, /Creep\*\* — Radiohead · 99 plays/); assert.match(text, /All time/);
  assert.equal(lastfm.normalizePeriod('overall'), 'overall'); assert.equal(lastfm.normalizePeriod('All time'), 'overall'); assert.equal(lastfm.normalizePeriod('3 months'), '3month');
  assert.equal(lastfm.normalizePeriod('week'), '7day'); assert.equal(lastfm.normalizePeriod('year'), '12month'); assert.equal(lastfm.normalizePeriod('bogus'), '1month'); assert.equal(lastfm.normalizePeriod(null), '1month');
  // Someone who has not linked.
  const stranger = fake({ sub: 'now', users: { user: { id: 'nolink', username: 'ana', displayName: 'Ana' } } });
  await lastfm.execute(stranger);
  assert.match(textOf(stranger.sent.edits.at(-1)), /Ana has not linked/);
  const alone = fake({ sub: 'now' });
  await lastfm.execute(alone);
  assert.match(textOf(alone.sent.edits.at(-1)), /You have not linked/);
  // Another member who has.
  links.set('friend', 'RJ');
  const friend = fake({ sub: 'now', users: { user: { id: 'friend', username: 'bob', displayName: 'Bob' } } });
  await lastfm.execute(friend);
  assert.match(textOf(friend.sent.edits.at(-1)), /Karma Police/);
  // Unlink.
  const gone = asMe('unlink');
  await lastfm.execute(gone);
  assert.match(textOf(gone.sent.replies.at(-1)), /forgot your Last\.fm name/); assert.equal(links.has(me.user.id), false);
  const again = asMe('unlink');
  await lastfm.execute(again);
  assert.match(textOf(again.sent.replies.at(-1)), /not linked/);
  // A private profile and an exhausted key.
  routes.unshift([/user=RJ&limit=1&/, json({ error: 17, message: 'Login: User required to be logged in' }, 200)]);
  integrations.clearCache();
  links.set('priv', 'RJ');
  const priv = fake({ sub: 'now', users: { user: { id: 'priv', username: 'p', displayName: 'P' } } });
  await lastfm.execute(priv);
  assert.match(textOf(priv.sent.edits.at(-1)), /profile is private/);
  config.lastfmApiKey = null;


  // --- an argument left out is for the command handler to explain, not an error of the lookup ----------------------------------------------
  for (const [command, option, sub] of [[roblox, 'user'], [steam, 'user'], [twitch, 'channel'], [minecraft, 'player', 'user'], [github, 'name', 'user'], [youtube, 'video', 'video']]) {
    const interaction = fake({ sub });
    await assert.rejects(command.execute(interaction), (error) => error.missingOption === option, `${command.data.name} without ${option}`);
  }
  assert.equal(logged.length, 0, 'and nothing was logged as an error');

  // --- typed after the prefix: the subcommand can be left out ----------------------------------------------------------------------------------
  const { buildInteractionFromMessage } = require('../src/handlers/prefixInteraction');
  const typed = async (command, text) => {
    const message = { guild: { id: 'g' }, channel: { id: 'c' }, author: { id: 'u' }, client: {}, content: text, attachments: { first: () => null } };
    const built = await buildInteractionFromMessage(message, command, text);
    if (!built) return null;
    return { sub: built.options.getSubcommand(false), strings: Object.fromEntries(['player', 'name', 'repository', 'video', 'channel', 'username', 'period', 'user'].map((n) => [n, built.options.getString(n)]).filter(([, v]) => v !== null)) };
  };
  assert.deepEqual(await typed(minecraft, 'Notch'), { sub: 'user', strings: { player: 'Notch' } });
  assert.deepEqual(await typed(minecraft, 'skin Notch'), { sub: 'skin', strings: { player: 'Notch' } });
  assert.deepEqual(await typed(minecraft, 'avatar Notch'), { sub: 'head', strings: { player: 'Notch' } }, 'a short word for a subcommand');
  assert.equal(await typed(minecraft, ''), null, 'with nothing typed the usage card is shown');
  assert.deepEqual(await typed(github, 'octocat'), { sub: 'user', strings: { name: 'octocat' } });
  assert.deepEqual(await typed(github, 'PettoBot/petto-bot'), { sub: 'repo', strings: { repository: 'PettoBot/petto-bot' } });
  assert.deepEqual(await typed(github, 'https://github.com/PettoBot/petto-bot'), { sub: 'repo', strings: { repository: 'https://github.com/PettoBot/petto-bot' } });
  assert.deepEqual(await typed(github, 'release PettoBot/petto-bot'), { sub: 'release', strings: { repository: 'PettoBot/petto-bot' } });
  assert.deepEqual(await typed(youtube, 'urugodd'), { sub: 'channel', strings: { channel: 'urugodd' } }, 'one word is a channel');
  assert.deepEqual(await typed(youtube, '@MrBeast'), { sub: 'channel', strings: { channel: '@MrBeast' } });
  assert.deepEqual(await typed(youtube, 'never gonna give you up'), { sub: 'video', strings: { video: 'never gonna give you up' } }, 'several words are a search');
  assert.deepEqual(await typed(youtube, 'https://youtu.be/dQw4w9WgXcQ'), { sub: 'video', strings: { video: 'https://youtu.be/dQw4w9WgXcQ' } });
  assert.deepEqual(await typed(youtube, 'dQw4w9WgXcQ'), { sub: 'video', strings: { video: 'dQw4w9WgXcQ' } });
  assert.deepEqual(await typed(youtube, 'channel urugodd'), { sub: 'channel', strings: { channel: 'urugodd' } });
  assert.deepEqual(await typed(lastfm, ''), { sub: 'now', strings: {} }, '!lfm alone is now');
  assert.equal((await typed(lastfm, 'recent')).sub, 'recent');
  assert.equal((await typed(lastfm, 'songs')).sub, 'toptracks', 'a short word for a subcommand');
  assert.equal((await typed(lastfm, 'link rj')).sub, 'link');

  // --- the three languages -----------------------------------------------------------------------------------------------------------------
  config.githubToken = null;
  routes = [[/api\.mojang\.com/, json({ id: MC_ID, name: 'Notch' })], [/sessionserver/, json({ id: MC_ID, name: 'Notch', properties: [{ name: 'textures', value: textures }] })]];
  for (const [lang, word] of [['es', /Capa/], ['pt-BR', /Capa/]]) {
    const result = await answerOf(minecraft, { sub: 'user', strings: { player: MC_ID }, lang });
    assert.match(result.text, word, lang);
  }

  console.log('Integrations checks passed.');
})().catch((error) => { console.error(error); process.exit(1); });
