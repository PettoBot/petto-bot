const { SlashCommandBuilder } = require('discord.js');
const { infoPayload, noticePayload, stamp, line, yesNo, snowflakeTime } = require('../../utils/infoCard');
const { t, languageOf } = require('../../i18n');

const EMOJI_RE = /<(a?):(\w+):(\d+)>/;

module.exports = {
  aliases: ['ei'],
  data: new SlashCommandBuilder()
    .setName('emojiinfo')
    .setDescription('Shows information about a custom emoji.')
    .addStringOption((o) => o.setName('emoji').setDescription('A custom emoji').setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const input = interaction.options.getString('emoji', true);
    const match = input.match(EMOJI_RE);

    if (!match) {
      await interaction.reply(noticePayload(t(lang, 'info.emojiinfo.notCustom')));
      return;
    }

    const [, animated, name, id] = match;
    const url = `https://cdn.discordapp.com/emojis/${id}.${animated ? 'gif' : 'png'}?size=512`;

    await interaction.reply(infoPayload({
      title: `:${name}:`,
      thumbnail: url,
      sections: [
        {
          title: t(lang, 'info.section.details'),
          lines: [
            line(t(lang, 'info.label.name'), `\`${name}\``),
            line(t(lang, 'info.emojiinfo.animated'), yesNo(animated, lang)),
            line(t(lang, 'info.label.created'), stamp(snowflakeTime(id))),
          ],
        },
      ],
      footer: t(lang, 'info.card.id', { id }),
      buttons: [{ label: t(lang, 'info.emojiinfo.open.button'), url }],
    }));
  },
};
