const { EmbedBuilder, escapeMarkdown } = require('discord.js');
const { getRoleplayCounter } = require('../db/roleplayStats');
const { COLORS } = require('./colors');
const { buildRoleplayButtonRow, getRoleplayCounterMessage } = require('./roleplayButtons');
const { actionOf } = require('./actions');
const { t, languageOf } = require('../i18n');

const WAIFU_ACTIONS = {
  airkiss: 'kiss',
  bite: 'bite',
  blush: 'blush',
  boop: 'boop',
  bye: 'wave',
  cuddle: 'cuddle',
  cry: 'cry',
  dance: 'dance',
  glomp: 'glomp',
  handhold: 'handhold',
  happy: 'happy',
  highfive: 'highfive',
  hug: 'hug',
  hi: 'wave',
  yes: 'happy',
  kick: 'kick',
  kill: 'kill',
  kiss: 'kiss',
  lick: 'lick',
  laugh: 'happy',
  nom: 'nom',
  pat: 'pat',
  poke: 'poke',
  punch: 'punch',
  sad: 'cry',
  slap: 'slap',
  smile: 'smile',
  smug: 'smug',
  wave: 'wave',
  wink: 'wink',
  yeet: 'yeet',
};

const NEKOS_ACTIONS = {
  baka: 'baka',
  bored: 'bored',
  facepalm: 'facepalm',
  handshake: 'handshake',
  lurk: 'lurk',
  nod: 'nod',
  peck: 'peck',
  pout: 'pout',
  shrug: 'shrug',
  sleep: 'sleep',
  stare: 'stare',
  think: 'think',
  thumbsup: 'thumbsup',
  yawn: 'yawn',
  airkiss: 'blowkiss',
  angry: 'stare',
  angrystare: 'stare',
  bite: 'bite',
  bleh: 'bleh',
  blush: 'blush',
  brofist: 'highfive',
  bye: 'wave',
  cuddle: 'cuddle',
  cry: 'cry',
  dance: 'dance',
  handhold: 'handhold',
  happy: 'happy',
  highfive: 'highfive',
  hug: 'hug',
  hi: 'wave',
  kick: 'kick',
  kiss: 'kiss',
  laugh: 'happy',
  no: 'bleh',
  nom: 'nom',
  pat: 'pat',
  poke: 'poke',
  punch: 'punch',
  sad: 'cry',
  slap: 'slap',
  smile: 'smile',
  smug: 'smug',
  tickle: 'tickle',
  wave: 'wave',
  wink: 'wink',
  yeet: 'yeet',
  yes: 'happy',
};

// nekos.best does not expose every action name (notably `lick`). OtakuGIFs
// fills those gaps and gives us a second independent fallback when waifu.pics
// is unavailable. The aliases keep every command visual instead of silently
// returning a text-only embed when a provider has a narrower catalogue.
const OTAKUGIFS_ACTIONS = {
  baka: 'bleh',
  bored: 'sigh',
  celebrate: 'celebrate',
  cheers: 'cheers',
  clap: 'clap',
  confused: 'confused',
  cool: 'cool',
  drool: 'drool',
  evillaugh: 'evillaugh',
  facepalm: 'facepalm',
  handshake: 'brofist',
  headbang: 'headbang',
  love: 'love',
  lurk: 'peek',
  mad: 'mad',
  nervous: 'nervous',
  nod: 'yes',
  nuzzle: 'nuzzle',
  nyah: 'nyah',
  peck: 'kiss',
  peek: 'peek',
  pinch: 'pinch',
  pout: 'pout',
  scared: 'scared',
  shout: 'shout',
  shrug: 'shrug',
  shy: 'shy',
  sigh: 'sigh',
  sip: 'sip',
  sleep: 'sleep',
  slowclap: 'slowclap',
  smack: 'smack',
  sneeze: 'sneeze',
  sorry: 'sorry',
  stare: 'stare',
  surprised: 'surprised',
  sweat: 'sweat',
  think: 'confused',
  thumbsup: 'thumbsup',
  tired: 'tired',
  woah: 'woah',
  yawn: 'yawn',
  yay: 'yay',
  airkiss: 'kiss',
  angry: 'stare',
  angrystare: 'stare',
  bite: 'bite',
  bleh: 'bleh',
  blush: 'blush',
  boop: 'poke',
  brofist: 'brofist',
  bye: 'wave',
  cuddle: 'cuddle',
  cry: 'cry',
  dance: 'dance',
  glomp: 'hug',
  handhold: 'handhold',
  happy: 'happy',
  highfive: 'brofist',
  hug: 'hug',
  hi: 'wave',
  kick: 'slap',
  kill: 'punch',
  kiss: 'kiss',
  laugh: 'happy',
  lick: 'lick',
  no: 'bleh',
  nom: 'nom',
  pat: 'pat',
  poke: 'poke',
  punch: 'punch',
  sad: 'cry',
  slap: 'slap',
  smile: 'smile',
  smug: 'smug',
  tickle: 'tickle',
  wave: 'wave',
  wink: 'wink',
  yeet: 'punch',
  yes: 'happy',
};

const API_TIMEOUT_MS = 5_000;

// Only the pictures of the sources Petto reads are shown, never a link a provider invents. waifu.pics is asked only for its `sfw`
// pictures, and the other two have no adult category.
const IMAGE_HOSTS = ['otakugifs.xyz', 'waifu.pics', 'nekos.best'];
// A source that failed for an action is skipped for a minute (unless every source failed), and the last pictures of each action
// are kept for an hour, so a source that is down does not leave the command without a gif.
const SOURCE_DOWN_MS = 60_000;
const CACHE_TTL_MS = 60 * 60 * 1000;
const CACHE_PER_ACTION = 12;
const sourceDownUntil = new Map(); // `${source}:${action}` -> when it is tried again
const imageCache = new Map(); // action -> { urls, at }

/** The link when it is an https picture of one of the sources, otherwise null. */
function safeImageUrl(value) {
  try {
    const url = new URL(value);
    const host = url.hostname.toLowerCase();
    if (url.protocol !== 'https:' || !IMAGE_HOSTS.some((allowed) => host === allowed || host.endsWith(`.${allowed}`))) return null;
    return url.href;
  } catch {
    return null;
  }
}

async function requestJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Petto Discord Bot/0.1' }, // i18n-ignore: HTTP header
    });
    if (!response.ok) throw new Error('Image provider returned HTTP ' + response.status); // i18n-ignore: internal error, never shown
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

/** The sources that know an action, in the order they are asked: each one reads the link out of its own answer. */
function imageSources(action) {
  const sources = [];
  if (WAIFU_ACTIONS[action]) sources.push({ id: 'waifu', url: 'https://api.waifu.pics/sfw/' + WAIFU_ACTIONS[action], read: (payload) => payload?.url });
  if (NEKOS_ACTIONS[action]) sources.push({ id: 'nekos', url: 'https://nekos.best/api/v2/' + NEKOS_ACTIONS[action], read: (payload) => payload?.results?.[0]?.url });
  if (OTAKUGIFS_ACTIONS[action]) sources.push({ id: 'otaku', url: 'https://api.otakugifs.xyz/gif?reaction=' + OTAKUGIFS_ACTIONS[action], read: (payload) => payload?.url });
  return sources;
}

function remember(action, url) {
  const entry = imageCache.get(action) ?? { urls: [], at: 0 };
  entry.urls = [url, ...entry.urls.filter((known) => known !== url)].slice(0, CACHE_PER_ACTION);
  entry.at = Date.now();
  imageCache.set(action, entry);
}

/** A picture kept from before (a source is down), or null. */
function remembered(action) {
  const entry = imageCache.get(action);
  if (!entry || !entry.urls.length || Date.now() - entry.at > CACHE_TTL_MS) return null;
  return entry.urls[Math.floor(Math.random() * entry.urls.length)];
}

/**
 * A picture for an action: the sources are asked together and the first good answer wins; a source that failed is skipped for a
 * minute; when all of them fail, a picture kept from before is used. Null when there is nothing to show (the command then
 * says so instead of failing).
 */
async function fetchActionImage(action) {
  const all = imageSources(action);
  if (!all.length) return null;
  const now = Date.now();
  const ready = all.filter((source) => (sourceDownUntil.get(`${source.id}:${action}`) ?? 0) <= now);
  const asked = ready.length ? ready : all;

  const requests = asked.map((source) => requestJson(source.url).then((payload) => {
    const url = safeImageUrl(source.read(payload));
    if (!url) throw new Error('Invalid image provider response'); // i18n-ignore: internal error, never shown
    sourceDownUntil.delete(`${source.id}:${action}`);
    return url;
  }).catch((error) => {
    sourceDownUntil.set(`${source.id}:${action}`, Date.now() + SOURCE_DOWN_MS);
    throw error;
  }));

  try {
    const url = await Promise.any(requests);
    remember(action, url);
    return url;
  } catch {
    return remembered(action);
  }
}

/** Forgets the sources marked as down and the kept pictures (the checks start clean). */
function resetImageState() {
  sourceDownUntil.clear();
  imageCache.clear();
}

function actorName(user) {
  return user.globalName ?? user.username;
}

/**
 * Runs one action of `/act`, the same code for the slash command (`/act love hug user:@Ana`) and the prefix (`!hug @Ana`, which the
 * prefix routes turn into `act love hug @Ana`).
 *
 * How the people are named depends on where the command was typed:
 *   - slash: the command itself is not visible in the channel, so the sentence mentions both people (`<@id>`, shown as pills);
 *   - prefix: the message that was typed already shows the mention, so the sentence uses plain display names.
 * The message is an embed that sends with `allowedMentions: { parse: [] }`, so nobody is notified either way.
 *
 * The texts of each action live in the roleplay catalog: `roleplay.<name>.title` (next to the author), `.target` (to another
 * member), `.self` (to themselves), and the response button, response lines and counters (see roleplayButtons.js).
 */
async function executeAction(interaction) {
  const name = interaction.options.getSubcommand();
  if (!actionOf(name)) throw new Error(`Unknown action "${name}"`); // i18n-ignore: internal error, never shown
  const lang = await languageOf(interaction);
  const actor = interaction.user;
  const target = interaction.options.getUser('user') ?? actor;
  const viaPrefix = Boolean(interaction.fromPrefix);
  const labelOf = (user) => (viaPrefix ? escapeMarkdown(actorName(user)) : `<@${user.id}>`);
  const actorLabel = labelOf(actor);
  const targetLabel = labelOf(target);
  const isSelf = actor.id === target.id;
  // A bot cannot answer the button, so it gets the sentence and nothing else.
  const canAnswer = !isSelf && !target.bot;
  const requestId = interaction.id ?? interaction.rawMessage?.id ?? `rp-${actor.id}-${Date.now()}`;
  // The self texts get the name already in bold, as they always did (a text that bolds {actor} again shows it the same).
  const sentence = isSelf
    ? t(lang, `roleplay.${name}.self`, { actor: '**' + actorLabel + '**' })
    : t(lang, `roleplay.${name}.target`, { actor: actorLabel, target: targetLabel });

  await interaction.deferReply();
  const imageUrl = await fetchActionImage(name);
  let components;
  let counterMessage;
  if (canAnswer) {
    const count = await getRoleplayCounter(interaction.guild.id, target.id, name).catch(() => null);
    if (count !== null) counterMessage = getRoleplayCounterMessage(name, count, targetLabel, lang);
    components = buildRoleplayButtonRow({ requestId, action: name, actorId: actor.id, targetId: target.id }, false, lang);
  }
  const footer = t(lang, 'roleplay.footer') + (imageUrl ? '' : ' · ' + t(lang, 'roleplay.noImage'));
  const embed = new EmbedBuilder()
    .setColor(COLORS.DEFAULT)
    .setAuthor({ name: actorName(actor) + ' · ' + t(lang, `roleplay.${name}.title`), iconURL: actor.displayAvatarURL({ size: 128 }) })
    .setDescription(counterMessage ? sentence + '\n*' + counterMessage + '*' : sentence)
    .setFooter({ text: footer });

  if (imageUrl) embed.setImage(imageUrl);
  const payload = { embeds: [embed], allowedMentions: { parse: [], repliedUser: false } };
  if (components) payload.components = [components];
  await interaction.editReply(payload);
}

module.exports = { executeAction, fetchActionImage, resetImageState, safeImageUrl, imageSources };
