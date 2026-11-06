const { AttachmentBuilder, MessageFlags, SlashCommandBuilder } = require('discord.js');
const { buildInfoCard, noticePayload, line } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');
const { runHex, withRenderSlot, attachFilesProblem } = require('../../utils/imageCommands');
const { parseColor, hexOf, toHsl, toHsv, toCmyk, toDecimal, contrastRatio, gradeOf, nearestName } = require('../../utils/colorParse');
const { renderColorSample } = require('../../imgutils/colorSampleCard');
const logger = require('../../utils/logger');

// What is a picture to look at and not a color: a link, a mention of a member or the id of one.
const PICTURE_SOURCE = /^(?:https?:\/\/\S+|<@!?\d+>|\d{17,20})$/i;

const GRADE_TEXT = { AAA: 'AAA', AA: 'AA', large: 'A', fail: '✗' };
/** `4.52:1 · AA`, the ratio of a text color on this one and what it allows. */
const ratioText = (ratio, lang) => `\`${ratio.toFixed(2)}:1\` · ${gradeOf(ratio) === 'fail' ? t(lang, 'info.color.fail') : GRADE_TEXT[gradeOf(ratio)]}`;

module.exports = {
  aliases: ['clr', 'hex'],
  // Drawing the sample picture, or finding the color of a picture, takes a moment.
  cooldownMs: 4000,
  // `!color rgb(255, 136, 0)` and `!color 255 136 0` are one value, not three words.
  prefixGreedyStringOptions: { _: 'hex' },
  data: new SlashCommandBuilder()
    .setName('color')
    .setDescription('Shows a color in every format with a sample picture, or finds the main color of an image or avatar.')
    .addStringOption((o) => o.setName('hex').setDescription('A color (#ff8800, rgb(255,136,0), hsl, cmyk, a name, random) or an image or member').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const typed = interaction.options.getString('hex')?.trim() ?? '';
    const color = typed ? parseColor(typed) : null;

    // Anything that is not a color (nothing, a picture, a link, a member) asks for the main color of that picture, with the prefix.
    if (!color && interaction.rawMessage && (!typed || PICTURE_SOURCE.test(typed))) {
      await runHex(interaction, lang, typed || null);
      return;
    }
    if (!color) {
      await interaction.reply(noticePayload(t(lang, 'info.color.invalid'), COLORS.RED));
      return;
    }

    const rgb = [color.r, color.g, color.b];
    const hex = hexOf(...rgb);
    const [h, s, l] = toHsl(...rgb);
    const [hv, sv, vv] = toHsv(...rgb);
    const [c, m, y, k] = toCmyk(...rgb);
    const decimal = toDecimal(...rgb);
    const name = nearestName(rgb);

    // A slash command has to answer within three seconds: drawing is quick, but the answer is promised first.
    if (typeof interaction.deferReply === 'function' && !interaction.deferred && !interaction.replied && interaction.isChatInputCommand?.() && !interaction.rawMessage) await interaction.deferReply();

    // The sample picture. When it cannot be drawn or sent (no permission to attach files, too many drawings at once), the card goes without it.
    let file = null;
    if (!attachFilesProblem(interaction, lang)) {
      try {
        const buffer = await withRenderSlot(async () => renderColorSample({ rgb }));
        file = new AttachmentBuilder(buffer, { name: 'color.png', description: hex });
      } catch (err) {
        logger.warn?.(`color: the sample picture was not drawn: ${err?.message ?? err}`); // i18n-ignore: a log line for the operator
      }
    }

    const subtitle = [
      color.source === 'name' || color.source === 'random' ? null : t(lang, 'info.color.closest', { name }),
      color.source === 'name' ? t(lang, 'info.color.named', { name: color.name }) : null,
      color.source === 'random' ? t(lang, 'info.color.random') : null,
      color.alpha !== null && color.alpha < 1 ? t(lang, 'info.color.alpha', { percent: Math.round(color.alpha * 100) }) : null,
    ].filter(Boolean);

    const card = buildInfoCard({
      title: hex.toUpperCase(),
      subtitle,
      banner: file ? 'attachment://color.png' : null,
      sections: [
        {
          lines: [
            line('Hex', `\`${hex}\``),
            line('RGB', `\`${color.r}, ${color.g}, ${color.b}\``),
            line('HSL', `\`${h}°, ${s}%, ${l}%\``),
            line('HSV', `\`${hv}°, ${sv}%, ${vv}%\``),
            line('CMYK', `\`${c}%, ${m}%, ${y}%, ${k}%\``),
            line('Decimal', `\`${decimal}\``),
          ],
        },
        {
          title: t(lang, 'info.color.readable'),
          lines: [
            line(t(lang, 'info.color.whiteText'), ratioText(contrastRatio(rgb, [255, 255, 255]), lang)),
            line(t(lang, 'info.color.blackText'), ratioText(contrastRatio(rgb, [0, 0, 0]), lang)),
          ],
        },
      ],
      footer: t(lang, 'info.color.footer'),
    });

    const payload = { components: [card], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [], repliedUser: false }, ...(file ? { files: [file] } : {}) };
    if (interaction.deferred) await interaction.editReply(payload);
    else await interaction.reply(payload);
  },
};
