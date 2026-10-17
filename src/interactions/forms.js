// Forms (applications) in Discord: the buttons and the menu of a panel open a form, its pages are Discord forms of five questions
// with "Next" between them, and the buttons of a review card accept, deny or open a thread.
//   fm:o:<form>          open a form (panel button)        fm:s:<panel>        open a form (panel menu)
//   fm:n:<form>:<page>   show a page (next / fix answers)  fm:x:<form>         stop filling it in
//   fm:p:<form>:<page>   a page was sent (modal)
//   fm:a:<n> / fm:d:<n>  accept / deny submission n        fm:ra:<n> / fm:rd:<n> the reason form of those (modal)
//   fm:t:<n>             open a thread under the card of submission n
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const formsDb = require('../db/forms');
const forms = require('../utils/forms');
const actions = require('../utils/formActions');
const { textCard } = require('../utils/caseCard');
const logger = require('../utils/logger');
const { t, languageOf } = require('../i18n');

const { PREFIX } = forms;
const EPHEMERAL_V2 = MessageFlags.IsComponentsV2 | MessageFlags.Ephemeral;
const RED = 0xf23f43;
const GREEN = 0x23a55a;

// `card` is for edits and updates (an edit cannot change whether a message is ephemeral); `reply` adds it for new answers.
const card = (text, color, rows = []) => ({ components: [textCard(text, color), ...rows], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
const fresh = (payload) => ({ ...payload, flags: EPHEMERAL_V2 });
const say = (interaction, text, color = 0x4b4f59, rows = []) => (interaction.deferred || interaction.replied ? interaction.editReply(card(text, color, rows)) : interaction.reply(fresh(card(text, color, rows))));

/** The member presses the button (or picks the form in the menu) of a panel: the rules are checked, then the first page opens. */
async function openForm(interaction, formId, lang) {
  const form = /^\d{1,15}$/.test(String(formId)) ? await formsDb.getForm(interaction.guild.id, formId) : null;
  if (!form) return say(interaction, t(lang, 'forms.gone'), RED);
  const member = interaction.member;
  const [stats, total] = await Promise.all([formsDb.memberStats(interaction.guild.id, form.id, member.id), form.max_total > 0 ? formsDb.countFormSubmissions(interaction.guild.id, form.id) : 0]);
  const refusal = forms.checkEligibility(form, member, stats, { total });
  if (refusal) return say(interaction, forms.refusalText(refusal, lang), RED);
  if (!form.review_channel_id) return say(interaction, t(lang, 'forms.refuse.noChannel'), RED);
  const draft = forms.getDraft(interaction.guild.id, member.id, form.id);
  return interaction.showModal(forms.buildModal(form, 0, { values: draft?.values ?? {}, lang }));
}

/** "Next" (or "Fix my answers"): the page opens again with what was already written. */
async function showPage(interaction, formId, page, lang) {
  const form = await formsDb.getForm(interaction.guild.id, formId);
  if (!form || form.status !== 'open') return say(interaction, t(lang, form ? 'forms.refuse.closed' : 'forms.gone'), RED);
  const draft = forms.getDraft(interaction.guild.id, interaction.user.id, form.id);
  if (!draft && page > 0) return interaction.update(card(t(lang, 'forms.expired'), RED));
  if (page >= forms.pagesOf(form).length) return interaction.update(card(t(lang, 'forms.changed'), RED));
  return interaction.showModal(forms.buildModal(form, page, { values: draft?.values ?? {}, lang }));
}

const pageButtons = (formId, page, lang, { fix = false } = {}) => new ActionRowBuilder().addComponents(
  new ButtonBuilder().setCustomId(`${PREFIX}n:${formId}:${page}`).setLabel(t(lang, fix ? 'forms.fix.button' : 'forms.next.button')).setStyle(ButtonStyle.Primary),
  new ButtonBuilder().setCustomId(`${PREFIX}x:${formId}`).setLabel(t(lang, 'forms.stop.button')).setStyle(ButtonStyle.Secondary),
);

/** Answers to a page of a form arrive. A page with a problem is offered again; the last page sends the whole form. */
async function pageSent(interaction, formId, page, lang) {
  // A page opened from "Next" updates that step message; the first page was opened from the panel, which must stay as it is.
  const fromStep = Boolean(interaction.isFromMessage?.() && interaction.message?.flags?.has?.(MessageFlags.Ephemeral));
  const answer = (payload) => (fromStep ? interaction.update(payload) : interaction.reply(fresh(payload)));
  const form = await formsDb.getForm(interaction.guild.id, formId);
  if (!form) return answer(card(t(lang, 'forms.gone'), RED));
  const pages = forms.pagesOf(form);
  if (page >= pages.length) return answer(card(t(lang, 'forms.changed'), RED));
  const { values, errors } = forms.readPage(form, page, interaction.fields);
  const draft = forms.saveDraft(interaction.guild.id, interaction.user.id, form.id, values);
  if (errors.length) {
    const lines = errors.map((e) => `• **${e.label}**: ${t(lang, `forms.error.${e.code}`, e.vars)}`);
    return answer(card([t(lang, 'forms.fix.title'), ...lines].join('\n'), RED, [pageButtons(form.id, page, lang, { fix: true })]));
  }
  if (page < pages.length - 1) {
    return answer(card(t(lang, 'forms.pageDone', { page: page + 1, count: pages.length, form: form.title }), forms.COLORS.pending, [pageButtons(form.id, page + 1, lang)]));
  }
  if (fromStep) await interaction.deferUpdate(); else await interaction.deferReply({ flags: EPHEMERAL_V2 });
  const result = await actions.submitForm({ client: interaction.client, guild: interaction.guild, form, member: interaction.member, answers: forms.collectAnswers(form, draft.values) });
  if (!result.ok) {
    if (result.error === 'refused') { forms.dropDraft(interaction.guild.id, interaction.user.id, form.id); return interaction.editReply(card(forms.refusalText(result.refusal, lang), RED)); }
    return interaction.editReply(card(t(lang, `forms.submitError.${result.error === 'missing' ? 'missing' : result.error === 'no_channel' ? 'noChannel' : result.error === 'full' ? 'full' : 'failed'}`), RED, result.error === 'missing' ? [pageButtons(form.id, 0, lang, { fix: true })] : []));
  }
  forms.dropDraft(interaction.guild.id, interaction.user.id, form.id);
  return interaction.editReply(card(await actions.submittedText(interaction.guild, form, result.submission, interaction.member, lang), GREEN));
}

async function reviewerFor(interaction, number, lang) {
  const submission = await formsDb.getSubmission(interaction.guild.id, number);
  if (!submission) { await say(interaction, t(lang, 'forms.review.gone'), RED); return null; }
  const form = submission.form_id ? await formsDb.getForm(interaction.guild.id, submission.form_id).catch(() => null) : null;
  if (!forms.isReviewer(interaction.member, form)) { await say(interaction, t(lang, 'forms.review.notReviewer'), RED); return null; }
  return { submission, form };
}

/** Accept or Deny on a card: a small form asks for the reason (optional). */
async function askReason(interaction, action, number, lang) {
  const found = await reviewerFor(interaction, number, lang);
  if (!found) return undefined;
  if (found.submission.status !== 'pending') return say(interaction, t(lang, 'forms.review.already'), RED);
  const input = new TextInputBuilder().setCustomId('reason').setLabel(t(lang, 'forms.review.reason')).setPlaceholder(t(lang, 'forms.review.reasonHint'))
    .setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(forms.LIMITS.reason);
  const title = t(lang, action === 'a' ? 'forms.review.acceptTitle' : 'forms.review.denyTitle', { number });
  return interaction.showModal(new ModalBuilder().setCustomId(`${PREFIX}r${action}:${number}`).setTitle(forms.clip(title, 45)).addComponents(new ActionRowBuilder().addComponents(input)));
}

/** The words a reviewer reads after a review (here and in `!form accept|deny`). */
function reviewSummary(result, lang) {
  const status = result.submission.status;
  const lines = [t(lang, `forms.review.done.${status}`, { number: result.submission.number, user: `<@${result.submission.user_id}>` })];
  const { added = [], removed = [], failed = [], left = false } = result.roles ?? {};
  if (added.length || removed.length) lines.push(t(lang, 'forms.card.roles', { roles: [...added.map((id) => `+<@&${id}>`), ...removed.map((id) => `−<@&${id}>`)].join(' ') }));
  if (failed.length) lines.push(t(lang, 'forms.card.rolesFailed', { roles: failed.map((id) => `<@&${id}>`).join(' ') }));
  if (left) lines.push(t(lang, 'forms.card.left'));
  if (result.dm === false) lines.push(t(lang, 'forms.card.noDm'));
  return lines.join('\n');
}

async function reviewSent(interaction, action, number, lang) {
  await interaction.deferReply({ flags: EPHEMERAL_V2 });
  const found = await reviewerFor(interaction, number, lang);
  if (!found) return undefined;
  let reason = '';
  try { reason = interaction.fields.getTextInputValue('reason') ?? ''; } catch { reason = ''; }
  const result = await actions.reviewSubmission({
    client: interaction.client, guild: interaction.guild, submission: found.submission, status: action === 'a' ? 'accepted' : 'denied',
    reviewer: { id: interaction.user.id, name: interaction.member?.displayName ?? interaction.user.username }, reason,
  });
  if (!result.ok) return interaction.editReply(card(t(lang, 'forms.review.already'), RED));
  return interaction.editReply(card(reviewSummary(result, lang), result.submission.status === 'accepted' ? GREEN : RED));
}

async function threadPressed(interaction, number, lang) {
  await interaction.deferReply({ flags: EPHEMERAL_V2 });
  const found = await reviewerFor(interaction, number, lang);
  if (!found) return undefined;
  const result = await actions.openThread(interaction.guild, found.submission);
  if (!result.ok) return interaction.editReply(card(t(lang, 'forms.thread.failed'), RED));
  return interaction.editReply(card(t(lang, result.existed ? 'forms.thread.exists' : 'forms.thread.opened', { thread: `<#${result.thread.id}>` }), GREEN));
}

async function handle(interaction) {
  if (!interaction.guild) return undefined;
  const lang = await languageOf(interaction);
  const [, action, first, second] = interaction.customId.split(':');
  const number = Number(first);
  if (interaction.isModalSubmit()) {
    if (action === 'p') return pageSent(interaction, first, Number(second) || 0, lang);
    if (action === 'ra' || action === 'rd') return reviewSent(interaction, action.slice(1), number, lang);
    return undefined;
  }
  if (interaction.isStringSelectMenu() && action === 's') return openForm(interaction, interaction.values?.[0], lang);
  if (!interaction.isButton()) return undefined;
  if (action === 'o') return openForm(interaction, first, lang);
  if (action === 'n') return showPage(interaction, first, Number(second) || 0, lang);
  if (action === 'x') {
    forms.dropDraft(interaction.guild.id, interaction.user.id, first);
    return interaction.update(card(t(lang, 'forms.stopped'), 0x4b4f59));
  }
  if (action === 'a' || action === 'd') return askReason(interaction, action, number, lang);
  if (action === 't') return threadPressed(interaction, number, lang);
  return undefined;
}

/** Never throws: a form that fails tells the member, and the error goes to the log of the host. */
async function handleFormInteraction(interaction) {
  try {
    await handle(interaction);
  } catch (err) {
    logger.error('Forms interaction failed:', err);
    const lang = await languageOf(interaction).catch(() => 'en');
    const payload = card(t(lang, 'forms.error.generic'), RED);
    if (interaction.deferred || interaction.replied) await interaction.editReply(payload).catch(() => {});
    else await interaction.reply(fresh(payload)).catch(() => {});
  }
}

module.exports = { PREFIX, handleFormInteraction, reviewSummary };
