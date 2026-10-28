// i18n-ignore-file: the words here are what titles of songs are made of (remix, cover...), not messages of Petto.
// Which recording is the song that was asked for. A search by text gives the most played or the most uploaded result, not the original recording, so
// the results are judged here: no remix, cover, slowed, live or karaoke version unless the person asked for it; the artist has to be the right one; the
// length has to be about the one of the song when it is known; and the official recordings (the "- Topic" channels, "official audio") come first.
// Nothing in this file talks to the network.

const BAD_TERMS = [
  'remix', 'remixed', 'rmx', 'cover', 'covers', 'cover by', 'slowed', 'sped up', 'speed up', 'speedup', 'nightcore', 'reverb', '8d', '16d', 'bass boosted',
  'bass boost', 'karaoke', 'instrumental', 'acoustic', 'live', 'en vivo', 'ao vivo', 'en directo', 'mashup', 'bootleg', 'tribute', 'parody', 'parodia',
  'chopped', 'screwed', 'daycore', 'lofi', 'lo fi', 'tiktok version', 'reaction', 'piano version', 'guitar version', 'male version', 'female version',
  'orchestral version', 'rock version', 'vip mix', 'club mix', 'dj mix',
];

// Words that say nothing about which song it is.
const NOISE = new Set(['official', 'audio', 'video', 'lyrics', 'lyric', 'hd', 'hq', '4k', 'topic', 'vevo', 'music', 'feat', 'ft', 'featuring', 'with', 'prod', 'by']);

const strip = (text) => String(text ?? '').normalize('NFKD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Lower case, no accents, no punctuation, one space between words. */
const normalize = (text) => strip(text).replace(/&/g, ' and ').replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

const tokensOf = (text) => normalize(text).split(' ').filter((word) => word && !NOISE.has(word));

/** The bad terms (remix, cover...) that a text holds, as whole words. */
function badTermsIn(text) {
  const value = ` ${normalize(text)} `;
  return BAD_TERMS.filter((term) => value.includes(` ${term} `));
}

/** The title of a song without what goes in brackets or after a dash ("Song (feat. X) - Remastered 2011" is "Song"). */
const coreTitle = (title) => String(title ?? '').replace(/\([^)]*\)|\[[^\]]*\]/g, ' ').replace(/\s[-–—]\s.*$/, ' ').trim();

/** Whether one of the artists of `artists` ("A, B & C") is named in `hay` (a normalized text). */
function artistNamed(hay, artists) {
  const compact = hay.replace(/ /g, '');
  const words = new Set(hay.split(' '));
  return String(artists ?? '').split(/,|&|\bfeat\.?\b|\bft\.?\b|\bx\b| and | y | e /i).some((part) => {
    const name = normalize(part);
    if (!name) return false;
    const pieces = name.split(' ').filter(Boolean);
    return pieces.every((piece) => words.has(piece)) || (name.replace(/ /g, '').length >= 4 && compact.includes(name.replace(/ /g, '')));
  });
}

const SOURCE_WEIGHT = { youtube: 0, soundcloud: -8, bandcamp: -4, twitch: -20 };

/**
 * How good a result of a search is for what was wanted, or why it is not.
 * `wanted`: { query?, title?, artist?, lengthMs?, isrc? }. `candidate`: a track of Lavalink ({ info: { title, author, length, isStream, sourceName, isrc } }).
 * `relaxed`: the second look when nothing passed: a longer difference of length and fewer words of the title needed.
 */
function scoreOne(candidate, wanted, { position = 0, relaxed = false } = {}) {
  const info = candidate?.info;
  if (!info || !candidate.encoded) return { ok: false, why: 'empty' };
  if (info.isStream) return { ok: false, why: 'stream' };

  const heading = `${info.title ?? ''} ${info.author ?? ''}`;
  const hay = normalize(heading);
  const hayWords = new Set(hay.split(' '));

  const asked = new Set(badTermsIn(`${wanted.query ?? ''} ${wanted.title ?? ''} ${wanted.artist ?? ''}`));
  const unwanted = badTermsIn(heading).filter((term) => !asked.has(term));
  if (unwanted.length) return { ok: false, why: `bad:${unwanted[0]}` };

  let score = 0;

  // The length: when the song's is known, a recording of another length is another version (or an intro, a talk, a loop).
  const length = Number(info.length) || 0;
  const wantedLength = Number(wanted.lengthMs) || 0;
  if (wantedLength && length) {
    const diff = Math.abs(length - wantedLength);
    const limit = relaxed ? Math.max(30_000, wantedLength * 0.2) : Math.max(12_000, wantedLength * 0.07);
    if (diff > limit) return { ok: false, why: 'length' };
    score += diff <= 3000 ? 30 : diff <= 7000 ? 15 : 0;
  }

  // The words of the title (or of the whole query when the title is not known).
  const needed = tokensOf(wanted.title ? coreTitle(wanted.title) || wanted.title : wanted.query);
  if (needed.length) {
    const found = needed.filter((word) => hayWords.has(word)).length / needed.length;
    if (found < (relaxed ? 0.4 : 0.6)) return { ok: false, why: 'title' };
    score += Math.round(found * 40);
  }

  // The artist: a song with the right title by someone else is a cover whatever its title says.
  if (wanted.artist) {
    if (!artistNamed(hay, wanted.artist)) return { ok: false, why: 'artist' };
    score += 25;
  } else if (wanted.title && wanted.query) {
    const extra = tokensOf(wanted.query).filter((word) => !needed.includes(word));
    if (extra.length) score += Math.round((extra.filter((word) => hayWords.has(word)).length / extra.length) * 20);
  }

  if (wanted.isrc && info.isrc && String(wanted.isrc).toUpperCase() === String(info.isrc).toUpperCase()) score += 100;

  const author = normalize(info.author);
  if (/\btopic$/.test(author)) score += 30; // the channels YouTube makes for the artists: the official recordings
  if (hay.includes('official audio')) score += 15;
  else if (hay.includes('official video') || hay.includes('official music video')) score += 6;
  if (/\b(lyrics?|visuali[sz]er)\b/.test(hay)) score -= 5;
  if (normalize(info.title) === normalize(coreTitle(wanted.title ?? ''))) score += 20;

  score += SOURCE_WEIGHT[String(info.sourceName ?? '').toLowerCase()] ?? 0;
  score += Math.max(0, 15 - position * 3); // the order of the search, which is mostly right
  return { ok: true, score };
}

/** The results that pass, best first: [{ track, score }]. */
function rank(tracks, wanted, options = {}) {
  const passed = [];
  (tracks ?? []).forEach((track, position) => {
    const result = scoreOne(track, wanted, { ...options, position });
    if (result.ok) passed.push({ track, score: result.score });
  });
  return passed.sort((a, b) => b.score - a.score);
}

/**
 * The recording to play out of the results of several searches. Strict first; when nothing passes, the relaxed look; when that finds nothing, the first
 * result that is not a remix or a cover (a person who typed a name with a typo still gets a song). `[]` when there is nothing.
 */
function order(tracks, wanted) {
  const strict = rank(tracks, wanted);
  if (strict.length) return { list: strict.map((entry) => entry.track), how: 'exact' };
  const loose = rank(tracks, wanted, { relaxed: true });
  if (loose.length) return { list: loose.map((entry) => entry.track), how: 'relaxed' };
  const trusted = (tracks ?? []).filter((track) => track?.encoded && !track.info?.isStream && !badTermsIn(`${track.info?.title ?? ''} ${track.info?.author ?? ''}`).filter((term) => !badTermsIn(wanted.query ?? '').includes(term)).length);
  return { list: trusted.slice(0, 3), how: trusted.length ? 'trusted' : 'none' };
}

const sourceOf = (track) => String(track?.info?.sourceName ?? '').toLowerCase();

/**
 * The order to try the recordings in. The second one is from another service than the first: when YouTube asks for a login (or blocks the address of the node),
 * a second recording of YouTube fails the same way, and a SoundCloud one does not. `preferNot`: a service to leave for last (YouTube, while it is failing).
 */
function diversify(tracks, { preferNot = null } = {}) {
  let list = [...(tracks ?? [])];
  if (preferNot) list = [...list.filter((track) => sourceOf(track) !== preferNot), ...list.filter((track) => sourceOf(track) === preferNot)];
  if (list.length < 3) return list;
  const other = list.findIndex((track, index) => index > 0 && sourceOf(track) !== sourceOf(list[0]));
  if (other <= 1) return list;
  const [pick] = list.splice(other, 1);
  list.splice(1, 0, pick);
  return list;
}

const SPOTIFY_LINK = /^(?:https?:\/\/)?open\.spotify\.com\/(?:intl-[a-z-]+\/)?(track|album|playlist|artist)\/([A-Za-z0-9]+)/i;
const SPOTIFY_URI = /^spotify:(track|album|playlist|artist):([A-Za-z0-9]+)$/i;
const YOUTUBE_LINK = /^(?:https?:\/\/)?(?:www\.|m\.|music\.)?(?:youtube\.com|youtu\.be)\//i;
const SOUNDCLOUD_LINK = /^(?:https?:\/\/)?(?:www\.|m\.|on\.)?soundcloud\.com\//i;

/** What a person wrote: a link of a service the node reads, a link of another one, or a text to search. */
function kindOfInput(input) {
  const text = String(input ?? '').trim();
  const spotify = SPOTIFY_LINK.exec(text) ?? SPOTIFY_URI.exec(text);
  if (spotify) return { kind: 'spotify', what: spotify[1].toLowerCase(), url: /^spotify:/i.test(text) ? `https://open.spotify.com/${spotify[1].toLowerCase()}/${spotify[2]}` : text.split(/[?#]/)[0] };
  if (YOUTUBE_LINK.test(text)) return { kind: 'youtube', url: text };
  if (SOUNDCLOUD_LINK.test(text)) return { kind: 'soundcloud', url: text };
  if (/^https?:\/\//i.test(text)) return { kind: 'other', url: text };
  return { kind: 'text', query: text };
}

module.exports = { BAD_TERMS, normalize, tokensOf, badTermsIn, coreTitle, artistNamed, scoreOne, rank, order, diversify, kindOfInput };
