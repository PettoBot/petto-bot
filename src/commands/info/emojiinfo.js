const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const { COLORS } = require('../../utils/colors');

const EMOJI_RE = /<(a?):(\w+):(\d+)>/;

module.exports = {
  aliases: ['ei'],
  data: new SlashCommandBuilder()
    .setName('emojiinfo')
    .setDescription('Shows information about a custom emoji.')
    .addStringOption((o) => o.setName('emoji').setDescription('A custom emoji').setRequired(true)),

  async execute(interaction) {
    const input = interaction.options.getString('emoji', true);
    const match = input.match(EMOJI_RE);

    if (!match) {
      await interaction.reply({ content: "That's not a custom emoji (default Discord emojis have no extra info to show)." });
      return;
    }

    const [, animated, name, id] = match;
    const url = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=512`;

    const embed = new EmbedBuilder()
      .setColor(COLORS.DEFAULT)
      .setTitle(`:${name}:`)
      .setThumbnail(url)
      .addFields({ name: 'ID', value: id, inline: true }, { name: 'Animated', value: animated ? 'Yes' : 'No', inline: true }, { name: 'URL', value: `[Link](${url})`, inline: true });

    await interaction.reply({ embeds: [embed] });
  },
};
