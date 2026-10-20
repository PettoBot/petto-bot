// What !image, !quote and !hex share: the Attach Files check, the limit on pictures drawn at once, finding the picture, and the
// answers (the new file, or a short error).
const { AttachmentBuilder, PermissionFlagsBits } = require('discord.js');
const { noticePayload } = require('./infoCard');
const { COLORS } = require('./colors');
const { t } = require('../i18n');
const logger = require('./logger');
const { ImageInputError, findImageSource, loadInputImage } = require('./imageInput');
const { applyEffect, mainColor, renderSwatch, hexOf } = require('../imgutils/imageEffects');

// Drawing runs on the main thread: at most two pictures at once, a few more waiting, and the rest told to try again.
const RENDER = { running: 2, waiting: 8 };
let running = 0;
const queue = [];

/** Runs `task` when a drawing slot is free. Throws an ImageInputError (busy) when too many are already waiting. */
async function withRenderSlot(task) {
  if (running >= RENDER.running) {
    if (queue.length >= RENDER.waiting) throw new ImageInputError('images.error.busy');
    await new Promise((resolve) => queue.push(resolve));
  } else {
    running += 1;
  }
  try {
    return await task();
  } finally {
    const next = queue.shift();
    if (next) next(); else running -= 1;
  }
}

/** The text to answer with when the bot or the member cannot attach files in the channel, or null when both can. */
function attachFilesProblem(interaction, lang) {
  const channel = interaction.channel;
  const me = interaction.guild?.members?.me;
  if (channel?.permissionsFor && me && !channel.permissionsFor(me)?.has(PermissionFlagsBits.AttachFiles)) return t(lang, 'images.error.botAttach');
  if (channel?.permissionsFor && interaction.member && !channel.permissionsFor(interaction.member)?.has(PermissionFlagsBits.AttachFiles)) return t(lang, 'images.error.memberAttach');
  return null;
}

/** Answers with plain text: the error about attaching files must be readable even where cards could fail. */
function replyPlain(interaction, content) {
  return interaction.reply({ content, allowedMentions: { parse: [], repliedUser: false } });
}

function replyError(interaction, lang, key, vars = {}) {
  return interaction.reply({ ...noticePayload(t(lang, key, vars), COLORS.RED), allowedMentions: { parse: [], repliedUser: false } });
}

/** The message the command answers, or null. */
async function repliedMessageOf(message) {
  if (!message?.reference?.messageId) return null;
  return message.fetchReference().catch(() => null);
}

/** Runs one image command: the member-facing errors become short answers, anything else is logged. */
async function guarded(interaction, lang, label, work) {
  try {
    await work();
  } catch (err) {
    if (err instanceof ImageInputError) {
      await replyError(interaction, lang, err.key, err.vars);
      return;
    }
    logger.warn(`Could not make the ${label} image: ${err.message}`);
    await replyError(interaction, lang, 'images.error.render');
  }
}

/** The picture the command works on: `{ image, gif }`, found from the message (see imageInput.findImageSource). */
async function inputImage(interaction, source) {
  const message = interaction.rawMessage;
  if (!message) throw new ImageInputError('images.error.noSource', { input: source ?? '' });
  const replied = await repliedMessageOf(message);
  const found = await findImageSource({ message, replied, text: source ?? '' });
  return loadInputImage(found.url);
}

/** `!image <effect>`: the effect applied to the picture, sent back as a file. */
async function runEffect(interaction, lang, effect, { amount = null, source = null } = {}) {
  const problem = attachFilesProblem(interaction, lang);
  if (problem) { await replyPlain(interaction, problem); return; }
  await guarded(interaction, lang, effect, async () => {
    const { image, gif } = await inputImage(interaction, source);
    const result = await withRenderSlot(() => applyEffect(effect, image, amount));
    const file = new AttachmentBuilder(result.buffer, { name: `${effect}.${result.format === 'jpeg' ? 'jpg' : 'png'}` });
    await interaction.reply({ content: gif ? t(lang, 'images.gifFirstFrame') : undefined, files: [file], allowedMentions: { parse: [], repliedUser: false } });
  });
}

/** `!hex` with a picture (or `!image hex`): its main color, with a swatch. */
async function runHex(interaction, lang, source = null) {
  const problem = attachFilesProblem(interaction, lang);
  if (problem) { await replyPlain(interaction, problem); return; }
  await guarded(interaction, lang, 'hex', async () => {
    const { image, gif } = await inputImage(interaction, source);
    const { color, buffer } = await withRenderSlot(async () => {
      const found = mainColor(image);
      return { color: found, buffer: await renderSwatch(image, found) };
    });
    const rgb = [(color >> 16) & 255, (color >> 8) & 255, color & 255].join(', ');
    const content = [t(lang, 'images.hex.done', { hex: hexOf(color), rgb }), gif ? t(lang, 'images.gifFirstFrame') : null].filter(Boolean).join('\n');
    await interaction.reply({ content, files: [new AttachmentBuilder(buffer, { name: 'color.png' })], allowedMentions: { parse: [], repliedUser: false } });
  });
}

module.exports = { RENDER, withRenderSlot, attachFilesProblem, replyPlain, replyError, repliedMessageOf, guarded, runEffect, runHex };
