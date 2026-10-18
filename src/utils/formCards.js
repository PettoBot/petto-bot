// Forms (applications): the card the staff reads for each submission, and the panel with the buttons (or the menu) that open forms.
const {
  ActionRowBuilder, ButtonBuilder, ButtonStyle, ContainerBuilder, FileBuilder, MessageFlags, SectionBuilder, SeparatorBuilder,
  SeparatorSpacingSize, StringSelectMenuBuilder, TextDisplayBuilder, ThumbnailBuilder,
} = require('discord.js');
const { PREFIX, COLORS, clip, answerText, webUrl } = require('./forms');
const { t, currentLanguage } = require('../i18n');

// A Components V2 message holds 4000 characters of text: the answers get what the header, the verdict and the buttons leave.
const ANSWER_BUDGET = 3200;
const MIN_SHARE = 60;
const BUTTON_STYLES = { primary: ButtonStyle.Primary, secondary: ButtonStyle.Secondary, success: ButtonStyle.Success, danger: ButtonStyle.Danger };
const unix = (value) => Math.floor(new Date(value).getTime() / 1000);
const quote = (text) => text.split('\n').map((line) => `> ${line}`).join('\n');
const dashboardUrl = (guildId) => `https://petto.sbs/dash/guild/${guildId}/forms?section=submissions`;

/**
 * The answers as blocks for the card. When they do not all fit, each one is cut to a fair share (and the last ones left out if even
 * that is too much); `cut` then says the full text has to go with the card as a file.
 */
function answerBlocks(answers, lang = currentLanguage(), budget = ANSWER_BUDGET) {
  const none = `*${t(lang, 'forms.answer.none')}*`;
  const items = (answers ?? []).map((a) => ({ label: `**${clip(a.label, 60)}**`, text: answerText(a, lang) || none }));
  const size = (item, text) => item.label.length + 1 + quote(text).length + 2;
  const full = items.reduce((sum, item) => sum + size(item, item.text), 0);
  if (full <= budget) return { blocks: items.map((item) => `${item.label}\n${quote(item.text)}`), cut: false };
  const fixed = items.reduce((sum, item) => sum + item.label.length + 6, 0);
  const share = Math.max(MIN_SHARE, Math.floor((budget - fixed) / Math.max(1, items.length)));
  const blocks = [];
  let used = 0;
  for (const item of items) {
    const text = item.text.length > share ? `${item.text.slice(0, share - 1).trimEnd()}…` : item.text;
    const block = `${item.label}\n${quote(text)}`;
    if (used + block.length + 2 > budget) break;
    used += block.length + 2;
    blocks.push(block);
  }
  return { blocks, cut: true, hidden: items.length - blocks.length };
}

/** The verdict line of a submission that was answered (or why it is closed). */
function verdictText(submission, lang = currentLanguage()) {
  const status = submission.status ?? 'pending';
  if (status === 'pending') return t(lang, 'forms.card.waiting');
  if (status === 'cancelled') return t(lang, 'forms.card.cancelled');
  const lines = [t(lang, `forms.card.${status}`, { reviewer: submission.reviewer_id ? `<@${submission.reviewer_id}>` : clip(submission.reviewer_name, 40), time: `<t:${unix(submission.reviewed_at ?? Date.now())}:R>` })];
  if (submission.reason) lines.push(quote(clip(submission.reason, 400)));
  const changes = submission.role_changes ?? {};
  const roles = [...(changes.added ?? []).map((id) => `+<@&${id}>`), ...(changes.removed ?? []).map((id) => `−<@&${id}>`)];
  if (roles.length) lines.push(t(lang, 'forms.card.roles', { roles: roles.join(' ') }));
  if ((changes.failed ?? []).length) lines.push(t(lang, 'forms.card.rolesFailed', { roles: changes.failed.map((id) => `<@&${id}>`).join(' ') }));
  if (changes.left) lines.push(t(lang, 'forms.card.left'));
  if (submission.dm_sent === false) lines.push(t(lang, 'forms.card.noDm'));
  return lines.join('\n');
}

/**
 * The card of a submission in the review channel, in Components V2. Returns `{ container, file }`: `file` ({ name, text }) is the whole
 * submission as text when the answers did not fit, sent with the card the first time (the card points at it after that).
 * `member` (when known) adds when the account was made and when they joined.
 */
function reviewCard({ submission, form = null, lang = currentLanguage(), pings = [], member = null, fileName = null }) {
  const status = submission.status ?? 'pending';
  const container = new ContainerBuilder().setAccentColor(status === 'pending' ? (form?.color ?? COLORS.pending) : COLORS[status] ?? COLORS.pending);
  const facts = [];
  const created = member?.user?.createdTimestamp;
  if (created) facts.push(t(lang, 'forms.card.created', { time: `<t:${Math.floor(created / 1000)}:R>` }));
  if (member?.joinedTimestamp) facts.push(t(lang, 'forms.card.joined', { time: `<t:${Math.floor(member.joinedTimestamp / 1000)}:R>` }));
  if (submission.source === 'web') facts.push(t(lang, 'forms.card.web'));
  const head = [
    ...(pings.length ? [pings.map((id) => `<@&${id}>`).join(' ')] : []),
    `## ${t(lang, 'forms.card.title', { form: clip(submission.form_title || form?.title || submission.form_name, 60), number: submission.number })}`,
    `<@${submission.user_id}> · \`${clip(submission.username, 40)}\` · \`${submission.user_id}\``,
    ...(facts.length ? [`-# ${facts.join(' · ')}`] : []),
  ].join('\n');
  const header = new TextDisplayBuilder().setContent(head);
  const avatar = /^https:\/\//i.test(String(submission.avatar_url ?? '')) ? submission.avatar_url : null;
  if (avatar) container.addSectionComponents(new SectionBuilder().addTextDisplayComponents(header).setThumbnailAccessory(new ThumbnailBuilder().setURL(avatar)));
  else container.addTextDisplayComponents(header);

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  const { blocks, cut, hidden } = submission.compacted ? { blocks: [`-# ${t(lang, 'forms.card.compacted')}`], cut: false, hidden: 0 } : answerBlocks(submission.answers, lang);
  for (let i = 0; i < blocks.length; i += 5) container.addTextDisplayComponents(new TextDisplayBuilder().setContent(blocks.slice(i, i + 5).join('\n\n')));
  const name = fileName ?? `answers-${submission.number}.txt`;
  if (cut) {
    container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`-# ${t(lang, hidden ? 'forms.card.moreHidden' : 'forms.card.moreCut', { count: hidden })}`));
    container.addFileComponents(new FileBuilder().setURL(`attachment://${name}`));
  }

  container.addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small));
  container.addTextDisplayComponents(new TextDisplayBuilder().setContent(`${verdictText(submission, lang)}\n-# ${t(lang, 'forms.card.footer', { number: submission.number, name: submission.form_name })}`));

  const locked = status !== 'pending';
  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder().setCustomId(`${PREFIX}a:${submission.number}`).setLabel(t(lang, 'forms.card.accept.button')).setStyle(ButtonStyle.Success).setDisabled(locked),
    new ButtonBuilder().setCustomId(`${PREFIX}d:${submission.number}`).setLabel(t(lang, 'forms.card.deny.button')).setStyle(ButtonStyle.Danger).setDisabled(locked),
  );
  if (submission.thread_id) row.addComponents(new ButtonBuilder().setLabel(t(lang, 'forms.card.thread.button')).setStyle(ButtonStyle.Link).setURL(`https://discord.com/channels/${submission.guild_id}/${submission.thread_id}`));
  else row.addComponents(new ButtonBuilder().setCustomId(`${PREFIX}t:${submission.number}`).setLabel(t(lang, 'forms.card.openThread.button')).setStyle(ButtonStyle.Secondary));
  row.addComponents(new ButtonBuilder().setLabel(t(lang, 'forms.card.dashboard.button')).setStyle(ButtonStyle.Link).setURL(dashboardUrl(submission.guild_id)));
  container.addActionRowComponents(row);
  return { container, file: cut ? { name, text: null } : null };
}

/** The buttons (or the menu) that open the forms of a panel. At most 25 forms. */
function panelRows(forms, { style = 'buttons', panelId = 0, lang = currentLanguage(), web = false } = {}) {
  const list = forms.slice(0, 25);
  // "Fill on the web": a link to petto.sbs/<lang>/form/<public id> for each form that allows it (at most five, one row).
  const webForms = web ? list.filter((form) => form.web_enabled !== false).slice(0, 5) : [];
  const webRow = webForms.length ? [new ActionRowBuilder().addComponents(webForms.map((form) => new ButtonBuilder().setStyle(ButtonStyle.Link).setURL(webUrl(form, lang))
    .setLabel(clip(webForms.length === 1 ? t(lang, 'forms.panel.web.button') : t(lang, 'forms.panel.web.buttonFor', { form: form.button_label || form.title }), 80))))] : [];
  if (style === 'select') {
    const menu = new StringSelectMenuBuilder().setCustomId(`${PREFIX}s:${panelId}`).setPlaceholder(t(lang, 'forms.panel.pick.menu')).setMinValues(1).setMaxValues(1)
      .addOptions(list.map((form) => {
        const option = { label: clip(form.button_label || form.title, 100), value: String(form.id) };
        if (form.description) option.description = clip(form.description.replace(/\s+/g, ' '), 100);
        return option;
      }));
    return [new ActionRowBuilder().addComponents(menu), ...webRow];
  }
  const rows = [];
  for (let i = 0; i < list.length; i += 5) {
    rows.push(new ActionRowBuilder().addComponents(list.slice(i, i + 5).map((form) => {
      const button = new ButtonBuilder().setCustomId(`${PREFIX}o:${form.id}`).setLabel(clip(form.button_label || form.title, 80)).setStyle(BUTTON_STYLES[form.button_style] ?? ButtonStyle.Primary);
      if (form.button_emoji) { try { button.setEmoji(form.button_emoji); } catch { /* an emoji Discord does not take is left out */ } }
      return button;
    })));
  }
  return rows.length < 5 ? [...rows, ...webRow] : rows;
}

/** The panel when the server did not pick a saved embed: a card with the title, the text and the buttons. */
function panelCard(forms, { title = null, description = null, color = null, style = 'buttons', panelId = 0, lang = currentLanguage() } = {}) {
  const single = forms.length === 1 ? forms[0] : null;
  const heading = clip(title, 200) || (single ? single.title : t(lang, 'forms.panel.title'));
  let text = clip(description, 2000);
  if (!text) text = single ? (single.description || t(lang, 'forms.panel.single')) : forms.map((form) => `**${form.title}**${form.description ? ` — ${clip(form.description.replace(/\s+/g, ' '), 140)}` : ''}`).join('\n');
  const container = new ContainerBuilder().setAccentColor(color ?? single?.color ?? COLORS.pending)
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`## ${heading}\n${text}`));
  for (const row of panelRows(forms, { style, panelId, lang })) container.addActionRowComponents(row);
  return { components: [container], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } };
}

/** The panel with a saved embed of the server: its message, with the buttons (or the menu) added under it. */
function withPanelRows(payload, forms, options) {
  const rows = panelRows(forms, options);
  const { reactions: _reactions, ...message } = payload;
  const isV2 = Boolean((message.flags ?? 0) & MessageFlags.IsComponentsV2);
  const existing = message.components ?? [];
  const kept = isV2 ? existing : existing.slice(0, Math.max(0, 5 - rows.length));
  return { ...message, components: [...kept, ...rows], allowedMentions: { parse: [] } };
}

module.exports = { reviewCard, answerBlocks, verdictText, panelRows, panelCard, withPanelRows, dashboardUrl, ANSWER_BUDGET };
