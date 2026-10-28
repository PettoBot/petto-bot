// The music of the bot: one session for each server that is playing (the voice connection, the queue, the card), and the actions the commands and the buttons
// of the card ask for. The commands (`src/commands/music/music.js`) and the buttons (`src/interactions/music.js`) only translate what was typed or pressed.
const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const node = require('./node');
const resolver = require('./resolver');
const autoplay = require('./autoplay');
const match = require('./match');
const card = require('./card');
const { GuildMusic } = require('./queue');
const { setVoiceStatus, statusOf } = require('./status');
const { canUseMusic } = require('./access');
const { plainText, clip } = require('../feeds/text');
const { peekGuildLanguage, t, tn } = require('../i18n');
const logger = require('../utils/logger');
const config = require('../config');

const IDLE_MS = 3 * 60_000; // the voice channel is left this long after the queue ended
const ALONE_MS = 2 * 60_000; // ... and this long after the last person left
const AUTOPLAY_BATCH = 5; // songs added each time autoplay looks
const WATCH_MS = 10_000; // how often a session looks whether its song still has a player behind it
const REFRESH_MS = 30_000; // the time and the bar of the card are refreshed this often while a song plays
const GREEN = 0xa5ea7a;
const RED = 0xfe6465;
const DISCONNECTED = 4014; // the code of Discord when the bot was removed from the voice channel

const IDLE_OK = new Set(['leave', 'queue', 'volume', 'loop', 'autoplay']); // what still makes sense when nothing plays but the bot is in the channel

const sessions = new Map();

const sessionOf = (guildId) => sessions.get(guildId) ?? null;
const langOf = (guildId) => peekGuildLanguage(guildId);
const good = (text) => card.notice(text, GREEN);
const bad = (text) => card.notice(text, RED);
/** What makes two songs the same one, for autoplay not to repeat what was heard. */
const songKey = (item) => `${match.normalize(autoplay.cleanArtist(item))}|${match.normalize(autoplay.cleanTitle(item, autoplay.cleanArtist(item)))}`;
const title = (item) => clip(plainText(item?.title, 100) || '—', 100);

/** "1:30", "90", "1m30s" or "1:02:03" in milliseconds, or null. */
function parseTime(text) {
  const value = String(text ?? '').trim().toLowerCase();
  if (/^\d+$/.test(value)) return Number(value) * 1000;
  const clockMatch = /^(?:(\d+):)?(\d{1,2}):(\d{2})$/.exec(value);
  if (clockMatch) return ((Number(clockMatch[1] ?? 0) * 60 + Number(clockMatch[2])) * 60 + Number(clockMatch[3])) * 1000;
  const words = /^(?:(\d+)\s*h)?\s*(?:(\d+)\s*m)?\s*(?:(\d+)\s*s)?$/.exec(value);
  if (words && (words[1] || words[2] || words[3])) return ((Number(words[1] ?? 0) * 60 + Number(words[2] ?? 0)) * 60 + Number(words[3] ?? 0)) * 1000;
  return null;
}

// --- The card and the timers of a session ----------------------------------------------------------------------------------------------------------------

const textChannelOf = (session) => session.client.channels.cache.get(session.textChannelId) ?? null;

function clearTimer(session, name) {
  if (session.timers[name]) clearTimeout(session.timers[name]);
  session.timers[name] = null;
}

function startIdle(session, ms = IDLE_MS) {
  clearTimer(session, 'idle');
  session.timers.idle = setTimeout(() => { leave(session).catch(() => {}); }, ms);
  session.timers.idle.unref?.();
}

/** Discord did not take the custom emojis (a deleted emoji, a server the bot left): the card goes on with plain ones. */
const emojiRejected = (error) => error?.code === 50035 || error?.status === 400;

async function updatePanel(session) {
  if (!session.panel || !session.music.current) return;
  try {
    await session.panel.edit(await card.nowPlaying(session.music, langOf(session.guildId), { plain: session.plain }));
  } catch (error) {
    if (!session.plain && emojiRejected(error)) {
      session.plain = true;
      try { await session.panel.edit(await card.nowPlaying(session.music, langOf(session.guildId), { plain: true })); return; } catch { /* gone */ }
    }
    session.panel = null; // the message is gone
  }
}

async function announce(session) {
  const channel = textChannelOf(session);
  if (!channel) return;
  const old = session.panel;
  session.panel = null;
  old?.delete().catch(() => {});
  try {
    try {
      session.panel = await channel.send(await card.nowPlaying(session.music, langOf(session.guildId), { first: true, plain: session.plain }));
    } catch (error) {
      if (session.plain || !emojiRejected(error)) throw error;
      session.plain = true;
      logger.warn(`Music: Discord did not take the custom emojis of the card, the plain ones are used: ${error?.message ?? error}`);
      session.panel = await channel.send(await card.nowPlaying(session.music, langOf(session.guildId), { first: true, plain: true }));
    }
  } catch (error) {
    logger.warn(`Music: the card could not be sent: ${error?.message ?? error}`);
    return;
  }
  clearTimer(session, 'refresh');
  session.timers.refresh = setInterval(() => { if (session.music.current && !session.music.paused) updatePanel(session); }, REFRESH_MS);
  session.timers.refresh.unref?.();
}

/** The card of a song that ended turns into a short line, so nobody presses the buttons of a song that is over. */
async function closePanel(session, text) {
  clearInterval(session.timers.refresh);
  session.timers.refresh = null;
  const panel = session.panel;
  session.panel = null;
  if (panel) await panel.edit({ ...card.notice(text), attachments: [] }).catch(() => {});
}

function hooksFor(session) {
  const say = (payload) => textChannelOf(session)?.send(payload).catch(() => {});
  return {
    onTrackStart(music, item, timing) {
      if (timing) logger.info(`Music: ${item?.title ?? 'a song'} started ${timing.total} ms after the change began (choosing the recording ${timing.recordings} ms, the node ${timing.node} ms)`); // what to look at when a change between songs is slow
      clearTimer(session, 'idle');
      if (session.announced === item && session.panel) updatePanel(session); // the same song again (repeat): the card is refreshed, not sent again
      else announce(session).catch(() => {});
      session.announced = item;
      setVoiceStatus(session.client, session.voiceChannelId, statusOf(item, { plain: session.plain }), statusOf(item, { plain: true }));
    },
    onTrackFailed(music, item, error) {
      logger.warn(`Music: ${item?.title ?? 'a song'} could not be played (${error})`);
      say(bad(t(langOf(session.guildId), 'music.failedTrack', { title: title(item) })));
    },
    onException(music, event) {
      const message = clip(plainText(event?.exception?.message, 200), 200);
      const cause = clip(plainText(event?.exception?.cause, 120), 120);
      logger.warn(`Music: Lavalink could not load ${music.current?.title ?? 'a song'}: ${message}${cause ? ` (${cause})` : ''}`);
      if (music.current?.source === 'youtube' && /sign in|log in|login|not a bot|confirm you/i.test(`${event?.exception?.message ?? ''} ${event?.exception?.cause ?? ''}`)) resolver.markYoutubeDown();
    },
    async onNeedMore(music, seed) {
      const similar = await autoplay.similarTo(seed);
      const heard = new Set([...music.history, ...music.queue, music.current, seed].filter(Boolean).map((item) => songKey(item)));
      return similar.filter((song) => !heard.has(songKey({ title: song.title, author: song.artist }))).slice(0, AUTOPLAY_BATCH).map((song) => ({ ...resolver.scrapedItem(song, null, null), autoplay: true }));
    },
    onAutoplayAdded(music, items, seed) {
      const lang = langOf(session.guildId);
      say(good(tn(lang, 'music.autoplay.added', items.length, { count: items.length, title: title(items[0]), seed: title(seed) })));
    },
    onGiveUp() { say(bad(t(langOf(session.guildId), 'music.gaveUp'))); },
    onQueueEnd() {
      closePanel(session, t(langOf(session.guildId), 'music.ended'));
      setVoiceStatus(session.client, session.voiceChannelId, null);
      startIdle(session);
    },
    onStopped() {
      closePanel(session, t(langOf(session.guildId), 'music.stopped'));
      setVoiceStatus(session.client, session.voiceChannelId, null);
      startIdle(session);
    },
    onClosed(music, event) { if (event?.code === DISCONNECTED) leave(session).catch(() => {}); },
    onError(music, error) { logger.warn(`Music: ${error?.message ?? error}`); },
  };
}

async function connect(interaction, voiceChannel) {
  const shoukaku = node.get();
  const guild = interaction.guild;
  if (shoukaku.players.has(guild.id)) await shoukaku.leaveVoiceChannel(guild.id).catch(() => {}); // a player left over from before
  const player = await shoukaku.joinVoiceChannel({ guildId: guild.id, channelId: voiceChannel.id, shardId: guild.shardId ?? 0, deaf: true });
  const session = { client: interaction.client, guildId: guild.id, voiceChannelId: voiceChannel.id, textChannelId: interaction.channelId, panel: null, timers: {}, music: null };
  session.music = new GuildMusic({ guildId: guild.id, player, recordingsFor: (item) => resolver.recordingsFor(node.idealNode(), item), hooks: hooksFor(session) });
  await player.setGlobalVolume(session.music.volume).catch(() => {}); // the player starts at 100: the default of the session is applied
  sessions.set(guild.id, session);
  session.timers.watch = setInterval(() => { session.music.unstick().catch(() => {}); }, WATCH_MS); // a song whose end never came is moved on from
  session.timers.watch.unref?.();
  return session;
}

/** Leaves the voice channel and forgets the server. */
async function leave(session) {
  if (sessions.get(session.guildId) !== session) return;
  sessions.delete(session.guildId);
  for (const name of Object.keys(session.timers)) { clearTimeout(session.timers[name]); clearInterval(session.timers[name]); }
  session.music.destroy();
  await closePanel(session, t(langOf(session.guildId), 'music.left'));
  await setVoiceStatus(session.client, session.voiceChannelId, null);
  await node.get()?.leaveVoiceChannel(session.guildId).catch(() => {});
}

/** Lavalink came back without its players (it restarted): what was playing is gone, so the servers are told and forgotten instead of showing a dead card. */
async function resetAll() {
  for (const session of [...sessions.values()]) {
    sessions.delete(session.guildId);
    for (const name of Object.keys(session.timers)) { clearTimeout(session.timers[name]); clearInterval(session.timers[name]); }
    session.music.destroy();
    const lang = langOf(session.guildId);
    await closePanel(session, t(lang, 'music.nodeReset'));
    setVoiceStatus(session.client, session.voiceChannelId, null);
    await node.get()?.leaveVoiceChannel(session.guildId).catch(() => {});
  }
}
node.onReset(() => { resetAll().catch((error) => logger.warn(`Music: ${error?.message ?? error}`)); });

// --- What the commands and the buttons ask for ------------------------------------------------------------------------------------------------------------

const replyTo = (interaction, payload) => (interaction.deferred || interaction.replied ? interaction.editReply(payload) : interaction.reply(payload));
const ephemeral = (payload) => ({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral });

/** Checks that the person can use the music and that the bot plays where they are. Returns the session, or null after answering. */
async function needSession(interaction, lang, action = '') {
  const private_ = interaction.isButton?.() ? ephemeral : (payload) => payload;
  if (!canUseMusic(interaction.user.id)) { await replyTo(interaction, private_(bad(t(lang, 'music.testing')))); return null; }
  const session = sessionOf(interaction.guildId);
  if (!session || !(session.music.current || session.music.queue.length || IDLE_OK.has(action))) { await replyTo(interaction, private_(bad(t(lang, 'music.nothing')))); return null; }
  if (interaction.member?.voice?.channelId !== session.voiceChannelId) { await replyTo(interaction, private_(bad(t(lang, 'music.sameChannel', { channel: `<#${session.voiceChannelId}>` })))); return null; }
  return session;
}

/**
 * What a person needs to play: the permission, the node, a voice channel where the bot can speak, and the same one as the bot when it is playing.
 * Returns `{ voice, existing, lavalink }`, or null after answering.
 */
async function preflight(interaction, lang) {
  const say = (payload) => replyTo(interaction, interaction.isStringSelectMenu?.() ? ephemeral(payload) : payload); // the menu of a search answers in private
  if (!canUseMusic(interaction.user.id)) { await say(bad(t(lang, 'music.testing'))); return null; }
  if (!node.enabled()) { await say(bad(t(lang, 'music.notConfigured'))); return null; }
  const voice = interaction.member?.voice?.channel;
  if (!voice || voice.type !== ChannelType.GuildVoice) { await say(bad(t(lang, 'music.joinFirst'))); return null; }
  const existing = sessionOf(interaction.guildId);
  if (existing && existing.voiceChannelId !== voice.id) { await say(bad(t(lang, 'music.sameChannel', { channel: `<#${existing.voiceChannelId}>` }))); return null; }
  if (!voice.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) { await say(bad(t(lang, 'music.noPermission', { channel: `<#${voice.id}>` }))); return null; }
  const lavalink = node.idealNode();
  if (!lavalink) { await say(bad(t(lang, 'music.nodeDown'))); return null; }
  return { voice, existing, lavalink };
}

/** Puts what was found in the queue of the session, answers, and starts it when nothing was playing. */
async function enqueue(interaction, lang, session, found, { next = false } = {}) {
  session.textChannelId = interaction.channelId;
  clearTimer(session, 'idle');

  const idle = !session.music.current;
  const { added, full, position } = session.music.add(found.items, { next });
  if (!added) return replyTo(interaction, bad(t(lang, 'music.full', { max: session.music.maxQueue })));
  let text;
  if (found.type === 'playlist') {
    text = tn(lang, 'music.added.playlist', added, { count: added, name: clip(plainText(found.name, 80), 80) || '—' });
    if (full || found.cut) text += `\n-# ${t(lang, 'music.added.cut', { max: session.music.maxQueue })}`;
  } else {
    text = idle ? t(lang, 'music.added.now', { title: title(found.items[0]) }) : t(lang, 'music.added.track', { title: title(found.items[0]), position });
  }
  await Promise.all([replyTo(interaction, good(text)), session.music.startIfIdle()]); // the song starts without waiting for the answer to be sent
  return null;
}

/** `!play` / `/music play`. */
async function play(interaction, query, { next = false } = {}) {
  const lang = langOf(interaction.guildId);
  if (!config.musicEnabled) return replyTo(interaction, bad(t(lang, 'music.disabled')));
  const ready = await preflight(interaction, lang);
  if (!ready) return null;
  const { voice, existing, lavalink } = ready;

  await interaction.deferReply();
  // The voice channel is joined while the song is searched (they do not depend on each other), so the song starts as soon as it is found.
  const joining = existing ? Promise.resolve(existing) : connect(interaction, voice).catch((error) => { logger.warn(`Music: could not join the voice channel: ${error?.message ?? error}`); return null; });
  const searching = resolver.resolveInput(lavalink, query, { requestedBy: interaction.user.id }).catch((error) => {
    logger.warn(`Music: the search failed: ${error?.message ?? error}`);
    return { type: 'error', items: [], error: 'unavailable' };
  });
  const [found, session] = await Promise.all([searching, joining]);
  const nothing = found.type === 'unsupported' || found.type === 'error' || !found.items.length;
  if (nothing && session && session !== existing) await leave(session).catch(() => {}); // joined for nothing
  if (found.type === 'unsupported') return replyTo(interaction, bad(t(lang, 'music.unsupported')));
  if (found.type === 'error') return replyTo(interaction, bad(t(lang, 'music.error', { reason: clip(plainText(found.error, 150), 150) })));
  if (!found.items.length) return replyTo(interaction, bad(t(lang, 'music.notFound', { query: clip(plainText(query, 80), 80) })));
  if (!session) return replyTo(interaction, bad(t(lang, 'music.joinFailed')));
  return enqueue(interaction, lang, session, found, { next });
}

// --- The list under the option of `/music play` while it is typed ------------------------------------------------------------------------------------

const SUGGESTIONS = new Map(); // what was typed (lower case) -> { choices, until }
const SUGGEST_MS = 60_000;
const SUGGEST_WAIT_MS = 2500; // Discord waits 3 seconds for the list

/** One entry of the list: "Title - Artist", and what to play when it is chosen (the link of that recording, or its name when the link is too long). */
function suggestionOf(item) {
  const artist = autoplay.cleanArtist(item);
  const name = clip(`${autoplay.cleanTitle(item, artist) || plainText(item.title, 60)} - ${artist || plainText(item.author, 40)}`, 100);
  const link = typeof item.uri === 'string' && item.uri.length <= 100 && /^https:\/\//.test(item.uri) ? item.uri : null;
  return { name, value: link ?? clip(`${artist} ${autoplay.cleanTitle(item, artist)}`.trim() || plainText(item.title, 100), 100) };
}

/** The suggestions for what a person has typed so far (up to 10), or `[]` when there are none, it is too soon, or the node is too slow. Never throws. */
async function suggest(userId, text) {
  const query = String(text ?? '').trim();
  if (!config.musicEnabled || query.length < 2 || /^(https?:|spotify:)/i.test(query) || !canUseMusic(userId) || !node.enabled()) return [];
  const key = query.toLowerCase();
  const hit = SUGGESTIONS.get(key);
  if (hit && hit.until > Date.now()) return hit.choices;
  const lavalink = node.idealNode();
  if (!lavalink) return [];
  const search = resolver.searchChoices(lavalink, query, { limit: 10 }).then((items) => {
    const seen = new Set();
    return items.map(suggestionOf).filter((choice) => choice.name && !seen.has(choice.value) && seen.add(choice.value));
  }).catch(() => []);
  let timer = null;
  const slow = new Promise((resolve) => { timer = setTimeout(() => resolve(null), SUGGEST_WAIT_MS); timer.unref?.(); });
  const choices = await Promise.race([search, slow]);
  clearTimeout(timer);
  if (!choices) return [];
  if (SUGGESTIONS.size >= 300) SUGGESTIONS.delete(SUGGESTIONS.keys().next().value);
  SUGGESTIONS.set(key, { choices, until: Date.now() + SUGGEST_MS });
  return choices;
}

// --- Search: five results to choose from -------------------------------------------------------------------------------------------------------------

const CHOICES = new Map(); // token -> { userId, items, until }: the results of a search that wait for a choice
const CHOICE_MS = 5 * 60_000;
const MAX_CHOICES = 200;

/** `/music search`: the five best results in a menu; the one who searched picks. */
async function search(interaction, query) {
  const lang = langOf(interaction.guildId);
  if (!config.musicEnabled) return replyTo(interaction, bad(t(lang, 'music.disabled')));
  const ready = await preflight(interaction, lang);
  if (!ready) return null;
  await interaction.deferReply();
  let items = [];
  try {
    items = await resolver.searchChoices(ready.lavalink, query, { requestedBy: interaction.user.id });
  } catch (error) {
    logger.warn(`Music: the search failed: ${error?.message ?? error}`);
    return replyTo(interaction, bad(t(lang, 'music.error', { reason: 'unavailable' })));
  }
  if (!items.length) return replyTo(interaction, bad(t(lang, 'music.notFound', { query: clip(plainText(query, 80), 80) })));
  const now = Date.now();
  for (const [token, entry] of CHOICES) if (entry.until < now) CHOICES.delete(token);
  if (CHOICES.size >= MAX_CHOICES) CHOICES.delete(CHOICES.keys().next().value);
  const token = Math.random().toString(36).slice(2, 10);
  CHOICES.set(token, { userId: interaction.user.id, items, until: now + CHOICE_MS });
  return replyTo(interaction, card.choiceMenu(items, token, lang));
}

/** The choice made in the menu of a search: the song is added like `play` does. */
async function pick(interaction, token) {
  const lang = langOf(interaction.guildId);
  if (!config.musicEnabled) { await interaction.reply(ephemeral(bad(t(lang, 'music.disabled')))); return; }
  const entry = CHOICES.get(token);
  if (!entry || entry.until < Date.now()) { await interaction.reply(ephemeral(bad(t(lang, 'music.search.expired')))); return; }
  if (interaction.user.id !== entry.userId) { await interaction.reply(ephemeral(bad(t(lang, 'music.search.notYours', { user: `<@${entry.userId}>` })))); return; }
  const chosen = entry.items[Number(interaction.values?.[0])];
  if (!chosen) { await interaction.reply(ephemeral(bad(t(lang, 'music.search.expired')))); return; }
  const ready = await preflight(interaction, lang).catch(() => null); // answers by itself when something is missing
  if (!ready) return;
  CHOICES.delete(token);
  await interaction.deferUpdate();
  let session = ready.existing;
  try {
    session ??= await connect(interaction, ready.voice);
  } catch (error) {
    logger.warn(`Music: could not join the voice channel: ${error?.message ?? error}`);
    await replyTo(interaction, bad(t(lang, 'music.joinFailed')));
    return;
  }
  await enqueue(interaction, lang, session, { type: 'track', items: [chosen] });
}

/**
 * The other commands and the buttons. `action`: pause, resume, toggle, skip, previous, stop, loop, cycleLoop, shuffle, volume, seek, remove, clear, leave, now, queue.
 * Returns `{ text, ok }` for a notice, `{ payload }` for something that is shown as it is, or `{}` when the card says it all (a button).
 */
async function run(session, action, args, lang) {
  const music = session.music;
  switch (action) {
    case 'pause': return await music.pause() ? { text: t(lang, 'music.paused'), ok: true } : { text: t(lang, 'music.alreadyPaused'), ok: false };
    case 'resume': return await music.resume() ? { text: t(lang, 'music.resumed'), ok: true } : { text: t(lang, 'music.notPaused'), ok: false };
    case 'toggle': return music.paused ? run(session, 'resume', args, lang) : run(session, 'pause', args, lang);
    case 'skip': {
      const name = title(music.current);
      await music.skip(args.count ?? 1);
      return { text: t(lang, 'music.skipped', { title: name }), ok: true };
    }
    case 'previous': return await music.previous() ? { text: t(lang, 'music.previous'), ok: true } : { text: t(lang, 'music.noPrevious'), ok: false };
    case 'stop': await music.stop(); return { text: t(lang, 'music.stopped'), ok: true };
    case 'loop': music.setLoop(args.mode); return { text: t(lang, `music.loop.${music.loop}`), ok: true };
    case 'cycleLoop': music.setLoop({ off: 'track', track: 'queue', queue: 'off' }[music.loop]); return { text: t(lang, `music.loop.${music.loop}`), ok: true };
    case 'autoplay': {
      if (!music.autoplay && !autoplay.available()) return { text: t(lang, 'music.autoplay.noKey'), ok: false };
      const on = music.setAutoplay(!music.autoplay);
      return { text: t(lang, on ? 'music.autoplay.on' : 'music.autoplay.off'), ok: true };
    }
    case 'shuffle': return { text: tn(lang, 'music.shuffled', music.shuffle(), { count: music.queue.length }), ok: true };
    case 'volume': {
      const volume = await music.setVolume(args.delta ? music.volume + args.delta : args.value);
      return { text: t(lang, 'music.volume', { volume }), ok: true };
    }
    case 'seek': {
      const ms = parseTime(args.time);
      if (ms === null) return { text: t(lang, 'music.seek.bad'), ok: false };
      return await music.seek(ms) ? { text: t(lang, 'music.seeked', { time: card.clock(music.positionMs()) }), ok: true } : { text: t(lang, 'music.seek.cannot'), ok: false };
    }
    case 'remove': {
      const item = music.remove(args.place);
      return item ? { text: t(lang, 'music.removed', { title: title(item) }), ok: true } : { text: t(lang, 'music.noSuchSong', { max: music.queue.length }), ok: false };
    }
    case 'clear': { const count = music.clear(); return { text: tn(lang, 'music.cleared', count, { count }), ok: true }; }
    case 'leave': await leave(session); return { text: t(lang, 'music.left'), ok: true };
    case 'queue': return { payload: card.queuePage(music, lang, args.page) };
    case 'now': await announce(session); return { text: t(lang, 'music.nowShown'), ok: true };
    default: return { text: t(lang, 'music.nothing'), ok: false };
  }
}

/** A command (not a button) that acts on the session: checks, runs and answers. */
async function command(interaction, action, args = {}) {
  const lang = langOf(interaction.guildId);
  if (!config.musicEnabled) return replyTo(interaction, bad(t(lang, 'music.disabled')));
  const session = await needSession(interaction, lang, action);
  if (!session) return null;
  const result = await run(session, action, args, lang);
  if (result.payload) return replyTo(interaction, result.payload);
  return replyTo(interaction, result.ok ? good(result.text) : bad(result.text));
}

/** A button of the card. */
async function button(interaction, action) {
  const lang = langOf(interaction.guildId);
  if (!config.musicEnabled) { await interaction.reply(ephemeral(bad(t(lang, 'music.disabled')))); return; }
  const session = await needSession(interaction, lang, action === 'queue' || action === 'leave' ? action : '');
  if (!session) return;
  const map = { prev: ['previous', {}], pause: ['toggle', {}], stop: ['stop', {}], skip: ['skip', {}], loop: ['cycleLoop', {}], queue: ['queue', { page: 1 }], voldown: ['volume', { delta: -10 }], /* the card no longer has it; the cards sent before do */ volup: ['volume', { delta: 10 }], shuffle: ['shuffle', {}], autoplay: ['autoplay', {}], leave: ['leave', {}] };
  const [name, args] = map[action] ?? [];
  if (!name) return;
  if (name === 'queue') {
    const { payload } = await run(session, name, args, lang);
    await interaction.reply(ephemeral(payload));
    return;
  }
  await interaction.deferUpdate();
  const result = await run(session, name, args, lang);
  if (!result.ok && result.text) await interaction.followUp(ephemeral(bad(result.text))).catch(() => {});
  if (sessions.get(session.guildId) === session) await updatePanel(session);
}

// --- Voice events -------------------------------------------------------------------------------------------------------------------------------------

/** Called on every change in a voice channel: the bot left when it is alone for a while, and forgets the server when it was taken out of the channel. */
function onVoiceState(oldState, newState) {
  const session = sessionOf((newState.guild ?? oldState.guild).id);
  if (!session) return;
  const botId = session.client.user.id;
  if (oldState.id === botId && !newState.channelId) { leave(session).catch(() => {}); return; }
  if (oldState.id === botId && newState.channelId && newState.channelId !== session.voiceChannelId) session.voiceChannelId = newState.channelId; // moved by a moderator
  const channel = session.client.channels.cache.get(session.voiceChannelId);
  if (!channel?.members) return;
  const people = channel.members.filter((member) => !member.user.bot).size;
  if (people === 0) {
    if (!session.timers.alone) { session.timers.alone = setTimeout(() => { leave(session).catch(() => {}); }, ALONE_MS); session.timers.alone.unref?.(); }
  } else {
    clearTimer(session, 'alone');
  }
}

/** For the checks. */
const _sessions = sessions;

module.exports = { play, search, pick, suggest, command, button, onVoiceState, parseTime, sessionOf, leave, _sessions, IDLE_MS, ALONE_MS };
