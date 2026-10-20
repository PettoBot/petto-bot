// The buttons and the jump menu of paginated messages (`!pagination`), and the confirmation of `!pagination reset`.
// Anyone can turn the pages. A shared message changes for everyone; a private one answers the member who clicked with their own copy
// (only they see it), whose buttons then turn that copy in place. Nothing is kept in memory: the record is read on each click.
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const db = require('../db/paginations');
const { getTemplate } = require('../db/embedTemplates');
const { parseCustomId, renderPage, PREFIX } = require('../utils/pagination');
const { ownerMember, pageContext, stripButtons } = require('../utils/paginationActions');
const { textCard } = require('../utils/caseCard');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

const RED = 0xfe6465;
const GREEN = 0xa5ea7a;
// A page usually draws at once; one with an image card can take longer than the 3 seconds Discord waits, so the answer is deferred then.
const QUICK_MS = 2000;

const ephemeralText = (interaction, text) => interaction.reply({ content: text, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });

/** Runs `work`; when it is not done in a moment, `defer` is called first so Discord keeps waiting. Answers whether it deferred. */
async function quickOrDefer(work, defer) {
  const LATE = Symbol('late');
  let timer;
  const late = new Promise((resolve) => { timer = setTimeout(() => resolve(LATE), QUICK_MS); });
  const first = await Promise.race([work, late]);
  clearTimeout(timer);
  if (first !== LATE) return { deferred: false, result: first };
  await defer();
  return { deferred: true, result: await work };
}

async function handleReset(interaction, parsed, lang) {
  if (interaction.user.id !== parsed.userId) {
    await ephemeralText(interaction, t(lang, 'pagination.reset.notYours', { user: `<@${parsed.userId}>` }));
    return;
  }
  if (parsed.answer === 'no') {
    await interaction.update({ components: [textCard(t(lang, 'pagination.reset.cancelled'))], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.Administrator)) {
    await ephemeralText(interaction, t(lang, 'pagination.reset.adminOnly'));
    return;
  }
  await interaction.deferUpdate();
  const removed = await db.deleteAll(interaction.guildId);
  // The buttons come off the messages one after the other (a few at most per server), so Discord's limits are respected.
  for (const record of removed) await stripButtons(interaction.client, record).catch(() => false);
  await interaction.editReply({ components: [textCard(t(lang, 'pagination.reset.done', { count: removed.length }), GREEN)], flags: MessageFlags.IsComponentsV2 });
}

async function handleInteraction(interaction) {
  const parsed = parseCustomId(interaction.customId);
  const lang = await languageOf(interaction);
  if (!parsed || !interaction.guild) {
    await ephemeralText(interaction, t(lang, 'pagination.click.gone'));
    return;
  }
  if (parsed.action === 'reset') return handleReset(interaction, parsed, lang);
  if (parsed.action === 'label') { await interaction.deferUpdate().catch(() => {}); return; }

  const record = await db.getPagination(parsed.id);
  if (!record || record.guild_id !== interaction.guildId || !record.pages.length) {
    await ephemeralText(interaction, t(lang, 'pagination.click.gone'));
    return;
  }
  const wanted = parsed.action === 'jump' ? Number(interaction.values?.[0]) : parsed.page;
  const inOwnCopy = Boolean(interaction.message?.flags?.has?.(MessageFlags.Ephemeral));
  const privateCopy = !inOwnCopy && record.private;
  // Someone's own copy is filled for them; the shared message for who made it, so it does not change with each click.
  const member = inOwnCopy || privateCopy ? interaction.member : await ownerMember(interaction.guild, record, interaction.member);
  const ctx = pageContext(interaction.guild, interaction.channel, member, lang);
  const work = renderPage(record, wanted, ctx, { getTemplate, navLang: lang });

  if (privateCopy) {
    const { deferred, result } = await quickOrDefer(work, () => interaction.deferReply({ flags: MessageFlags.Ephemeral }));
    if (result.error) {
      const text = { content: t(lang, `pagination.error.${result.error}`, result.vars ?? {}), allowedMentions: { parse: [] } };
      await (deferred ? interaction.editReply(text) : interaction.reply({ ...text, flags: MessageFlags.Ephemeral }));
      return;
    }
    const { attachments, ...payload } = result.payload;
    if (deferred) await interaction.editReply(payload);
    else await interaction.reply({ ...payload, flags: (payload.flags ?? 0) | MessageFlags.Ephemeral });
    return;
  }

  const { deferred, result } = await quickOrDefer(work, () => interaction.deferUpdate());
  if (result.error) {
    const text = { content: t(lang, `pagination.error.${result.error}`, result.vars ?? {}), flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
    await (deferred ? interaction.followUp(text) : interaction.reply(text)).catch(() => {});
    return;
  }
  if (deferred) await interaction.editReply(result.payload);
  else await interaction.update(result.payload);
}

async function handlePaginationInteraction(interaction) {
  try {
    await handleInteraction(interaction);
  } catch (err) {
    logger.error('Error handling a paginated message:', err);
    const lang = await languageOf(interaction).catch(() => 'en');
    const text = { content: t(lang, 'pagination.click.failed'), flags: MessageFlags.Ephemeral };
    if (interaction.deferred || interaction.replied) await interaction.followUp(text).catch(() => {});
    else await interaction.reply(text).catch(() => {});
  }
}

module.exports = { PREFIX, handlePaginationInteraction, RED };
