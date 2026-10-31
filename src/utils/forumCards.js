// Forum support: the messages. The panel with the button, the cards inside a post (who opened it, the guidelines, the description, who claims
// it), the small green card that answers every tool (`!tl` says "Successfully locked"), the card of a message moved to the forum and the
// summary of a setup. Components V2 like the rest of Petto; nothing here talks to Discord.
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, MessageFlags } = require('discord.js');
const { EMOJI } = require('./emojis');
const { textCard } = require('./caseCard');
const { addBlocks } = require('./cardBlocks');
const { buildPanelFallbackCard } = require('./ticketCards');
const { solvedTagOf } = require('./forumConfig');
const { t, tn, currentLanguage } = require('../i18n');

const BUTTON_STYLE = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
const GREEN = 0xa5ea7a;
const OPEN_PREFIX = 'forum:open:';

// What a message with these options says to Discord: mentions in a card never notify, unless the caller asks (the staff roles of a new post).
const QUIET = { parse: [], repliedUser: false };
const v2 = (container, extra = {}) => ({ components: [container, ...(extra.rows ?? [])], flags: MessageFlags.IsComponentsV2, allowedMentions: extra.allowedMentions ?? QUIET });

const isEmoji = (text) => /^<a?:\w{2,32}:\d{15,25}>$/.test(text) || /^\p{Extended_Pictographic}/u.test(text);

/** The text of the panel when the server wrote none: where to open a post, what the form asks, and a word on pictures. */
function defaultPanelText(setup, forum, lang = currentLanguage()) {
  const hasTags = (forum?.availableTags ?? []).some((tag) => !tag.moderated);
  return [
    t(lang, 'forums.panel.intro', { forum: `<#${setup.forum_channel_id}>` }),
    '',
    t(lang, 'forums.panel.form'),
    hasTags ? t(lang, 'forums.panel.tags') : null,
    t(lang, setup.ask_images ? 'forums.panel.imagesIn' : 'forums.panel.imagesOut'),
  ].filter((line) => line !== null).join('\n');
}

/** The button that opens the form. `disabled` while the setup is turned off. */
function openButton(setup, { lang = currentLanguage(), disabled = false } = {}) {
  const button = new ButtonBuilder()
    .setCustomId(`${OPEN_PREFIX}${setup.id}`)
    .setLabel(String(setup.button_label || t(lang, 'forums.panel.button')).slice(0, 80))
    .setStyle(BUTTON_STYLE[setup.button_style] ?? ButtonStyle.Success)
    .setDisabled(Boolean(disabled));
  const emoji = setup.button_emoji || '➕';
  if (isEmoji(emoji)) { try { button.setEmoji(emoji); } catch { /* an emoji Discord cannot read: the button goes without one */ } }
  return new ActionRowBuilder().addComponents(button);
}

/**
 * The panel (the message with the button) as the payload to send or edit. `design` is a saved design already built (`templatePayload`) or
 * null: the usual card is made from the texts of the setup. The row with the button goes under the design.
 */
function buildPanel(setup, { forum = null, lang = currentLanguage(), design = null } = {}) {
  const row = openButton(setup, { lang, disabled: !setup.enabled });
  if (design) {
    const isV2 = Boolean(design.flags && (design.flags & MessageFlags.IsComponentsV2));
    const { reactions, ...rest } = design;
    return { ...rest, components: [...(design.components ?? []), row], ...(isV2 ? { flags: design.flags } : {}), allowedMentions: QUIET };
  }
  const card = buildPanelFallbackCard({
    title: setup.panel_title || t(lang, 'forums.panel.title'),
    description: setup.panel_description || defaultPanelText(setup, forum, lang),
    color: Number.isInteger(setup.panel_color) ? setup.panel_color : GREEN,
    imageUrl: setup.panel_image,
    footer: setup.panel_footer || (setup.enabled ? null : t(lang, 'forums.panel.off')),
    lang,
  });
  return { components: [card, row], flags: MessageFlags.IsComponentsV2, allowedMentions: QUIET };
}

// ── inside a post ──────────────────────────────────────────────────────────────────────────────────────────────────────

/** The card with the roles to ping and the guidelines, under the first message of a post. Null when there is nothing to say. */
function buildInfoCard({ pingText = '', guidelines = '' } = {}, { lang = currentLanguage() } = {}) {
  if (!pingText && !guidelines) return null;
  const container = new ContainerBuilder().setAccentColor(GREEN);
  if (pingText) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(pingText));
  if (guidelines) addBlocks(container, `### ${t(lang, 'forums.post.guidelinesTitle')}\n${guidelines}`);
  return v2(container, { allowedMentions: undefined });
}

/** The description of a post as a card (the "card" style of the first message: the first message itself is only the line that says who opened it). */
function buildDescriptionCard(text) {
  return v2(addBlocks(new ContainerBuilder().setAccentColor(GREEN), text));
}

/** What a member is asked in a post that was started without the panel and has no tag: choose one before the time is up. */
function buildTagAsk({ author, minutes, lang = currentLanguage() }) {
  return v2(new ContainerBuilder().setAccentColor(0xfed53c).addTextDisplayComponents(new TextDisplayBuilder().setContent(`${EMOJI.WARNING} ${tn(lang, 'forums.tagAsk', minutes, { user: `<@${author}>`, minutes })}`)), { allowedMentions: { parse: [], users: [author], repliedUser: false } });
}

// ── the answers of the tools ───────────────────────────────────────────────────────────────────────────────────────────

const TOOL_EMOJI = { moved: EMOJI.APPROVE, locked: EMOJI.APPROVE, unlocked: EMOJI.APPROVE, closed: EMOJI.APPROVE, reopened: EMOJI.APPROVE, solved: EMOJI.APPROVE, unsolved: EMOJI.APPROVE, renamed: EMOJI.APPROVE, tagAdded: EMOJI.APPROVE, tagRemoved: EMOJI.APPROVE, claimed: EMOJI.APPROVE, unclaimed: EMOJI.APPROVE };

/**
 * The small green card that answers a tool: `<@who>: Successfully locked <#post>`. Every kind has its own sentence in the catalog
 * (`forums.done.<kind>`); `extra` is what the sentence needs (the new title, the tag...). A reason goes on a line of its own, small.
 */
function buildDone(kind, { actor, thread, reason = null, note = null, extra = {}, lang = currentLanguage() }) {
  const text = t(lang, `forums.done.${kind}`, { emoji: TOOL_EMOJI[kind] ?? EMOJI.APPROVE, user: `<@${actor}>`, post: `<#${thread}>`, ...extra });
  return v2(textCard(`${text}${reason ? `\n-# ${t(lang, 'forums.done.reason', { reason: String(reason).slice(0, 300) })}` : ''}${note ? `\n-# ${note}` : ''}`, GREEN));
}

/** The card of a post closed, locked or solved by itself (a job, the author...): the same card, with the sentence of the cause. */
function buildNotice(key, vars = {}, { lang = currentLanguage() } = {}) {
  return v2(textCard(`${EMOJI.APPROVE} ${t(lang, `forums.notice.${key}`, vars)}`, GREEN));
}

/** An error or a refusal shown in a card (the usual warning). */
function buildProblem(text) {
  return v2(textCard(`${EMOJI.WARNING} ${text}`));
}

/** The notice in a post when a staff member claims it. */
function buildClaim({ staff, lang = currentLanguage() }) {
  return v2(new ContainerBuilder().setAccentColor(GREEN).addTextDisplayComponents(new TextDisplayBuilder().setContent(`${EMOJI.TICKET_CLAIM} ${t(lang, 'forums.claim.card', { user: `<@${staff}>` })}`)));
}

/** The card of a message that was moved into the forum: who wrote it, what it said, who moved it, and a word on where to ask next time. */
function buildOriginal({ author, channelId, content, staff, forumId, lang = currentLanguage() }) {
  const container = new ContainerBuilder().setAccentColor(GREEN);
  const quoted = String(content || t(lang, 'forums.move.noText')).slice(0, 2500).split('\n').map((line) => `> ${line}`).join('\n');
  addBlocks(container, [
    `### ${t(lang, 'forums.move.title')}`,
    t(lang, 'forums.move.from', { user: `<@${author}>`, channel: `<#${channelId}>` }),
    quoted,
  ].join('\n'));
  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${t(lang, 'forums.move.more')}\n-# ${t(lang, 'forums.move.created', { staff: `<@${staff}>`, forum: `<#${forumId}>` })}`));
  return v2(container, { allowedMentions: { parse: [], users: [author], repliedUser: false } });
}

// ── lists and summaries ────────────────────────────────────────────────────────────────────────────────────────────────

const unix = (value) => Math.floor(new Date(value).getTime() / 1000);

/** One post of `!forum list`: its link, who opened it, the state, who claims it and when it was opened. */
function postLine(post, lang = currentLanguage()) {
  const parts = [`<#${post.thread_id}>`, `<@${post.author_id}>`, t(lang, `forums.status.${post.status}`)];
  if (post.claimed_by) parts.push(t(lang, 'forums.list.claimedBy', { user: `<@${post.claimed_by}>` }));
  parts.push(`<t:${unix(post.opened_at)}:R>`);
  return `- ${parts.join(' · ')}`;
}

const onOff = (value, lang) => t(lang, value ? 'config.card.on' : 'config.card.off');
const roles = (list, lang) => (list?.length ? `${list.slice(0, 8).map((id) => `<@&${id}>`).join(' ')}${list.length > 8 ? ` +${list.length - 8}` : ''}` : t(lang, 'config.card.none'));

/** The summary of a setup for `!forum status`: where it is, who may do what, the limits, the automation and what the bot is missing. */
function buildStatus(setup, { forum = null, missing = [], optionalMissing = [], lang = currentLanguage(), panelUrl = null, prefix = '!' } = {}) {
  const tag = solvedTagOf(forum, setup);
  const lines = [
    `### ${EMOJI.TICKET} ${t(lang, 'forums.status.title', { name: setup.name })}`,
    `${t(lang, 'forums.status.forum')}: <#${setup.forum_channel_id}> · ${onOff(setup.enabled, lang)}`,
    `${t(lang, 'forums.status.panel')}: ${setup.panel_message_id && panelUrl ? `[${t(lang, 'forums.status.panelLink')}](${panelUrl})` : t(lang, 'forums.status.noPanel', { prefix, name: setup.name })}`,
    '',
    `**${t(lang, 'forums.status.who')}**`,
    `- ${t(lang, 'forums.status.staff')}: ${roles(setup.staff_role_ids, lang)}`,
    `- ${t(lang, 'forums.status.required')}: ${roles(setup.required_role_ids, lang)}`,
    `- ${t(lang, 'forums.status.blocked')}: ${roles(setup.blocked_role_ids, lang)}${setup.blocked_user_ids?.length ? ` +${setup.blocked_user_ids.length}` : ''}`,
    `- ${t(lang, 'forums.status.limits')}: ${setup.max_open_per_user ? tn(lang, 'forums.status.maxOpen', setup.max_open_per_user, { count: setup.max_open_per_user }) : t(lang, 'forums.status.noLimit')} · ${t(lang, 'forums.status.cooldown', { seconds: setup.cooldown_seconds })}`,
    `- ${t(lang, 'forums.status.author')}: ${[setup.author_can_close && t(lang, 'forums.status.close'), setup.author_can_solve && t(lang, 'forums.status.solve'), setup.author_can_rename && t(lang, 'forums.status.rename')].filter(Boolean).join(', ') || t(lang, 'config.card.none')}`,
    '',
    `**${t(lang, 'forums.status.post')}**`,
    `- ${t(lang, 'forums.status.tags')}: ${setup.require_tag ? t(lang, 'forums.status.tagRequired') : t(lang, 'forums.status.tagOptional')} · ${t(lang, 'forums.status.solvedTag')}: ${tag ? tag.name : t(lang, 'forums.status.noSolvedTag')}`,
    `- ${t(lang, 'forums.status.pings')}: ${roles(setup.ping_role_ids, lang)} · ${t(lang, 'forums.status.images')}: ${onOff(setup.ask_images, lang)}`,
    '',
    `**${t(lang, 'forums.status.automation')}**`,
    `- ${t(lang, 'forums.status.inactive')}: ${setup.inactive_days ? t(lang, 'forums.status.inactiveOn', { days: setup.inactive_days, action: t(lang, `forums.action.${setup.inactive_action}`) }) : t(lang, 'config.card.off')}`,
    `- ${t(lang, 'forums.status.solvedAuto')}: ${setup.solved_action === 'none' ? t(lang, 'config.card.off') : t(lang, 'forums.status.solvedOn', { hours: setup.solved_delay_hours, action: t(lang, `forums.action.${setup.solved_action}`) })}`,
    `- ${t(lang, 'forums.status.adopt')}: ${onOff(setup.adopt, lang)}`,
    `- ${t(lang, 'forums.status.logs')}: ${(setup.log_events ?? []).map((name) => t(lang, `forums.logEvent.${name}`)).join(', ') || t(lang, 'config.card.none')}`,
  ];
  if (missing.length) lines.push('', `${EMOJI.WARNING} ${t(lang, 'forums.status.missing', { permissions: missing.join(', ') })}`);
  if (optionalMissing.length) lines.push(`-# ${t(lang, 'forums.status.optionalMissing', { permissions: optionalMissing.join(', ') })}`);
  return v2(addBlocks(new ContainerBuilder().setAccentColor(missing.length ? 0xfed53c : GREEN), lines.join('\n')));
}

module.exports = {
  GREEN, OPEN_PREFIX, QUIET, isEmoji, defaultPanelText, openButton, buildPanel, buildInfoCard, buildDescriptionCard, buildTagAsk, buildDone, buildNotice, buildProblem, buildClaim, buildOriginal, postLine, buildStatus,
};
