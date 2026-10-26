// Checks the feeds: the cleaning of the text, the card of every kind of notice, the readers of each platform (with the answers of the services
// written out), the engine (what is posted, what is not posted twice, the streams that end, the failures) and, when PETTO_TEST_DATABASE_URL points
// to a test database, the same against a real PostgreSQL: the limits of Free and Premium, the first look of a new feed and the cleanup.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL = process.env.PETTO_TEST_DATABASE_URL || 'postgres://check:check@127.0.0.1:1/check';
const assert = require('node:assert/strict');

const text = require('../src/feeds/text');
const card = require('../src/feeds/card');
const { PLATFORMS, PLATFORM_IDS, TYPES } = require('../src/feeds/platforms');
const youtube = require('../src/feeds/providers/youtube');
const twitch = require('../src/feeds/providers/twitch');
const kick = require('../src/feeds/providers/kick');
const bluesky = require('../src/feeds/providers/bluesky');
const modrinth = require('../src/feeds/providers/modrinth');
const pokemon = require('../src/feeds/providers/pokemon');
const { PROVIDERS, MAX_AGE_MS, notLive } = require('../src/feeds/providers');
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
  assert.equal(text.linkText('A [test] **video**'), 'A \\[test\\] \\*\\*video\\*\\*');
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
  assert.deepEqual(message.allowedMentions.roles, ['223456789012345678']);
  assert.equal(message.allowedMentions.parse.length, 0, 'only the roles named are mentioned');
  const container = parts[1];
  assert.equal(container.type, 17);
  assert.equal(container.accent_color, PLATFORMS.youtube.color, 'the side bar has the color of the platform');
  assert.equal(container.components[0].type, 9, 'a section: the title and a picture at the right');
  assert.equal(container.components[0].accessory.media.url, 'https://yt3.example/a.jpg');
  assert.match(container.components[0].components[0].content, /\*\*\[A \\\[new\\\] video\]\(https:\/\/youtu\.be\/x\)\*\*\n-# What it is about$/);
  assert.equal(container.components[1].type, 14, 'a separator, then the cover');
  assert.equal(container.components[2].items[0].media.url, 'https://i.ytimg.com/vi/x/hq.jpg');
  assert.match(container.components.at(-1).content, /^-# 🎬 New video · Channel · <t:\d+:R>$/);
  assert.ok(message.flags);

  message = card.buildFeedMessage({ message: '', ping_roles: [], options: {} }, { ...base, avatar: null }, { lang: 'es' });
  parts = json(message.components);
  assert.equal(parts[0].type, 17, 'no words and no ping: only the card');
  assert.ok(parts[0].components[0].accessory.media.url.endsWith('/youtube.png'), 'an account with no picture shows the one of the platform');
  const short = json(card.buildFeedMessage({ message: '', options: {} }, { ...base, type: 'short' }, { lang: 'en' }).components)[0];
  assert.ok(!short.components.some((child) => child.type === 12), 'a Short goes without the big picture');
  const shortWith = json(card.buildFeedMessage({ message: '', options: { image: true } }, { ...base, type: 'short' }, { lang: 'en' }).components)[0];
  assert.ok(shortWith.components.some((child) => child.type === 12), 'unless the server asks for it');
  const noImage = json(card.buildFeedMessage({ message: '', options: { image: false } }, base, { lang: 'en' }).components)[0];
  assert.ok(!noImage.components.some((child) => child.type === 12));
  const withButton = json(card.buildFeedMessage({ message: '', options: { button: true } }, base, { lang: 'en' }).components)[0];
  assert.equal(withButton.components.at(-1).components[0].url, 'https://youtu.be/x');
  assert.equal(withButton.components.at(-1).components[0].label, 'Watch on YouTube');
  const colored = json(card.buildFeedMessage({ message: '', options: { color: 0x123456 } }, base, { lang: 'en' }).components)[0];
  assert.equal(colored.accent_color, 0x123456);
  const everyone = card.buildFeedMessage({ message: '', ping_everyone: true, ping_roles: [] }, base, { lang: 'en' });
  assert.deepEqual(everyone.allowedMentions.parse, ['everyone']);
  assert.ok(json(everyone.components)[0].content.startsWith('@everyone'));
  const tested = json(card.buildFeedMessage({ message: '', options: {} }, base, { lang: 'en', test: true }).components);
  assert.ok(tested[0].content.includes(t('en', 'feeds.test.badge')));
  const ended = json(card.buildFeedMessage({ message: '', options: {} }, { ...base, type: 'ended', vodUrl: 'https://youtu.be/x', authorUrl: 'https://youtube.com/channel/UCx' }, { lang: 'en' }).components)[0];
  assert.equal(ended.accent_color, 0x4f545c, 'a stream that is over is grey');
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
  ];
  const parsed = youtube.parseFeed(rss(entries));
  assert.equal(parsed.length, 5);
  assert.equal(parsed[0].title, 'A video & more');
  assert.equal(parsed[0].views, 5);
  assert.deepEqual(parsed.map((entry) => entry.short), [false, true, false, false, false], 'a Short has /shorts/ in its link');

  // The platform of YouTube with the answers of the services written out: the feed, and the call that says who is live.
  const calls = [];
  const realFetch = globalThis.fetch;
  config.youtubeApiKey = 'key';
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    if (String(url).includes('/feeds/videos.xml')) return new Response(rss(entries), { status: 200 });
    if (String(url).includes('/youtube/v3/videos')) {
      const ids = new URL(url).searchParams.get('id').split(',');
      const state = { liv1: 'live', upc1: 'upcoming' };
      return new Response(JSON.stringify({ items: ids.map((id) => ({ id, snippet: { liveBroadcastContent: state[id] ?? 'none' }, liveStreamingDetails: {} })) }), { status: 200 });
    }
    return new Response('{}', { status: 404 });
  };
  const account = { id: 'UCx', name: 'Chan', avatar: 'https://yt3.example/a.jpg', url: 'https://www.youtube.com/channel/UCx' };
  let results = await PROVIDERS.youtube.poll([account], new Map(), { now });
  let result = results.get('UCx');
  assert.deepEqual(result.items.map((item) => `${item.id}:${item.type}`).sort(), ['liv1:live', 'sho1:short', 'vid1:video'], 'a live is a live, an upcoming one waits, an old one is not news');
  assert.deepEqual([...result.stillLive], ['liv1']);
  const apiCalls = () => calls.filter((url) => url.includes('/youtube/v3/videos')).length;
  assert.equal(apiCalls(), 1, 'one call for all the videos');
  results = await PROVIDERS.youtube.poll([account], new Map(), { now });
  const second = new URL(calls.filter((url) => url.includes('/youtube/v3/videos')).at(-1)).searchParams.get('id').split(',').sort();
  assert.deepEqual(second, ['liv1', 'upc1'], 'what is known not to be live is not asked about again, a live and an upcoming one are');
  // A stream being followed that ended: it is not in `stillLive` any more.
  results = await PROVIDERS.youtube.poll([account], new Map([['UCx', new Set(['gone1'])]]), { now });
  assert.ok(!results.get('UCx').stillLive.has('gone1'), 'a followed stream that is not live now has ended');
  // Without the key every video is just a video and nothing is said to have ended.
  config.youtubeApiKey = null;
  notLive.clear();
  results = await PROVIDERS.youtube.poll([account], new Map([['UCx', new Set(['liv1'])]]), { now });
  assert.ok(results.get('UCx').items.every((item) => item.type !== 'live'));
  assert.equal(results.get('UCx').stillLive, undefined, 'without the key nothing is closed by mistake');
  config.youtubeApiKey = 'key';
  // The feed fails for one channel and not for the others.
  globalThis.fetch = async (url) => (String(url).includes('channel_id=bad') ? new Response('', { status: 404 }) : new Response(rss(entries), { status: 200 }));
  results = await PROVIDERS.youtube.poll([{ ...account, id: 'bad' }, account], new Map(), { now, withLive: false });
  assert.equal(results.get('bad').error, 'notFound');
  assert.equal(results.get('UCx').items.length, 4);
  globalThis.fetch = realFetch;
  config.youtubeApiKey = null;

  // --- Kick: the answers of its API written out ------------------------------------------------------------------------------------------------
  {
    config.kickClientId = 'id';
    config.kickClientSecret = 'secret';
    const kickCalls = [];
    const channels = { 1: { broadcaster_user_id: 1, slug: 'live-one', stream_title: 'Hello', category: { name: 'Minecraft' }, stream: { is_live: true, start_time: '2026-10-26T20:00:00Z', viewer_count: 1234, thumbnail: 'https://images.kick.com/t.jpg' } },
      2: { broadcaster_user_id: 2, slug: 'quiet', stream_title: '', stream: { is_live: false } } };
    globalThis.fetch = async (url, options) => {
      kickCalls.push(String(url));
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
    assert.equal(kickCalls.filter((url) => url.includes('/channels?') && url.includes('broadcaster_user_id')).length, 1, 'both accounts are asked in one call');
    config.kickClientId = null;
    kickCalls.length = 0;
    await assert.rejects(PROVIDERS.kick.resolve('live-one'), (error) => error.kind === 'notConfigured', 'without the keys Kick says it is not set up');
    globalThis.fetch = realFetch;
    config.kickClientSecret = null;
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
  const fourth = await service.createFeed(guild, { platform: 'youtube', account: 'four', channelId: CH });
  assert.equal(fourth.error, 'limitFree', 'Free follows up to three accounts');
  assert.equal(fourth.count, 3);
  assert.equal(fourth.premium, 10, 'and Premium up to ten');
  const [a, b, c] = await rows();
  await service.updateFeed(guild, b.id, { enabled: false });
  await service.updateFeed(guild, c.id, { enabled: false });

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
  queue = [{ id: 'live1', type: 'live', title: 'Streaming', url: 'https://y.t/live1', authorUrl: 'https://y.t/chan', publishedAt: at }];
  liveNow = new Set(['live1']);
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 480_000 });
  const liveMessage = sent.at(-1);
  assert.ok(allText(liveMessage.payload).includes('Streaming'));
  assert.equal((await pool.query('select count(*)::int as n from feed_live where feed_id = $1', [a.id])).rows[0].n, 1);
  assert.equal(edits.length, 0);
  liveNow = new Set();
  engine.forgetSchedule();
  await engine.tick(client, { now: at + 600_000 });
  assert.equal(edits.length, 1, 'the message of the stream was edited when it ended');
  assert.equal(JSON.parse(JSON.stringify(edits[0].payload.components.at(-1))).accent_color, 0x4f545c);
  assert.deepEqual(edits[0].payload.allowedMentions, { parse: [] }, 'and it does not mention anyone again');
  assert.equal((await pool.query('select count(*)::int as n from feed_live where feed_id = $1', [a.id])).rows[0].n, 0);

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
  await closePools();
  console.log('check-feeds: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
