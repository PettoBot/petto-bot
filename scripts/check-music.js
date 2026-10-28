// The music: which recording is chosen (no remix or cover unless asked), the queue and its player with a stand-in of Lavalink (a recording that fails goes to the
// next one, a run of failures stops), the card, the status of the voice channel, who can use it, and the commands and buttons with a stand-in of Discord.
// Nothing here talks to Lavalink or to Discord: that part is tested by hand with the node of Pettolava.
process.env.DISCORD_TOKEN ||= 'check-only';
process.env.DISCORD_CLIENT_ID ||= '1';
process.env.DISCLOUD_DATABASE_URL ||= 'postgres://check:check@127.0.0.1:1/check'; // never connected to
process.env.LAVALINK_HOST = 'node.example.com';
process.env.LAVALINK_PASSWORD = 'secret';
const assert = require('node:assert/strict');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { Collection } = require('discord.js');

const resolvedDb = require.resolve('../src/db/database');
require.cache[resolvedDb] = { id: resolvedDb, filename: resolvedDb, loaded: true, exports: { from: () => ({}) } };

const config = require('../src/config');
const match = require('../src/music/match');
const resolver = require('../src/music/resolver');
const { GuildMusic, MAX_FAILURES } = require('../src/music/queue');
const card = require('../src/music/card');
const { setVoiceStatus, statusOf } = require('../src/music/status');
const { canUseMusic } = require('../src/music/access');
const { t, LANGUAGES } = require('../src/i18n');

const T = (title, author, length, extra = {}) => ({ encoded: `enc:${title}:${author}`, info: { identifier: `id-${title}`, title, author, length, isStream: false, isSeekable: true, sourceName: 'youtube', ...extra } });
const json = (payload) => JSON.parse(JSON.stringify(payload));
const flat = (node) => (Array.isArray(node) ? node.flatMap(flat) : node && typeof node === 'object' ? [node, ...flat(Object.values(node))] : []);
const textOf = (payload) => flat(json(payload.components)).filter((part) => typeof part.content === 'string').map((part) => part.content).join('\n');

(async () => {
  // --- Which recording ------------------------------------------------------------------------------------------------------------------------------
  const creep = { title: 'Creep', artist: 'Radiohead', lengthMs: 238_000 };
  const results = [
    T('Creep (Vicetone Remix)', 'Vicetone', 240_000), T('Creep (cover by Postmodern Jukebox)', 'PMJ', 230_000), T('Radiohead - Creep', 'Radiohead - Topic', 238_500),
    T('Creep', 'TLC', 270_000), T('Radiohead - Creep (Official Video)', 'Radiohead', 239_000), T('Creep', 'Stone Sour', 238_000), T('Radiohead - Creep (Live)', 'Radiohead', 240_000),
    T('Radiohead - Creep (Slowed + Reverb)', 'x', 300_000), T('Radiohead - Creep (karaoke)', 'k', 238_000), T('Radiohead - Creep', 'Someone', 600_000),
  ];
  assert.deepEqual(match.rank(results, creep).map((entry) => entry.track.info.title), ['Radiohead - Creep', 'Radiohead - Creep (Official Video)'], 'remixes, covers, live, slowed, karaoke, another artist and another length are out; the Topic channel first');
  assert.equal(match.rank([T('Creep (Live)', 'Radiohead', 300_000)], { query: 'creep radiohead live' }).length, 1, 'a word that was asked for is allowed');
  assert.equal(match.rank([T('Cover Me Up', 'Jason Isbell', 220_000)], { title: 'Cover Me Up', artist: 'Jason Isbell', lengthMs: 220_000 }).length, 1, 'the word is part of the title of the song');
  assert.equal(match.rank([{ ...T('Radio', 'x', 100), info: { ...T('Radio', 'x', 100).info, isStream: true } }], { query: 'radio' }).length, 0, 'a live stream is not a song');
  assert.ok(match.rank([T('Anything', 'a', 1000, { isrc: 'GBAYE9200070' })], { title: 'Anything', artist: 'a', isrc: 'gbaye9200070' })[0].score > match.rank([T('Anything', 'a', 1000)], { title: 'Anything', artist: 'a' })[0].score + 90, 'the ISRC settles it');
  assert.equal(match.order(results.slice(0, 2), { query: 'creep radiohead' }).how, 'none', 'only remixes and covers: nothing to play');
  assert.equal(match.order([T('Radiohead - Creep', 'Radiohead - Topic', 238_000)], { query: 'radiohead the creep studio recording' }).how, 'relaxed', 'a little off is still found');
  assert.equal(match.order([T('Something else', 'Someone', 100_000)], { query: 'creep radiohead' }).how, 'trusted', 'with nothing close, the first result that is not a remix is what the search found');
  assert.equal(match.artistNamed(match.normalize('Dua Lipa - Levitating'), 'Dua Lipa, Elton John'), true);
  assert.equal(match.artistNamed(match.normalize('DuaLipa Levitating'), 'Dua Lipa'), true, 'a name written without the space');
  assert.equal(match.artistNamed(match.normalize('Levitating'), 'Dua Lipa'), false);
  assert.equal(match.coreTitle('Song (feat. X) - Remastered 2011'), 'Song');
  assert.deepEqual(['https://open.spotify.com/intl-es/track/4cOdK2wGLETKBW3PvgPWqT?si=x', 'spotify:playlist:37i9dQZF1DXcBWIGoYBM5M', 'https://youtu.be/x', 'https://music.youtube.com/watch?v=x', 'https://soundcloud.com/a/b', 'https://example.com/x', 'creep radiohead'].map((text) => match.kindOfInput(text).kind),
    ['spotify', 'spotify', 'youtube', 'youtube', 'soundcloud', 'other', 'text']);
  assert.equal(match.kindOfInput('spotify:playlist:37i9dQZF1DXcBWIGoYBM5M').url, 'https://open.spotify.com/playlist/37i9dQZF1DXcBWIGoYBM5M');

  // --- The resolver, with a stand-in node -----------------------------------------------------------------------------------------------------------
  const asked = [];
  const answers = {
    'ytmsearch:radiohead creep': { loadType: 'search', data: [T('Radiohead - Creep', 'Radiohead - Topic', 238_000), T('Creep (cover)', 'Cover Guy', 238_000)] },
    'scsearch:radiohead creep': { loadType: 'search', data: [T('Creep', 'Radiohead', 239_000, { sourceName: 'soundcloud' })] },
    'ytmsearch:Radiohead Creep': { loadType: 'search', data: [T('Creep (Vicetone Remix)', 'Vicetone', 240_000), T('Radiohead - Creep', 'Radiohead - Topic', 238_300)] },
    'scsearch:Radiohead Creep': { loadType: 'search', data: [] },
    'https://open.spotify.com/track/abc': { loadType: 'track', data: T('Creep', 'Radiohead', 238_000, { sourceName: 'spotify', isrc: 'GBAYE9200070', artworkUrl: 'https://i.scdn.co/a.jpg' }) },
    'https://open.spotify.com/playlist/pl': { loadType: 'playlist', data: { info: { name: 'My list' }, tracks: [T('Creep', 'Radiohead', 238_000, { sourceName: 'spotify' }), T('Karma Police', 'Radiohead', 264_000, { sourceName: 'spotify' })] } },
    'https://youtu.be/abc': { loadType: 'track', data: T('Some video', 'Chan', 100_000) },
    'https://soundcloud.com/bad': { loadType: 'error', data: { message: 'Something broke', severity: 'common' } },
    'https://soundcloud.com/none': { loadType: 'empty', data: {} },
  };
  const fakeNode = { rest: { resolve: async (identifier) => { asked.push(identifier); return answers[identifier] ?? { loadType: 'search', data: [] }; } } };

  const text = await resolver.resolveInput(fakeNode, 'radiohead creep', { requestedBy: '7' });
  assert.equal(text.type, 'track');
  assert.deepEqual([text.items[0].title, text.items[0].requestedBy, text.items[0].lazy], ['Radiohead - Creep', '7', false], 'a name: the best recording, found on YouTube Music and SoundCloud at once');
  assert.ok(asked.includes('ytmsearch:radiohead creep') && asked.includes('scsearch:radiohead creep'));
  assert.ok(text.items[0].candidates.length >= 2 && text.items[0].candidates[0] === text.items[0].encoded, 'the other good recordings are kept in case the first one fails');
  assert.ok(!text.items[0].candidates.some((encoded) => encoded.includes('cover')), 'a cover is not kept');

  const track = await resolver.resolveInput(fakeNode, 'https://open.spotify.com/track/abc', { requestedBy: '7' });
  assert.deepEqual([track.type, track.items[0].lazy, track.items[0].meta.isrc, track.items[0].artwork], ['track', true, 'GBAYE9200070', 'https://i.scdn.co/a.jpg'], 'a Spotify song is only its data; the recording is chosen later');
  const list = await resolver.resolveInput(fakeNode, 'https://open.spotify.com/playlist/pl');
  assert.deepEqual([list.type, list.name, list.items.length, list.items.every((item) => item.lazy)], ['playlist', 'My list', 2, true]);
  const capped = await resolver.resolveInput(fakeNode, 'https://open.spotify.com/playlist/pl', { limit: 1 });
  assert.deepEqual([capped.items.length, capped.cut], [1, 1]);
  assert.equal((await resolver.resolveInput(fakeNode, 'https://youtu.be/abc')).items[0].lazy, false, 'a link of YouTube is played as it is');
  assert.equal((await resolver.resolveInput(fakeNode, 'https://example.com/a.mp3')).type, 'unsupported');
  assert.deepEqual(await resolver.resolveInput(fakeNode, 'https://soundcloud.com/bad'), { type: 'error', items: [], error: 'Something broke' });
  assert.equal((await resolver.resolveInput(fakeNode, 'https://soundcloud.com/none')).type, 'none');
  assert.equal((await resolver.resolveInput(fakeNode, '   ')).type, 'none');
  assert.equal((await resolver.resolveInput({ rest: { resolve: async () => { throw new Error('down'); } } }, 'https://youtu.be/abc')).error, 'unavailable', 'a node that fails is an error, not a crash');

  resolver.forgetChosen();
  asked.length = 0;
  const recordings = await resolver.recordingsFor(fakeNode, track.items[0]);
  assert.equal(recordings[0], 'enc:Radiohead - Creep:Radiohead - Topic', 'the recording of a Spotify song: not the remix, the one with the right length');
  assert.equal(recordings.at(-1), track.items[0].fallback, 'the mirror of the node goes last');
  const before = asked.length;
  await resolver.recordingsFor(fakeNode, track.items[0]);
  assert.equal(asked.length, before, 'the choice is remembered');

  // --- The queue and its player ---------------------------------------------------------------------------------------------------------------------
  const makePlayer = () => {
    const player = new EventEmitter();
    player.calls = [];
    player.playTrack = async (options) => { player.calls.push(['play', options.track.encoded]); player.loaded = options.track.encoded; setImmediate(() => player.emit('start', { track: { encoded: options.track.encoded } })); };
    player.stopTrack = async () => { player.calls.push(['stop']); };
    player.setPaused = async (value) => { player.calls.push(['paused', value]); };
    player.seekTo = async (ms) => { player.calls.push(['seek', ms]); };
    player.setGlobalVolume = async (value) => { player.calls.push(['volume', value]); };
    return player;
  };
  const song = (name, ms = 200_000, list = null) => ({ title: name, author: 'A', lengthMs: ms, encoded: `e:${name}`, list: list ?? [`e:${name}`], requestedBy: '1' });
  const events = [];
  let clockNow = 1_000_000;
  const hooksFor = () => ({ onTrackStart: (m, item) => events.push(['start', item.title]), onTrackFailed: (m, item, error) => events.push(['failed', item.title, error]), onQueueEnd: () => events.push(['ended']), onGiveUp: () => events.push(['gaveUp']), onStopped: () => events.push(['stopped']) });
  const create = (player, recordingsFor = async (item) => item.list ?? [item.encoded]) => new GuildMusic({ guildId: 'g', player, recordingsFor, hooks: hooksFor(), now: () => clockNow, maxQueue: 5 });
  const settle = () => new Promise((resolve) => setImmediate(resolve));
  const until = async (condition) => { for (let i = 0; i < 100 && !condition(); i += 1) await new Promise((resolve) => setTimeout(resolve, 50)); };
  const finished = (player, name) => { player.emit('end', { reason: 'finished', track: { encoded: `e:${name}` } }); return settle(); };

  {
    const player = makePlayer();
    const music = create(player);
    assert.deepEqual(music.add([song('one'), song('two'), song('three')]), { added: 3, position: 1, full: false });
    await music.startIfIdle();
    assert.deepEqual(player.calls, [['play', 'e:one']]);
    assert.equal(music.current.title, 'one');
    assert.equal(await music.startIfIdle(), false, 'it does not start twice');
    await finished(player, 'one');
    assert.equal(music.current.title, 'two', 'when a song ends the next one plays');
    player.emit('end', { reason: 'replaced', track: { encoded: 'e:one' } });
    player.emit('end', { reason: 'stopped', track: { encoded: 'e:two' } });
    await settle();
    assert.equal(music.current.title, 'two', 'the ends caused by Petto itself are not a reason to move on');
    await finished(player, 'one');
    assert.equal(music.current.title, 'two', 'the end of a song that is not the one playing is ignored');
    await finished(player, 'two');
    await finished(player, 'three');
    assert.equal(music.current, null);
    assert.deepEqual(events.filter((event) => event[0] === 'ended').length, 1, 'the end of the queue is said once');
    assert.deepEqual(music.history.map((item) => item.title), ['one', 'two', 'three']);

    // The queue is full at 5.
    assert.deepEqual(music.add([song('a'), song('b'), song('c'), song('d'), song('e'), song('f'), song('g')]), { added: 5, position: 1, full: true });
    music.clear();
    // Previous: back to the song before.
    music.add([song('x'), song('y')]);
    await music.startIfIdle();
    await finished(player, 'x');
    assert.equal(music.current.title, 'y');
    assert.equal(await music.previous(), true);
    assert.equal(music.current.title, 'x', 'the previous song');
    await finished(player, 'x');
    assert.equal(music.current.title, 'y', 'and the one that was playing is not lost');
  }

  {
    // Loop: the song, the queue.
    const player = makePlayer();
    const music = create(player);
    music.add([song('a'), song('b')]);
    await music.startIfIdle();
    music.setLoop('track');
    await finished(player, 'a');
    assert.equal(music.current.title, 'a', 'repeating the song');
    assert.equal(player.calls.filter((call) => call[0] === 'play').length, 2);
    await music.skip();
    assert.equal(music.current.title, 'b', 'skipping leaves the repeat of the song');
    music.setLoop('queue');
    music.add([song('c')]);
    await finished(player, 'b');
    assert.equal(music.current.title, 'c');
    assert.deepEqual(music.queue.map((item) => item.title), ['b'], 'repeating the queue: the song that ended goes to the back');
    await finished(player, 'c');
    assert.equal(music.current.title, 'b', 'and it comes round again');
    assert.equal(music.setLoop('nonsense'), 'off');
  }

  {
    // Controls.
    const player = makePlayer();
    const music = create(player);
    music.add([song('a', 200_000), song('b'), song('c'), song('d')]);
    await music.startIfIdle();
    assert.equal(await music.resume(), false, 'it was not paused');
    assert.equal(await music.pause(), true);
    assert.equal(music.paused, true);

    clockNow += 10_000;
    assert.equal(music.positionMs(), 0, 'a paused song does not move');
    await music.resume();
    clockNow += 5_000;
    assert.equal(music.positionMs(), 5_000, 'the time goes on after it');
    player.emit('update', { state: { position: 20_000 } });
    assert.equal(music.positionMs(), 20_000);
    assert.equal(await music.seek(999_999_999), true);
    assert.equal(player.calls.at(-1)[1], 199_000, 'a jump past the end stays inside the song');
    assert.equal(await music.setVolume(500), 150);
    assert.equal(await music.setVolume(0), 1);
    assert.equal(music.remove(0), null);
    assert.equal(music.remove(9), null);
    assert.equal(music.remove(1).title, 'b');
    assert.deepEqual(music.queue.map((item) => item.title), ['c', 'd']);
    await music.skip(2);
    assert.equal(music.current.title, 'd', 'skipping two songs');
    assert.equal(music.clear(), 0);
    music.add([song('e'), song('f'), song('g')]);
    assert.equal(music.shuffle(), 3);
    assert.deepEqual(music.queue.map((item) => item.title).sort(), ['e', 'f', 'g']);
    await music.stop();
    assert.deepEqual([music.current, music.queue.length, events.at(-1)[0]], [null, 0, 'stopped']);
    await finished(player, 'd');
    assert.equal(events.filter((event) => event[0] === 'ended').length, 1, 'a song that ended after a stop does not start anything');
  }

  {
    // A recording that fails goes to the next one of the same song; a song with none goes to the next song; a run of failures stops.
    const player = makePlayer();
    const music = create(player);
    music.add([song('a', 200_000, ['e:a1', 'e:a2']), song('b')]);
    await music.startIfIdle();
    player.emit('exception', { exception: { message: 'boom' } });
    player.emit('end', { reason: 'loadFailed', track: { encoded: 'e:a1' } });
    await settle();
    assert.equal(player.loaded, 'e:a2', 'the next recording of the same song');
    player.emit('end', { reason: 'loadFailed', track: { encoded: 'e:a2' } });
    await settle();
    assert.deepEqual([music.current.title, events.some((event) => event[0] === 'failed' && event[1] === 'a')], ['b', true], 'no recording left: the next song, and it is said');
    assert.equal(music.history.length, 0, 'a song that could not play is not in the history');
    player.emit('start', {});
    assert.equal(music.failures, 0, 'a song that starts clears the count');
    // stuck
    player.emit('stuck', { thresholdMs: 10_000 });
    await settle();
    assert.equal(events.filter((event) => event[0] === 'failed').length, 2, 'a stuck song with no other recording is skipped');
    assert.equal(music.current, null, 'the queue had nothing else');
    // a song with no recordings at all
    const quiet = create(makePlayer(), async () => []);
    quiet.add([song('lost', 200_000, [])]);
    await quiet.startIfIdle();
    assert.deepEqual(events.at(-2), ['failed', 'lost', 'notFound']);
    // a recordingsFor that throws
    const broken = create(makePlayer(), async () => { throw new Error('search down'); });
    broken.add([{ title: 'lost2', author: 'A', lengthMs: 1000, lazy: true }]);
    await broken.startIfIdle();
    assert.equal(broken.current, null);
    // the run of failures
    const loop = makePlayer();
    const failing = create(loop, async () => []);
    failing.maxQueue = 20;
    failing.add(Array.from({ length: MAX_FAILURES + 3 }, (_, i) => song(`bad${i}`, 200_000, [])));
    await failing.startIfIdle();
    assert.equal(events.filter((event) => event[0] === 'gaveUp').length, 1, 'after a run of failures it stops and says so');
    assert.equal(failing.queue.length, 0);
    // the next song is chosen while this one plays
    const chosenAhead = [];
    const ahead = create(makePlayer(), async (item) => { chosenAhead.push(item.title); return [`e:${item.title}`]; });
    ahead.add([{ title: 'now', author: 'A', lengthMs: 1000, lazy: true }, { title: 'later', author: 'A', lengthMs: 1000, lazy: true }]);
    await ahead.startIfIdle();
    await settle();
    assert.deepEqual(chosenAhead, ['now', 'later'], 'the recording of the next song is looked for in advance');
    ahead.destroy();
    assert.equal(await ahead.playNext(), false, 'a destroyed queue does nothing');
  }

  {
    const player = makePlayer();
    const music = create(player);
    music.add([song('p1'), song('p2')]);
    await music.startIfIdle();
    await music.pause();
    await music.skip();
    assert.deepEqual([music.paused, player.calls.at(-1)], [false, ['paused', false]], 'a new song plays even when the last one was paused');
  }

  {
    // The card is announced when Lavalink says the track started, not when it was asked to play it (a recording can fail to load).
    const player = makePlayer();
    player.playTrack = async (options) => { player.loaded = options.track.encoded; };
    const started = [];
    const music = new GuildMusic({ guildId: 'g', player, recordingsFor: async (item) => item.list, hooks: { onTrackStart: (m, item) => started.push(item.title) } });
    music.add([song('quiet', 1000, ['q1', 'q2'])]);
    await music.startIfIdle();
    assert.deepEqual(started, [], 'asked, not started');
    player.emit('start', { track: { encoded: 'other' } });
    assert.deepEqual(started, [], 'the start of another recording is not it');
    player.emit('start', { track: { encoded: 'q1' } });
    assert.deepEqual(started, ['quiet']);
  }

  // --- The card -------------------------------------------------------------------------------------------------------------------------------------
  assert.deepEqual([card.clock(83_000), card.clock(3_725_000), card.clock(0), card.clock(-5)], ['1:23', '1:02:05', '0:00', '0:00']);
  assert.equal(card.progressBar(0, 100).startsWith('🔘'), true);
  assert.equal(card.progressBar(100, 100).endsWith('🔘'), true);
  assert.equal(card.progressBar(50, 0).includes('🔘'), false, 'a stream has no knob');
  {
    const player = makePlayer();
    const music = create(player);
    music.add([{ ...song('A [new] **song** 🎵 26.4', 200_000), uri: 'https://youtu.be/x', author: 'Some @everyone <@1>', artwork: null }, song('Next one')]);
    await music.startIfIdle();
    for (const lang of LANGUAGES) {
      const payload = await card.nowPlaying(music, lang, { first: true });
      const body = textOf(payload);
      assert.ok(body.length < 4000, `the card fits the limit in ${lang}`);
      assert.ok(body.includes('Next one'), 'the next song is told');
      assert.ok(!body.includes('@everyone') || body.includes('@​everyone'), 'a name cannot mention');
      assert.ok(!/\[.*🎵.*\]\(/.test(body), 'the emojis of a title are left out of its link');
      const rows = flat(json(payload.components)).filter((part) => part.type === 1);
      assert.deepEqual(rows.map((row) => row.components.length), [5, 5]);
      assert.deepEqual(rows[0].components.map((button) => button.custom_id), ['music:prev', 'music:pause', 'music:stop', 'music:skip', 'music:loop']);
      assert.equal(rows[0].components[0].disabled, true, 'nothing before the first song');
      assert.equal(payload.allowedMentions.parse.length, 0);
    }
    const refreshed = await card.nowPlaying(music, 'en');
    assert.equal(refreshed.files, undefined, 'a refresh does not send the picture again');
    await music.pause();
    assert.ok(textOf(await card.nowPlaying(music, 'en')).includes(t('en', 'music.card.paused')));
    const queued = card.queuePage(music, 'en', 1);
    assert.ok(textOf(queued).includes('Next one') && textOf(queued).includes(t('en', 'music.queue.title')));
    assert.ok(textOf(card.queuePage(create(makePlayer()), 'es', 1)).includes(t('es', 'music.queue.empty')));
    // a long queue is in pages
    const long = create(makePlayer());
    long.maxQueue = 40;
    long.add(Array.from({ length: 25 }, (_, i) => song(`s${i + 1}`)));
    assert.ok(textOf(card.queuePage(long, 'en', 2)).includes('`11.`') && textOf(card.queuePage(long, 'en', 99)).includes('`21.`'), 'ten songs a page, and a page too far is the last');
  }

  // --- The status of the voice channel and who can use it ------------------------------------------------------------------------------------------
  {
    const puts = [];
    let failWith = null;
    const client = { rest: { put: async (route, options) => { if (failWith) throw failWith; puts.push([route, options.body.status]); } } };
    assert.equal(await setVoiceStatus(client, '55', statusOf({ title: 'Creep', author: 'Radiohead' })), true);
    assert.deepEqual(puts[0], ['/channels/55/voice-status', '🎵 Creep - Radiohead']);
    assert.equal(await setVoiceStatus(client, '55', null), true);
    assert.equal(puts[1][1], '', 'cleared');
    await setVoiceStatus(client, '55', 'x'.repeat(900));
    assert.ok(puts[2][1].length <= 450, 'the status is cut');
    failWith = Object.assign(new Error('Missing Permissions'), { code: 50013, status: 403 });
    assert.equal(await setVoiceStatus(client, '66', 'a song'), false, 'no permission: it does not throw');
    failWith = null;
    assert.equal(await setVoiceStatus(client, '66', 'a song'), false, 'and it does not insist on a channel that said no');
    assert.equal(await setVoiceStatus(client, '66', null), true, 'but it still clears');
  }
  {
    config.musicPublic = false;
    config.developerIds = ['dev'];
    config.musicTesterIds = ['tester'];
    assert.deepEqual([canUseMusic(config.ownerId), canUseMusic('dev'), canUseMusic('tester'), canUseMusic('anyone'), canUseMusic(null)], [true, true, true, false, false]);
    config.musicPublic = true;
    assert.equal(canUseMusic('anyone'), true);
    config.musicPublic = false;
  }

  // --- The commands and the buttons, with a stand-in of Discord and of the node ---------------------------------------------------------------------
  {
    const nodeModule = path.resolve(__dirname, '../src/music/node.js');
    const players = new Map();
    const left = [];
    const fakeShoukaku = {
      players,
      joinVoiceChannel: async ({ guildId }) => { const player = makePlayer(); players.set(guildId, player); return player; },
      leaveVoiceChannel: async (guildId) => { left.push(guildId); players.delete(guildId); },
    };
    let nodeOn = true;
    require.cache[nodeModule] = { id: nodeModule, filename: nodeModule, loaded: true, exports: { enabled: () => true, get: () => fakeShoukaku, idealNode: () => (nodeOn ? fakeNode : undefined), init: () => {}, health: () => ({}) } };
    delete require.cache[path.resolve(__dirname, '../src/music/service.js')];
    const service = require('../src/music/service');

    const sent = [];
    const textChannel = { id: 'text', send: async (payload) => { const message = { payload, edits: [], deleted: false, edit: async (next) => { message.edits.push(next); }, delete: async () => { message.deleted = true; } }; sent.push(message); return message; } };
    const voiceChannel = { id: 'voice', type: 2, permissionsFor: () => ({ has: () => true }), members: new Collection() };
    const rest = [];
    const client = { user: { id: 'bot' }, channels: { cache: new Map([['text', textChannel], ['voice', voiceChannel]]) }, rest: { put: async (route, options) => { rest.push([route, options.body.status]); } } };
    const replies = [];
    const makeInteraction = (userId, { inVoice = 'voice', options = {}, sub = 'play' } = {}) => ({
      guildId: 'g1', channelId: 'text', client, user: { id: userId }, deferred: false, replied: false,
      guild: { id: 'g1', shardId: 0, members: { me: {} } },
      member: { voice: { channelId: inVoice, channel: inVoice ? voiceChannel : null } },
      options: { getSubcommand: () => sub, getString: (name) => options[name] ?? null, getInteger: (name) => options[name] ?? null },
      deferReply: async function deferReply() { this.deferred = true; },
      reply: async function reply(payload) { this.replied = true; replies.push(payload); },
      editReply: async (payload) => { replies.push(payload); },
    });
    const say = () => textOf(replies.at(-1));

    config.musicPublic = false;
    await service.play(makeInteraction('anyone'), 'radiohead creep');
    assert.ok(say().includes(t('en', 'music.testing')), 'a person who is not in the team is told it is being tested');
    assert.equal(players.size, 0);

    const owner = config.ownerId;
    await service.play(makeInteraction(owner, { inVoice: null }), 'radiohead creep');
    assert.ok(say().includes(t('en', 'music.joinFirst')));
    nodeOn = false;
    await service.play(makeInteraction(owner), 'radiohead creep');
    assert.ok(say().includes(t('en', 'music.nodeDown')));
    nodeOn = true;
    await service.play(makeInteraction(owner), 'zzz nothing found');
    assert.ok(say().includes('zzz nothing found') && players.size === 0, 'no match: nothing is joined');
    await service.play(makeInteraction(owner), 'https://example.com/a.mp3');
    assert.ok(say().includes(t('en', 'music.unsupported')));

    await service.play(makeInteraction(owner), 'radiohead creep');
    assert.ok(say().includes('Radiohead - Creep') && say().includes(t('en', 'music.added.now', { title: '' }).slice(0, 7)), 'the first song plays at once');
    const session = service.sessionOf('g1');
    assert.equal(session.music.current.title, 'Radiohead - Creep');
    await until(() => sent.length >= 1 && rest.length >= 1);
    assert.ok(sent.length >= 1 && sent.at(-1).payload.components, 'the card of the song is sent');
    assert.deepEqual(rest.at(-1), ['/channels/voice/voice-status', '🎵 Radiohead - Creep - Radiohead - Topic'], 'the status of the voice channel is the song');
    const firstCard = sent.at(-1);

    await service.play(makeInteraction(owner), 'https://open.spotify.com/playlist/pl');
    assert.ok(say().includes('My list') && say().includes('**2**'), 'a playlist adds its songs');
    assert.equal(session.music.queue.length, 2);
    await service.play(makeInteraction(owner), 'https://youtu.be/abc');
    assert.ok(say().includes(t('en', 'music.added.track', { title: 'Some video', position: 3 })), 'a song that has to wait says its place');

    // somebody else, in another voice channel
    await service.command(makeInteraction('someone', { inVoice: 'other' }), 'skip');
    assert.ok(say().includes(t('en', 'music.testing')));
    await service.command(makeInteraction(owner, { inVoice: 'other' }), 'skip');
    assert.ok(say().includes(t('en', 'music.sameChannel', { channel: '<#voice>' })), 'only from the voice channel where it plays');

    await service.command(makeInteraction(owner), 'pause');
    assert.ok(say().includes(t('en', 'music.paused')) && session.music.paused);
    await service.command(makeInteraction(owner), 'volume', { value: 60 });
    assert.ok(say().includes('60%'));
    await service.command(makeInteraction(owner), 'seek', { time: 'abc' });
    assert.ok(say().includes(t('en', 'music.seek.bad')));
    await service.command(makeInteraction(owner), 'seek', { time: '1:30' });
    assert.ok(say().includes('1:30'));
    await service.command(makeInteraction(owner), 'loop', { mode: 'queue' });
    assert.equal(session.music.loop, 'queue');
    await service.command(makeInteraction(owner), 'queue', { page: 1 });
    assert.ok(say().includes('Creep') && say().includes('Karma Police'));
    await service.command(makeInteraction(owner), 'remove', { place: 9 });
    assert.ok(say().includes(t('en', 'music.noSuchSong', { max: 3 })));
    assert.deepEqual(['90', '1:30', '1m30s', '1h2m3s', '1:02:03', 'x', ''].map(service.parseTime), [90_000, 90_000, 90_000, 3_723_000, 3_723_000, null, null]);

    // the buttons
    const press = async (action, userId = owner) => {
      const calls = [];
      const interaction = { ...makeInteraction(userId), isButton: () => true, deferUpdate: async () => { calls.push('defer'); }, followUp: async (payload) => { calls.push(['follow', textOf(payload)]); }, reply: async (payload) => { calls.push(['reply', textOf(payload), payload.flags & 64]); } };
      await service.button(interaction, action);
      return calls;
    };
    assert.deepEqual((await press('pause')).slice(0, 1), ['defer']);
    assert.equal(session.music.paused, false, 'the button of pause toggles');
    const queueCalls = await press('queue');
    assert.equal(queueCalls[0][0], 'reply');
    assert.ok(queueCalls[0][2], 'the queue is shown only to who pressed');
    assert.equal((await press('stop', 'someone'))[0][0], 'reply', 'a person outside the team is turned away');
    await press('volup');
    assert.equal(session.music.volume, 70);
    await press('loop');
    assert.equal(session.music.loop, 'off', 'queue -> off');
    await press('shuffle');

    // the song ends; the next one has its own card and the old one is gone
    session.music.setLoop('off');
    const player = players.get('g1');
    player.emit('end', { reason: 'finished', track: { encoded: session.music.playing } });
    await settle();
    await settle();
    assert.ok(['Creep', 'Karma Police', 'Some video'].includes(session.music.current.title), 'the next song of the queue plays (the queue was shuffled)');
    await until(() => firstCard.deleted);
    assert.ok(firstCard.deleted, 'the card of the song that ended is deleted');

    // everything ends: the card turns into a line, the status is cleared, the bot leaves after a while
    await service.command(makeInteraction(owner), 'stop');
    assert.ok(say().includes(t('en', 'music.stopped')));
    assert.equal(rest.at(-1)[1], '', 'the status of the voice channel is cleared');
    await service.command(makeInteraction(owner), 'skip');
    assert.ok(say().includes(t('en', 'music.nothing')), 'with nothing playing there is nothing to skip');
    await service.command(makeInteraction(owner), 'leave');
    assert.ok(say().includes(t('en', 'music.left')) && left.includes('g1') && !service.sessionOf('g1'), 'it leaves and forgets the server');

    // alone in the channel / taken out of it
    await service.play(makeInteraction(owner), 'radiohead creep');
    const second = service.sessionOf('g1');
    assert.ok(second);
    service.onVoiceState({ id: 'u', guild: { id: 'g1' }, channelId: 'voice' }, { id: 'u', guild: { id: 'g1' }, channelId: null });
    assert.ok(second.timers.alone, 'when the last person leaves, a timer to leave starts');
    voiceChannel.members = new Collection([['u2', { user: { bot: false } }]]);
    service.onVoiceState({ id: 'u2', guild: { id: 'g1' }, channelId: null }, { id: 'u2', guild: { id: 'g1' }, channelId: 'voice' });
    assert.equal(second.timers.alone, null, 'and it is cancelled when somebody comes');
    service.onVoiceState({ id: 'bot', guild: { id: 'g1' }, channelId: 'voice' }, { id: 'bot', guild: { id: 'g1' }, channelId: null });
    await settle();
    assert.equal(service.sessionOf('g1'), null, 'taken out of the channel: the server is forgotten');
  }

  console.log('check-music: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
