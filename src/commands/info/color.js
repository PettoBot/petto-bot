const { SlashCommandBuilder } = require('discord.js');
const { infoPayload, noticePayload, line } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

function toHsl(r, g, b) {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const lightness = (max + min) / 2;
  const delta = max - min;
  if (delta === 0) return [0, 0, Math.round(lightness * 100)];
  const saturation = delta / (1 - Math.abs(2 * lightness - 1));
  let hue;
  if (max === rn) hue = ((gn - bn) / delta) % 6;
  else if (max === gn) hue = (bn - rn) / delta + 2;
  else hue = (rn - gn) / delta + 4;
  return [Math.round((hue * 60 + 360) % 360), Math.round(saturation * 100), Math.round(lightness * 100)];
}

module.exports = {
  aliases: ['clr', 'hex'],
  data: new SlashCommandBuilder()
    .setName('color')
    .setDescription('Previews a hex color.')
    .addStringOption((o) => o.setName('hex').setDescription('e.g. #ff91c2 or ff91c2').setRequired(true)),

  async execute(interaction) {
    const input = interaction.options.getString('hex', true).replace('#', '').trim();
    const num = parseInt(input, 16);

    if (!/^[0-9a-f]{1,6}$/i.test(input) || Number.isNaN(num)) {
      await interaction.reply(noticePayload('Provide a valid hex color, e.g. `#ff91c2`.', COLORS.RED));
      return;
    }

    const hex = num.toString(16).padStart(6, '0');
    const [r, g, b] = [(num >> 16) & 255, (num >> 8) & 255, num & 255];
    const [h, s, l] = toHsl(r, g, b);

    // The bar on the left edge of the card is the color being previewed.
    await interaction.reply(infoPayload({
      accent: num,
      title: `#${hex}`,
      sections: [
        {
          lines: [
            line('Hex', `\`#${hex}\``),
            line('RGB', `\`${r}, ${g}, ${b}\``),
            line('HSL', `\`${h}°, ${s}%, ${l}%\``),
            line('Decimal', `\`${num}\``),
          ],
        },
      ],
    }));
  },
};
