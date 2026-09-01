const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('./colors');
const { getRoleplayCounter } = require('../db/roleplayStats');
const { buildRoleplayButtonRow, buildRoleplayCounterField } = require('./roleplayButtons');
const logger = require('./logger');

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
      headers: { 'User-Agent': 'Petto Discord Bot/0.1' },
    });
    if (!response.ok) throw new Error('Image provider returned HTTP ' + response.status);
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
        if (typeof payload.url !== 'string') throw new Error('Invalid waifu.pics response');
        return payload.url;
      }),
    );
  }

  if (nekosAction) {
    requests.push(
      requestJson('https://nekos.best/api/v2/' + nekosAction).then((payload) => {
        const url = payload.results?.[0]?.url;
        if (typeof url !== 'string') throw new Error('Invalid nekos.best response');
        return url;
      }),
    );
  }

  const otakuGifsAction = OTAKUGIFS_ACTIONS[action];
  if (otakuGifsAction) {
    requests.push(
      requestJson('https://api.otakugifs.xyz/gif?reaction=' + otakuGifsAction).then((payload) => {
        if (typeof payload.url !== 'string') throw new Error('Invalid OtakuGIFs response');
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
      const actor = interaction.user;
      const target = interaction.options.getUser('member') ?? actor;
      const actorLabel = actorName(actor);
      const targetLabel = actorName(target);
      const isSelf = actor.id === target.id;
      const requestId = interaction.id ?? interaction.rawMessage?.id ?? `${actor.id}${Date.now()}`;
      const sentence = isSelf
        ? (config.self ?? '**' + actorLabel + '** ' + config.verb + ' themselves.').replaceAll('{actor}', '**' + actorLabel + '**')
        : '**' + actorLabel + '** ' + config.verb + ' **' + targetLabel + '**.';

      await interaction.deferReply();
      const imageUrl = await fetchActionImage(name);
      let components;
      let counterField;
      if (!isSelf) {
        try {
          const count = await getRoleplayCounter(interaction.guild.id, target.id, name);
          counterField = buildRoleplayCounterField(name, count);
          components = buildRoleplayButtonRow({ requestId, action: name, actorId: actor.id, targetId: target.id });
        } catch (error) {
          logger.warn({ guildId: interaction.guild.id, command: name, source: 'roleplay' }, 'Roleplay response controls could not be loaded; sending the interaction without buttons.', error);
        }
      }
      const embed = new EmbedBuilder()
        .setColor(COLORS.DEFAULT)
        .setAuthor({ name: actorLabel + ' · ' + config.label, iconURL: actor.displayAvatarURL({ size: 128 }) })
        .setDescription(sentence)
        .setFooter({ text: 'Roleplay interaction · Petto' });

      if (counterField) embed.addFields(counterField);
      if (imageUrl) embed.setImage(imageUrl);
      const payload = { embeds: [embed], allowedMentions: { parse: [] } };
      if (components) payload.components = [components];
      await interaction.editReply(payload);
    },
  };
}

module.exports = { createRoleplayCommand, fetchActionImage };
