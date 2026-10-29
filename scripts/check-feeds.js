// Checks the feeds: the cleaning of the text, the card of every kind of notice, the readers of each platform (with the answers of the services
// written out), the engine (what is posted, what is not posted twice, the streams that end, the failures) and, when PETTO_TEST_DATABASE_URL points
// to a test database, the same against a real PostgreSQL: the limits of Free and Premium, the first look of a new feed and the cleanup.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL = process.env.PETTO_TEST_DATABASE_URL || 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');

const text = require('../src/feeds/text');
// A picture that has bytes (the check of a stand-in looks at them, as Discord does).
const emptyAnswer = () => new Response(Buffer.alloc(40), { status: 200, headers: { 'content-type': 'image/png' } });
const fakeImage = () => new Response(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(3000)]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
const card = require('../src/feeds/card');
const { PLATFORMS, PLATFORM_IDS, TYPES } = require('../src/feeds/platforms');
const youtube = require('../src/feeds/providers/youtube');
const twitch = require('../src/feeds/providers/twitch');
const kick = require('../src/feeds/providers/kick');
const bluesky = require('../src/feeds/providers/bluesky');
const modrinth = require('../src/feeds/providers/modrinth');
const pokemon = require('../src/feeds/providers/pokemon');
const { PROVIDERS, MAX_AGE_MS, notLive } = require('../src/feeds/providers');
const REAL_YOUTUBE = PROVIDERS.youtube; // the engine checks replace PROVIDERS.youtube with a stand-in later
const config = require('../src/config');
const { t } = require('../src/i18n');
const { IntegrationError } = require('../src/utils/integrations');

const json = (value) => JSON.parse(JSON.stringify(value));
const contentOf = (component) => json(component).components?.map((child) => child.content ?? child.components?.map((c) => c.content).join('\n')).join('\n') ?? json(component).content;
const allText = (message) => JSON.stringify(json(message.components));

(async () => {
  // --- the text -----------------------------------------------------------------------------------------------------------------------------
  assert.equal(text.plainText('Hello <b>world</b> &amp; friends https://x.test/a'), 'Hello world & friends');
  assert.ok(!text.plainText('@everyone and <@123456789012345678>').includes('@everyone'), 'a mention in the words of a service is neutralized');
  assert.ok(!/(^|[^\u200b])<@/.test(text.plainText('<@123456789012345678>')));
  assert.equal(text.linkText('A [test] **video**'), 'A ［test］ \\*\\*video\\*\\*', 'brackets in the words of a link cannot end it, and Discord does not read an escaped one');
  assert.equal(text.safeUrl('javascript:alert(1)'), null);
  assert.equal(text.safeUrl('https://youtu.be/x'), 'https://youtu.be/x');
  assert.ok(text.clip('word '.repeat(100), 50).length <= 50);

  // --- the card ------------------------------------------------------------------------------------------------------------------------------
  const base = { platform: 'youtube', type: 'video', title: 'A [new] video', url: 'https://youtu.be/x', description: 'What it is about', image: 'https://i.ytimg.com/vi/x/hq.jpg', avatar: 'https://yt3.example/a.jpg', author: 'Channel', publishedAt: Date.now() };
  const feed = { message: 'New from {feed.author}: {feed.url}', ping_roles: ['223456789012345678'], ping_everyone: false, options: {} };
  let message = card.buildFeedMessage(feed, base, { lang: 'en' });
  let parts = json(message.components);
  assert.equal(parts[0].type, 10, 'the words above the card are a text of their own');
  assert.equal(parts[0].content, '<@&223456789012345678> New from Channel: https://youtu.be/x');
  assert.deepEqual(message.allowedMentions.parse, ['users', 'roles'], 'the users and roles written in the words of the feed are real mentions');
  assert.equal(message.allowedMentions.roles, undefined);
  const hostileTitle = card.buildFeedMessage({ message: '{feed.title}', ping_roles: [], ping_everyone: false, options: {} }, { ...base, title: 'Hi <@123456789012345678> <@&223456789012345678> @everyone' }, { lang: 'en' });
  assert.ok(!/<@/.test(json(hostileTitle.components).map((part) => part.content ?? '').join('')) || json(hostileTitle.components).map((part) => part.content ?? '').join('').includes('<\u200b@'), 'what a platform sends cannot mention anyone, even though mentions are allowed');
  const container = parts[1];
  assert.equal(container.type, 17);
  assert.equal(container.accent_color, PLATFORMS.youtube.color, 'the side bar has the color of the platform');
  assert.equal(container.components[0].type, 9, 'a section: the title and a picture at the right');
  assert.equal(container.components[0].accessory.media.url, 'https://yt3.example/a.jpg');
  assert.match(container.components[0].components[0].content, /\*\*\[A ［new］ video\]\(https:\/\/youtu\.be\/x\)\*\*\n-# What it is about$/);
  assert.equal(container.components[1].type, 14, 'a separator, then the cover');
  assert.equal(container.components[2].items[0].media.url, 'https://i.ytimg.com/vi/x/hq.jpg');
  assert.match(container.components.at(-2).content, /^-# <:pe_f_video_short:\d+> New video · Channel · <t:\d+:R>$/);
  assert.ok(message.flags);

  message = card.buildFeedMessage({ message: '', ping_roles: [], options: {} }, { ...base, avatar: null }, { lang: 'es' });
  parts = json(message.components);
  assert.equal(parts[0].type, 17, 'no words and no ping: only the card');
  assert.ok(parts[0].components[0].accessory.media.url.endsWith('/youtube.png'), 'an account with no picture shows the one of the platform');
  const short = json(card.buildFeedMessage({ message: '', options: { player: false } }, { ...base, type: 'short' }, { lang: 'en' }).components)[0];
  assert.ok(!short.components.some((child) => child.type === 12), 'a Short goes without the big picture');
  const shortWith = json(card.buildFeedMessage({ message: '', options: { image: true, player: false } }, { ...base, type: 'short' }, { lang: 'en' }).components)[0];
  assert.ok(shortWith.components.some((child) => child.type === 12), 'unless the server asks for it');
  const noImage = json(card.buildFeedMessage({ message: '', options: { image: false } }, base, { lang: 'en' }).components)[0];
  assert.ok(!noImage.components.some((child) => child.type === 12));
  // The player: a plain message with the link (Discord draws the video), only for the videos and Shorts of YouTube.
  const player = card.buildFeedMessage({ message: 'New one!', ping_roles: [], options: { player: true } }, { ...base, type: 'short' }, { lang: 'en' });
  assert.equal(player.content, 'New one!\nhttps://youtu.be/x');
  assert.ok(!player.components && !player.flags, 'no card: Discord only draws the video for a plain message');
  assert.equal(card.buildFeedMessage({ message: '', options: {} }, { ...base, type: 'short' }, { lang: 'en' }).content, 'https://youtu.be/x', 'a Short is the player by default');
  assert.ok(card.buildFeedMessage({ message: '', options: { player: false } }, { ...base, type: 'short' }, { lang: 'en' }).components, 'unless the feed says no');
  assert.ok(card.buildFeedMessage({ message: '', options: {} }, { ...base, type: 'video' }, { lang: 'en' }).components, 'a video keeps its card by default');
  assert.ok(card.buildFeedMessage({ message: '', options: { player: true } }, { ...base, type: 'live' }, { lang: 'en' }).components, 'a live stream keeps its card');
  assert.ok(card.buildFeedMessage({ message: '', options: { player: true } }, { ...base, platform: 'twitch', type: 'live' }, { lang: 'en' }).components, 'and so does everything that is not a video of YouTube');
  assert.deepEqual(require('../src/feeds/service').cleanOptions({ player: true, image: 'x', other: 1 }), { player: true }, 'the option is kept, nothing else');
  // Only a title: no section with the picture of the account (it would leave an empty space under one line); with a description the section stays.
  const bare = json(card.buildFeedMessage({ message: '', options: {} }, { ...base, description: '' }, { lang: 'en' }).components)[0];
  assert.deepEqual([bare.components[0].type, bare.components.some((child) => child.type === 9)], [10, false], 'a title alone is plain text');
  const described = json(card.buildFeedMessage({ message: '', options: {} }, base, { lang: 'en' }).components)[0];
  assert.equal(described.components[0].type, 9, 'with a description it is a section with the picture of the account');
  const withButton = json(card.buildFeedMessage({ message: '', options: { button: true } }, base, { lang: 'en' }).components)[0];
  assert.equal(withButton.components.at(-1).components[0].url, 'https://youtu.be/x');
  assert.equal(withButton.components.at(-1).components[0].label, 'Watch on YouTube');
  assert.ok(withButton.components.at(-1).components[0].emoji, 'the button carries the icon of the platform');
  const byDefault = json(card.buildFeedMessage({ message: '', options: {} }, base, { lang: 'en' }).components)[0];
  assert.equal(byDefault.components.at(-1).components[0].url, 'https://youtu.be/x', 'the button is on unless the server turned it off');
  const buttonOff = json(card.buildFeedMessage({ message: '', options: { button: false } }, base, { lang: 'en' }).components)[0];
  assert.notEqual(buttonOff.components.at(-1).type, 1, 'and it can be turned off');
  const colored = json(card.buildFeedMessage({ message: '', options: { color: 0x123456 } }, base, { lang: 'en' }).components)[0];
  assert.equal(colored.accent_color, 0x123456);
  const everyone = card.buildFeedMessage({ message: '', ping_everyone: true, ping_roles: [] }, base, { lang: 'en' });
  assert.deepEqual(everyone.allowedMentions.parse, ['users', 'roles', 'everyone']);
  assert.ok(json(everyone.components)[0].content.startsWith('@everyone'));
  assert.equal(text.linkText('✅ LADRILLOS DE NIEVE 👉 26.4 Snapshot 6 Minecraft'), 'LADRILLOS DE NIEVE 26.4 Snapshot 6 Minecraft', 'the emojis of a title are left out of its link (Discord would not draw it)');
  assert.equal(text.linkText('Mix 🇨🇴 <:pe_f_video:123456789012345678> 👨‍👩‍👧 end'), 'Mix end', 'flags, custom emojis and joined emojis too');
  assert.equal(text.linkText('Top 1️⃣0 songs'), 'Top 10 songs', 'a keycap keeps its digit');
  const tested = json(card.buildFeedMessage({ message: '', options: {} }, base, { lang: 'en', test: true }).components);
  assert.ok(tested[0].content.includes(t('en', 'feeds.test.badge')));
  const ended = json(card.buildFeedMessage({ message: '', options: {} }, { ...base, type: 'ended', vodUrl: 'https://youtu.be/x', authorUrl: 'https://youtube.com/channel/UCx' }, { lang: 'en' }).components)[0];
  assert.equal(ended.accent_color, 0xff0000, 'a stream that is over keeps the color of its platform');
  assert.deepEqual(ended.components.at(-1).components.map((button) => button.label), ['Open the channel', 'Watch the replay']);
  for (const lang of ['en', 'es', 'pt-BR']) for (const type of TYPES) assert.ok(!t(lang, `feeds.type.${type}`).startsWith('feeds.type.'), `${type} has a label in ${lang}`);
  for (const platform of PLATFORM_IDS) assert.ok(card.buildFeedMessage({ message: '', options: {} }, { ...base, platform }, { lang: 'en' }).components.length === 1);
  // A hostile text cannot make a link or a mention out of the card.
  const hostile = json(card.buildFeedMessage({ message: '', options: {} }, { ...base, title: '](https://evil.test) @everyone', url: 'javascript:alert(1)', description: '@everyone <@123456789012345678>', image: 'javascript:1' }, { lang: 'en' }).components)[0];
  assert.ok(!JSON.stringify(hostile).includes('(javascript:'));
  assert.ok(JSON.stringify(hostile).includes('@\u200beveryone') && !/@everyone/.test(JSON.stringify(hostile)), 'a mention in the text of a service is made harmless');
  assert.ok(!hostile.components.some((child) => child.type === 12), 'a picture that is not a web link is not shown');

  // --- the readers of the platforms ---------------------------------------------------------------------------------------------------------
  assert.deepEqual(youtube.parseChannel('https://www.youtube.com/@mkbhd'), { handle: 'mkbhd' });
  assert.deepEqual(youtube.parseChannel('UCBJycsmduvYEL83R_U4JriQ'), { id: 'UCBJycsmduvYEL83R_U4JriQ' });
  assert.deepEqual(youtube.parseChannel('https://www.youtube.com/channel/UCBJycsmduvYEL83R_U4JriQ/videos'), { id: 'UCBJycsmduvYEL83R_U4JriQ' });
  assert.equal(youtube.parseChannel(''), null);
  assert.equal(twitch.parseLogin('https://www.twitch.tv/Some_Name'), 'some_name');
  assert.equal(twitch.parseLogin('a b'), null);
  assert.equal(kick.parseSlug('https://kick.com/Some-Name?x=1'), 'some-name');
  assert.equal(kick.parseSlug('@someone'), 'someone');
  assert.equal(kick.parseSlug('a b'), null);
  assert.equal(kick.parseSlug('x'.repeat(26)), null, 'Kick names have at most 25 characters');
  assert.equal(bluesky.parseActor('https://bsky.app/profile/jay.bsky.team'), 'jay.bsky.team');
  assert.equal(bluesky.parseActor('@name'), 'name.bsky.social');
  assert.equal(modrinth.parseProject('https://modrinth.com/mod/sodium/versions'), 'sodium');
  const walked = new Set();
  for (let day = 0; day < pokemon.TOTAL; day += 1) walked.add(pokemon.pokemonOfDay(day));
  assert.equal(walked.size, pokemon.TOTAL, 'the Pokémon of the day walks the whole dex before it repeats');
  assert.ok([...walked].every((n) => n >= 1 && n <= pokemon.TOTAL));

  const rss = (entries) => `<?xml version="1.0"?><feed><title>Chan</title>${entries.map((e) => `<entry><yt:videoId>${e.id}</yt:videoId><title>${e.title}</title><link rel="alternate" href="https://www.youtube.com/${e.short ? 'shorts/' : 'watch?v='}${e.id}"/><author><name>Chan</name></author><published>${new Date(e.at).toISOString()}</published><yt:channelId>UCx</yt:channelId><media:group><media:thumbnail url="https://i.ytimg.com/vi/${e.id}/hq.jpg"/><media:description>${e.desc ?? ''}</media:description><media:community><media:statistics views="5"/></media:community></media:group></entry>`).join('')}</feed>`;
  const now = Date.now();
  const entries = [
    { id: 'vid1', title: 'A video &amp; more', at: now - 3_600_000, desc: 'First line\nsecond line' },
    { id: 'sho1', title: 'A short', at: now - 7_200_000, short: true },
    { id: 'liv1', title: 'Live now', at: now - 600_000 },
    { id: 'upc1', title: 'Soon', at: now - 300_000 },
    { id: 'old1', title: 'Old one', at: now - MAX_AGE_MS - 86_400_000 },
    { id: 'sch1', title: 'Scheduled days ago', at: now - 5 * 86_400_000 },
  ];
  const parsed = youtube.parseFeed(rss(entries));
  assert.equal(parsed.length, 6);
  assert.equal(parsed[0].title, 'A video & more');
  assert.equal(parsed[0].views, 5);
  assert.deepEqual(parsed.map((entry) => entry.short), [false, true, false, false, false, false], 'a Short has /shorts/ in its link');

  // The platform of YouTube with the answers of the services written out: the feed, and the call that says who is live.
  const calls = [];
  const realFetch = globalThis.fetch;
  config.youtubeApiKey = 'key';
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/feeds/videos.xml')) return new Response(rss(entries), { status: 200 });
    if (String(url).includes('/youtube/v3/videos')) {
      const ids = new URL(url).searchParams.get('id').split(',');
      const state = { liv1: 'live', upc1: 'upcoming', sch1: 'live' };
      return new Response(JSON.stringify({ items: ids.map((id) => ({ id, snippet: { liveBroadcastContent: state[id] ?? 'none' }, liveStreamingDetails: id === 'sch1' ? { actualStartTime: new Date(now - 90_000).toISOString() } : {} })) }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  const account = { id: 'UCx', name: 'Chan', avatar: 'https://yt3.example/a.jpg', url: 'https://www.youtube.com/channel/UCx' };
  const logger = require('../src/utils/logger');
  const infoLines = [];
  const realInfo = logger.info;
  logger.info = (...args) => { infoLines.push(args.join(' ')); };
  let results = await PROVIDERS.youtube.poll([account], new Map(), { now });
  let result = results.get('UCx');
  assert.ok(!infoLines.some((line) => line.includes('reached the notice')), 'looking at a channel says nothing about late videos: only a notice that is really sent does');
  const { noteLate } = require('../src/feeds/providers');
  noteLate('UCx', { id: 'late1', title: 'Late one', author: 'Chan', publishedAt: now - 40 * 60_000 }, now);
  noteLate('UCx', { id: 'late1', title: 'Late one', author: 'Chan', publishedAt: now - 40 * 60_000 }, now); // the second server that follows the channel
  noteLate('UCx', { id: 'ontime', title: 'Fast', author: 'Chan', publishedAt: now - 2 * 60_000 }, now);
  assert.deepEqual(infoLines.filter((line) => line.includes('reached the notice')).map((line) => line.replace(/^.*YouTube: /, 'YouTube: ')), ['YouTube: "Late one" of Chan reached the notice 40 min after it was published (no push arrived for it).'], 'one line for a late video (once, whatever the servers) and none for a prompt one');
  logger.info = realInfo;
  assert.deepEqual(result.items.map((item) => `${item.id}:${item.type}`).sort(), ['liv1:live', 'sch1:live', 'sho1:short', 'vid1:video'], 'a live is a live (also one scheduled days before), an upcoming one waits, an old one is not news');
  assert.deepEqual([...result.stillLive].sort(), ['liv1', 'sch1']);
  assert.ok(Math.abs(result.items.find((item) => item.id === 'sch1').publishedAt - (now - 90_000)) < 1000, 'a stream says when it began, not when its page was made');
  const apiCalls = () => calls.filter((url) => url.includes('/youtube/v3/videos')).length;
  assert.equal(apiCalls(), 1, 'one call for all the videos');
  results = await PROVIDERS.youtube.poll([account], new Map(), { now });
  const second = new URL(calls.filter((url) => url.includes('/youtube/v3/videos')).at(-1)).searchParams.get('id').split(',').sort();
  assert.deepEqual(second, ['liv1', 'sch1', 'upc1'], 'what is known not to be live is not asked about again, a live and an upcoming one are');
  // A stream being followed that ended: it is not in `stillLive` any more.
  results = await PROVIDERS.youtube.poll([account], new Map([['UCx', new Set(['gone1'])]]), { now });
  assert.ok(!results.get('UCx').stillLive.has('gone1'), 'a followed stream that is not live now has ended');
  // Without the key every video is just a video and nothing is said to have ended.
  config.youtubeApiKey = null;
  notLive.clear();
  results = await PROVIDERS.youtube.poll([account], new Map([['UCx', new Set(['liv1'])]]), { now });
  assert.deepEqual(results.get('UCx').items, [], 'without the key nothing is posted: a stream must never go out as a video');
  assert.equal(results.get('UCx').error, 'unavailable', 'and the feed is tried again later');
  assert.equal(results.get('UCx').stillLive, undefined, 'without the key nothing is closed by mistake');
  await assert.rejects(PROVIDERS.youtube.resolve('UCaaaaaaaaaaaaaaaaaaaaaa'), (error) => error.kind === 'notConfigured', 'a YouTube feed is not made without the key');
  config.youtubeApiKey = 'key';
  // The key is set but the call fails: nothing is posted either (a stream could be among the videos).
  globalThis.fetch = async (url) => (String(url).includes('/feeds/videos.xml') ? new Response(rss(entries), { status: 200 }) : new Response('{}', { status: 500 }));
  notLive.clear();
  results = await PROVIDERS.youtube.poll([account], new Map(), { now });
  assert.deepEqual([results.get('UCx').items.length, results.get('UCx').error], [0, 'unavailable']);
  // A stream that was seen live and has ended since is not posted as a new video.
  globalThis.fetch = async (url) => {
    if (String(url).includes('/feeds/videos.xml')) return new Response(rss(entries), { status: 200 });
    const ids = new URL(url).searchParams.get('id').split(',');
    return new Response(JSON.stringify({ items: ids.map((id) => ({ id, snippet: { liveBroadcastContent: 'none' } })) }), { status: 200 });
  };
  notLive.clear();
  results = await PROVIDERS.youtube.poll([account], new Map(), { now });
  assert.ok(!results.get('UCx').items.some((item) => item.id === 'liv1'), 'the recording of a stream that was live is not a new video');
  assert.ok(results.get('UCx').items.some((item) => item.id === 'vid1'), 'a real video still is');
  // The feed fails for one channel and not for the others.
  globalThis.fetch = async (url) => (String(url).includes('channel_id=bad') ? new Response('', { status: 404 }) : new Response(rss(entries), { status: 200 }));
  results = await PROVIDERS.youtube.poll([{ ...account, id: 'bad' }, account], new Map(), { now, withLive: false });
  assert.equal(results.get('bad').error, 'unavailable', 'a feed that fails for a channel that was found is YouTube having trouble, not a channel that is gone');
  assert.equal(results.get('UCx').items.length, 4);
  globalThis.fetch = realFetch;
  config.youtubeApiKey = null;

  // --- The auto feeds: a pace in minutes, the same content for everybody in a slot -----------------------------------------------------------------
  {
    const schedule = require('../src/feeds/schedule');
    assert.deepEqual(['', 'daily', '1d', '24h', '1440', 'https://www.wikipedia.org'].map(schedule.parseMinutes), [1440, 1440, 1440, 1440, 1440, 1440], 'nothing, or the old page of the platform, is once a day');
    assert.deepEqual(['15', '15m', '30 min', '2h', 'every:45'].map(schedule.parseMinutes), [15, 15, 30, 120, 45]);
    assert.deepEqual(['4', '1441', '48h'].map(schedule.parseMinutes), [null, null, null], 'less than 5 minutes (spam) or more than a day is refused');
    assert.deepEqual([schedule.accountIdFor('pokemon', 1440), schedule.accountIdFor('chess', 1440), schedule.accountIdFor('wikipedia', 1440), schedule.accountIdFor('pokemon', 15)], ['daily', 'puzzle', 'featured', 'every:15']);
    assert.deepEqual(['daily', 'featured', 'every:15'].map(schedule.minutesOf), [1440, 1440, 15]);
    const realFetch = globalThis.fetch;
    const asked = [];
    globalThis.fetch = async (url) => {
      asked.push(String(url));
      const u = String(url);
      if (u.includes('/page/random/summary')) return new Response(JSON.stringify({ title: 'Random page', titles: { normalized: 'Random page' }, extract: 'About it.', content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Random_page' } }, thumbnail: { source: 'https://upload.wikimedia.org/t.jpg' } }), { status: 200 });
      if (u.includes('/pub/puzzle/random')) return new Response(JSON.stringify({ title: 'A puzzle', url: 'https://www.chess.com/forum/view/x', image: 'https://images.chesscomfiles.com/p.png' }), { status: 200 });
      if (u.includes('/pokemon-species/')) return new Response(JSON.stringify({ flavor_text_entries: [{ language: { name: 'en' }, flavor_text: 'It is a Pokémon.' }], names: [{ language: { name: 'en' }, name: 'Testmon' }] }), { status: 200 });
      if (u.includes('/pokemon/')) return new Response(JSON.stringify({ id: 7, name: 'testmon', types: [{ type: { name: 'water' } }], height: 5, weight: 90, sprites: { front_default: 'https://sprite.example/s.png', other: { 'official-artwork': { front_default: 'https://art.example/a.png' } } } }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    const when = Date.UTC(2026, 9, 27, 10, 7, 30); // a Tuesday, 10:07 UTC
    const slot15 = Math.floor(when / (15 * 60_000));
    for (const platform of ['wikipedia', 'chess', 'pokemon']) {
      const quarter = await PROVIDERS[platform].resolve('15m');
      assert.equal(quarter.id, 'every:15');
      await assert.rejects(PROVIDERS[platform].resolve('3'), (error) => error.kind === 'badInput', `${platform}: a pace under 5 minutes is refused`);
      const accounts = [{ id: 'every:15', name: 'x', url: null }, { id: 'every:60', name: 'x', url: null }];
      const results = await PROVIDERS[platform].poll(accounts, new Map(), { now: when, lang: 'en' });
      const a = results.get('every:15').items[0];
      const b = results.get('every:60').items[0];
      assert.ok(a && b && a.id === `15:${slot15}` && b.id === `60:${Math.floor(when / 3_600_000)}`, `${platform}: each pace has its own slot`);
      assert.equal(a.publishedAt, slot15 * 15 * 60_000, `${platform}: the notice is dated at the start of its slot`);
      const again = (await PROVIDERS[platform].poll([accounts[0]], new Map(), { now: when + 60_000, lang: 'en' })).get('every:15').items[0];
      assert.equal(again.id, a.id, `${platform}: a minute later it is the same notice, so it is not posted twice`);
      const next = (await PROVIDERS[platform].poll([accounts[0]], new Map(), { now: when + 15 * 60_000, lang: 'en' })).get('every:15').items[0];
      assert.equal(next.id, `15:${slot15 + 1}`, `${platform}: the next slot is a new notice`);
      assert.deepEqual((await PROVIDERS[platform].baselineItems(accounts[0], when)).map((item) => item.id), [`15:${slot15}`], `${platform}: a new feed starts at the next slot`);
      assert.deepEqual(await PROVIDERS[platform].baselineItems({ id: 'daily' }, when), [], `${platform}: the once-a-day feed has no baseline`);
    }
    assert.equal(asked.filter((url) => url.includes('/page/random/summary')).length, 3, 'Wikipedia is asked once for each slot, not once for each server');
    globalThis.fetch = realFetch;
  }

  // --- The music, social and game platforms: names, links, and the answers of each service written out -----------------------------------------------
  {
    const music = require('../src/feeds/providers/music');
    const social = require('../src/feeds/providers/social');
    assert.equal(music.parseDeezerArtist('https://www.deezer.com/en/artist/27'), '27');
    assert.equal(music.parseDeezerArtist('27'), '27');
    assert.equal(music.parseDeezerArtist('daft punk'), null);
    assert.equal(music.parseAppleArtist('https://music.apple.com/us/artist/daft-punk/5468295'), '5468295');
    assert.equal(music.parseAppleArtist('5468295'), '5468295');
    assert.equal(music.parseSpotify('https://open.spotify.com/intl-es/artist/4tZwfgrHOc3mvqYlEYSvVi?si=x'), 'artist:4tZwfgrHOc3mvqYlEYSvVi');
    assert.equal(music.parseSpotify('spotify:show:4rOoJ6Egrf8K2IrywzwOMk'), 'show:4rOoJ6Egrf8K2IrywzwOMk');
    assert.equal(music.parseSpotify('daft punk'), null);
    assert.equal(social.parseMastodon('@Gargron@Mastodon.Social'), 'gargron@mastodon.social');
    assert.equal(social.parseMastodon('https://mastodon.social/@Gargron/123'), 'gargron@mastodon.social');
    assert.equal(social.parseMastodon('gargron'), null, 'a Mastodon account needs its server');
    assert.equal(social.parseMastodon('a@localhost'), null, 'and the server must be a real domain');
    assert.equal(social.parseTumblr('https://staff.tumblr.com/post/1'), 'staff');
    assert.equal(social.parseTumblr('Staff.tumblr.com'), 'staff');
    assert.equal(social.parseLetterboxd('https://letterboxd.com/DavidEhrlich/films/'), 'davidehrlich');
    assert.equal(social.parseLetterboxd('https://letterboxd.com/films/'), null);

    config.spotifyClientId = 'id';
    config.spotifyClientSecret = 'secret';
    const day = 86_400_000;
    const now = Date.now();
    const iso = (offset) => new Date(now + offset).toISOString().slice(0, 10);
    const asked = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const u = String(url);
      asked.push(u);
      if (u.startsWith('https://api.deezer.com/artist/27/albums')) return new Response(JSON.stringify({ data: [
        { id: 1, title: 'Old album', release_date: iso(-400 * day), cover_xl: 'https://cdn.dz/old.jpg', link: 'https://www.deezer.com/album/1', record_type: 'album' },
        { id: 2, title: 'New single', release_date: iso(-day), cover_xl: 'https://cdn.dz/new.jpg', link: 'https://www.deezer.com/album/2', record_type: 'single' },
        { id: 3, title: 'Pre-save', release_date: iso(20 * day), cover_xl: 'https://cdn.dz/future.jpg', link: 'https://www.deezer.com/album/3', record_type: 'album' },
      ] }), { status: 200 });
      if (u.startsWith('https://api.deezer.com/artist/404')) return new Response(JSON.stringify({ error: { type: 'DataException', code: 800 } }), { status: 200 });
      if (u.startsWith('https://itunes.apple.com/lookup')) return new Response(JSON.stringify({ results: [
        { wrapperType: 'artist', artistId: 5468295, artistName: 'Artist', artistLinkUrl: 'https://music.apple.com/us/artist/artist/5468295' },
        { wrapperType: 'collection', collectionId: 11, collectionName: 'Newest', artworkUrl100: 'https://is1.mzstatic.com/i/100x100bb.jpg', releaseDate: new Date(now - day).toISOString(), collectionViewUrl: 'https://music.apple.com/us/album/11', trackCount: 1 },
        { wrapperType: 'collection', collectionId: 10, collectionName: 'Older', artworkUrl100: 'https://is1.mzstatic.com/i/100x100bb.jpg', releaseDate: new Date(now - 90 * day).toISOString(), collectionViewUrl: 'https://music.apple.com/us/album/10', trackCount: 12 },
      ] }), { status: 200 });
      if (u === 'https://accounts.spotify.com/api/token') { assert.match(options.headers.Authorization, /^Basic /); return new Response(JSON.stringify({ access_token: 'sp-token', expires_in: 3600 }), { status: 200 }); }
      if (u.startsWith('https://api.spotify.com/v1/')) {
        assert.equal(options.headers.Authorization, 'Bearer sp-token');
        if (u.includes('/artists/AAAAAAAAAAAAAAAAAAAAAA/albums')) return new Response(JSON.stringify({ items: [{ id: 'alb1', name: 'Fresh album', album_type: 'album', total_tracks: 9, release_date: iso(-day), images: [{ url: 'https://i.scdn.co/a.jpg' }], external_urls: { spotify: 'https://open.spotify.com/album/alb1' } }] }), { status: 200 });
        if (u.includes('/shows/BBBBBBBBBBBBBBBBBBBBBB/episodes')) return new Response(JSON.stringify({ items: [{ id: 'ep1', name: 'Episode one', description: 'About it', duration_ms: 3_600_000, release_date: iso(-day), images: [{ url: 'https://i.scdn.co/e.jpg' }], external_urls: { spotify: 'https://open.spotify.com/episode/ep1' } }] }), { status: 200 });
        if (u.includes('/search?')) return new Response(JSON.stringify({ artists: { items: [{ id: 'AAAAAAAAAAAAAAAAAAAAAA', name: 'Artist', images: [{ url: 'https://i.scdn.co/p.jpg' }], followers: { total: 1500 } }] }, shows: { items: [{ id: 'BBBBBBBBBBBBBBBBBBBBBB', name: 'A show', publisher: 'Pub', images: [] }] } }), { status: 200 });
        return new Response(JSON.stringify({ name: u.includes('/shows/') ? 'A show' : 'Artist', images: [{ url: 'https://i.scdn.co/p.jpg' }], external_urls: { spotify: 'https://open.spotify.com/x' } }), { status: 200 });
      }
      if (u.includes('freeGamesPromotions')) return new Response(JSON.stringify({ data: { Catalog: { searchStore: { elements: [
        { id: 'g1', title: 'Free Game', description: 'Fun.', productSlug: 'free-game/home', price: { totalPrice: { discountPrice: 0 } }, keyImages: [{ type: 'OfferImageWide', url: 'https://cdn1.epicgames.com/w.jpg' }, { type: 'Thumbnail', url: 'https://cdn1.epicgames.com/t.jpg' }], promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: new Date(now - day).toISOString(), endDate: new Date(now + 6 * day).toISOString() }] }] } },
        { id: 'g2', title: 'Next week', price: { totalPrice: { discountPrice: 0 } }, keyImages: [], promotions: { promotionalOffers: [], upcomingPromotionalOffers: [{ promotionalOffers: [{ startDate: new Date(now + 6 * day).toISOString() }] }] } },
        { id: 'g3', title: 'Just a discount', price: { totalPrice: { discountPrice: 500 } }, keyImages: [], promotions: { promotionalOffers: [{ promotionalOffers: [{ startDate: new Date(now - day).toISOString() }] }] } },
      ] } } } }), { status: 200 });
      if (u === 'https://staff.tumblr.com/rss') return new Response('<?xml version="1.0"?><rss><channel><title>Tumblr Staff</title><item><title>A post</title><link>https://staff.tumblr.com/post/1</link><guid>https://staff.tumblr.com/post/1</guid><description>&lt;p&gt;Hello&lt;/p&gt;</description><pubDate>' + new Date(now - 3600_000).toUTCString() + '</pubDate></item></channel></rss>', { status: 200 });
      return new Response('{}', { status: 404 });
    };

    // Deezer: newest first, a release dated far in the future waits, an artist that does not exist is not found.
    const deezerAccount = { id: '27', name: 'Daft', avatar: null, url: 'https://www.deezer.com/artist/27' };
    const deezer = (await PROVIDERS.deezer.poll([deezerAccount], new Map(), { now })).get('27');
    assert.deepEqual(deezer.items.map((item) => [item.id, item.type]), [['2', 'release']], 'only the release of this week is news: not the old one, not the one that is still to come');
    assert.equal(deezer.items[0].image, 'https://cdn.dz/new.jpg');
    assert.equal(deezer.items[0].extra, 'SINGLE');
    await assert.rejects(PROVIDERS.deezer.resolve('404'), (error) => error.kind === 'notFound');
    // Apple Music: the newest first, with the cover in a good size.
    const apple = (await PROVIDERS.applemusic.poll([{ id: '5468295', name: 'Artist', avatar: null, url: 'https://music.apple.com/us/artist/artist/5468295' }], new Map(), { now })).get('5468295');
    assert.deepEqual(apple.items.map((item) => item.id), ['11']);
    assert.ok(apple.items[0].image.includes('600x600bb'), 'the cover is asked in a big size');
    // Spotify: with the app keys, artists give releases and podcasts give episodes.
    const spotifyResolved = await PROVIDERS.spotify.resolve('https://open.spotify.com/artist/AAAAAAAAAAAAAAAAAAAAAA');
    assert.deepEqual([spotifyResolved.id, spotifyResolved.name], ['artist:AAAAAAAAAAAAAAAAAAAAAA', 'Artist']);
    const spotify = (await PROVIDERS.spotify.poll([{ ...spotifyResolved }, { id: 'show:BBBBBBBBBBBBBBBBBBBBBB', name: 'A show', avatar: null, url: 'https://open.spotify.com/show/B' }], new Map(), { now }));
    assert.deepEqual([spotify.get('artist:AAAAAAAAAAAAAAAAAAAAAA').items[0].type, spotify.get('show:BBBBBBBBBBBBBBBBBBBBBB').items[0].type], ['release', 'episode']);
    assert.equal(spotify.get('show:BBBBBBBBBBBBBBBBBBBBBB').items[0].extra, '60 min');
    assert.equal(asked.filter((url) => url === 'https://accounts.spotify.com/api/token').length, 1, 'the token is asked once and kept');
    const { searchAccounts: search, forgetSearches: forgetAll } = require('../src/feeds/search');
    forgetAll();
    const found = await search('spotify', 'artist');
    assert.deepEqual(found.map((entry) => entry.value), ['artist:AAAAAAAAAAAAAAAAAAAAAA', 'show:BBBBBBBBBBBBBBBBBBBBBB'], 'a search of Spotify finds artists and podcasts');
    config.spotifyClientId = null;
    await assert.rejects(PROVIDERS.spotify.resolve('Artist'), (error) => error.kind === 'notConfigured', 'without the keys Spotify says it is not set up');
    config.spotifyClientSecret = null;
    // Epic Games: only the game that is free now, in its own language, with the day it ends.
    const epic = (await PROVIDERS.epic.poll([{ id: 'free' }], new Map(), { now, lang: 'es' })).get('free').items;
    assert.deepEqual(epic.map((item) => [item.id.split(':')[0], item.type]), [['g1', 'game']], 'an upcoming offer and a plain discount are not free games');
    assert.ok(epic[0].url.endsWith('/p/free-game') && epic[0].url.includes('es-ES'));
    assert.match(epic[0].extra, /^Gratis hasta el /);
    assert.ok(asked.some((url) => url.includes('locale=es-ES') && url.includes('country=ES')));
    // Tumblr through the reader of RSS.
    const tumblr = await PROVIDERS.tumblr.resolve('staff.tumblr.com');
    assert.deepEqual([tumblr.id, tumblr.name], ['staff', 'Tumblr Staff']);
    const posts = (await PROVIDERS.tumblr.poll([tumblr], new Map(), { now })).get('staff').items;
    assert.deepEqual([posts.length, posts[0].type, posts[0].platform], [1, 'post', 'tumblr']);
    globalThis.fetch = realFetch;
  }

  // --- Music beyond one artist: playlists, charts, the new albums of a country, and the link of a song or an album ----------------------------------------
  {
    config.spotifyClientId = 'id';
    config.spotifyClientSecret = 'secret';
    const day = 86_400_000;
    const now = Date.now();
    const realFetch = globalThis.fetch;
    const asked = [];
    const deezerTrack = (id, title, added) => ({ id, title, title_short: title, link: `https://www.deezer.com/track/${id}`, time_add: Math.floor((now - added * day) / 1000), artist: { id: 7, name: 'Singer', link: 'https://www.deezer.com/artist/7' }, album: { cover_xl: `https://cdn.dz/${id}.jpg` } });
    globalThis.fetch = async (url, options = {}) => {
      const u = String(url);
      asked.push(u);
      if (u === 'https://api.deezer.com/playlist/55') return new Response(JSON.stringify({ id: 55, title: 'My list', public: true, picture_xl: 'https://cdn.dz/pl.jpg', link: 'https://www.deezer.com/playlist/55' }), { status: 200 });
      if (u === 'https://api.deezer.com/playlist/55/tracks?limit=1') return new Response(JSON.stringify({ data: [], total: 3 }), { status: 200 });
      if (u.startsWith('https://api.deezer.com/playlist/55/tracks?index=0&limit=30')) return new Response(JSON.stringify({ data: [deezerTrack(1, 'Old song', 90), deezerTrack(2, 'Newer song', 1), deezerTrack(3, 'Mid song', 2)] }), { status: 200 });
      if (u === 'https://api.deezer.com/genre') return new Response(JSON.stringify({ data: [{ id: 0, name: 'All' }, { id: 152, name: 'Rock', picture_xl: 'https://cdn.dz/rock.jpg' }] }), { status: 200 });
      if (u.startsWith('https://api.deezer.com/chart/152/tracks')) return new Response(JSON.stringify({ data: [{ ...deezerTrack(9, 'On top', 0), position: 1 }, { ...deezerTrack(8, 'Second', 0), position: 2 }] }), { status: 200 });
      if (u.startsWith('https://api.deezer.com/search/playlist')) return new Response(JSON.stringify({ data: [{ id: 55, title: 'My list', public: true, nb_tracks: 3, picture_medium: 'https://cdn.dz/pl.jpg', link: 'https://www.deezer.com/playlist/55' }, { id: 56, title: 'Private', public: false }] }), { status: 200 });
      if (u.startsWith('https://api.deezer.com/search/artist')) return new Response(JSON.stringify({ data: [{ id: 7, name: 'Singer', nb_fan: 2500, picture_medium: 'https://cdn.dz/s.jpg', link: 'https://www.deezer.com/artist/7' }] }), { status: 200 });
      if (u === 'https://api.deezer.com/album/12') return new Response(JSON.stringify({ id: 12, artist: { id: 7 } }), { status: 200 });
      if (u === 'https://api.deezer.com/artist/7') return new Response(JSON.stringify({ id: 7, name: 'Singer', picture_xl: 'https://cdn.dz/s.jpg', link: 'https://www.deezer.com/artist/7' }), { status: 200 });
      if (u.startsWith('https://rss.marketingtools.apple.com/api/v2/co/music/most-played/10/songs.json')) return new Response(JSON.stringify({ feed: { results: [{ id: '501', name: 'Hit', artistName: 'Star', artistUrl: 'https://music.apple.com/co/artist/star/1', url: 'https://music.apple.com/co/album/hit/500?i=501', artworkUrl100: 'https://is1.mzstatic.com/i/100x100bb.jpg' }] } }), { status: 200 });
      if (u.startsWith('https://itunes.apple.com/lookup?id=777')) return new Response(JSON.stringify({ results: [{ wrapperType: 'collection', collectionId: 777, artistId: 5468295 }] }), { status: 200 });
      if (u.startsWith('https://itunes.apple.com/lookup?id=5468295')) return new Response(JSON.stringify({ results: [{ wrapperType: 'artist', artistId: 5468295, artistName: 'Apple Artist', artistLinkUrl: 'https://music.apple.com/us/artist/a/5468295' }, { wrapperType: 'collection', collectionId: 1, artworkUrl100: 'https://is1.mzstatic.com/i/100x100bb.jpg' }] }), { status: 200 });
      if (u === 'https://accounts.spotify.com/api/token') return new Response(JSON.stringify({ access_token: 'sp-token', expires_in: 3600 }), { status: 200 });
      if (u.startsWith('https://api.spotify.com/v1/playlists/PPPPPPPPPPPPPPPPPPPPPP/tracks?limit=1')) return new Response(JSON.stringify({ total: 2 }), { status: 200 });
      if (u.startsWith('https://api.spotify.com/v1/playlists/PPPPPPPPPPPPPPPPPPPPPP/tracks?offset=0')) return new Response(JSON.stringify({ items: [
        { added_at: new Date(now - 40 * day).toISOString(), track: { id: 't1', name: 'Older', type: 'track', artists: [{ name: 'A' }], album: { images: [{ url: 'https://i.scdn.co/1.jpg' }] } } },
        { added_at: new Date(now - day).toISOString(), track: { id: 't2', name: 'Fresh track', type: 'track', external_urls: { spotify: 'https://open.spotify.com/track/t2' }, artists: [{ name: 'B', external_urls: { spotify: 'https://open.spotify.com/artist/b' } }], album: { images: [{ url: 'https://i.scdn.co/2.jpg' }] } } },
        { added_at: new Date(now - day).toISOString(), track: { id: 'e1', name: 'An episode', type: 'episode' } },
      ] }), { status: 200 });
      if (u.startsWith('https://api.spotify.com/v1/playlists/PPPPPPPPPPPPPPPPPPPPPP?')) return new Response(JSON.stringify({ name: 'Spotify list', images: [{ url: 'https://i.scdn.co/pl.jpg' }], external_urls: { spotify: 'https://open.spotify.com/playlist/PPPPPPPPPPPPPPPPPPPPPP' } }), { status: 200 });
      if (u.startsWith('https://api.spotify.com/v1/browse/new-releases?country=CO')) return new Response(JSON.stringify({ albums: { items: [{ id: 'n1', name: 'Fresh', album_type: 'album', release_date: new Date(now - day).toISOString().slice(0, 10), artists: [{ name: 'Z', external_urls: { spotify: 'https://open.spotify.com/artist/z' } }], images: [{ url: 'https://i.scdn.co/n.jpg' }], external_urls: { spotify: 'https://open.spotify.com/album/n1' } }, { id: 'n2', name: 'Compilation', album_type: 'compilation', release_date: new Date(now - day).toISOString().slice(0, 10), artists: [] }] } }), { status: 200 });
      if (u.startsWith('https://api.spotify.com/v1/albums/AAAAAAAAAAAAAAAAAAAAAA')) return new Response(JSON.stringify({ artists: [{ id: 'ZZZZZZZZZZZZZZZZZZZZZZ' }] }), { status: 200 });
      if (u.startsWith('https://api.spotify.com/v1/artists/ZZZZZZZZZZZZZZZZZZZZZZ')) return new Response(JSON.stringify({ name: 'Z', images: [], external_urls: { spotify: 'https://open.spotify.com/artist/z' } }), { status: 200 });
      return new Response('{}', { status: 404 });
    };

    // Deezer: a playlist gives its newest songs (the list is read from its end), a chart gives the ones on top, a song or an album gives its artist.
    const list = await PROVIDERS.deezer.resolve('https://www.deezer.com/en/playlist/55');
    assert.deepEqual([list.id, list.name], ['playlist:55', 'My list']);
    const songs = (await PROVIDERS.deezer.poll([list], new Map(), { now })).get('playlist:55').items;
    assert.deepEqual(songs.map((item) => item.title), ['Newer song', 'Mid song'], 'newest first, and a song added 90 days ago is not news');
    assert.deepEqual([songs[0].type, songs[0].extra, songs[0].author], ['release', 'My list', 'Singer']);
    const chart = await PROVIDERS.deezer.resolve('chart:152:tracks');
    assert.deepEqual([chart.id, chart.name], ['chart:152:tracks', 'Top 10 · Rock']);
    const top = (await PROVIDERS.deezer.poll([chart], new Map(), { now })).get('chart:152:tracks').items;
    assert.deepEqual(top.map((item) => [item.title, item.extra]), [['On top', 'TOP 1'], ['Second', 'TOP 2']]);
    assert.equal((await PROVIDERS.deezer.resolve('https://www.deezer.com/album/12')).id, '7', 'the link of an album follows its artist');
    const baseline = await PROVIDERS.deezer.baselineItems(chart);
    assert.deepEqual(baseline.map((item) => item.id), ['9', '8'], 'what is on top when the feed is made is not news');
    const { searchAccounts: search, forgetSearches: forgetAll } = require('../src/feeds/search');
    forgetAll();
    assert.deepEqual((await search('deezer', 'top rock')).map((entry) => entry.value), ['chart:152:tracks', 'chart:152:albums'], 'typing top and a genre offers its charts');
    forgetAll();
    assert.deepEqual((await search('deezer', 'singer')).map((entry) => entry.value), ['7', 'playlist:55'], 'a search finds artists and the public playlists (not the private ones)');

    // Apple Music: the chart of a country, the artist of an album, and a playlist is not possible.
    forgetAll();
    assert.deepEqual((await search('applemusic', 'top colombia')).map((entry) => entry.value), ['chart:co:songs', 'chart:co:albums']);
    const apple = await PROVIDERS.applemusic.resolve('chart:co:songs');
    const hits = (await PROVIDERS.applemusic.poll([apple], new Map(), { now })).get('chart:co:songs').items;
    assert.deepEqual([hits[0].title, hits[0].extra, hits[0].author], ['Hit', 'TOP 1', 'Star']);
    assert.equal((await PROVIDERS.applemusic.resolve('https://music.apple.com/us/album/name/777')).id, '5468295', 'the link of an album follows its artist');
    await assert.rejects(PROVIDERS.applemusic.resolve('https://music.apple.com/us/playlist/todays-hits/pl.f4d106fed2bd41149aaacabb233eb5eb'), (error) => error.kind === 'unsupported');

    // Spotify: a playlist, the new albums of a country, and the artist of an album or a song.
    const spotifyList = await PROVIDERS.spotify.resolve('https://open.spotify.com/playlist/PPPPPPPPPPPPPPPPPPPPPP?si=1');
    assert.deepEqual([spotifyList.id, spotifyList.name], ['playlist:PPPPPPPPPPPPPPPPPPPPPP', 'Spotify list']);
    const tracks = (await PROVIDERS.spotify.poll([spotifyList], new Map(), { now })).get(spotifyList.id).items;
    assert.deepEqual(tracks.map((item) => [item.id, item.extra]), [['t2', 'Spotify list']], 'only the song added this week; the old one and the episode are not news');
    const fresh = await PROVIDERS.spotify.resolve('new:CO');
    assert.equal(fresh.id, 'new:CO');
    const albums = (await PROVIDERS.spotify.poll([fresh], new Map(), { now })).get('new:CO').items;
    assert.deepEqual(albums.map((item) => [item.id, item.author, item.extra]), [['n1', 'Z', 'ALBUM']], 'the new albums of the country, without the compilations');
    assert.equal((await PROVIDERS.spotify.resolve('https://open.spotify.com/album/AAAAAAAAAAAAAAAAAAAAAA')).id, 'artist:ZZZZZZZZZZZZZZZZZZZZZZ', 'the link of an album follows its artist');
    forgetAll();
    assert.deepEqual((await search('spotify', 'new colombia')).map((entry) => entry.value), ['new:CO']);

    const musicHelpers = require('../src/feeds/providers/music');
    assert.deepEqual(['top', 'Top Rock', 'charts colombia', 'hello'].map(musicHelpers.chartWords), ['', 'Rock', 'colombia', null]);
    assert.deepEqual(['colombia', 'CO', 'United States', 'EEUU', 'atlantis'].map(musicHelpers.countryOf), ['co', 'co', 'us', 'us', null]);
    config.spotifyClientId = null;
    config.spotifyClientSecret = null;
    globalThis.fetch = realFetch;
  }

  // --- Lists of what is new: the newest projects of Modrinth and the lists of the Steam store -------------------------------------------------------------
  {
    const now = Date.now();
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      if (u.startsWith('https://api.modrinth.com/v2/search?limit=10&index=newest')) {
        assert.ok(decodeURIComponent(u).includes('project_type:shader'), 'the kind is asked for');
        return new Response(JSON.stringify({ hits: [{ project_id: 'sh1', slug: 'glow', title: 'Glow', description: 'Light it up', project_type: 'shader', icon_url: 'https://cdn.modrinth.com/i.webp', author: 'someone', date_created: new Date(now - 3600_000).toISOString(), versions: ['1.20', '1.21'], gallery: ['https://cdn.modrinth.com/g.png'] }] }), { status: 200 });
      }
      if (u.startsWith('https://store.steampowered.com/api/featuredcategories')) return new Response(JSON.stringify({ top_sellers: { items: [{ id: 10, name: 'Big Game', header_image: 'https://cdn.steam/h.jpg' }, { id: 11, name: 'Other' }] }, new_releases: { items: [{ id: 20, name: 'Fresh' }] } }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    const shaders = await PROVIDERS.modrinth.resolve('new:shader');
    assert.deepEqual([shaders.id, shaders.name], ['new:shader', 'New shaders']);
    const projects = (await PROVIDERS.modrinth.poll([shaders], new Map(), { now })).get('new:shader').items;
    assert.deepEqual([projects.length, projects[0].title, projects[0].type, projects[0].extra, projects[0].author], [1, 'Glow', 'project', 'SHADER · 1.21', 'someone']);
    const several = await PROVIDERS.modrinth.resolve('new:shader+mod', { lang: 'es' });
    assert.deepEqual([several.id, several.name], ['new:mod+shader', 'Mods nuevos + Shaders nuevos'], 'several kinds in one feed (always in the same order)');
    assert.deepEqual([(await PROVIDERS.modrinth.resolve('new:all')).id, (await PROVIDERS.modrinth.resolve('new:all', { lang: 'pt-BR' })).name], ['new:all', 'Novidades do Modrinth']);
    await assert.rejects(PROVIDERS.modrinth.resolve('new:nonsense'), () => true, 'a kind that does not exist is not a list');
    assert.deepEqual((await PROVIDERS.modrinth.baselineItems(shaders)).map((item) => item.id), ['sh1']);
    const top = await PROVIDERS.steam.resolve('store:top');
    assert.equal(top.name, 'Steam · Top sellers');
    const sellers = (await PROVIDERS.steam.poll([top], new Map(), { now })).get('store:top').items;
    assert.deepEqual(sellers.map((item) => [item.title, item.extra]), [['Big Game', 'TOP 1'], ['Other', 'TOP 2']]);
    const { searchAccounts: search, forgetSearches: forgetAll } = require('../src/feeds/search');
    forgetAll();
    assert.deepEqual((await search('modrinth', 'new shaders')).map((entry) => entry.value), ['new:shader']);
    forgetAll();
    const everything = await search('modrinth', 'nuevos');
    assert.deepEqual([everything.length, everything[0].value], [7, 'new:all'], 'new alone offers every kind together first, then each one');
    forgetAll();
    assert.equal((await search('modrinth', 'new mods shaders'))[0].value, 'new:mod+shader', 'two kinds written offer them in one feed');
    forgetAll();
    assert.deepEqual((await search('steam', 'top')).map((entry) => entry.value), ['store:top']);
    forgetAll();
    assert.deepEqual((await search('steam', 'new')).map((entry) => entry.value), ['store:new', 'store:top', 'store:soon'], 'new alone offers the three lists');
    globalThis.fetch = realFetch;
  }

  // --- A release is headed by a picture drawn for it (cover + title), the rest of the kinds are not -----------------------------------------------------
  {
    const { heroFor } = require('../src/feeds/hero');
    assert.equal(await heroFor({ type: 'video', image: 'https://i.ytimg.com/vi/x/hq.jpg', title: 'A video' }), null, 'only a release gets the picture');
    assert.equal(await heroFor({ type: 'release', image: null, title: 'No cover' }), null, 'and only when it has a cover');
    const release = { platform: 'deezer', type: 'release', id: '9', title: 'An album', url: 'https://www.deezer.com/album/9', image: 'https://cdn.dz/a.jpg', author: 'An artist', extra: 'ALBUM', publishedAt: Date.now() };
    const withHero = JSON.parse(JSON.stringify(card.buildFeedMessage({ message: '', options: {}, ping_roles: [] }, release, { lang: 'en', hero: { name: 'release.png' } }).components));
    assert.equal(withHero[0].components[0].items[0].media.url, 'attachment://release.png', 'the picture of the release is the head of the card');
    assert.equal(withHero[0].components.at(-1).components[0].label, 'Listen on Deezer', 'and the button opens the release');
    const plain = JSON.stringify(card.buildFeedMessage({ message: '', options: {}, ping_roles: [] }, release, { lang: 'en' }).components);
    assert.ok(plain.includes('https://cdn.dz/a.jpg') && !plain.includes('attachment://'), 'without the picture it is the ordinary card with the cover');
  }

  // --- The YouTube key has a daily budget: the search and the way out of a failing feed stop early so the live check never runs dry ---------------------------
  {
    const youtube = require('../src/feeds/providers/youtube');
    const before = youtube.quotaUsed();
    assert.equal(youtube.canSpend(100, 0.5), before + 100 <= config.youtubeDailyQuota * 0.5, 'a search is allowed while the day is under half of the budget');
    youtube.spend(Math.ceil(config.youtubeDailyQuota * 0.6) - before);
    assert.equal(youtube.canSpend(100, 0.5), false, 'past half of the day the searches stop');
    assert.equal(youtube.canSpend(2, 0.7), true, 'but the way out of a failing feed still has room until 70%');
    youtube.spend(Math.ceil(config.youtubeDailyQuota * 0.15));
    assert.equal(youtube.canSpend(2, 0.7), false, 'and past 70% it stops too');
    assert.equal(youtube.canSpend(1), true, 'the live check keeps its room until the budget is gone');
    youtube.spend(-(youtube.quotaUsed() - before)); // back to where the day was
  }

  // --- What the bot learned about the YouTube videos is kept in Redis, so a restart does not forget it (and does not spend the quota again) --------------------
  {
    const redis = require('../src/utils/redis');
    const providers = require('../src/feeds/providers');
    const youtube = require('../src/feeds/providers/youtube');
    const kept = new Map();
    const original = { getJson: redis.getJson, setJson: redis.setJson, incr: redis.incr };
    redis.setJson = async (key, value) => { kept.set(key, JSON.parse(JSON.stringify(value))); return true; };
    redis.getJson = async (key) => (kept.has(key) ? { hit: true, value: kept.get(key) } : { hit: false });
    redis.incr = async (key) => { kept.set(key, (kept.get(key) ?? 0) + 1); return kept.get(key); };
    providers.notLive.clear(); providers.wasLive.clear();
    providers.rememberNotLive('vid-a');
    providers.wasLive.add('live-b');
    youtube.importLengths([['vid-a', 42]]);
    assert.equal(await providers.saveYoutubeState(Date.now() + 120_000), true, 'what changed is written');
    assert.deepEqual([kept.get('feeds:youtube:state').notLive, kept.get('feeds:youtube:state').lengths], [['vid-a'], [['vid-a', 42]]]);
    assert.equal(await providers.saveYoutubeState(Date.now() + 121_000), false, 'and nothing is written again when nothing changed');
    const quotaBefore = youtube.quotaUsed();
    youtube.spend(7);
    assert.equal([...kept.keys()].some((key) => key.startsWith('feeds:youtube:quota:')), true, 'the units spent are counted in Redis');
    providers.notLive.clear(); providers.wasLive.clear();
    kept.set('feeds:youtube:state', { notLive: ['vid-a'], wasLive: ['live-b'], lengths: [['vid-a', 42]], at: Date.now() });
    assert.equal(await providers.restoreYoutubeState(), true, 'the state is read back after a restart');
    assert.deepEqual([providers.notLive.has('vid-a'), providers.wasLive.has('live-b')], [true, true]);
    kept.set(`feeds:youtube:quota:${[...kept.keys()].find((key) => key.startsWith('feeds:youtube:quota:')).split(':').pop()}`, quotaBefore + 500);
    assert.ok((await youtube.restoreQuota()) >= quotaBefore + 500, 'and so are the units already spent today');
    youtube.spend(-(youtube.quotaUsed() - quotaBefore));
    // Without Redis nothing breaks: the answers are "nothing there".
    redis.getJson = async () => ({ hit: false });
    assert.equal(await providers.restoreYoutubeState(), false);
    Object.assign(redis, original);
    providers.notLive.clear(); providers.wasLive.clear();
  }

  // --- Animals: a picture for each slot of time, the same for everybody, at the pace of the account; several services each, the next one when one is down ---
  {
    const realFetch = globalThis.fetch;
    const asked = [];
    const down = new Set(); // hosts that do not answer
    const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
    globalThis.fetch = async (url) => {
      const u = String(url);
      asked.push(u);
      const host = new URL(u).host;
      if (down.has(host)) return new Response('{}', { status: 500 });
      if (host === 'api.thecatapi.com') return ok([{ id: 'c1', url: 'https://cdn2.thecatapi.com/images/c1.jpg' }]);
      if (host === 'cataas.com') return ok({ url: 'https://cataas.com/cat/c2?position=center' });
      if (host === 'dog.ceo') return ok({ message: 'https://images.dog.ceo/breeds/chow/n1.jpg', status: 'success' });
      if (host === 'api.thedogapi.com') return ok([{ url: 'https://cdn2.thedogapi.com/images/d2.jpg' }]);
      if (host === 'randomfox.ca') return ok({ image: 'https://randomfox.ca/images/7.jpg', link: 'https://randomfox.ca/?i=7' });
      if (host === 'api.sefinek.net') return ok({ message: `https://cdn.sefinek.net/images/animals/${u.split('/').pop()}/x.jpg` });
      if (host === 'random-d.uk') return ok({ url: 'http://random-d.uk/api/483.JPG' });
      if (host === 'api.capy.lol') return ok({ data: { url: 'http://api.capy.lol/v1/capybara/45' } });
      if (host === 'api.bunnies.io') return ok({ media: { poster: 'https://bunnies.media/poster/76.png' } });
      return new Response('{}', { status: 404 });
    };
    const when = Date.UTC(2026, 9, 27, 10, 7, 30);
    const titles = { cat: ['Un gatito para ti', 'A cat for you'], dog: ['Un perrito para ti', 'A dog for you'], fox: ['Un zorrito para ti', 'A fox for you'], bird: ['Un pajarito para ti', 'A bird for you'], duck: ['Un patito para ti', 'A duck for you'], capybara: ['Una capibara para ti', 'A capybara for you'], bunny: ['Un conejito para ti', 'A bunny for you'] };
    for (const [animal, [es]] of Object.entries(titles)) {
      const account = await PROVIDERS[animal].resolve('30m');
      assert.equal(account.id, 'every:30');
      assert.equal((await PROVIDERS[animal].resolve('')).id, 'daily', 'nothing is once a day');
      await assert.rejects(PROVIDERS[animal].resolve('4m'), (error) => error.kind === 'badInput');
      assert.equal((await PROVIDERS[animal].resolve('5m')).id, 'every:5', 'five minutes is the shortest pace');
      const before = asked.length;
      const first = (await PROVIDERS[animal].poll([account, { id: 'every:30' }], new Map(), { now: when, lang: 'es' })).get('every:30').items[0];
      assert.deepEqual([first.type, first.title, first.platform], ['photo', es, animal]);
      assert.ok(first.image.startsWith('https://'), 'a service that answers with http is used over https');
      assert.ok(!first.author && !first.authorUrl && !account.url, 'the notice does not say where the picture comes from');
      const again = (await PROVIDERS[animal].poll([account], new Map(), { now: when + 60_000, lang: 'en' })).get('every:30').items[0];
      assert.equal(again.id, first.id, 'a minute later it is the same picture');
      assert.equal(asked.length - before, 1, 'the service is asked once for each slot');
    }
    // When the service of a slot is down the next one answers.
    down.add('api.thecatapi.com'); down.add('cataas.com');
    const catAccount = await PROVIDERS.cat.resolve('15m');
    const viaSefinek = (await PROVIDERS.cat.poll([catAccount], new Map(), { now: when + 7 * 15 * 60_000, lang: 'en' })).get('every:15').items[0];
    assert.ok(viaSefinek.image.includes('sefinek'), 'the third service of cats answers when the other two are down');
    down.clear();
    // `animals` is any of them, one for each slot, the same for everybody.
    const mixed = await PROVIDERS.animals.resolve('15m');
    assert.equal(mixed.id, 'every:15');
    const kinds = new Set();
    for (let slot = 0; slot < 14; slot += 1) {
      const item = (await PROVIDERS.animals.poll([mixed], new Map(), { now: when + slot * 15 * 60_000, lang: 'en' })).get('every:15').items[0];
      kinds.add(item.title);
      assert.equal(item.platform, 'animals');
    }
    assert.deepEqual([...kinds].sort(), Object.values(titles).map(([, en]) => en).sort(), 'every kind of animal comes up');
    globalThis.fetch = realFetch;
  }

  // --- The animals are one feed: any of them, or only the ones asked for (in three languages), each choice a feed of its own -------------------------------------
  {
    const animals = require('../src/feeds/providers/animals');
    assert.deepEqual(animals.parseAnimalInput('15m cat dog'), { tokens: ['15m'], kinds: ['cat', 'dog'] });
    assert.deepEqual(animals.parseAnimalInput('gatos, perritos 1h'), { tokens: ['1h'], kinds: ['cat', 'dog'] }, 'in Spanish');
    assert.deepEqual(animals.parseAnimalInput('capivara coelhinho'), { tokens: [], kinds: ['bunny', 'capybara'] }, 'in Portuguese');
    assert.deepEqual(animals.parseAnimalInput('30m all'), { tokens: ['30m'], kinds: [] }, 'all is no choice at all');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const host = new URL(String(url)).host;
      const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
      if (host === 'api.thecatapi.com') return ok([{ url: 'https://cdn2.thecatapi.com/images/c1.jpg' }]);
      if (host === 'dog.ceo') return ok({ message: 'https://images.dog.ceo/breeds/chow/n1.jpg' });
      if (host === 'randomfox.ca') return ok({ image: 'https://randomfox.ca/images/7.jpg' });
      return new Response('{}', { status: 404 });
    };
    const both = await PROVIDERS.animals.resolve('15m cat dog', { lang: 'es' });
    assert.deepEqual([both.id, both.name], ['every:15:cat+dog', 'Gatos + Perros'], 'the choice is part of the account, and its name is in the language of who follows it');
    assert.equal((await PROVIDERS.animals.resolve('15m cat dog')).id, both.id, 'the same choice is the same account');
    assert.equal((await PROVIDERS.animals.resolve('15m')).id, 'every:15', 'no choice is every animal');
    assert.equal((await PROVIDERS.animals.resolve('')).id, 'daily', 'and nothing at all is once a day');
    assert.equal((await PROVIDERS.animals.resolve('cat')).id, 'every:1440:cat', 'a choice without a pace is once a day');
    await assert.rejects(PROVIDERS.animals.resolve('4m cat'), (error) => error.kind === 'badInput');
    const when = Date.UTC(2026, 9, 27, 10, 7, 30);
    const titles = new Set();
    for (let slot = 0; slot < 8; slot += 1) {
      const item = (await PROVIDERS.animals.poll([both], new Map(), { now: when + slot * 15 * 60_000, lang: 'en' })).get(both.id).items[0];
      titles.add(item.title);
    }
    assert.deepEqual([...titles].sort(), ['A cat for you', 'A dog for you'], 'only the animals asked for come up');
    assert.equal(require('../src/feeds/schedule').minutesOf('every:15:cat+dog'), 15, 'the pace is read from an account with a choice');
    globalThis.fetch = realFetch;
  }

  // --- Random music: a song of the charts of a random genre for each slot of time, the same for everybody -----------------------------------------------
  {
    const realFetch = globalThis.fetch;
    const asked = [];
    globalThis.fetch = async (url) => {
      const u = String(url);
      asked.push(u);
      if (u === 'https://api.deezer.com/genre') return new Response(JSON.stringify({ data: [{ id: 0, name: 'All' }, { id: 152, name: 'Rock' }] }), { status: 200 });
      const chart = /chart\/(\d+)\/tracks/.exec(u);
      if (chart) return new Response(JSON.stringify({ data: [1, 2, 3, 4].map((n) => ({ id: Number(chart[1]) * 10 + n, title: `Song ${chart[1]}-${n}`, link: `https://www.deezer.com/track/${n}`, artist: { name: 'Singer', link: 'https://www.deezer.com/artist/7' }, album: { cover_xl: 'https://cdn.dz/c.jpg' } })) }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    const when = Date.UTC(2026, 9, 27, 10, 7, 30);
    const account = await PROVIDERS.randommusic.resolve('10m');
    assert.equal(account.id, 'every:10');
    await assert.rejects(PROVIDERS.randommusic.resolve('3m'), (error) => error.kind === 'badInput');
    const song = (await PROVIDERS.randommusic.poll([account], new Map(), { now: when })).get('every:10').items[0];
    assert.deepEqual([song.type, song.platform, song.author], ['track', 'deezer', 'Singer'], 'a song that opens on Deezer, with its own kind of notice');
    const before = asked.length;
    const again = (await PROVIDERS.randommusic.poll([account], new Map(), { now: when + 60_000 })).get('every:10').items[0];
    assert.equal(again.id, song.id);
    assert.equal(asked.length, before, 'the same slot is not asked again');
    const next = (await PROVIDERS.randommusic.poll([account], new Map(), { now: when + 10 * 60_000 })).get('every:10').items[0];
    assert.notEqual(next.id, song.id, 'the next slot is another song');
    const songCard = JSON.parse(JSON.stringify(card.buildFeedMessage({ message: '', options: {}, ping_roles: [] }, song, { lang: 'es', hero: { name: 'release.png' } }).components));
    assert.equal(songCard[0].components.at(-1).components[0].label, 'Escuchar en Deezer');
    assert.ok(JSON.stringify(songCard).includes('Una canción para ti'), 'and says what it is');
    globalThis.fetch = realFetch;
  }

  // --- Pictures by tags: a few tags and a pace, a picture of what is tagged that way (Flickr's public feed of tags), the same for everybody -------------------------
  {
    const pictures = require('../src/feeds/providers/pictures');
    assert.deepEqual(pictures.parseTags('Rosa #Estética, gatos'), ['pink', 'aesthetic', 'cats'], 'accents and signs go, the common words of Spanish become the English ones, and `rosa` next to a thing is the color');
    assert.deepEqual(pictures.parseTags('a b pink pink blue green red gold'), ['pink', 'blue', 'green', 'red'], 'one letter is no tag, a tag twice is one, and four at most');
    assert.equal(pictures.refused(['pink', 'nsfw']), true, 'some words are never followed');
    // A word with several meanings is asked about, unless the other words say which one.
    assert.deepEqual(pictures.parseQuery('rosa').ambiguous?.senses.map((each) => each.key), ['flower', 'color', 'mountain'], '`rosa` alone: the flower, the color or the mountain');
    assert.deepEqual(pictures.parseQuery('flor rosa anime'), { tags: ['flower', 'pink', 'anime'], ambiguous: null }, 'a pink flower, drawn');
    assert.deepEqual(pictures.parseTags('rosa roja'), ['rose-flower', 'red'], 'a red rose');
    assert.deepEqual(pictures.parseTags('rosa montaña'), ['monte-rosa', 'mountain'], 'the mountain');
    assert.deepEqual(pictures.parseTags('gato naranja'), ['cat', 'orange-color'], 'an orange cat');
    assert.ok(pictures.parseQuery('rosa anime').ambiguous, 'a word of style does not say which meaning');
    assert.deepEqual(pictures.parseQuery('rose-flower'), { tags: ['rose-flower'], ambiguous: null }, 'a meaning that was chosen is never asked about again');
    assert.deepEqual(pictures.choicesFor('30m rosa', pictures.parseQuery('rosa').ambiguous).map((each) => each.account), ['30m rose-flower', '30m pink', '30m monte-rosa']);
    assert.equal(pictures.queryLabel(['flower', 'pink', 'anime']), 'flower · pink · anime style');
    const asked = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => {
      const u = String(url);
      asked.push(u);
      if (u.startsWith('https://live.staticflickr.com/')) return new Response(new Uint8Array([0xff, 0xd8, 0xff, ...new Array(3000).fill(1)]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
      if (!u.startsWith('https://www.flickr.com/services/feeds/photos_public.gne')) return new Response('{}', { status: 404 });
      const mode = /tagmode=(\w+)/.exec(u)[1];
      assert.equal(mode, 'all', 'every tag is needed');
      const items = u.includes('pink%2Cunicorn') ? [] : [1, 2, 3].map((n) => ({ title: `IMG_${n}.jpg`, tags: 'pink sunset', link: `https://www.flickr.com/photos/someone/${n}/`, media: { m: `https://live.staticflickr.com/65535/${n}_abc_m.jpg` }, author: 'nobody@flickr.com ("someone")' }));
      return new Response(JSON.stringify({ items }), { status: 200 });
    };
    const account = await PROVIDERS.pictures.resolve('30m rosa sunset', { lang: 'es' });
    assert.deepEqual([account.id, account.name], ['every:30:pink+sunset', 'pink · sunset'], 'the tags are part of the account, with the pace, and its name is what is searched');
    assert.equal((await PROVIDERS.pictures.resolve('pink')).id, 'every:1440:pink', 'a pace of nothing is once a day');
    await assert.rejects(PROVIDERS.pictures.resolve('30m rosa'), (error) => error.kind === 'ambiguous' && error.word === 'rosa' && error.choices.length === 3, 'a word with several meanings is asked about');
    await assert.rejects(PROVIDERS.pictures.resolve('30m'), (error) => error.kind === 'badTags', 'a pace without tags is no feed');
    await assert.rejects(PROVIDERS.pictures.resolve('30m nsfw'), (error) => error.kind === 'badTags');
    await assert.rejects(PROVIDERS.pictures.resolve('3m pink'), (error) => error.kind === 'badInput', 'and a pace that is too short is refused');
    const when = Date.UTC(2026, 9, 27, 10, 7, 30);
    const first = (await PROVIDERS.pictures.poll([account], new Map(), { now: when })).get(account.id).items[0];
    assert.deepEqual([first.type, first.platform, first.url.startsWith('https://www.flickr.com/photos/'), first.image.endsWith('_b.jpg'), first.title, first.source, first.author], ['photo', 'pictures', true, true, '', 'Flickr', 'someone'], 'the title of the picture on its site is not used');
    const before = asked.length;
    const again = (await PROVIDERS.pictures.poll([account], new Map(), { now: when + 60_000 })).get(account.id).items[0];
    assert.deepEqual([again.id, asked.length], [first.id, before], 'a minute later it is the same picture and Flickr is not asked again');
    const two = await PROVIDERS.pictures.resolve('15m pink unicorn');
    assert.equal((await PROVIDERS.pictures.poll([two], new Map(), { now: when })).get(two.id).items.length, 0, 'a picture with only some of the tags is not what was asked');
    // The notice says what was searched, in the language of the server, and where it was found; never the title of the picture.
    const shown = JSON.stringify(card.buildFeedMessage({ message: '', options: {}, ping_roles: [] }, first, { lang: 'es' }).components);
    assert.ok(shown.includes('Buscando: pink · sunset · Flickr') && !shown.includes('IMG_'), shown);
    globalThis.fetch = realFetch;
  }

  // --- Pictures are searched in several places: anime words go only to Wallhaven and Safebooru, a key opens the others, every word is needed ------------------------
  {
    const pictures = require('../src/feeds/providers/pictures');
    const realFetch = globalThis.fetch;
    const realConfig = { ...config };
    const asked = [];
    let down = new Set();
    const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
    const jpeg = () => new Response(new Uint8Array([0xff, 0xd8, 0xff, ...new Array(3000).fill(1)]), { status: 200, headers: { 'content-type': 'image/jpeg' } });
    const IMAGE_HOSTS = new Set(['w.wallhaven.cc', 'safebooru.org', 'pixabay.com', 'images.pexels.com', 'images.unsplash.com', 'img.example', 'live.staticflickr.com']);
    globalThis.fetch = async (url, options) => {
      const u = String(url);
      const host = new URL(u).host;
      if (options?.headers?.Range) {
        if (u.includes('/page.html')) return new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } });
        return IMAGE_HOSTS.has(host) ? jpeg() : new Response('', { status: 404 });
      }
      asked.push(u);
      if (down.has(host)) return new Response('{}', { status: 500 });
      if (host === 'wallhaven.cc') return ok({ data: [1, 2, 3].map((n) => ({ path: `https://w.wallhaven.cc/full/aa/wallhaven-${n}.jpg`, url: `https://wallhaven.cc/w/${n}` })) });
      if (host === 'safebooru.org') return ok([{ id: 7, directory: '12', image: 'x.png', sample: true, tags: 'pink_flower 1girl', rating: 'general' }, { id: 8, directory: '13', image: 'y.jpg', sample: false, tags: 'car', rating: 'general' }]);
      if (host === 'pixabay.com') return ok({ hits: [1, 2, 3].map((n) => ({ largeImageURL: `https://pixabay.com/get/${n}.jpg`, pageURL: `https://pixabay.com/photos/${n}/`, tags: n === 3 ? 'mountain, snow' : 'rose, flower', user: 'Ann' })) });
      if (host === 'api.pexels.com') { assert.equal(options.headers.Authorization, 'pexels-key'); return ok({ photos: [{ src: { large2x: 'https://images.pexels.com/1.jpg' }, url: 'https://www.pexels.com/photo/1/', alt: 'Pink roses', photographer: 'Bo' }] }); }
      if (host === 'api.unsplash.com') { assert.equal(options.headers.Authorization, 'Client-ID unsplash-key'); return ok({ results: [{ urls: { regular: 'https://images.unsplash.com/1' }, links: { html: 'https://unsplash.com/photos/1' }, alt_description: 'a pink rose', user: { name: 'Cy' } }] }); }
      if (host === 'www.googleapis.com') return ok({ items: [{ link: 'https://img.example/page.html', title: 'Rose wallpaper', image: { contextLink: 'https://example.com/a' } }, { link: 'https://img.example/rose.jpg', title: 'Rose wallpaper pink', image: { contextLink: 'https://example.com/rose' } }] });
      if (host === 'api.openverse.org') return ok({ results: [1, 2].map((n) => ({ url: `https://live.staticflickr.com/${n}.jpg`, foreign_landing_url: `https://www.flickr.com/photos/x/${n}`, title: n === 1 ? 'Monte Rosa' : 'Flowers', tags: [{ name: n === 1 ? 'mountain' : 'flowers' }], creator: 'Di' })) });
      if (host === 'www.flickr.com') return ok({ items: [{ title: 'Photo', tags: 'flower', link: 'https://www.flickr.com/photos/someone/1/', media: { m: 'https://live.staticflickr.com/1_abc_m.jpg' }, author: 'nobody@flickr.com ("Ed")' }] });
      return new Response('{}', { status: 404 });
    };
    const pick = async (words, key = 'x:1') => { asked.length = 0; return pictures.pictureOf(pictures.parseTags(words), key, 0); };
    for (const name of ['googleCseKey', 'googleCseCx', 'pixabayApiKey', 'pexelsApiKey', 'unsplashAccessKey']) config[name] = null;

    // Anime: only Wallhaven and Safebooru (no photo), every word required, the color as the color filter of Wallhaven and a tag of the booru.
    let item = await pick('flor rosa anime');
    const wallhaven = new URL(asked.find((u) => new URL(u).host === 'wallhaven.cc'));
    assert.deepEqual([wallhaven.searchParams.get('q'), wallhaven.searchParams.get('categories'), wallhaven.searchParams.get('purity'), wallhaven.searchParams.get('colors')], ['+flower', '010', '100', 'ea4c88'], 'the anime category, the word required and the color filtered');
    assert.equal(asked.some((u) => !['wallhaven.cc', 'safebooru.org'].includes(new URL(u).host)), false, 'an anime search asks no place of photos');
    assert.ok(['Wallhaven', 'Safebooru'].includes(item.source) && item.image.startsWith('https://'), item.source);
    down = new Set(['wallhaven.cc']);
    item = await pick('flores rosa anime', 'x:7'); // other words: the ones before are kept for a while
    assert.equal(new URL(asked.find((u) => new URL(u).host === 'safebooru.org')).searchParams.get('tags'), 'pink_flower', 'a booru tags a pink flower pink_flower');
    assert.deepEqual([item.source, item.url], ['Safebooru', 'https://safebooru.org/index.php?page=post&s=view&id=7'], 'a picture of the booru without every word (a car) is left out');
    down = new Set();
    // Without an anime word, with no key: Openverse, then Flickr; a picture without every word (Monte Rosa for flowers) is left out.
    item = await pick('flores', 'x:2');
    assert.ok(asked[0].startsWith('https://api.openverse.org/') && asked[0].includes('q=flowers') && asked[0].includes('mature=false'), 'the free searcher is asked for pictures without adult content');
    assert.equal(asked.some((u) => new URL(u).host === 'wallhaven.cc'), false, 'anime places are only for anime words');
    assert.deepEqual([item.source, item.url, item.rehost], ['Openverse', 'https://www.flickr.com/photos/x/2', true], 'Openverse pictures go as a file');
    // With the keys, the search by meaning comes first, Google before the others, with the color filter of each place.
    config.pixabayApiKey = 'pixabay-key'; config.pexelsApiKey = 'pexels-key'; config.unsplashAccessKey = 'unsplash-key';
    item = await pick('rose-flower pink', 'x:3');
    const pixabay = new URL(asked[0]);
    assert.deepEqual([pixabay.host, pixabay.searchParams.get('safesearch'), pixabay.searchParams.get('q'), pixabay.searchParams.get('colors')], ['pixabay.com', 'true', 'rose flower', 'pink']);
    assert.ok(item.source === 'Pixabay' ? item.image !== 'https://pixabay.com/get/3.jpg' : true, 'the mountain is not a rose');
    config.googleCseKey = 'google-key'; config.googleCseCx = 'cx';
    item = await pick('rose-flower pink wallpaper', 'x:4');
    assert.ok(asked[0].startsWith('https://www.googleapis.com/customsearch/v1') && asked[0].includes('safe=active') && asked[0].includes('searchType=image') && asked[0].includes('imgDominantColor=pink'));
    assert.deepEqual([item.platform, item.type, item.title], ['pictures', 'photo', '']);
    assert.notEqual(item.image, 'https://img.example/page.html', 'a link that is a page and not a picture is never posted');
    // A place that fails is skipped; when every place fails the feed gets the error, and a word that is never followed is refused before asking anything.
    down = new Set(['www.googleapis.com', 'pixabay.com']);
    item = await pick('pink rose-flower', 'x:5');
    assert.ok(item && ['Pexels', 'Unsplash', 'Openverse'].includes(item.source), `the next place answers: ${item?.source}`);
    down = new Set(['wallhaven.cc', 'safebooru.org', 'www.googleapis.com', 'pixabay.com', 'api.pexels.com', 'api.unsplash.com', 'api.openverse.org', 'www.flickr.com']);
    await assert.rejects(pick('anime stars', 'x:6'), (error) => error.kind === 'unavailable', 'with every place down the feed says it is unavailable');
    assert.equal(pictures.refused(pictures.parseTags('anime nsfw')), true);
    Object.assign(config, realConfig);
    globalThis.fetch = realFetch;

    // A picture whose link expires (Pixabay, Google, Openverse) is sent as a file; one that cannot be downloaded keeps its link.
    const feedRow = { message: '', options: {}, ping_roles: [] };
    const photo = { platform: 'pictures', type: 'photo', id: 'x', title: '', url: 'https://pixabay.com/photos/1/', image: 'https://pixabay.com/get/1.jpg', rehost: true, query: { tags: ['pink'] }, source: 'Pixabay', publishedAt: 0 };
    const payload = await card.buildFeedPayload(feedRow, photo, { lang: 'en', hero: null, download: async () => Buffer.from([0xff, 0xd8, 0xff, 1, 2, 3]) });
    assert.equal(payload.files?.[0]?.name, 'picture.jpg');
    assert.ok(JSON.stringify(payload.components).includes('attachment://picture.jpg'));
    const kept = await card.buildFeedPayload(feedRow, photo, { lang: 'en', hero: null, download: async () => { throw new Error('refused'); } });
    assert.equal(kept.files, undefined);
    assert.ok(JSON.stringify(kept.components).includes('https://pixabay.com/get/1.jpg'));
    const html = await card.buildFeedPayload(feedRow, photo, { lang: 'en', hero: null, download: async () => Buffer.from('<html>') });
    assert.equal(html.files, undefined, 'bytes that are not a picture are not sent');

    // `!feed add pictures 30m rosa` asks which meaning with a button each; only who asked can pick, and the question expires.
    const feedSense = require('../src/interactions/feedSense');
    const error = pictures.ambiguousError('30m rosa', pictures.parseQuery('rosa').ambiguous);
    const asking = feedSense.question({ lang: 'es', userId: '2', guildId: '1', input: { platform: 'pictures', account: '30m rosa', channelId: '3' }, result: { error: 'ambiguous', word: error.word, choices: error.choices } });
    const buttons = asking.components[1].toJSON().components;
    assert.deepEqual(buttons.map((button) => button.label), ['La flor', 'El color', 'La montaña (Monte Rosa)']);
    assert.ok(JSON.stringify(asking.components[0].toJSON()).includes('**rosa** puede significar varias cosas'));
    const said = [];
    const click = (customId, userId) => ({ customId, guildId: '1', guild: { id: '1' }, user: { id: userId }, locale: 'es', reply: async (payload) => said.push(payload.content) });
    await feedSense.handleButton(click(buttons[0].custom_id, '9'));
    await feedSense.handleButton(click('fdsense:nothing:0', '2'));
    assert.equal(said.length, 2, 'someone else and an old question are told, and nothing is saved');
  }
  // --- Random music comes from Deezer, Apple Music and (with the keys of the bot) Spotify; Spotify that rejects the keys says so ---------------------------------
  {
    config.spotifyClientId = 'id';
    config.spotifyClientSecret = 'secret';
    const realFetch = globalThis.fetch;
    let down = new Set();
    const ok = (body) => new Response(JSON.stringify(body), { status: 200 });
    globalThis.fetch = async (url) => {
      const u = String(url);
      const host = new URL(u).host;
      if (down.has(host)) return new Response('{}', { status: 500 });
      if (u === 'https://api.deezer.com/genre') return ok({ data: [{ id: 152, name: 'Rock' }] });
      if (/api\.deezer\.com\/chart\/\d+\/tracks/.test(u)) return ok({ data: [1, 2, 3].map((n) => ({ id: n, title: `Dz ${n}`, link: `https://www.deezer.com/track/${n}`, artist: { name: 'Singer' }, album: { cover_xl: 'https://cdn.dz/c.jpg' } })) });
      if (host === 'rss.marketingtools.apple.com') return ok({ feed: { results: [1, 2, 3].map((n) => ({ id: String(n), name: `Ap ${n}`, artistName: 'Star', url: `https://music.apple.com/x/${n}`, artworkUrl100: 'https://is1.mzstatic.com/i/100x100bb.jpg' })) } });
      if (u === 'https://accounts.spotify.com/api/token') return ok({ access_token: 'sp-token', expires_in: 3600 });
      if (u.startsWith('https://api.spotify.com/v1/search')) return ok({ tracks: { items: [1, 2, 3].map((n) => ({ id: `s${n}`, name: `Sp ${n}`, artists: [{ name: 'Band' }], album: { images: [{ url: 'https://i.scdn.co/a.jpg' }] }, external_urls: { spotify: `https://open.spotify.com/track/s${n}` } })) } });
      return new Response('{}', { status: 404 });
    };
    const when = Date.UTC(2026, 9, 27, 10, 7, 30);
    const account = await PROVIDERS.randommusic.resolve('5m');
    const platforms = new Set();
    for (let slot = 0; slot < 12; slot += 1) {
      const item = (await PROVIDERS.randommusic.poll([account], new Map(), { now: when + slot * 5 * 60_000 })).get(account.id).items[0];
      platforms.add(item.platform);
      assert.equal(item.type, 'track');
    }
    assert.deepEqual([...platforms].sort(), ['applemusic', 'deezer', 'spotify'], 'the songs come from the three services, a different one in each slot');
    // When a service is down the next one answers.
    down = new Set(['api.deezer.com', 'rss.marketingtools.apple.com']);
    const via = (await PROVIDERS.randommusic.poll([account], new Map(), { now: when + 100 * 5 * 60_000 })).get(account.id).items[0];
    assert.equal(via.platform, 'spotify', 'with Deezer and Apple down it is Spotify');
    down = new Set();
    // Without the keys of the bot there is no Spotify in it.
    config.spotifyClientId = null;
    const without = new Set();
    for (let slot = 200; slot < 212; slot += 1) without.add((await PROVIDERS.randommusic.poll([account], new Map(), { now: when + slot * 5 * 60_000 })).get(account.id).items[0].platform);
    assert.equal(without.has('spotify'), false);
    // Spotify that rejects the id or the secret is a bot that is not set up.
    config.spotifyClientId = 'wrong';
    require('../src/feeds/providers/music').forgetSpotifyToken();
    globalThis.fetch = async (url) => (String(url) === 'https://accounts.spotify.com/api/token' ? new Response('{"error":"invalid_client"}', { status: 400 }) : new Response('{}', { status: 404 }));
    await assert.rejects(PROVIDERS.spotify.resolve('Artist'), (error) => error.kind === 'notConfigured', 'wrong keys say that Spotify is not set up (and the log says what it answered)');
    config.spotifyClientId = null;
    config.spotifyClientSecret = null;
    globalThis.fetch = realFetch;
  }

  // --- The names of the lists come in the language of who follows them --------------------------------------------------------------------------------------
  {
    const realFetch = globalThis.fetch;
    globalThis.fetch = async () => new Response('{}', { status: 404 });
    const steam = await PROVIDERS.steam.resolve('store:top', { lang: 'es' });
    assert.equal(steam.name, 'Steam · Los más vendidos');
    assert.equal((await PROVIDERS.modrinth.resolve('new:shader', { lang: 'pt-BR' })).name, 'Shaders novos');
    assert.equal((await PROVIDERS.applemusic.resolve('chart:co:albums', { lang: 'es' })).name, 'Top 10 álbumes · Colombia');
    assert.equal((await PROVIDERS.applemusic.resolve('chart:co:songs', { lang: 'en' })).name, 'Top 10 · Colombia');
    config.spotifyClientId = null;
    assert.equal((await PROVIDERS.spotify.resolve('new:CO', { lang: 'pt-BR' })).name, 'Álbuns novos · Colômbia');
    globalThis.fetch = realFetch;
  }

  // --- The check of a picture: bytes of a real image, not only a good answer ----------------------------------------------------------------------
  {
    const { imageReady } = require('../src/feeds/picture');
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url) => (String(url).endsWith('/empty.png') ? emptyAnswer() : String(url).endsWith('/ok.jpg') ? fakeImage() : new Response('<html></html>', { status: 200, headers: { 'content-type': 'text/html' } }));
    assert.equal(await imageReady('https://images.example/ok.jpg'), true);
    assert.equal(await imageReady('https://images.example/empty.png'), false, 'a few bytes is what a CDN answers while it makes the picture');
    assert.equal(await imageReady('https://images.example/page.html'), false);
    globalThis.fetch = realFetch;
  }

  // --- Twitch: a live notice goes out at once, with a stand-in picture until the preview of the stream exists ----------------------------------------------
  {
    config.twitchClientId = 'tid';
    config.twitchClientSecret = 'tsecret';
    const pictures = {};
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => {
      const u = String(url);
      if (u.startsWith('https://static-cdn.jtvnw.net/')) return pictures[u.split('?')[0]] ? fakeImage() : new Response('', { status: 404 });
      if (u.includes('id.twitch.tv/oauth2/token')) return new Response(JSON.stringify({ access_token: 'tw', expires_in: 3600 }), { status: 200 });
      if (u.includes('/helix/streams')) return new Response(JSON.stringify({ data: [{ id: 's1', user_id: '7', user_login: 'streamer', user_name: 'Streamer', type: 'live', title: 'Hello', game_name: 'Minecraft', viewer_count: 12, started_at: new Date().toISOString(), thumbnail_url: 'https://static-cdn.jtvnw.net/previews-ttv/live_user_streamer-{width}x{height}.jpg' }] }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    const account = { id: '7', name: 'Streamer', avatar: null, url: 'https://www.twitch.tv/streamer' };
    const early = (await PROVIDERS.twitch.poll([account, { id: '8', name: 'Quiet', avatar: null, url: 'x' }], new Map())).get('7').items[0];
    assert.deepEqual([early.placeholder, early.image.endsWith('/twitch-live.png')], [true, true], 'a stream whose preview does not exist yet goes out with the stand-in');
    pictures['https://static-cdn.jtvnw.net/previews-ttv/live_user_streamer-1280x720.jpg'] = true;
    const later = (await PROVIDERS.twitch.poll([account], new Map())).get('7').items[0];
    assert.deepEqual([Boolean(later.placeholder), later.image.includes('live_user_streamer-1280x720.jpg')], [false, true], 'the real preview is used as soon as it loads');
    globalThis.fetch = realFetch;
    config.twitchClientId = null;
    config.twitchClientSecret = null;
  }

  // --- Kick: the answers of its API written out ------------------------------------------------------------------------------------------------
  {
    config.kickClientId = 'id';
    config.kickClientSecret = 'secret';
    const kickCalls = [];
    const pictures = { 'https://images.kick.com/t.jpg': true };
    const channels = { 1: { broadcaster_user_id: 1, slug: 'live-one', stream_title: 'Hello', category: { name: 'Minecraft' }, stream: { is_live: true, start_time: '2026-10-26T20:00:00Z', viewer_count: 1234, thumbnail: 'https://images.kick.com/t.jpg' } },
      2: { broadcaster_user_id: 2, slug: 'quiet', stream_title: '', stream: { is_live: false } } };
    globalThis.fetch = async (url, options) => {
      kickCalls.push(String(url));
      if (String(url).startsWith('https://images.kick.com/')) return pictures[String(url)] ? fakeImage() : new Response('', { status: 404 });
      if (String(url).includes('id.kick.com/oauth/token')) return new Response(JSON.stringify({ access_token: 'tok', expires_in: 3600 }), { status: 200 });
      assert.equal(options.headers.Authorization, 'Bearer tok');
      const u = new URL(url);
      if (u.pathname.endsWith('/users')) return new Response(JSON.stringify({ data: [{ user_id: 1, name: 'Live_One', profile_picture: 'https://kick.example/p.png' }] }), { status: 200 });
      const slugs = u.searchParams.getAll('slug');
      const ids = u.searchParams.getAll('broadcaster_user_id');
      const data = slugs.length ? Object.values(channels).filter((c) => slugs.includes(c.slug)) : Object.values(channels).filter((c) => ids.includes(String(c.broadcaster_user_id)));
      return new Response(JSON.stringify({ data }), { status: 200 });
    };
    const found = await PROVIDERS.kick.resolve('https://kick.com/live-one');
    assert.deepEqual([found.id, found.name, found.url], ['1', 'Live_One', 'https://kick.com/live-one']);
    await assert.rejects(PROVIDERS.kick.resolve('nobody-here'), (error) => error.kind === 'notFound');
    const results = await PROVIDERS.kick.poll([{ id: '1', name: 'Live_One', avatar: found.avatar, url: found.url }, { id: '2', name: 'quiet', avatar: null, url: 'https://kick.com/quiet' }]);
    assert.equal(results.get('1').items.length, 1);
    assert.equal(results.get('1').items[0].type, 'live');
    assert.equal(results.get('1').items[0].id, '2026-10-26T20:00:00Z', 'a stream is told apart by when it started');
    assert.match(results.get('1').items[0].extra, /Minecraft/);
    assert.deepEqual([...results.get('1').stillLive], ['2026-10-26T20:00:00Z']);
    assert.deepEqual(results.get('2'), { items: [], stillLive: new Set() }, 'a quiet channel has no stream and nothing is open');
    assert.equal(results.get('1').items[0].image.endsWith('/kick-live.png'), true, 'a Kick notice always carries the picture of Kick: its preview can fail to draw in Discord and stay broken');
    assert.equal(results.get('1').items[0].placeholder, undefined, 'and it is never swapped for the real one');
    assert.equal(kickCalls.filter((url) => url.includes('/channels?') && url.includes('broadcaster_user_id')).length, 1, 'both accounts are asked in one call');
    assert.equal(kickCalls.some((url) => url.startsWith('https://images.kick.com/')), false, 'and the preview is not even asked for');
    config.kickClientId = null;
    kickCalls.length = 0;
    await assert.rejects(PROVIDERS.kick.resolve('live-one'), (error) => error.kind === 'notConfigured', 'without the keys Kick says it is not set up');
    globalThis.fetch = realFetch;
    config.kickClientSecret = null;
  }

  // --- the other platforms: the answers of the services written out ------------------------------------------------------------------------------
  {
    const { publicUrl, fetchPublicText } = require('../src/feeds/http');
    const { parseFeed, discoverFeed } = require('../src/feeds/feedparse');
    const rssProviders = require('../src/feeds/providers/rss');
    const github = require('../src/feeds/providers/github');
    const packages = require('../src/feeds/providers/packages');
    const steam = require('../src/feeds/providers/steam');
    const anilist = require('../src/feeds/providers/anilist');
    const now = Date.parse('2026-10-26T15:00:00Z');
    const json = (body, status = 200, headers = {}) => new Response(JSON.stringify(body), { status, headers });

    // A link a person typed cannot reach the bot's own network.
    for (const bad of ['http://localhost/feed', 'https://127.0.0.1/x', 'http://10.0.0.5/x', 'https://169.254.169.254/latest', 'https://[::1]/x', 'ftp://example.com/x', 'https://user:pass@example.com/x', 'https://example.com:8080/x', 'https://intranet.internal/x', 'not a link']) {
      assert.equal(publicUrl(bad), null, `${bad} is not public`);
    }
    assert.ok(publicUrl('https://example.com/feed.xml'));
    assert.ok(publicUrl('http://example.com/feed.xml'));
    await assert.rejects(fetchPublicText('http://127.0.0.1/secret'), (error) => error.kind === 'badInput', 'a private address is refused before any connection');
    await assert.rejects(PROVIDERS.rss.resolve('localhost:8787/api'), (error) => error.kind === 'badInput');
    assert.equal(rssProviders.normalizeUrl('example.com/feed#top'), 'https://example.com/feed');

    // RSS and Atom, with CDATA, entities and pictures.
    const rssXml = '<rss><channel><title>My &amp; Blog</title><link>https://ex.com/</link><item><title><![CDATA[Hello *world*]]></title><link>http://ex.com/a</link><guid>g1</guid><pubDate>Mon, 26 Oct 2026 10:00:00 GMT</pubDate><description><![CDATA[<p>Some <b>text</b> <img src="https://ex.com/p.jpg"></p>]]></description></item></channel></rss>';
    let parsed = parseFeed(rssXml);
    assert.deepEqual([parsed.title, parsed.entries[0].id, parsed.entries[0].title, parsed.entries[0].summary, parsed.entries[0].image, parsed.entries[0].url], ['My & Blog', 'g1', 'Hello *world*', 'Some text', 'https://ex.com/p.jpg', 'https://ex.com/a']);
    parsed = parseFeed('<feed><title>r/x</title><entry><id>t3_1</id><title>One</title><link rel="alternate" href="https://r.com/p1"/><updated>2026-10-26T10:00:00+00:00</updated><author><name>/u/a</name></author><content type="html">&lt;img src=&quot;https://i.r/x.jpg&quot;&gt; hi</content></entry></feed>');
    assert.deepEqual([parsed.entries[0].id, parsed.entries[0].author, parsed.entries[0].image, parsed.entries[0].summary], ['t3_1', '/u/a', 'https://i.r/x.jpg', 'hi']);
    assert.equal(parseFeed('<html>not a feed</html>').entries.length, 0);
    // A web page has a <title> too: it is not a feed (the changelog page of a site was taken for an empty feed that never posted).
    const page = parseFeed('<!doctype html><html><head><title>Changelog · Petto</title></head><body><article><h2>0.7.9</h2></article></body></html>');
    assert.deepEqual([page.isFeed, page.title, page.entries.length], [false, '', 0]);
    const { feedKind } = require('../src/feeds/feedparse');
    assert.equal(feedKind('﻿<?xml version="1.0"?>\n<?xml-stylesheet href="/rss.xsl"?>\n<!-- made by hand -->\n<rss version="2.0"><channel/></rss>'), 'rss');
    assert.equal(feedKind('<rdf:RDF xmlns:rdf="x"><item/></rdf:RDF>'), 'rdf');
    assert.equal(feedKind('<feed xmlns="http://www.w3.org/2005/Atom"></feed>'), 'atom');
    assert.equal(feedKind('{"items":[]}'), null);
    parsed = parseFeed('<?xml version="1.0"?><rss version="2.0"><channel><title><![CDATA[Petto · Changelog]]></title><link>https://petto.sbs/changelog</link><item><title><![CDATA[0.7.9-1]]></title><link>https://petto.sbs/changelog/0.7.9-1</link><guid isPermaLink="false">0.7.9-1</guid><pubDate>Thu, 29 Oct 2026 12:00:00 +0000</pubDate></item></channel></rss>');
    assert.deepEqual([parsed.isFeed, parsed.title, parsed.entries[0].id, parsed.entries[0].url, parsed.entries[0].published], [true, 'Petto · Changelog', '0.7.9-1', 'https://petto.sbs/changelog/0.7.9-1', Date.UTC(2026, 9, 29, 12)]);
    assert.deepEqual(rssProviders.usualFeedUrls('https://petto.sbs/changelog').slice(0, 2), ['https://petto.sbs/changelog/rss.xml', 'https://petto.sbs/changelog/feed.xml'], 'a page without a feed link is looked at where sites keep their feed');
    assert.ok(rssProviders.usualFeedUrls('https://petto.sbs/changelog').includes('https://petto.sbs/rss.xml'));
    assert.equal(discoverFeed('<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head>', 'https://ex.com/blog/'), 'https://ex.com/feed.xml');
    assert.equal(parseFeed('<rss><channel><title>t</title><item><title>only</title><guid>1</guid></item></channel></rss>').entries.length, 1);

    // Reddit and Pinterest.
    assert.equal(rssProviders.parseSubreddit('https://www.reddit.com/r/Minecraft/comments/abc'), 'Minecraft');
    assert.equal(rssProviders.parseSubreddit('r/a b'), null);
    assert.equal(rssProviders.parsePinterest('https://www.pinterest.com/Some_User/my-board/'), 'some_user/my-board');
    assert.equal(rssProviders.parsePinterest('https://www.pinterest.com/pin/12345/'), null);
    assert.equal(rssProviders.parsePinterest('https://www.pinterest.com/emstunes/%E0%B1%A8%E0%A7%8E-k-pop/'), 'emstunes/%e0%b1%a8%e0%a7%8e-k-pop', 'a board with letters of another alphabet (written as %XX in its link) is accepted');
    assert.equal(rssProviders.bigPin('https://i.pinimg.com/236x/aa/bb.jpg'), 'https://i.pinimg.com/736x/aa/bb.jpg');
    globalThis.fetch = async (url) => {
      if (String(url).includes('reddit.com/r/zzz')) return new Response('', { status: 404 });
      if (new URL(url).hostname === 'www.reddit.com') return new Response('<feed><title>r/minecraft</title><entry><id>t3_9</id><title>A &amp; B</title><link href="https://www.reddit.com/r/minecraft/comments/9"/><updated>2026-10-26T14:00:00+00:00</updated></entry></feed>', { status: 200 });
      return new Response('<rss><channel><title>user on Pinterest</title><item><title>Pin</title><link>https://www.pinterest.com/pin/1/</link><guid>p1</guid><description><![CDATA[<a><img src="https://i.pinimg.com/236x/a/b.jpg"></a>]]></description></item></channel></rss>', { status: 200 });
    };
    const reddit = await PROVIDERS.reddit.resolve('r/minecraft');
    assert.deepEqual([reddit.id, reddit.name], ['minecraft', 'r/minecraft']);
    await assert.rejects(PROVIDERS.reddit.resolve('zzz'), (error) => error.kind === 'notFound');
    let polled = await PROVIDERS.reddit.poll([reddit], new Map(), { now });
    assert.equal(polled.get('minecraft').items[0].title, 'A & B');
    assert.equal(polled.get('minecraft').items[0].type, 'post');
    polled = await PROVIDERS.pinterest.poll([{ id: 'user', name: 'user', avatar: null, url: 'https://www.pinterest.com/user/' }], new Map(), { now: Date.parse('2026-10-26T15:00:00Z') });
    assert.equal(polled.get('user').items[0].type, 'pin');
    assert.equal(polled.get('user').items[0].image, 'https://i.pinimg.com/736x/a/b.jpg');

    // GitHub: the tag of the last answer is sent, and a 304 gives the same releases without a new reading.
    assert.equal(github.parseRepo('https://github.com/PettoBot/petto-bot/releases/tag/v1'), 'PettoBot/petto-bot');
    assert.equal(github.parseRepo('nonsense'), null);
    const seenHeaders = [];
    globalThis.fetch = async (url, options) => {
      if (String(url).endsWith('/repos/o/r')) return json({ full_name: 'o/r', owner: { avatar_url: 'https://a/x.png' }, html_url: 'https://github.com/o/r', description: 'd' });
      seenHeaders.push(options.headers['If-None-Match'] ?? null);
      if (options.headers['If-None-Match'] === '"abc"') return new Response(null, { status: 304 });
      return json([{ id: 7, tag_name: 'v2.0.0', name: 'v2.0.0', html_url: 'https://github.com/o/r/releases/tag/v2.0.0', body: '## What is new\nA big feature', draft: false, prerelease: false, published_at: '2026-10-26T13:00:00Z', author: { login: 'a' } }, { id: 8, tag_name: 'v3', draft: true }], 200, { etag: '"abc"' });
    };
    const repo = await PROVIDERS.github.resolve('o/r');
    assert.equal(repo.id, 'o/r');
    polled = await PROVIDERS.github.poll([repo], new Map(), { now });
    assert.deepEqual(polled.get('o/r').items.map((item) => [item.id, item.type, item.title, item.description]), [['7', 'update', 'r v2.0.0', 'What is new']], 'a draft is not a release');
    polled = await PROVIDERS.github.poll([repo], new Map(), { now });
    assert.deepEqual(seenHeaders, [null, '"abc"']);
    assert.equal(polled.get('o/r').items.length, 1, 'a 304 keeps the releases already read');
    globalThis.fetch = async () => new Response('', { status: 403 });
    polled = await PROVIDERS.github.poll([{ id: 'x/y', name: 'x/y', avatar: null, url: 'u' }], new Map(), { now });
    assert.equal(polled.get('x/y').error, 'rateLimited');

    // npm and PyPI.
    assert.equal(packages.parseNpm('https://www.npmjs.com/package/@scope/pkg/v/1.0.0'), '@scope/pkg');
    assert.equal(packages.parseNpm('Discord.js'), 'discord.js');
    assert.equal(packages.parsePypi('https://pypi.org/project/Requests/'), 'requests');
    globalThis.fetch = async (url) => (new URL(url).hostname === 'registry.npmjs.org'
      ? json({ name: 'pkg', version: '1.2.3', description: 'A package' })
      : json({ info: { name: 'requests', version: '2.0.0', summary: 'HTTP for humans' }, releases: { '2.0.0': [{ upload_time_iso_8601: '2026-10-26T12:00:00Z' }] } }));
    polled = await PROVIDERS.npm.poll([{ id: 'pkg', name: 'pkg', avatar: null, url: 'u' }], new Map(), { now });
    assert.deepEqual([polled.get('pkg').items[0].id, polled.get('pkg').items[0].title], ['pkg@1.2.3', 'pkg 1.2.3']);
    polled = await PROVIDERS.pypi.poll([{ id: 'requests', name: 'requests', avatar: null, url: 'u' }], new Map(), { now });
    assert.deepEqual([polled.get('requests').items[0].id, polled.get('requests').items[0].publishedAt], ['requests@2.0.0', Date.parse('2026-10-26T12:00:00Z')]);

    // Steam.
    assert.equal(steam.parseApp('https://store.steampowered.com/app/730/CounterStrike_2/'), '730');
    assert.equal(steam.parseApp('abc'), null);
    globalThis.fetch = async (url) => (String(url).includes('appdetails')
      ? json({ 730: { success: true, data: { name: 'Counter-Strike 2', header_image: 'https://cdn/h.jpg' } } })
      : json({ appnews: { newsitems: [{ gid: '55', title: 'Update', url: 'https://steamcommunity.com/n/55', contents: '[h1]Hi[/h1] [img]https://cdn/i.png[/img] Fixes and more', date: Math.floor(now / 1000) - 3600, author: 'Valve', feedlabel: 'Community Announcements' }] } }));
    const app = await PROVIDERS.steam.resolve('730');
    assert.equal(app.name, 'Counter-Strike 2');
    polled = await PROVIDERS.steam.poll([app], new Map(), { now });
    assert.deepEqual([polled.get('730').items[0].id, polled.get('730').items[0].image, polled.get('730').items[0].description], ['55', 'https://cdn/i.png', 'Hi Fixes and more']);

    // AniList: all the anime in one call.
    assert.deepEqual(anilist.parseAnime('https://anilist.co/anime/21/One-Piece/'), { id: 21 });
    assert.deepEqual(anilist.parseAnime('one piece'), { search: 'one piece' });
    let anilistCalls = 0;
    globalThis.fetch = async (url, options) => {
      anilistCalls += 1;
      const { query, variables } = JSON.parse(options.body);
      if (query.includes('Media(')) return json({ data: { Media: { id: 21, title: { romaji: 'One Piece', english: null }, coverImage: { large: 'https://cdn/c.jpg' }, siteUrl: 'https://anilist.co/anime/21' } } });
      return json({ data: { Page: { airingSchedules: variables.ids.map((id) => ({ id: 900 + id, episode: 1100, airingAt: Math.floor(now / 1000) - 600, mediaId: id })) } } });
    };
    const anime = await PROVIDERS.anilist.resolve('one piece');
    assert.equal(anime.id, '21');
    anilistCalls = 0;
    polled = await PROVIDERS.anilist.poll([anime, { id: '5', name: 'Other', avatar: null, url: 'u' }], new Map(), { now });
    assert.equal(anilistCalls, 1, 'two anime, one call');
    assert.deepEqual([polled.get('21').items[0].type, polled.get('21').items[0].id, polled.get('21').items[0].title], ['episode', '921', 'One Piece · 1100']);

    // Wikipedia (the article of the day, once a day for each language) and the puzzle of Chess.com.
    let wikiCalls = 0;
    globalThis.fetch = async (url) => {
      if (new URL(url).hostname.endsWith('.wikipedia.org')) { wikiCalls += 1; return json({ tfa: { titles: { normalized: 'Duck' }, extract: 'A bird.', thumbnail: { source: 'https://up/d.jpg' }, content_urls: { desktop: { page: 'https://en.wikipedia.org/wiki/Duck' } } } }); }
      return json({ title: 'Mate in 2', url: 'https://www.chess.com/forum/view/daily-puzzles/1', image: 'https://i/p.png', publish_time: 1793000000 });
    };
    const wiki = { id: 'featured', name: 'Wikipedia', avatar: null, url: 'u' };
    assert.equal((await PROVIDERS.wikipedia.poll([wiki], new Map(), { now: Date.parse('2026-10-26T03:00:00Z'), lang: 'en' })).get('featured').items.length, 0, 'before the article of the day is chosen nothing is posted');
    polled = await PROVIDERS.wikipedia.poll([wiki], new Map(), { now, lang: 'en' });
    await PROVIDERS.wikipedia.poll([wiki], new Map(), { now, lang: 'en' });
    assert.equal(wikiCalls, 1, 'the article of a day is asked once for each language');
    assert.deepEqual([polled.get('featured').items[0].title, polled.get('featured').items[0].type], ['Duck', 'daily']);
    polled = await PROVIDERS.chess.poll([{ id: 'puzzle', name: 'Chess.com', avatar: null, url: 'u' }], new Map(), { now });
    assert.deepEqual([polled.get('puzzle').items[0].id, polled.get('puzzle').items[0].title], ['1793000000', 'Mate in 2']);
    assert.ok(PROVIDERS.chess.noAccount && PROVIDERS.wikipedia.noAccount && PROVIDERS.pokemon.noAccount);
    assert.ok(PROVIDERS.wikipedia.perLanguage && PROVIDERS.pokemon.perLanguage && !PROVIDERS.chess.perLanguage);
    globalThis.fetch = realFetch;
  }

  // --- the search of the dashboard and the way out when YouTube's feed fails --------------------------------------------------------------------
  {
    const { searchAccounts, forgetSearches } = require('../src/feeds/search');
    const youtubeProvider = require('../src/feeds/providers/youtube');
    const json = (body, status = 200) => new Response(JSON.stringify(body), { status });
    forgetSearches();
    let asked = 0;
    globalThis.fetch = async (url) => {
      asked += 1;
      const u = new URL(url);
      if (u.hostname === 'public.api.bsky.app') return json({ actors: [{ did: 'd', handle: 'jay.bsky.team', displayName: 'Jay', avatar: 'https://cdn.bsky/a.jpg' }] });
      if (u.hostname === 'store.steampowered.com') return json({ items: [{ id: 730, name: 'Counter-Strike 2', tiny_image: 'https://cdn/t.jpg' }] });
      if (u.hostname === 'www.googleapis.com' && u.pathname.endsWith('/search')) return json({ items: [{ id: { channelId: 'UC' + 'a'.repeat(22) }, snippet: { channelTitle: 'Chan', description: 'About', thumbnails: { default: { url: 'https://yt/a.jpg' } } } }] });
      if (u.hostname === 'www.googleapis.com' && u.pathname.endsWith('/channels') && u.searchParams.get('forHandle') === '@known') return json({ items: [{ id: 'UC' + 'b'.repeat(22), snippet: { title: 'Known', customUrl: '@known', thumbnails: { medium: { url: 'https://yt/b.jpg' } } } }] });
      return json({}, 404);
    };
    assert.deepEqual(await searchAccounts('bluesky', 'j'), [], 'a single letter is not searched');
    assert.equal(asked, 0);
    const found = await searchAccounts('bluesky', 'jay');
    assert.deepEqual([found[0].value, found[0].name, found[0].avatar], ['jay.bsky.team', 'Jay', 'https://cdn.bsky/a.jpg']);
    await searchAccounts('bluesky', 'JAY');
    assert.equal(asked, 1, 'the same search is asked once');
    assert.equal((await searchAccounts('steam', 'counter'))[0].value, '730');
    assert.deepEqual(await searchAccounts('pokemon', 'anything'), [], 'a platform with no account has nothing to search');
    config.youtubeApiKey = null;
    await assert.rejects(searchAccounts('youtube', 'chan'), (error) => error.kind === 'notConfigured');
    config.youtubeApiKey = 'key';
    const yt = await searchAccounts('youtube', 'chan');
    assert.deepEqual([yt[0].name, yt[0].value.length], ['Chan', 24]);
    for (let i = 0; i < 70; i += 1) await searchAccounts('youtube', `chan${i}`).catch(() => null);
    await assert.rejects(searchAccounts('youtube', 'one more'), (error) => error.kind === 'rateLimited', 'YouTube has a daily budget of searches');
    forgetSearches();
    // A name written as one word is tried as an @name first (a unit): when it exists, the search of a hundred units is not made. One server cannot spend the day's searches.
    {
      let searchCalls = 0;
      const dailyQuota = config.youtubeDailyQuota; config.youtubeDailyQuota = 10_000_000; // the earlier searches used up the share of the day
      const before = globalThis.fetch;
      globalThis.fetch = async (url) => { if (new URL(url).pathname.endsWith('/search')) searchCalls += 1; return before(url); };
      const known = await searchAccounts('youtube', 'known', 'en', 'guildA');
      assert.deepEqual([known[0].name, searchCalls], ['Known', 0], 'the @name exists: no search of a hundred units');
      assert.equal((await searchAccounts('youtube', 'Known', 'en', 'guildA')).length, 1, 'and the answer is kept whatever the case');
      for (let i = 0; i < 10; i += 1) await searchAccounts('youtube', `nothing${i}`, 'en', 'guildB');
      await assert.rejects(searchAccounts('youtube', 'nothing99', 'en', 'guildB'), (error) => error.kind === 'rateLimited', 'a server has 10 searches a day');
      assert.equal((await searchAccounts('youtube', 'other one', 'en', 'guildC')).length, 1, 'another server still can');
      globalThis.fetch = before; config.youtubeDailyQuota = dailyQuota;
    }

    // The feed of a channel answers 404 but the channel exists: its uploads list from the API is used.
    const channelId = 'UC' + 'b'.repeat(22);
    globalThis.fetch = async (url) => {
      const u = new URL(url);
      if (u.pathname.endsWith('/feeds/videos.xml')) return new Response('', { status: 404 });
      if (u.pathname.endsWith('/playlistItems')) return json({ items: [
        { snippet: { title: 'A long one', publishedAt: '2026-10-26T10:00:00Z', channelTitle: 'Chan', description: 'd', resourceId: { videoId: 'v1' }, thumbnails: { high: { url: 'https://yt/h.jpg' } } } },
        { snippet: { title: 'A short', publishedAt: '2026-10-26T11:00:00Z', channelTitle: 'Chan', description: '', resourceId: { videoId: 's1' }, thumbnails: {} } }] });
      if (u.pathname.endsWith('/videos')) return json({ items: [{ id: 'v1', contentDetails: { duration: 'PT12M3S' } }, { id: 's1', contentDetails: { duration: 'PT45S' } }] });
      return json({}, 404);
    };
    const viaApi = await youtubeProvider.fetchChannel(channelId);
    assert.deepEqual(viaApi.entries.map((entry) => [entry.videoId, entry.short, entry.url.includes('/shorts/')]), [['v1', false, false], ['s1', true, true]]);
    assert.equal(viaApi.name, 'Chan');
    // Both fail: YouTube is having trouble, the channel is not gone.
    globalThis.fetch = async () => new Response('', { status: 404 });
    await assert.rejects(youtubeProvider.fetchChannel(channelId), (error) => error.kind === 'unavailable');
    config.youtubeApiKey = null;
    globalThis.fetch = realFetch;
  }

  // --- the engine ----------------------------------------------------------------------------------------------------------------------------
  const engine = require('../src/feeds/engine');
  const feedsDb = require('../src/db/feeds');
  assert.equal(engine.passes({ filters: { include: ['review'], exclude: ['sponsor'] } }, { title: 'A review', description: '' }), true);
  assert.equal(engine.passes({ filters: { include: ['review'] } }, { title: 'Other', description: '' }), false);
  assert.equal(engine.passes({ filters: { exclude: ['sponsor'] } }, { title: 'Sponsored', description: 'a sponsor' }), false);

  if (!process.env.PETTO_TEST_DATABASE_URL) {
    console.log('check-feeds: ok (the database part was skipped: set PETTO_TEST_DATABASE_URL to a test database to run it)');
    process.exit(0);
  }
  const fs = require('node:fs');
  const path = require('node:path');
  const { getPrimaryPool, closePools } = require('../src/db/postgres');
  const pool = getPrimaryPool();
  const schema = fs.readFileSync(path.join(__dirname, '..', 'src', 'db', 'schema.sql'), 'utf8');
  await pool.query(schema);
  await pool.query(schema); // the bot applies it on every start
  const service = require('../src/feeds/service');
  const G = '950000000000000001';
  const CH = '960000000000000001';
  const CH2 = '960000000000000002';
  const clean = () => pool.query('delete from guilds where guild_id = $1', [G]);
  await clean();

  const sent = [];
  const edits = [];
  let failSend = null;
  const makeChannel = (id) => ({
    id, isTextBased: () => true, isDMBased: () => false, permissionsFor: () => ({ has: () => true }),
    send: async (payload) => { if (failSend) throw Object.assign(new Error('x'), { code: failSend }); sent.push({ id, payload }); return { id: `m${sent.length}` }; },
    messages: { fetch: async (messageId) => ({ id: messageId, edit: async (payload) => { edits.push({ messageId, payload }); } }) },
  });
  const channels = new Map([[CH, makeChannel(CH)], [CH2, makeChannel(CH2)]]);
  const guild = { id: G, name: 'G', channels: { cache: channels }, members: { me: {} } };
  const client = { guilds: { cache: new Map([[G, guild]]) }, channels: { cache: channels, fetch: async (id) => channels.get(id) ?? null } };

  // A provider with the answers written out, so the engine is checked without the network.
  let queue = [];
  let liveNow = new Set();
  let baseline = [];
  const fake = {
    interval: 60_000, perTick: 10, concurrency: 1,
    resolve: async (input) => (input === 'nobody' ? Promise.reject(new IntegrationError('notFound')) : { id: `acc-${input}`, name: `Account ${input}`, avatar: null, url: `https://youtube.com/${input}` }),
    poll: async (accounts) => new Map(accounts.map((a) => [a.id, { items: queue.map((item) => ({ platform: 'youtube', author: a.name, ...item })), stillLive: liveNow }])),
    baselineItems: async () => baseline,
  };
  PROVIDERS.youtube = { ...PROVIDERS.youtube, ...fake };
  const rows = async () => (await pool.query('select * from feeds where guild_id = $1 order by id', [G])).rows;

  // Following an account: the checks, the limits and the first look.
  assert.equal((await service.createFeed(guild, { platform: 'nope', account: 'a', channelId: CH })).error, 'unknownPlatform');
  assert.equal((await service.createFeed(guild, { platform: 'youtube', account: 'a', channelId: '1' })).error, 'notText');
  assert.equal((await service.createFeed(guild, { platform: 'youtube', account: 'nobody', channelId: CH })).error, 'notFound');
  baseline = [{ id: 'old-a' }, { id: 'old-b' }];
  const first = await service.createFeed(guild, { platform: 'youtube', account: 'one', channelId: CH, types: ['video', 'live', 'bogus'], message: 'Hi {feed.title}', pingRoles: ['223456789012345678', 'x'], createdBy: 'u' });
  assert.equal(first.ok, true);
  assert.deepEqual(first.feed.types, ['video', 'live'], 'only the kinds the platform has');
  assert.deepEqual(first.feed.ping_roles, ['223456789012345678']);
  assert.equal(first.feed.ready, true, 'the first look was done');
  assert.equal((await feedsDb.seenAmong([first.feed.id], ['old-a', 'old-b', 'new'])).size, 2, 'what already existed is marked as seen');
  assert.equal((await service.createFeed(guild, { platform: 'youtube', account: 'one', channelId: CH })).error, 'already');
  assert.equal((await service.createFeed(guild, { platform: 'youtube', account: 'two', channelId: CH })).ok, true);
  assert.equal((await service.createFeed(guild, { platform: 'youtube', account: 'three', channelId: CH })).ok, true);
  assert.equal((await service.createFeed(guild, { platform: 'youtube', account: 'four', channelId: CH })).ok, true);
  assert.equal((await service.createFeed(guild, { platform: 'youtube', account: 'five', channelId: CH })).ok, true);
  const sixth = await service.createFeed(guild, { platform: 'youtube', account: 'six', channelId: CH });
  assert.equal(sixth.error, 'limitFree', 'Free follows up to five accounts of a platform');
  assert.equal(sixth.count, 5);
  assert.equal(sixth.premium, 25, 'and Premium up to twenty-five');
  assert.equal(sixth.platform, 'YouTube');
  // The limit is for each platform: the five of YouTube do not use the room of Reddit.
  PROVIDERS.reddit = { ...PROVIDERS.youtube };
  const other = await service.createFeed(guild, { platform: 'reddit', account: 'r/other', channelId: CH });
  assert.equal(other.ok, true, 'a sixth feed of another platform is fine');
  assert.equal(await feedsDb.countForGuild(G), 6);
  assert.equal(await feedsDb.countForGuild(G, 'youtube'), 5);
  assert.equal(await feedsDb.remove(G, other.feed.id), true);
  delete PROVIDERS.reddit;
  // An auto feed: the pace is part of the account, a new pace starts at its next slot, and a pace under 15 minutes is refused.
  {
    const auto = await service.createFeed(guild, { platform: 'pokemon', account: '30m', channelId: CH });
    assert.equal(auto.ok, true);
    assert.equal(auto.feed.account_id, 'every:30');
    const slot = Math.floor(Date.now() / (30 * 60_000));
    assert.ok((await feedsDb.seenAmong([auto.feed.id], [`30:${slot}`])).has(`${auto.feed.id}:30:${slot}`), 'the slot running now is the past: it is marked as seen');
    assert.equal((await service.createFeed(guild, { platform: 'pokemon', account: '4', channelId: CH })).error, 'badPace');
    const paced = await service.updateFeed(guild, auto.feed.id, { every: '2h' });
    assert.equal(paced.ok && paced.feed.account_id, 'every:120', 'the pace of a feed can change');
    assert.equal((await service.updateFeed(guild, auto.feed.id, { every: '1' })).error, 'badPace');
    const daily = await service.updateFeed(guild, auto.feed.id, { every: '1d' });
    assert.equal(daily.feed.account_id, 'daily', 'once a day is the old account');
    assert.equal(await feedsDb.remove(G, auto.feed.id), true);
  }
  const [a, b, c, d, e] = await rows();
  for (const extra of [b, c, d, e]) await service.updateFeed(guild, extra.id, { enabled: false });

  // What is new is posted, once.
  const at = Date.now();
  queue = [{ id: 'old-a', type: 'video', title: 'Old A', publishedAt: at - 9e6 }, { id: 'n1', type: 'video', title: 'New one', url: 'https://y.t/n1', publishedAt: at - 1000 }, { id: 's1', type: 'short', title: 'A short', publishedAt: at - 500 }];
  engine.forgetSchedule();
  await engine.tick(client, { now: at });
  assert.equal(sent.length, 1, 'one new video; the short is a type the feed did not choose, and the old one was seen');
  assert.ok(allText(sent[0].payload).includes('New one'));
  assert.equal(sent[0].payload.components[0].toJSON().content, '<@&223456789012345678> Hi New one', 'the words of the feed, with the title in them');
  await engine.tick(client, { now: at + 1 });
  assert.equal(sent.length, 1, 'the schedule keeps it from asking again so soon');
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 120_000 });
  assert.equal(sent.length, 1, 'and what was posted is not posted again');
  assert.equal((await rows())[0].failures, 0);
  assert.ok((await rows())[0].last_sent_at, 'the time of the last notice is kept');
  // Turning the short on later does not post the old shorts (they were marked as seen).
  await service.updateFeed(guild, a.id, { types: ['video', 'short', 'live'] });
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 240_000 });
  assert.equal(sent.length, 1);

  // After a long silence only the newest are posted.
  queue = ['a', 'b', 'c', 'd', 'e'].map((id, index) => ({ id: `burst-${id}`, type: 'video', title: `Burst ${id}`, publishedAt: at + index }));
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 360_000 });
  assert.equal(sent.length, 1 + engine.MAX_PER_PASS, 'a flood is cut to the newest');
  assert.ok(allText(sent.at(-1).payload).includes('Burst e'));
  assert.equal((await feedsDb.seenAmong([a.id], ['burst-a', 'burst-b'])).size, 2, 'and all of them are marked as seen');

  // A stream: posted when it starts, its message is kept, and it is edited (grey, with buttons) when it ends.
  const standIn = 'https://petto.sbs/assets/feeds/kick-live.png';
  queue = [{ id: 'live1', type: 'live', title: 'Streaming', url: 'https://y.t/live1', authorUrl: 'https://y.t/chan', publishedAt: at, image: standIn, placeholder: true }];
  liveNow = new Set(['live1']);
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 480_000 });
  const liveMessage = sent.at(-1);
  assert.ok(allText(liveMessage.payload).includes('Streaming'));
  assert.equal((await pool.query('select count(*)::int as n from feed_live where feed_id = $1', [a.id])).rows[0].n, 1);
  assert.equal(edits.length, 0);
  // It went out with a stand-in picture; once the real one exists the same message is edited to show it (once).
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 540_000 });
  assert.equal(edits.length, 0, 'while the stand-in is all there is, nothing is edited');
  queue = [{ ...queue[0], image: 'https://images.kick.com/real.jpg', placeholder: undefined, viewers: 120 }];
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 560_000 });
  assert.equal(edits.length, 1, 'the real picture replaced the stand-in');
  assert.ok(JSON.stringify(edits[0].payload).includes('images.kick.com/real.jpg'));
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 570_000 });
  assert.equal(edits.length, 1, 'and it is not edited again');
  liveNow = new Set();
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 600_000 });
  assert.equal(edits.length, 2, 'the message of the stream was edited when it ended');
  const closed = JSON.parse(JSON.stringify(edits[1].payload.components.at(-1)));
  assert.ok(JSON.stringify(closed).includes('Peak: 120 viewers'), 'the card that closes the stream tells the most viewers it had');
  assert.equal(closed.accent_color, JSON.parse(JSON.stringify(liveMessage.payload.components.at(-1))).accent_color, 'the closed card keeps the color of the live one');
  assert.equal(engine.replayUrl({ platform: 'kick', authorUrl: 'https://kick.com/aquisi/' }), 'https://kick.com/aquisi/videos', 'Kick has no link to one replay: the videos of the channel');
  assert.equal(engine.replayUrl({ platform: 'youtube', url: 'https://youtu.be/x' }), 'https://youtu.be/x');
  assert.equal(engine.replayUrl({ platform: 'twitch', authorUrl: 'https://twitch.tv/x' }), null);
  assert.deepEqual(edits[1].payload.allowedMentions, { parse: [] }, 'and it does not mention anyone again');
  assert.equal((await pool.query('select count(*)::int as n from feed_live where feed_id = $1', [a.id])).rows[0].n, 0);

  // The live notices of Kick that were posted with its preview (a picture that can stay broken in Discord) are edited once, when the bot starts, to carry the picture of Kick.
  {
    const kickFeed = { ...a, platform: 'kick' };
    const base = { platform: 'kick', type: 'live', title: 'Old', url: 'https://kick.com/x', author: 'X', publishedAt: at };
    const broken = { feed_id: a.id, item_id: 'old1', channel_id: CH, message_id: 'm-old', item: { ...base, id: 'old1', image: 'https://images.kick.com/broken.jpg' } };
    const fine = { feed_id: a.id, item_id: 'old2', channel_id: CH, message_id: 'm-fine', item: { ...base, id: 'old2', image: standIn } };
    await feedsDb.saveLive(broken);
    await feedsDb.saveLive(fine);
    const editsBefore = edits.length;
    const done = await engine.repairKickPictures(client, [kickFeed, { ...a, id: a.id + 1000, platform: 'twitch' }], new Map([[a.id, [broken, fine]]]));
    assert.equal(done, 1, 'only the notice that has the preview is repaired');
    assert.equal(edits.length - editsBefore, 1);
    assert.deepEqual([edits.at(-1).messageId, JSON.stringify(edits.at(-1).payload).includes('kick-live.png'), edits.at(-1).payload.allowedMentions], ['m-old', true, { parse: [] }], 'its message now has the picture of Kick and mentions nobody again');
    const saved = (await pool.query('select item from feed_live where feed_id = $1 and item_id = $2', [a.id, 'old1'])).rows[0].item;
    assert.equal(saved.image, standIn, 'and it is written down');
    assert.equal(await engine.repairKickPictures(client, [kickFeed], new Map([[a.id, [broken]]])), 0, 'a repaired one is not touched again');
    await feedsDb.deleteLive(a.id, 'old1');
    await feedsDb.deleteLive(a.id, 'old2');
  }

  // A feed that cannot post: the failure is written down and, five times in a row, it is turned off.
  await service.updateFeed(guild, a.id, { enabled: true });
  failSend = 50013;
  for (let i = 0; i < engine.FAILURES_TO_STOP; i += 1) {
    queue = [{ id: `fail-${i}`, type: 'video', title: `Fail ${i}`, publishedAt: at + 1000 + i }];
    engine.forgetSchedule();
    await engine.tick(client, { now: at + 700_000 + i * 120_000 });
  }
  const failed = (await rows())[0];
  assert.equal(failed.enabled, false, 'five failures in a row turn it off');
  assert.equal(failed.last_error, 'permission');
  failSend = null;
  assert.equal((await service.updateFeed(guild, a.id, { enabled: true })).feed.failures, 0, 'turning it on clears the failures');

  // A feed whose first look failed only marks what exists (it does not post the past), and then works.
  await pool.query('update feeds set ready = false where id = $1', [a.id]);
  const before = sent.length;
  queue = [{ id: 'late1', type: 'video', title: 'Existing', publishedAt: at + 5 }];
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 2_000_000 });
  assert.equal(sent.length, before, 'the first pass of a feed that was not ready posts nothing');
  assert.equal((await rows())[0].ready, true);
  queue = [{ id: 'late2', type: 'video', title: 'Really new', publishedAt: at + 6 }];
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 2_200_000 });
  assert.equal(sent.length, before + 1);

  // The test notice, the removal, and the cleanup of what is old.
  const tested2 = await service.sendTest(guild, (await rows())[0], 'en');
  assert.equal(tested2.ok, true);
  assert.ok(allText(sent.at(-1).payload).includes(t('en', 'feeds.test.badge')));
  await feedsDb.markSeen([[a.id, 'ancient']]);
  await pool.query("update feed_seen set seen_at = now() - interval '90 days' where item_id = 'ancient'");
  await feedsDb.pruneOld();
  assert.equal((await feedsDb.seenAmong([a.id], ['ancient'])).size, 0, 'what was posted long ago is forgotten');
  assert.equal(await feedsDb.remove(G, a.id), true);
  assert.equal((await pool.query('select count(*)::int as n from feed_seen where feed_id = $1', [a.id])).rows[0].n, 0, 'removing a feed removes what it remembered');

  // The routes of the dashboard.
  const { registerFeedRoutes } = require('../src/web/feedRoutes');
  config.feedsPublic = true;
  const handlers = {};
  registerFeedRoutes({ post: (route, ...fns) => { handlers[route.split('/').pop()] = fns.at(-1); } }, { authorize: async () => ({ guild, userId: 'u', member: null }) });
  const call = async (name, body) => {
    const out = { status: 200, body: null };
    const res = { status(code) { out.status = code; return this; }, json(value) { out.body = value; return this; }, set() { return this; } };
    await handlers[name]({ body, params: { guildId: G }, headers: {}, query: {} }, res);
    return out;
  };
  let answer = await call('resolve', { platform: 'youtube', account: 'route-one' });
  assert.equal(answer.body.account.name, 'Account route-one');
  const asks = [];
  PROVIDERS.youtube.resolve = async (input) => { asks.push(input); return { id: `acc-${input}`, name: input, avatar: null, url: null }; };
  await call('resolve', { platform: 'youtube', account: 'cached' });
  await call('resolve', { platform: 'youtube', account: 'cached' });
  assert.equal(asks.length, 1, 'an account looked up twice is asked about once');
  let blocked = 0;
  for (let i = 0; i < 20; i += 1) if ((await call('resolve', { platform: 'youtube', account: `many-${i}` })).status === 429) blocked += 1;
  assert.ok(blocked > 0, 'a server cannot spend all the quota of a platform');
  assert.equal((await call('resolve', { platform: 'nope', account: 'x' })).status, 400);
  answer = await call('create', { platform: 'youtube', account: 'by-route', channel_id: CH2, types: ['video'], message: 'Hello', ping_roles: [], options: { image: false } });
  assert.equal(answer.body.ok, true);
  const routeFeed = answer.body.feed;
  assert.deepEqual(routeFeed.options, { image: false });
  answer = await call('update', { id: routeFeed.id, message: 'Changed', types: ['video', 'short'], enabled: false });
  assert.equal(answer.body.feed.message, 'Changed');
  assert.equal(answer.body.feed.enabled, false);
  assert.equal((await call('update', { id: 99999999, message: 'x' })).status, 404);
  assert.equal((await call('test', { id: routeFeed.id })).body.ok, true);
  answer = await call('preview', { platform: 'twitch', type: 'live', message: 'Live: {feed.title}', ping_roles: ['223456789012345678'], options: {}, account: { name: 'Somebody', avatar: null, url: 'https://www.twitch.tv/somebody' } });
  assert.equal(answer.body.ok, true);
  assert.ok(JSON.stringify(answer.body.messages).includes('Somebody'), 'the preview has the name of the account chosen');
  assert.ok(JSON.stringify(answer.body.messages[0][0]).startsWith('{"type":10,"content":"<@&223456789012345678> Live: '), 'with the ping and the words');
  assert.equal((await call('preview', { platform: 'nope' })).status, 400);
  assert.equal((await call('delete', { id: routeFeed.id })).body.ok, true);
  assert.equal((await call('delete', { id: routeFeed.id })).status, 404);

  await clean();
  // While the feeds are being tested only the team and the testers can use them (FEEDS_PUBLIC=true opens them to everybody).
  const { canUseFeeds } = require('../src/feeds/access');
  config.feedsPublic = false;
  assert.equal(canUseFeeds('u'), false, 'a member is not in the team');
  assert.equal(canUseFeeds(config.ownerId), true, 'the owner is');
  config.feedTesterIds.push('tester1');
  assert.equal(canUseFeeds('tester1'), true, 'a tester is');
  answer = await call('create', { platform: 'youtube', account: 'x', channel_id: '1' });
  assert.equal(answer.status, 403, 'the dashboard refuses a member while the feeds are in test');
  assert.equal(answer.body.error, 'no_access');
  config.feedsPublic = true;
  assert.equal(canUseFeeds('u'), true, 'public: everybody');
  config.feedsPublic = false;
  config.feedTesterIds.pop();
  {
    // The service of a slot of time: the hash must be exact at the size of a 5-minute slot (6 million), where a plain product lost its last bit and always chose the same service.
    const { hashOf } = require('../src/feeds/providers/music');
    const first = 5_977_072;
    const two = new Set(); const three = new Set();
    for (let slot = first; slot < first + 40; slot += 1) { two.add((hashOf(`5:${slot}`) >>> 16) % 2); three.add((hashOf(`5:${slot}`) >>> 16) % 3); }
    assert.deepEqual([...two].sort(), [0, 1], 'with two services (no Spotify keys) both are chosen at a 5-minute pace');
    assert.deepEqual([...three].sort(), [0, 1, 2], 'and with three, all of them');
    assert.equal(hashOf('5:5977072'), hashOf('5:5977072'), 'the same slot gives the same service for every server');
  }
  // --- YouTube push (WebSub): subscribe, confirm, push (signed), and a channel that pushes is looked at less often ------------------------------------------------
  {
    const websub = require('../src/feeds/websub');
    const store = require('../src/db/youtubeWebsub');
    const database = require('../src/db/database');
    config.youtubeApiKey = 'key';
    config.youtubeWebsubUrl = 'https://bot.example';
    await database.from('youtube_websub').delete().neq('channel_id', '');
    await websub.load();
    assert.equal(websub.enabled(), true);
    assert.equal(websub.callbackUrl(), 'https://bot.example/webhooks/youtube');
    const CHANNEL = 'UC_x5XG1OV2P6uZZ5FSM9Ttw';
    const OTHER = 'UCBJycsmduvYEL83R_U4JriQ';
    const hubCalls = [];
    const realFetch = globalThis.fetch;
    globalThis.fetch = async (url, options = {}) => { hubCalls.push({ url: String(url), body: new URLSearchParams(String(options.body ?? '')) }); return new Response('', { status: 202 }); };
    // A channel that is followed gets asked for; one that is not followed does not.
    await feedsDb.create({ guild_id: G, platform: 'youtube', account_id: CHANNEL, account_name: 'Push channel', channel_id: CH, types: ['video'], message: '', ping_roles: [], ping_everyone: false, options: {}, filters: {}, enabled: true, ready: true });
    feedsDb.forgetList();
    const upkeep = await websub.maintain();
    assert.deepEqual([upkeep.followed, upkeep.asked, upkeep.healthy], [1, 1, 0], 'the channel is asked for, and is not healthy until YouTube confirms it');
    const ask = hubCalls[0];
    assert.equal(ask.url, 'https://pubsubhubbub.appspot.com/subscribe');
    assert.deepEqual([ask.body.get('hub.mode'), ask.body.get('hub.topic'), ask.body.get('hub.callback'), ask.body.get('hub.verify')], ['subscribe', `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${CHANNEL}`, 'https://bot.example/webhooks/youtube', 'async']);
    const secret = ask.body.get('hub.secret');
    assert.ok(secret && secret.length >= 32, 'each channel has a secret of its own');
    assert.equal((await websub.maintain()).asked, 0, 'a subscription waiting for its confirmation is not asked for again at once');
    assert.equal(websub.isHealthy(CHANNEL), false);

    const reply = () => { const out = { status: 0, text: '', headers: {} }; return Object.assign(out, { status(code) { out.status = code; return out; }, type() { return out; }, set(headers) { Object.assign(out.headers, headers); return out; }, send(text) { out.text = text; return out; }, end(body) { if (body) out.text = Buffer.from(body).toString('utf8'); return out; } }); };
    const verify = async (query) => { const res = reply(); await websub.verifyHandler({ query }, res); return res; };
    let res = await verify({ 'hub.mode': 'subscribe', 'hub.topic': `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${OTHER}`, 'hub.challenge': 'abc' });
    assert.equal(res.status, 404, 'a channel nobody asked for is not confirmed');
    res = await verify({ 'hub.mode': 'subscribe', 'hub.topic': `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${CHANNEL}`, 'hub.challenge': 'abc123', 'hub.lease_seconds': '432000' });
    assert.deepEqual([res.status, res.text], [200, 'abc123'], 'the confirmation is answered with the challenge');
    assert.deepEqual([res.headers['Content-Type'], res.headers['X-Content-Type-Options']], ['text/plain; charset=utf-8', 'nosniff'], 'as plain text that is never read as a page');
    res = await verify({ 'hub.mode': 'subscribe', 'hub.topic': `https://www.youtube.com/xml/feeds/videos.xml?channel_id=${CHANNEL}`, 'hub.challenge': '<script>alert(1)</script>' });
    assert.equal(res.status, 404, 'a challenge with anything but letters, digits and a few signs is refused');
    assert.equal(websub.isHealthy(CHANNEL), true);
    assert.equal((await store.get(CHANNEL)).status, 'active');
    assert.equal((await websub.maintain()).healthy, 1);
    assert.equal(websub.needing([CHANNEL], Date.now() + 4.5 * 86_400_000).length, 1, 'it is renewed when less than a day is left');

    // What YouTube sends: signed with the secret of the channel; the engine is woken for the channel, and not for a bad signature.
    const woken = [];
    websub.setWake((id) => woken.push(id));
    const atom = `<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><entry><yt:videoId>vid1</yt:videoId><yt:channelId>${CHANNEL}</yt:channelId><title>New</title></entry></feed>`;
    const push = async (signature, body = atom) => { const res = reply(); await websub.pushHandler({ body: Buffer.from(body), get: (name) => (name === 'x-hub-signature' ? signature : undefined) }, res); return res; };
    assert.equal((await push('sha1=wrong')).status, 204, 'the hub is always answered');
    assert.deepEqual(woken, [], 'but a notice with a bad signature does nothing');
    await push(websub.sign(secret, atom));
    assert.deepEqual(woken, [CHANNEL], 'a signed notice makes the channel be looked at at once');
    assert.ok((await store.get(CHANNEL)).last_push_at, 'and the push is written down');
    assert.equal(websub.signatureOk(secret, Buffer.from(atom), websub.sign(secret, atom)), true);
    assert.deepEqual(websub.channelsOf(`<yt:channelId>${CHANNEL}</yt:channelId><yt:channelId>${CHANNEL}</yt:channelId>`), [CHANNEL]);

    // What the hub sent is kept and added to what the feed shows: the feed of a channel can take minutes to show a new video, the push already says it.
    assert.deepEqual(websub.pushedFor(CHANNEL).map((entry) => [entry.videoId, entry.title]), [['vid1', 'New']], 'the entries of a signed push are kept');
    assert.deepEqual(websub.pushedFor(CHANNEL, Date.now() + 31 * 60_000), [], 'for half an hour');
    await push(websub.sign(secret, atom)); // the same push again (the hub repeats)
    assert.equal(websub.pushedFor(CHANNEL).length, 1, 'a video is kept once');
    const afterPush = globalThis.fetch;
    globalThis.fetch = async (url) => {
      if (String(url).includes('/feeds/videos.xml')) return new Response(`<?xml version="1.0"?><feed xmlns:yt="http://www.youtube.com/xml/schemas/2015"><title>Push channel</title></feed>`, { status: 200 }); // the feed does not show the video yet
      if (String(url).includes('/youtube/v3/videos')) return new Response(JSON.stringify({ items: [{ id: 'vid1', snippet: { liveBroadcastContent: 'none', description: 'About this video\nand more' } }] }), { status: 200 });
      return new Response('{}', { status: 404 });
    };
    const polled = (await REAL_YOUTUBE.poll([{ id: CHANNEL, name: 'Push channel', avatar: null, url: `https://www.youtube.com/channel/${CHANNEL}` }], new Map(), { now: Date.now() })).get(CHANNEL);
    globalThis.fetch = afterPush;
    assert.deepEqual(polled.items.map((item) => `${item.id}:${item.type}`), ['vid1:video'], 'a video the push brought is posted although the feed does not show it yet');
    assert.equal(polled.items[0].description, 'About this video', 'and its description comes from the call that says whether it is live (the push does not carry it)');

    // A channel that pushes is looked at every 3 minutes (every 10 with more than 300 channels followed, every 30 with more than 1500); with a stream announced it keeps the fast pace; without push it is every 5 minutes.
    const yt = PROVIDERS.youtube;
    assert.equal(yt.intervalFor(CHANNEL), 3 * 60_000, 'a channel that pushes needs a look only now and then');
    const filler = Array.from({ length: 301 }, (_, index) => `filler${index}`);
    for (const id of filler) websub.known.set(id, { status: 'subscribed', expiresAt: 0, secret: 'x', fails: 0, requestedAt: 0 });
    assert.equal(yt.intervalFor(CHANNEL), 10 * 60_000, 'with a few hundred channels, every 10 minutes');
    const more = Array.from({ length: 1200 }, (_, index) => `more${index}`);
    for (const id of more) websub.known.set(id, { status: 'subscribed', expiresAt: 0, secret: 'x', fails: 0, requestedAt: 0 });
    assert.equal(yt.intervalFor(CHANNEL), 30 * 60_000, 'with a lot of channels the look is every 30 minutes, so the job keeps up');
    for (const id of [...filler, ...more]) websub.known.delete(id);
    assert.equal(yt.intervalFor(OTHER), 5 * 60_000, 'one that does not push is looked at as before');
    assert.equal(websub.isHealthy(CHANNEL, Date.now() + 6 * 86_400_000), false, 'and one whose subscription ran out goes back to the fast pace');

    // When push cannot be set up (no public address, or turned off) nothing changes.
    config.youtubeWebsubUrl = null; const verifyBase = config.verifyBaseUrl; config.verifyBaseUrl = null;
    assert.equal(websub.enabled(), false);
    config.verifyBaseUrl = verifyBase;
    config.youtubeWebsub = false;
    assert.equal(websub.enabled(), false, 'YOUTUBE_WEBSUB=false turns it off');
    config.youtubeWebsub = true;
    globalThis.fetch = realFetch;
    await database.from('youtube_websub').delete().neq('channel_id', '');
    await clean();
    config.youtubeApiKey = null;
  }

  await closePools();
  console.log('check-feeds: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
