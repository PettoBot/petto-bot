const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { getRoleplayCounter } = require('../db/roleplayStats');
const { COLORS } = require('./colors');
const { buildRoleplayButtonRow, getRoleplayCounterMessage } = require('./roleplayButtons');
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

async function requestJson(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Petto Discord Bot/0.1' }, // i18n-ignore: HTTP header
    });
    if (!response.ok) throw new Error('Image provider returned HTTP ' + response.status); // i18n-ignore: internal error, never shown
    return response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchActionImage(action) {
  const requests = [];
  const waifuAction = WAIFU_ACTIONS[action];
  const nekosAction = NEKOS_ACTIONS[action];

  if (waifuAction) {
    requests.push(
      requestJson('https://api.waifu.pics/sfw/' + waifuAction).then((payload) => {
        if (typeof payload.url !== 'string') throw new Error('Invalid waifu.pics response'); // i18n-ignore: internal error, never shown
        return payload.url;
      }),
    );
  }

  if (nekosAction) {
    requests.push(
      requestJson('https://nekos.best/api/v2/' + nekosAction).then((payload) => {
        const url = payload.results?.[0]?.url;
        if (typeof url !== 'string') throw new Error('Invalid nekos.best response'); // i18n-ignore: internal error, never shown
        return url;
      }),
    );
  }

  const otakuGifsAction = OTAKUGIFS_ACTIONS[action];
  if (otakuGifsAction) {
    requests.push(
      requestJson('https://api.otakugifs.xyz/gif?reaction=' + otakuGifsAction).then((payload) => {
        if (typeof payload.url !== 'string') throw new Error('Invalid OtakuGIFs response'); // i18n-ignore: internal error, never shown
        return payload.url;
      }),
    );
  }

  if (!requests.length) return null;
  try {
    return await Promise.any(requests);
  } catch {
    return null;
  }
}

function actorName(user) {
  return user.globalName ?? user.username;
}

// The texts of each action live in the roleplay catalog: `roleplay.<name>.title` (next to the author), `.target` (to another
// member), `.self` (to themselves), and the response button, response lines and counters (see roleplayButtons.js).
function createRoleplayCommand(name, config) {
  return {
    category: 'roleplay',
    aliases: config.aliases ?? [],
    cooldownMs: 2_500,
    data: new SlashCommandBuilder()
      .setName(name)
      .setDescription(config.description)
      .setDMPermission(false)
      .addUserOption((option) => option
        .setName('member')
        .setDescription('The member involved in the interaction.')
        .setRequired(false)),

    async execute(interaction) {
      const lang = await languageOf(interaction);
      const actor = interaction.user;
      const target = interaction.options.getUser('member') ?? actor;
      const actorLabel = actorName(actor);
      const targetLabel = actorName(target);
      const isSelf = actor.id === target.id;
      const requestId = interaction.id ?? interaction.rawMessage?.id ?? `rp-${actor.id}-${Date.now()}`;
      // The self texts get the name already in bold, as they always did (a text that bolds {actor} again shows it the same).
      const sentence = isSelf
        ? t(lang, `roleplay.${name}.self`, { actor: '**' + actorLabel + '**' })
        : t(lang, `roleplay.${name}.target`, { actor: actorLabel, target: targetLabel });

      await interaction.deferReply();
      const imageUrl = await fetchActionImage(name);
      let components;
      let counterMessage;
      if (!isSelf) {
        const count = await getRoleplayCounter(interaction.guild.id, target.id, name).catch(() => null);
        if (count !== null) counterMessage = getRoleplayCounterMessage(name, count, targetLabel, lang);
        components = buildRoleplayButtonRow({ requestId, action: name, actorId: actor.id, targetId: target.id }, false, lang);
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.DEFAULT)
        .setAuthor({ name: actorLabel + ' · ' + t(lang, `roleplay.${name}.title`), iconURL: actor.displayAvatarURL({ size: 128 }) })
        .setDescription(counterMessage ? sentence + '\n*' + counterMessage + '*' : sentence)
        .setFooter({ text: t(lang, 'roleplay.footer') });

      if (imageUrl) embed.setImage(imageUrl);
      const payload = { embeds: [embed], allowedMentions: { parse: [] } };
      if (components) payload.components = [components];
      await interaction.editReply(payload);
    },
  };
}

module.exports = { createRoleplayCommand, fetchActionImage };
