const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('./colors');

const WAIFU_ACTIONS = {
  airkiss: 'kiss',
  bite: 'bite',
  blush: 'blush',
  boop: 'boop',
  cuddle: 'cuddle',
  cry: 'cry',
  dance: 'dance',
  glomp: 'glomp',
  handhold: 'handhold',
  happy: 'happy',
  highfive: 'highfive',
  hug: 'hug',
  kick: 'kick',
  kill: 'kill',
  kiss: 'kiss',
  lick: 'lick',
  nom: 'nom',
  pat: 'pat',
  poke: 'poke',
  punch: 'punch',
  slap: 'slap',
  smile: 'smile',
  smug: 'smug',
  wave: 'wave',
  wink: 'wink',
  yeet: 'yeet',
};

const NEKOS_ACTIONS = {
  airkiss: 'blowkiss',
  angrystare: 'stare',
  bite: 'bite',
  bleh: 'bleh',
  blush: 'blush',
  brofist: 'highfive',
  cuddle: 'cuddle',
  cry: 'cry',
  dance: 'dance',
  handhold: 'handhold',
  happy: 'happy',
  highfive: 'highfive',
  hug: 'hug',
  kick: 'kick',
  kiss: 'kiss',
  nom: 'nom',
  pat: 'pat',
  poke: 'poke',
  punch: 'punch',
  slap: 'slap',
  smile: 'smile',
  smug: 'smug',
  tickle: 'tickle',
  wave: 'wave',
  wink: 'wink',
  yeet: 'yeet',
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
      const sentence = isSelf
        ? (config.self ?? '**' + actorLabel + '** ' + config.verb + ' themselves.').replaceAll('{actor}', '**' + actorLabel + '**')
        : '**' + actorLabel + '** ' + config.verb + ' **' + targetLabel + '**.';

      await interaction.deferReply();
      const imageUrl = await fetchActionImage(name);
      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setAuthor({ name: actorLabel + ' · ' + config.label, iconURL: actor.displayAvatarURL({ size: 128 }) })
        .setDescription(sentence)
        .setFooter({ text: 'Roleplay interaction · Petto' });

      if (imageUrl) embed.setImage(imageUrl);
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  };
}

module.exports = { createRoleplayCommand };
