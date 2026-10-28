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

  {
    const yt = (name) => T(name, 'A - Topic', 200_000);
    const sc = (name) => T(name, 'A', 200_000, { sourceName: 'soundcloud' });
    assert.deepEqual(match.diversify([yt('1'), yt('2'), sc('3')]).map((track) => track.info.title), ['1', '3', '2'], 'the second try is from another service than the first');
    assert.deepEqual(match.diversify([yt('1'), yt('2')]).map((track) => track.info.title), ['1', '2'], 'with only one service there is nothing to change');
    assert.deepEqual(match.diversify([yt('1'), sc('2'), yt('3')]).map((track) => track.info.title), ['1', '2', '3']);
    assert.deepEqual(match.diversify([yt('1'), yt('2'), sc('3')], { preferNot: 'youtube' }).map((track) => track.info.title), ['3', '1', '2'], 'while YouTube fails the other services go first');
  }

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
  const order = []; // what happened first: used to check that the voice channel is joined while the song is searched
  const fakeNode = { rest: { resolve: async (identifier) => { asked.push(identifier); order.push('search'); return answers[identifier] ?? { loadType: 'search', data: [] }; } } };

  const text = await resolver.resolveInput(fakeNode, 'radiohead creep', { requestedBy: '7' });
  assert.equal(text.type, 'track');
  assert.deepEqual([text.items[0].title, text.items[0].requestedBy, text.items[0].lazy], ['Radiohead - Creep', '7', false], 'a name: the best recording, found on YouTube Music and SoundCloud at once');
  assert.ok(asked.includes('ytmsearch:radiohead creep') && asked.includes('scsearch:radiohead creep'));
  assert.ok(text.items[0].candidates.length >= 2 && text.items[0].candidates[0] === text.items[0].encoded, 'the other good recordings are kept in case the first one fails');
  assert.ok(!text.items[0].candidates.some((encoded) => encoded.includes('cover')), 'a cover is not kept');

  assert.deepEqual([match.kindOfInput('https://open.spotify.com/playlist/6rWn7A?si=x').id, match.kindOfInput('spotify:album:4LH4d3').id], ['6rWn7A', '4LH4d3'], 'the id of a Spotify link');
  const track = await resolver.resolveInput(fakeNode, 'https://open.spotify.com/track/abc', { requestedBy: '7' });
  assert.deepEqual([track.type, track.items[0].lazy, track.items[0].meta.isrc, track.items[0].artwork], ['track', true, 'GBAYE9200070', 'https://i.scdn.co/a.jpg'], 'a Spotify song is only its data; the recording is chosen later');
  const list = await resolver.resolveInput(fakeNode, 'https://open.spotify.com/playlist/pl');
  assert.deepEqual([list.type, list.name, list.items.length, list.items.every((item) => item.lazy)], ['playlist', 'My list', 2, true]);
  const capped = await resolver.resolveInput(fakeNode, 'https://open.spotify.com/playlist/pl', { limit: 1 });
  assert.deepEqual([capped.items.length, capped.cut], [1, 1]);
  assert.equal((await resolver.resolveInput(fakeNode, 'https://youtu.be/abc')).items[0].lazy, false, 'a link of YouTube is played as it is');
  assert.equal((await resolver.resolveInput(fakeNode, 'https://example.com/a.mp3')).type, 'unsupported');
  {
    // Deezer, when the bot has it on (MUSIC_DEEZER): searched with the others and its links played; off, its links are not supported
    assert.equal((await resolver.resolveInput(fakeNode, 'https://www.deezer.com/en/track/3135556')).type, 'unsupported', 'a Deezer link while Deezer is off');
    config.musicDeezer = true;
    answers['dzsearch:radiohead creep'] = { loadType: 'search', data: [T('Creep', 'Radiohead', 238_000, { sourceName: 'deezer', isrc: 'GBAYE9200070' })] };
    answers['https://www.deezer.com/en/track/3135556'] = { loadType: 'track', data: T('Creep', 'Radiohead', 238_000, { sourceName: 'deezer' }) };
    asked.length = 0;
    const withDeezer = await resolver.resolveInput(fakeNode, 'radiohead creep');
    assert.ok(asked.includes('dzsearch:radiohead creep'), 'Deezer is searched with YouTube Music and SoundCloud');
    assert.equal(withDeezer.items[0].source, 'deezer', 'and its studio recording goes first');
    const deezerLink = await resolver.resolveInput(fakeNode, 'https://www.deezer.com/en/track/3135556');
    assert.deepEqual([deezerLink.type, deezerLink.items[0].lazy, deezerLink.items[0].source], ['track', false, 'deezer'], 'a Deezer link is played as it is');
    config.musicDeezer = false;
    asked.length = 0;
    await resolver.resolveInput(fakeNode, 'radiohead creep');
    assert.ok(!asked.some((identifier) => identifier.startsWith('dzsearch:')), 'with Deezer off it is not asked');
    assert.equal(match.kindOfInput('https://link.deezer.com/s/abc').kind, 'deezer');
    delete answers['dzsearch:radiohead creep'];
  }
  assert.deepEqual(await resolver.resolveInput(fakeNode, 'https://soundcloud.com/bad'), { type: 'error', items: [], error: 'Something broke' });
  assert.equal((await resolver.resolveInput(fakeNode, 'https://soundcloud.com/none')).type, 'none');
  assert.equal((await resolver.resolveInput(fakeNode, '   ')).type, 'none');
  assert.equal((await resolver.resolveInput({ rest: { resolve: async () => { throw new Error('down'); } } }, 'https://youtu.be/abc')).error, 'unavailable', 'a node that fails is an error, not a crash');

  // A Spotify link that Lavalink cannot read (no keys): the embed page of the link gives the songs.
  {
    const spotifyPages = require('../src/music/spotify');
    const realRead = spotifyPages.read;
    const reads = [];
    let page = { name: 'Page list', cover: 'https://img.example/c.jpg', tracks: [{ title: 'Creep', artist: 'Radiohead', lengthMs: 238_000, uri: 'spotify:track:abc' }, { title: 'Karma Police', artist: 'Radiohead', lengthMs: 264_000, uri: 'spotify:track:def' }] };
    spotifyPages.read = async (what, id) => { reads.push([what, id]); return page; };
    answers['https://open.spotify.com/playlist/nokeys'] = { loadType: 'error', data: { message: 'Something went wrong while looking up the track.' } };
    answers['https://open.spotify.com/track/nokeys'] = { loadType: 'empty', data: {} };
    const fromPage = await resolver.resolveInput(fakeNode, 'https://open.spotify.com/playlist/nokeys?si=x', { requestedBy: '9' });
    assert.deepEqual([fromPage.type, fromPage.name, fromPage.items.length, fromPage.items.every((item) => item.lazy && !item.fallback && item.requestedBy === '9')], ['playlist', 'Page list', 2, true], 'a playlist Lavalink cannot read is read from its page');
    assert.deepEqual(reads[0], ['playlist', 'nokeys']);
    assert.equal(fromPage.items[0].artwork, 'https://img.example/c.jpg');
    assert.equal(fromPage.items[0].uri, 'https://open.spotify.com/track/abc');
    const single = await resolver.resolveInput(fakeNode, 'https://open.spotify.com/track/nokeys');
    assert.deepEqual([single.type, single.items.length], ['track', 1], 'a song too');
    const cappedPage = await resolver.resolveInput(fakeNode, 'https://open.spotify.com/playlist/nokeys', { limit: 1 });
    assert.deepEqual([cappedPage.items.length, cappedPage.cut], [1, 1]);
    reads.length = 0;
    await resolver.resolveInput(fakeNode, 'https://open.spotify.com/playlist/pl');
    assert.equal(reads.length, 0, 'when Lavalink reads the link, the page is not used');
    page = null;
    assert.equal((await resolver.resolveInput(fakeNode, 'https://open.spotify.com/playlist/nokeys')).type, 'error', 'when neither can, it is an error');
    page = { name: 'No cover', cover: null, tracks: [{ title: 'Creep', artist: 'Radiohead', lengthMs: 238_000, uri: null }] };
    const bare = await resolver.resolveInput(fakeNode, 'https://open.spotify.com/playlist/nokeys');
    resolver.forgetChosen();
    const chosenList = await resolver.recordingsFor(fakeNode, bare.items[0]);
    assert.equal(chosenList[0], 'enc:Radiohead - Creep:Radiohead - Topic', 'the recording of a song read from a page is chosen like any other');
    assert.equal(chosenList.length, 1, 'and there is no mirror of the node after it (it has none)');
    assert.equal(new URL(bare.items[0].artwork).hostname, 'i.ytimg.com', 'its cover is the one of the recording when the page had none');
    spotifyPages.read = realRead;
  }

  // The page of Spotify itself: what is read from it and what happens when it cannot be read.
  {
    const { read, songsOf, entityOf } = require('../src/music/spotify');
    const html = (entity) => `<html><script id="__NEXT_DATA__" type="application/json">${JSON.stringify({ props: { pageProps: { state: { data: { entity } } } } })}</script></html>`;
    const playlist = { type: 'playlist', name: 'Gus', coverArt: { sources: [{ url: 'https://c/1.jpg' }] }, trackList: [{ uri: 'spotify:track:1', title: 'Es Épico', subtitle: 'Canserbero', duration: 361_978 }, { uri: 'spotify:track:2', title: 'B', subtitle: 'X,\u00a0Y', duration: 1000, isPlayable: false }, { title: '' }] };
    const parsed = songsOf(entityOf(html(playlist)));
    assert.deepEqual([parsed.name, parsed.cover, parsed.tracks.length], ['Gus', 'https://c/1.jpg', 2], 'the songs of a playlist (one with no title is left out)');
    assert.deepEqual(parsed.tracks[0], { title: 'Es Épico', artist: 'Canserbero', lengthMs: 361_978, uri: 'spotify:track:1' });
    assert.equal(parsed.tracks[1].artist, 'X, Y', 'a song Spotify calls unplayable is still searched elsewhere');
    const one = songsOf(entityOf(html({ type: 'track', name: 'Knights', title: 'Knights', artists: [{ name: 'Muse' }, { name: 'Other' }], duration: 366_213, uri: 'spotify:track:7' })));
    assert.deepEqual([one.tracks.length, one.tracks[0].artist, one.tracks[0].lengthMs], [1, 'Muse, Other', 366_213], 'a single song');
    assert.equal(songsOf(entityOf('<html>nothing</html>')), null, 'a page that changed gives nothing');
    assert.equal(songsOf(entityOf(html({ type: 'playlist', name: 'Empty', trackList: [] }))), null);
    const answer = (status, body) => async (url) => { answer.url = url; return { ok: status === 200, status, text: async () => body }; };
    assert.equal((await read('playlist', 'abc123', { fetchImpl: answer(200, html(playlist)) })).tracks.length, 2);
    assert.equal(answer.url, 'https://open.spotify.com/embed/playlist/abc123');
    assert.equal(await read('playlist', 'abc123', { fetchImpl: answer(404, '') }), null, 'a page that is not there');
    assert.equal(await read('playlist', 'abc123', { fetchImpl: async () => { throw new Error('offline'); } }), null, 'and one that cannot be reached: no crash');
    assert.equal(await read('podcast', 'abc123', { fetchImpl: answer(200, '') }), null, 'only songs, albums, playlists and artists');
    assert.equal(await read('playlist', '../etc', { fetchImpl: answer(200, '') }), null, 'the id is only letters and numbers');
  }

  {
    // The choices of a search: one for each song, no cover, at most five
    answers['ytmsearch:many songs'] = { loadType: 'search', data: [
      T('Many Songs', 'Band - Topic', 200_000), T('Many Songs', 'Band - Topic', 200_500), T('Many Songs (cover)', 'Cover Guy', 200_000), T('Many Songs - Live', 'Band', 260_000),
      T('Many Songs', 'Band', 300_000), T('Many Songs (Official Audio)', 'Band Official', 199_000), T('Many Songs', 'Other Band', 150_000), T('Many Songs', 'Third Band', 120_000),
    ] };
    const choices = await resolver.searchChoices(fakeNode, 'many songs', { requestedBy: '5' });
    assert.ok(choices.length >= 3 && choices.length <= 5, 'up to five choices');
    assert.ok(choices.every((item) => item.requestedBy === '5' && !item.lazy && item.encoded), 'each one is ready to play');
    assert.ok(!choices.some((item) => /cover|live/i.test(item.title)), 'no cover and no live version');
    assert.equal(choices.filter((item) => item.author === 'Band - Topic').length, 1, 'the same song of the same channel appears once');
    assert.deepEqual(await resolver.searchChoices(fakeNode, 'zzz nothing found'), [], 'nothing found: no choices');
    delete answers['ytmsearch:many songs'];
  }

  resolver.forgetChosen();
  asked.length = 0;
  const recordings = await resolver.recordingsFor(fakeNode, track.items[0]);
  assert.equal(recordings[0], 'enc:Radiohead - Creep:Radiohead - Topic', 'the recording of a Spotify song: not the remix, the one with the right length');
  assert.equal(recordings.at(-1), track.items[0].fallback, 'the mirror of the node goes last');
  const before = asked.length;
  await resolver.recordingsFor(fakeNode, track.items[0]);
  assert.equal(asked.length, before, 'the choice is remembered');

  {
    // YouTube asks for a login: the second recording is from SoundCloud, and for a while SoundCloud goes first.
    const ask = { rest: { resolve: async (identifier) => ({
      'ytmsearch:login song': { loadType: 'search', data: [T('Login Song', 'A - Topic', 200_000), T('Login Song (audio)', 'A - Topic', 200_500)] },
      'scsearch:login song': { loadType: 'search', data: [T('Login Song', 'A', 201_000, { sourceName: 'soundcloud' })] },
    }[identifier] ?? { loadType: 'search', data: [] }) } };
    resolver.forgetChosen();
    const first = await resolver.searchText(ask, 'login song', '1');
    assert.deepEqual(first.items[0].candidates.map((encoded) => encoded.endsWith(':A') ? 'sc' : 'yt'), ['yt', 'sc', 'yt'], 'YouTube, then SoundCloud, then the rest');
    resolver.markYoutubeDown();
    assert.equal(resolver.youtubeDown(), true);
    const second = await resolver.searchText(ask, 'login song', '1');
    assert.equal(second.items[0].source, 'soundcloud', 'while YouTube fails, SoundCloud is the first one');
    resolver.forgetChosen();
    assert.equal(resolver.youtubeDown(), false);
  }

  {
    // Autoplay: what Last.fm says is like the song that plays
    const autoplayModule = require('../src/music/autoplay');
    assert.equal(autoplayModule.cleanArtist({ author: 'Radiohead - Topic' }), 'Radiohead');
    assert.equal(autoplayModule.cleanArtist({ author: 'AdeleVEVO' }), 'Adele');
    assert.equal(autoplayModule.cleanArtist({ author: 'Bad Bunny, Jhay Cortez' }), 'Bad Bunny');
    assert.equal(autoplayModule.cleanArtist({ author: 'x', meta: { artist: 'Muse' } }), 'Muse', 'the artist of Spotify, when there is one');
    assert.equal(autoplayModule.cleanTitle({ title: 'Radiohead - Creep (Official Video)' }, 'Radiohead'), 'Creep');
    assert.equal(autoplayModule.cleanTitle({ title: 'Karma Police - Remastered' }, 'Radiohead'), 'Karma Police', 'what comes after a dash that is not the artist stays only if the artist was not in front');
    const calls = [];
    const lastfm = (answers) => async (url) => {
      const query = new URL(url).searchParams;
      calls.push(`${query.get('method')}:${query.get('artist')}:${query.get('track') ?? ''}`);
      const body = answers[query.get('method')] ?? {};
      return { ok: true, json: async () => body };
    };
    config.lastfmApiKey = null;
    assert.deepEqual(await autoplayModule.similarTo({ title: 'Creep', author: 'Radiohead' }, { fetchImpl: lastfm({}) }), [], 'no key: nothing');
    config.lastfmApiKey = 'key';
    const similar = await autoplayModule.similarTo({ title: 'Radiohead - Creep', author: 'Radiohead - Topic' }, { fetchImpl: lastfm({ 'track.getsimilar': { similartracks: { track: [
      { name: 'Karma Police', artist: { name: 'Radiohead' } }, { name: 'Zombie', artist: { name: 'The Cranberries' } }, { name: 'Karma Police', artist: { name: 'Radiohead' } }, { name: 'Yellow', artist: { name: 'Coldplay' } },
    ] } } }) });
    assert.deepEqual(similar.map((song) => `${song.artist} - ${song.title}`), ['Radiohead - Karma Police', 'The Cranberries - Zombie', 'Coldplay - Yellow'], 'in the order of Last.fm, without repeats');
    assert.equal(calls[0], 'track.getsimilar:Radiohead:Creep', 'it asks with the clean artist and title');
    calls.length = 0;
    const viaArtists = await autoplayModule.similarTo({ title: 'Obscure', author: 'Nobody' }, { fetchImpl: lastfm({
      'track.getsimilar': { similartracks: { track: [] } },
      'artist.getsimilar': { similarartists: { artist: [{ name: 'A1' }, { name: 'A2' }] } },
      'artist.gettoptracks': { toptracks: { track: [{ name: 'Top 1' }, { name: 'Top 2' }] } },
    }) });
    assert.ok(viaArtists.length >= 2 && calls.some((call) => call.startsWith('artist.getsimilar')), 'with few similar songs it goes through similar artists');
    assert.deepEqual(await autoplayModule.similarTo({ title: 'Creep', author: 'Radiohead' }, { fetchImpl: async () => { throw new Error('offline'); } }), [], 'Last.fm down: nothing, no crash');
    config.lastfmApiKey = null;
  }

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
    // Autoplay: while the last song plays, songs like it are added; it waits for them when the song ends first; loops and "off" leave it alone
    const asked = [];
    const hooks = (extra) => ({ ...hooksFor(), onNeedMore: async (m, seed) => { asked.push(seed.title); await new Promise((resolve) => setTimeout(resolve, 15)); return [song('like1'), song('like2')]; }, onAutoplayAdded: (m, items, seed) => events.push(['autoplay', items.length, seed.title]), ...extra });
    const make = (extra) => new GuildMusic({ guildId: 'g', player: makePlayer(), recordingsFor: async (item) => item.list ?? [item.encoded], hooks: hooks(extra), now: () => clockNow, maxQueue: 10 });
    {
      const music = make();
      music.add([song('only')]);
      await music.startIfIdle();
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.deepEqual(asked, [], 'off: nothing is asked');
      assert.equal(music.queue.length, 0);
      assert.equal(music.setAutoplay(true), true);
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.deepEqual(asked, ['only'], 'turned on while the last song plays: songs like it are looked for at once');
      assert.deepEqual(music.queue.map((item) => item.title), ['like1', 'like2']);
      assert.deepEqual(events.find((event) => event[0] === 'autoplay'), ['autoplay', 2, 'only']);
      music.setAutoplay(false);
      music.destroy();
    }
    {
      // the song ends before autoplay answered: the end waits for it and the next one plays
      events.length = 0;
      const player = makePlayer();
      const music = new GuildMusic({ guildId: 'g', player, recordingsFor: async (item) => item.list ?? [item.encoded], hooks: { ...hooksFor(), onNeedMore: async () => { await new Promise((resolve) => setTimeout(resolve, 40)); return [song('late')]; } }, now: () => clockNow, maxQueue: 10 });
      music.autoplay = true;
      music.add([song('last')]);
      await music.startIfIdle();
      await settle();
      await finished(player, 'last');
      await new Promise((resolve) => setTimeout(resolve, 80));
      assert.equal(music.current?.title, 'late', 'the queue did not end: the song of autoplay plays');
      assert.ok(!events.some((event) => event[0] === 'ended'));
      music.destroy();
    }
    {
      // with nothing to add, or with a repeat on, the queue ends as always
      events.length = 0;
      const player = makePlayer();
      const music = new GuildMusic({ guildId: 'g', player, recordingsFor: async (item) => item.list ?? [item.encoded], hooks: { ...hooksFor(), onNeedMore: async () => [] }, now: () => clockNow, maxQueue: 10 });
      music.autoplay = true;
      music.add([song('z')]);
      await music.startIfIdle();
      await settle();
      await finished(player, 'z');
      await settle();
      assert.ok(events.some((event) => event[0] === 'ended'), 'autoplay found nothing: the queue ends');
      music.destroy();
      asked.length = 0;
      const looping = make();
      looping.autoplay = true;
      looping.setLoop('queue');
      looping.add([song('w')]);
      await looping.startIfIdle();
      await new Promise((resolve) => setTimeout(resolve, 40));
      assert.equal(looping.queue.length, 0, 'songs added to a repeating queue are not wanted');
      looping.destroy();
    }
    events.length = 0;
  }

  {
    // The volume: it starts at 50, which is also the lowest; 150 is the highest
    const player = makePlayer();
    const music = create(player);
    assert.equal(music.volume, 50);
    assert.equal(await music.setVolume(10), 50, 'nothing quieter than 50');
    assert.equal(await music.setVolume(120), 120);
    assert.equal(await music.setVolume(500), 150, 'and nothing louder than 150');
    assert.deepEqual(player.calls.filter((call) => call[0] === 'volume').map((call) => call[1]), [50, 120, 150]);
    music.destroy();
  }

  {
    // The recordings of the next three songs are chosen while one plays (each one once), so a change only waits for the node to load the audio.
    const asks = [];
    const player = makePlayer();
    const music = create(player, async (item) => { asks.push(item.title); await new Promise((resolve) => setTimeout(resolve, 20)); return [`e:${item.title}`]; });
    music.add(['a', 'b', 'c', 'd', 'e'].map((name) => ({ title: name, author: 'A', lengthMs: 200_000, encoded: `e:${name}`, requestedBy: '1' })));
    await music.startIfIdle();
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(asks, ['a', 'b', 'c', 'd'], 'the song and the three after it are prepared, and no more');
    await finished(player, 'a');
    await new Promise((resolve) => setTimeout(resolve, 60));
    assert.deepEqual(asks, ['a', 'b', 'c', 'd', 'e'], 'one song later the next one is prepared; the others are not asked again');
    assert.equal(music.current.title, 'b');
    assert.equal(player.loaded, 'e:b');
    // a change in the middle of a preparation waits for it instead of asking again
    const quick = create(makePlayer(), async (item) => { asks.push(`quick:${item.title}`); await new Promise((resolve) => setTimeout(resolve, 40)); return [`e:${item.title}`]; });
    quick.add([{ title: 'x', author: 'A', lengthMs: 100_000, encoded: 'e:x', requestedBy: '1' }]);
    const first = quick.startIfIdle();
    await settle();
    quick.queue.push({ title: 'y', author: 'A', lengthMs: 100_000, encoded: 'e:y', requestedBy: '1' });
    quick.prefetch();
    await first;
    await quick.skip();
    assert.deepEqual(asks.filter((ask) => ask.startsWith('quick:')), ['quick:x', 'quick:y'], 'a song asked for while it was being prepared is not asked twice');
    music.destroy();
    quick.destroy();
    events.length = 0;
  }

  {
    // The end of a song never came (Lavalink restarted, the connection was cut): the session moves on by itself.
    const player = makePlayer();
    events.length = 0;
    const music = create(player);
    music.add([song('one', 100_000), song('two', 100_000), song('live', 0)]);
    await music.startIfIdle();
    await settle();
    assert.equal(music.stale(), null, 'a song that just started is fine');
    clockNow += 20_000;
    assert.equal(music.stale(), null, '20 seconds without word from the player is still fine');
    music.mark(50_000);
    clockNow += 30_000;
    assert.equal(music.stale(), 'lost', 'no word for 30 seconds in the middle of a song: the player is gone');
    music.paused = true;
    assert.equal(music.stale(), null, 'a paused song has nothing to say');
    music.paused = false;
    assert.equal(await music.unstick(), 'lost');
    await settle();
    assert.deepEqual(events.filter((event) => event[0] === 'failed').map((event) => event.slice(1)), [['one', 'lost']], 'a lost song is a failed one: the next goes on');
    assert.equal(music.current.title, 'two');
    music.mark(95_000);
    clockNow += 30_000;
    assert.equal(music.stale(), 'ended', 'no word after the end of the song: it ended (its end never came)');
    assert.equal(await music.unstick(), 'ended');
    await settle();
    assert.equal(music.current.title, 'live', 'and the next one plays');
    assert.equal(music.history.at(-1).title, 'two', 'a song that ended goes to the history');
    clockNow += 600_000;
    assert.equal(music.stale(), null, 'a stream has no end to wait for');
    music.destroy();
    events.length = 0;
  }

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
    assert.equal(await music.setVolume(0), 50, 'the lowest is 50');
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
    // a song that freezes in the middle goes on from where it was; a second freeze soon after goes to the next recording
    {
      const stuckPlayer = makePlayer();
      const stuckMusic = create(stuckPlayer);
      stuckMusic.add([song('mid', 200_000, ['e:mid1', 'e:mid2']), song('after')]);
      await stuckMusic.startIfIdle();
      await settle();
      stuckMusic.mark(60_000);
      stuckPlayer.calls.length = 0;
      stuckPlayer.emit('stuck', { thresholdMs: 10_000 });
      await settle();
      assert.deepEqual(stuckPlayer.calls, [['play', 'e:mid1']], 'the same recording is played again');
      assert.equal(stuckMusic.current.title, 'mid', 'and the song is still the same');
      stuckPlayer.emit('stuck', { thresholdMs: 10_000 });
      await settle();
      assert.equal(stuckPlayer.loaded, 'e:mid2', 'frozen again soon after: the next recording');
      stuckMusic.destroy();
    }
    events.length = 0;
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

  {
    // What Lavalink says about a track that cannot load goes with the failure, and a login asked by YouTube is remembered.
    const player = makePlayer();
    const failed = [];
    const exceptions = [];
    const music = new GuildMusic({ guildId: 'g', player, recordingsFor: async (item) => item.list, hooks: { onTrackFailed: (m, item, error) => failed.push(error), onException: (m, event) => exceptions.push(event.exception.message) }, now: () => clockNow });
    music.add([{ ...song('y', 1000, ['y1']), source: 'youtube' }]);
    await music.startIfIdle();
    player.emit('exception', { exception: { message: 'This video requires login.', cause: 'x', severity: 'common' } });
    player.emit('end', { reason: 'loadFailed', track: { encoded: 'y1' } });
    await settle();
    assert.deepEqual([failed, exceptions], [['This video requires login.'], ['This video requires login.']], 'the real reason, not only "loadFailed"');
  }

  // --- The card -------------------------------------------------------------------------------------------------------------------------------------
  assert.deepEqual([card.clock(83_000), card.clock(3_725_000), card.clock(0), card.clock(-5)], ['1:23', '1:02:05', '0:00', '0:00']);
  const iconSets = require('../src/music/icons');
  assert.equal(card.progressBar(0, 100, iconSets.plain).startsWith('🔘'), true);
  assert.equal(card.progressBar(100, 100, iconSets.plain).endsWith('🔘'), true);
  assert.equal(card.progressBar(50, 0, iconSets.plain).includes('🔘'), false, 'a stream has no knob');
  {
    // the bar of the music set: a pill that moves along a track that ends in a rounded end
    const cells = (bar) => [...bar.matchAll(/<:(\w+):\d+>/g)].map((match) => match[1]);
    assert.deepEqual(cells(card.progressBar(0, 100)), ['pe_s_progressbarfilledleftstartw', 'pe_s_progressbarempty', 'pe_s_progressbarempty', 'pe_s_progressbarempty', 'pe_s_progressbaremptyrightrounde'], 'at the start the pill is first');
    const middle = cells(card.progressBar(50, 100));
    assert.equal(middle.indexOf('pe_s_progressbarfilledleftstartw'), 2, 'half way it is in the middle');
    assert.equal(middle.at(-1), 'pe_s_progressbaremptyrightrounde', 'the track ends in the rounded end');
    const last = cells(card.progressBar(100, 100));
    assert.equal(last.length, 5);
    assert.equal(last.at(-1), 'pe_s_progressbarfilledleftstartw', 'at the end the pill is last');
    assert.equal(new Set(Array.from({ length: 11 }, (_, i) => cells(card.progressBar(i * 10, 100)).indexOf('pe_s_progressbarfilledleftstartw'))).size, 5, 'it takes every place on its way');
    assert.ok(!card.progressBar(40, 100).includes('🔘'));
  }
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
      assert.ok(rows.flatMap((row) => row.components).every((button) => button.label && button.label.length <= 8 && button.emoji), `every button has a short name next to its icon in ${lang}`);
      assert.equal(rows[0].components[1].label, t(lang, 'music.btn.pause'));
      assert.equal(payload.allowedMentions.parse.length, 0);
    }
    {
      // the buttons use the emojis of the music set; the plain card (when Discord does not take them) uses ordinary ones
      const buttonsOf = (payload) => flat(json(payload.components)).filter((part) => part.type === 1).flatMap((row) => row.components);
      const withIds = buttonsOf(await card.nowPlaying(music, 'en'));
      assert.deepEqual([withIds.length, withIds.filter((button) => /^\d{17,20}$/.test(String(button.emoji?.id))).length], [10, 10], 'every button has a custom emoji');
      assert.ok(withIds.every((button) => String(button.emoji.name).startsWith('pe_')), 'of the music set, and leave of the main set of Petto');
      assert.equal(withIds.find((button) => button.custom_id === 'music:leave').emoji.id, '1533576199354454197');
      assert.ok(!withIds.some((button) => button.custom_id === 'music:voldown'), 'there is no button to lower the volume (50 is the lowest)');
      assert.equal(withIds.find((button) => button.custom_id === 'music:volup').disabled, false);
      const plainCard = await card.nowPlaying(music, 'en', { plain: true });
      assert.ok(buttonsOf(plainCard).every((button) => !button.emoji?.id), 'the plain card has no custom emoji in its buttons');
      assert.ok(!textOf(plainCard).includes('pe_s_') && textOf(plainCard).includes('🎵'), 'nor in its text');
      assert.ok(textOf(await card.nowPlaying(music, 'en')).includes('<:pe_s_musicnote:'), 'the card says the title with the custom note');
    }
    const refreshed = await card.nowPlaying(music, 'en');
    assert.equal(refreshed.files, undefined, 'a refresh does not send the picture again');
    await music.pause();
    assert.ok(textOf(await card.nowPlaying(music, 'en')).includes(t('en', 'music.card.paused')));
    assert.equal(flat(json((await card.nowPlaying(music, 'en')).components)).filter((part) => part.type === 1)[0].components[1].label, t('en', 'music.btn.resume'), 'while paused the button says what it does: play');
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
    assert.deepEqual(puts[0], ['/channels/55/voice-status', '<:pe_s_musicnote:1564869235774197841> Creep - Radiohead'], 'the status starts with the custom note of the music set');
    assert.equal(statusOf({ title: 'Creep', author: 'Radiohead' }, { plain: true }), '🎵 Creep - Radiohead');
    {
      // Discord does not take the custom emoji: the plain status is written instead
      const seen = [];
      const strict = { rest: { put: async (route, options) => { seen.push(options.body.status); if (options.body.status.includes('<:')) throw Object.assign(new Error('Invalid Form Body'), { status: 400, code: 50035 }); } } };
      assert.equal(await setVoiceStatus(strict, '77', statusOf({ title: 'A', author: 'B' }), statusOf({ title: 'A', author: 'B' }, { plain: true })), true);
      assert.deepEqual(seen.map((status) => status.includes('<:')), [true, false], 'it tried the custom one and then the plain one');
    }
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
      joinVoiceChannel: async ({ guildId }) => { order.push('join:start'); await new Promise((resolve) => setTimeout(resolve, 30)); const player = makePlayer(); players.set(guildId, player); order.push('join:done'); return player; },
      leaveVoiceChannel: async (guildId) => { left.push(guildId); players.delete(guildId); },
    };
    let nodeOn = true;
    let resetNode = null;
    require.cache[nodeModule] = { id: nodeModule, filename: nodeModule, loaded: true, exports: { enabled: () => true, get: () => fakeShoukaku, idealNode: () => (nodeOn ? fakeNode : undefined), init: () => {}, health: () => ({}), onReset: (handler) => { resetNode = handler; } } };
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
    const joinSpan = order.slice(order.lastIndexOf('join:start'), order.lastIndexOf('join:done') + 1);
    assert.ok(joinSpan.includes('search'), 'the voice channel is joined while the song is searched, not before');
    assert.equal(session.music.current.title, 'Radiohead - Creep');
    await until(() => sent.length >= 1 && rest.length >= 1);
    assert.ok(sent.length >= 1 && sent.at(-1).payload.components, 'the card of the song is sent');
    assert.deepEqual(rest.at(-1), ['/channels/voice/voice-status', '<:pe_s_musicnote:1564869235774197841> Radiohead - Creep - Radiohead - Topic'], 'the status of the voice channel is the song');
    assert.ok(players.get('g1').calls.some((call) => call[0] === 'volume' && call[1] === 50), 'a session starts at 50% of volume');
    assert.equal(session.music.volume, 50);
    const firstCard = sent.at(-1);
    players.get('g1').emit('exception', { exception: { message: 'Sign in to confirm you are not a bot', cause: '' } });
    assert.equal(resolver.youtubeDown(), true, 'a login asked by YouTube is remembered, and the recordings of other services go first for a while');
    resolver.forgetChosen();

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

    // search: the best results in a menu, and only the one who searched picks
    await service.search(makeInteraction(owner), 'radiohead creep');
    const menuPayload = replies.at(-1);
    const menu = flat(json(menuPayload.components)).find((part) => part.type === 3);
    assert.ok(menu && menu.options.length >= 1 && menu.options.length <= 5 && menu.custom_id.startsWith('music:pick:'), 'a menu of results');
    assert.ok(menu.options.every((option) => option.label.length <= 100 && option.description.length <= 100), 'its options fit');
    assert.ok(textOf(menuPayload).includes(t('en', 'music.search.title')));
    assert.equal(service.sessionOf('g1'), null, 'searching does not join the voice channel');
    const token = menu.custom_id.split(':')[2];
    const pickBy = (userId, value = '0', tokenOf = token) => ({ ...makeInteraction(userId), customId: `music:pick:${tokenOf}`, values: [value], isStringSelectMenu: () => true, isButton: () => false, deferUpdate: async function deferUpdate() { this.deferred = true; } });
    await service.pick(pickBy('someone'), token);
    assert.ok(say().includes('<@' + owner + '>') && service.sessionOf('g1') === null, 'somebody else is told the menu is not theirs');
    await service.pick(pickBy(owner, '9'), token);
    assert.ok(say().includes(t('en', 'music.search.expired')) && service.sessionOf('g1') === null, 'a choice that is not in the menu does nothing');
    await service.pick(pickBy(owner), token);
    assert.ok(service.sessionOf('g1')?.music.current, 'the song that was picked plays');
    assert.ok(say().includes(menu.options[0].label.slice(0, 10)), 'and the menu turns into the answer');
    await service.pick(pickBy(owner), token);
    assert.ok(say().includes(t('en', 'music.search.expired')), 'a menu is used once');
    await service.command(makeInteraction(owner), 'leave');
    assert.equal(service.sessionOf('g1'), null);

    // autoplay: turned on and off by the command and by the button; it needs the Last.fm key of the bot
    const realFetch = global.fetch;
    global.fetch = async () => ({ ok: true, json: async () => ({ similartracks: { track: [] } }) }); // Last.fm is not asked for real
    await service.play(makeInteraction(owner), 'radiohead creep');
    const autoSession = service.sessionOf('g1');
    config.lastfmApiKey = null;
    await service.command(makeInteraction(owner), 'autoplay');
    assert.ok(say().includes(t('en', 'music.autoplay.noKey')) && !autoSession.music.autoplay, 'without the Last.fm key it cannot be turned on');
    config.lastfmApiKey = 'key';
    await service.command(makeInteraction(owner), 'autoplay');
    assert.ok(say().includes(t('en', 'music.autoplay.on')) && autoSession.music.autoplay, 'the command turns it on');
    assert.ok(textOf(await card.nowPlaying(autoSession.music, 'en')).includes(t('en', 'music.card.autoplay')), 'and the card says so');
    const autoButton = flat(json((await card.nowPlaying(autoSession.music, 'en')).components)).filter((part) => part.type === 2).find((button) => button.custom_id === 'music:autoplay');
    assert.equal(autoButton.style, 3, 'its button is green while it is on');
    await press('autoplay');
    assert.equal(autoSession.music.autoplay, false, 'the button turns it off');
    await service.command(makeInteraction(owner), 'leave');
    config.lastfmApiKey = null;
    global.fetch = realFetch;

    // the list under the option of /music play
    const typed = await service.suggest(owner, 'radiohead creep');
    assert.ok(typed.length >= 1 && typed.every((choice) => choice.name.length <= 100 && choice.value.length <= 100), 'suggestions fit what Discord accepts');
    assert.equal(typed[0].name, 'Creep - Radiohead', 'each one reads "Title - Artist"');
    assert.deepEqual(await service.suggest(owner, 'a'), [], 'too soon: nothing');
    assert.deepEqual(await service.suggest(owner, 'https://youtu.be/abc'), [], 'a link is not searched');
    assert.deepEqual(await service.suggest('anyone', 'radiohead creep'), [], 'only the team gets them while it is tested');

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

    // Lavalink came back without its players: what was playing is gone, the card says so and the server is forgotten
    await service.play(makeInteraction(owner), 'radiohead creep');
    assert.ok(service.sessionOf('g1'));
    await until(() => service.sessionOf('g1')?.panel);
    const panel = service.sessionOf('g1').panel;
    left.length = 0;
    assert.equal(typeof resetNode, 'function', 'the service asks the node to tell it');
    resetNode();
    await until(() => left.includes('g1'));
    assert.equal(service.sessionOf('g1'), null, 'the server is forgotten');
    assert.ok(left.includes('g1'), 'and the dead player is dropped');
    assert.ok(textOf(panel.edits.at(-1)).includes(t('en', 'music.nodeReset')), 'the card of the song says what happened');
    resetNode();
    await settle();

    // Discord does not take the custom emojis (deleted, or a server the bot is not in): the card is sent again with plain ones
    const realSend = textChannel.send;
    textChannel.send = async (payload) => {
      if (JSON.stringify(json(payload.components)).includes('pe_s_')) throw Object.assign(new Error('Invalid emoji'), { status: 400, code: 50035 });
      return realSend(payload);
    };
    await service.play(makeInteraction(owner), 'radiohead creep');
    await until(() => service.sessionOf('g1')?.panel);
    const plainSession = service.sessionOf('g1');
    assert.equal(plainSession.plain, true, 'the session remembers that the custom emojis do not work');
    assert.ok(plainSession.panel && !JSON.stringify(json(plainSession.panel.payload.components)).includes('pe_s_'), 'and the card was sent with plain ones');
    textChannel.send = realSend;
    await service.command(makeInteraction(owner), 'leave');
  }

  {
    // Shoukaku drops a node for good when its reconnect tries run out: it is put back.
    const nodeModule = path.resolve(__dirname, '../src/music/node.js');
    delete require.cache[nodeModule];
    const realNode = require('../src/music/node');
    const pool = new Map();
    const added = [];
    const seen = {};
    class FakeShoukaku extends EventEmitter {
      constructor(connector, nodes, options) { super(); seen.options = options; seen.instance = this; this.nodes = pool; this.players = new Map(); nodes.forEach((node) => pool.set(node.name, node)); added.push(['start', nodes[0].url]); }
      addNode(options) { pool.set(options.name, options); added.push(['add', options.name]); }
      getIdealNode() { return pool.size ? {} : undefined; }
    }
    const fakeLib = { Shoukaku: FakeShoukaku, Connectors: { DiscordJS: class {} } };
    realNode.init({}, { lib: fakeLib, reviveMs: 1_000_000 });
    assert.deepEqual(added[0], ['start', 'node.example.com:443']);
    // the times of Shoukaku are in seconds: a value in milliseconds waits for hours
    assert.ok(seen.options.reconnectInterval <= 30, 'it tries again within seconds, not hours');
    assert.ok(seen.options.restTimeout <= 60, 'a request to a dead node is given up within a minute');
    assert.ok(seen.options.reconnectTries * seen.options.reconnectInterval >= 180, 'it keeps trying for as long as Lavalink takes to start');
    assert.equal(realNode.revive(), false, 'a node that is in the pool is left alone');
    // the node came back: only a session that is not the resumed one means the players are gone
    let resets = 0;
    realNode.onReset(() => { resets += 1; });
    seen.instance.emit('ready', 'pettolava', false);
    assert.equal(resets, 0, 'the first connection is not a restart');
    seen.instance.emit('ready', 'pettolava', true);
    assert.equal(resets, 0, 'a session that was resumed kept its players');
    seen.instance.emit('ready', 'pettolava', false);
    assert.equal(resets, 1, 'a new session after a connection: the players are gone');
    pool.clear(); // what Shoukaku does when it gives up
    assert.equal(realNode.revive(), true);
    assert.deepEqual(added.at(-1), ['add', 'pettolava'], 'it is added again');
    assert.equal(realNode.revive(), false);
    realNode.stop();
  }

  {
    // `/music` is registered with Discord (it was not: without `registerSlash` a command only works with the prefix) and fits what Discord accepts
    const { collectCommandData } = require('../src/handlers/commandHandler');
    const registered = collectCommandData().find((command) => command.name === 'music');
    assert.ok(registered, '/music is in the commands that are registered');
    assert.ok(registered.options.length <= 25 && registered.options.every((sub) => sub.type === 1), 'subcommands, at most 25');
    for (const name of ['play', 'search', 'playnext', 'skip', 'previous', 'stop', 'pause', 'resume', 'queue', 'nowplaying', 'volume', 'loop', 'autoplay', 'shuffle', 'seek', 'remove', 'clear', 'leave']) {
      assert.ok(registered.options.some((sub) => sub.name === name), `/music ${name} exists`);
    }
    const tooLong = [];
    const walk = (node, path) => {
      if (String(node.description ?? '').length > 100) tooLong.push(path);
      for (const [locale, text] of Object.entries(node.description_localizations ?? {})) if (String(text).length > 100) tooLong.push(`${path} (${locale})`);
      for (const child of node.options ?? []) walk(child, `${path} ${child.name}`);
    };
    walk(registered, 'music');
    assert.deepEqual(tooLong, [], 'every description (and its translations) fits the 100 characters of Discord');
    const play = registered.options.find((sub) => sub.name === 'play').options[0];
    assert.equal(play.autocomplete, true, 'the song is suggested while it is typed');
  }

  console.log('check-music: ok');
  process.exit(0);
})().catch((error) => { console.error(error); process.exit(1); });
