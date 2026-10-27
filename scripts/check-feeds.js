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
  assert.match(container.components.at(-1).content, /^-# <:pe_f_video_short:\d+> New video · Channel · <t:\d+:R>$/);
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
    assert.equal(discoverFeed('<head><link rel="alternate" type="application/rss+xml" href="/feed.xml"></head>', 'https://ex.com/blog/'), 'https://ex.com/feed.xml');
    assert.equal(parseFeed('<rss><channel><title>t</title><item><title>only</title><guid>1</guid></item></channel></rss>').entries.length, 1);

    // Reddit and Pinterest.
    assert.equal(rssProviders.parseSubreddit('https://www.reddit.com/r/Minecraft/comments/abc'), 'Minecraft');
    assert.equal(rssProviders.parseSubreddit('r/a b'), null);
    assert.equal(rssProviders.parsePinterest('https://www.pinterest.com/Some_User/my-board/'), 'some_user/my-board');
    assert.equal(rssProviders.parsePinterest('https://www.pinterest.com/pin/12345/'), null);
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
  await closePools();
  console.log('check-feeds: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
