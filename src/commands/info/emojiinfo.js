const { SlashCommandBuilder } = require('discord.js');
const { infoPayload, noticePayload, stamp, line, yesNo, snowflakeTime } = require('../../utils/infoCard');

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
      await interaction.reply(noticePayload("That's not a custom emoji (default Discord emojis have no extra info to show)."));
      return;
    }

    const [, animated, name, id] = match;
    const url = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=512`;

    await interaction.reply(infoPayload({
      title: `:${name}:`,
      thumbnail: url,
      sections: [
        {
          title: 'Details',
          lines: [
            line('Name', `\`${name}\``),
            line('Animated', yesNo(animated)),
            line('Created', stamp(snowflakeTime(id))),
          ],
        },
      ],
      footer: `ID ${id}`,
      buttons: [{ label: 'Open image', url }],
    }));
  },
};
