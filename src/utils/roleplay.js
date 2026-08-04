const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('./colors');

const API_ACTIONS = {
  airkiss: 'kiss',
  bite: 'bite',
  blush: 'blush',
  boop: 'boop',
  brother: 'brother',
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

const API_TIMEOUT_MS = 5_000;

async function fetchActionImage(action) {
  const endpointAction = API_ACTIONS[action];
  if (!endpointAction) return null;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), API_TIMEOUT_MS);

  try {
    const response = await fetch(`https://api.waifu.pics/sfw/${endpointAction}`, { signal: controller.signal });
    if (!response.ok) return null;
    const payload = await response.json();
    return typeof payload.url === 'string' ? payload.url : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
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
        ? (config.self ?? `**${actorLabel}** ${config.verb} themselves.`).replaceAll('{actor}', `**${actorLabel}**`)
        : `**${actorLabel}** ${config.verb} **${targetLabel}**.`;

      await interaction.deferReply();
      const imageUrl = await fetchActionImage(name);
      const embed = new EmbedBuilder()
        .setColor(COLORS.BLUE)
        .setAuthor({ name: `${actorLabel} · ${config.label}`, iconURL: actor.displayAvatarURL({ size: 128 }) })
        .setDescription(sentence)
        .setFooter({ text: 'Roleplay interaction · Petto' });

      if (imageUrl) embed.setImage(imageUrl);
      await interaction.editReply({ embeds: [embed], allowedMentions: { parse: [] } });
    },
  };
}

module.exports = { createRoleplayCommand };
