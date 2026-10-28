// The music of the bot: one session for each server that is playing (the voice connection, the queue, the card), and the actions the commands and the buttons
// of the card ask for. The commands (`src/commands/music/music.js`) and the buttons (`src/interactions/music.js`) only translate what was typed or pressed.
const { ChannelType, PermissionFlagsBits, MessageFlags } = require('discord.js');
const node = require('./node');
const resolver = require('./resolver');
const card = require('./card');
const { GuildMusic } = require('./queue');
const { setVoiceStatus, statusOf } = require('./status');
const { canUseMusic } = require('./access');
const { plainText, clip } = require('../feeds/text');
const { peekGuildLanguage, t, tn } = require('../i18n');
const logger = require('../utils/logger');

const IDLE_MS = 3 * 60_000; // the voice channel is left this long after the queue ended
const ALONE_MS = 2 * 60_000; // ... and this long after the last person left
const WATCH_MS = 10_000; // how often a session looks whether its song still has a player behind it
const REFRESH_MS = 30_000; // the time and the bar of the card are refreshed this often while a song plays
const GREEN = 0xa5ea7a;
const RED = 0xfe6465;
const DISCONNECTED = 4014; // the code of Discord when the bot was removed from the voice channel

const IDLE_OK = new Set(['leave', 'queue', 'volume', 'loop']); // what still makes sense when nothing plays but the bot is in the channel

const sessions = new Map();

const sessionOf = (guildId) => sessions.get(guildId) ?? null;
const langOf = (guildId) => peekGuildLanguage(guildId);
const good = (text) => card.notice(text, GREEN);
const bad = (text) => card.notice(text, RED);
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
    onTrackStart(music, item) {
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

/** `!play` / `/music play`. */
async function play(interaction, query, { next = false } = {}) {
  const lang = langOf(interaction.guildId);
  if (!canUseMusic(interaction.user.id)) return replyTo(interaction, bad(t(lang, 'music.testing')));
  if (!node.enabled()) return replyTo(interaction, bad(t(lang, 'music.notConfigured')));
  const voice = interaction.member?.voice?.channel;
  if (!voice || voice.type !== ChannelType.GuildVoice) return replyTo(interaction, bad(t(lang, 'music.joinFirst')));
  const existing = sessionOf(interaction.guildId);
  if (existing && existing.voiceChannelId !== voice.id) return replyTo(interaction, bad(t(lang, 'music.sameChannel', { channel: `<#${existing.voiceChannelId}>` })));
  if (!voice.permissionsFor(interaction.guild.members.me)?.has([PermissionFlagsBits.Connect, PermissionFlagsBits.Speak])) return replyTo(interaction, bad(t(lang, 'music.noPermission', { channel: `<#${voice.id}>` })));
  const lavalink = node.idealNode();
  if (!lavalink) return replyTo(interaction, bad(t(lang, 'music.nodeDown')));

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
  const session = await needSession(interaction, lang, action);
  if (!session) return null;
  const result = await run(session, action, args, lang);
  if (result.payload) return replyTo(interaction, result.payload);
  return replyTo(interaction, result.ok ? good(result.text) : bad(result.text));
}

/** A button of the card. */
async function button(interaction, action) {
  const lang = langOf(interaction.guildId);
  const session = await needSession(interaction, lang, action === 'queue' || action === 'leave' ? action : '');
  if (!session) return;
  const map = { prev: ['previous', {}], pause: ['toggle', {}], stop: ['stop', {}], skip: ['skip', {}], loop: ['cycleLoop', {}], queue: ['queue', { page: 1 }], voldown: ['volume', { delta: -10 }], volup: ['volume', { delta: 10 }], shuffle: ['shuffle', {}], leave: ['leave', {}] };
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

module.exports = { play, command, button, onVoiceState, parseTime, sessionOf, leave, _sessions, IDLE_MS, ALONE_MS };
