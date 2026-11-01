// Guided ticket setup: pick the channel, support roles and log channel with menus, name the ticket types with buttons,
// choose how the panel looks, and publish it all in one go.
const { wrapTicketHandler } = require('../utils/safeTicketAction');
const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ChannelSelectMenuBuilder,
  RoleSelectMenuBuilder,
  ChannelType,
  ContainerBuilder,
  TextDisplayBuilder,
  MessageFlags,
  PermissionFlagsBits,
} = require('discord.js');
const db = require('../db/tickets');
const { guildLimit } = require('../db/premium');
const settingsDb = require('../db/ticketSettings');
const { ensureGuild } = require('../db/guilds');
const { buildPanelRows, buildPanelFallbackCard } = require('../utils/ticketCards');
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');
const { t, tn, formatList, currentLanguage, languageOf } = require('../i18n');

const DRAFT_TTL_MS = 20 * 60_000;
const MAX_TYPES_BUTTON = 5;
const MAX_TYPES_SELECT = 25;
const COLORS = ['primary', 'secondary', 'success', 'danger'];
const COLOR_DOT = { primary: '🔵', secondary: '⚪', success: '🟢', danger: '🔴' };
const CUSTOM_EMOJI = /^<a?:\w{2,32}:\d{15,25}>$/;
const drafts = new Map();

function setDraft(userId, data) {
  clearTimeout(drafts.get(userId)?.timer);
  const timer = setTimeout(() => drafts.delete(userId), DRAFT_TTL_MS);
  timer.unref?.();
  drafts.set(userId, { data, timer });
  return data;
}
const getDraft = (userId) => drafts.get(userId)?.data;
function deleteDraft(userId) {
  clearTimeout(drafts.get(userId)?.timer);
  drafts.delete(userId);
}

/** A new setup, with Petto's example panel written in `lang` (the server changes it before publishing). */
function startDraft(userId, { guildId, channelId, lang = currentLanguage() }) {
  return setDraft(userId, {
    guildId,
    channelId: channelId ?? null,
    supportRoleIds: [],
    logChannelId: null,
    style: 'button',
    buttonStyle: 'primary',
    title: t(lang, 'tickets.setup.default.title'),
    description: t(lang, 'tickets.setup.default.description'),
    types: [{ label: t(lang, 'tickets.setup.default.typeLabel'), emoji: EMOJI.TICKET, description: t(lang, 'tickets.setup.default.typeDescription') }],
  });
}

function maxTypes(draft) {
  return draft.style === 'select' ? MAX_TYPES_SELECT : MAX_TYPES_BUTTON;
}

function isValidEmoji(value) {
  return CUSTOM_EMOJI.test(value) || /^\p{Extended_Pictographic}[\u{FE0F}\u{200D}\p{Extended_Pictographic}]*$/u.test(value);
}

/** The panel the way members will see it, as categories shaped for the shared button/menu builders. */
function previewCategories(draft) {
  return draft.types.map((t) => ({ key: `preview_${i}`, label: t.label, emoji: t.emoji, description: t.description, button_style: draft.buttonStyle }));
}

function renderWizard(uid, draft, lang = currentLanguage()) {
  const mark = (ok) => (ok ? EMOJI.APPROVE : '▫️');
  const colorName = t(lang, `tickets.setup.color.${draft.buttonStyle}`);
  const summary = [
    ...(draft.types.some((type) => type.welcome) ? [t(lang, 'tickets.setup.summary.welcome')] : []),
    t(lang, draft.style === 'select' ? 'tickets.setup.summary.dropdown' : 'tickets.setup.summary.buttons'),
    t(lang, 'tickets.setup.summary.color', { color: colorName }),
    t(lang, 'tickets.setup.summary.types', { count: draft.types.length, max: maxTypes(draft) }),
  ];
  const lines = [
    t(lang, 'tickets.setup.intro', { emoji: EMOJI.STAR }),
    '',
    t(lang, 'tickets.setup.panelChannel', { mark: mark(draft.channelId), channel: draft.channelId ? `<#${draft.channelId}>` : t(lang, 'tickets.setup.panelChannelEmpty') }),
    t(lang, 'tickets.setup.supportRoles', { mark: mark(draft.supportRoleIds.length), roles: draft.supportRoleIds.length ? draft.supportRoleIds.map((r) => `<@&${r}>`).join(' ') : t(lang, 'tickets.setup.supportRolesEmpty') }),
    t(lang, 'tickets.setup.logChannel', { mark: mark(draft.logChannelId), channel: draft.logChannelId ? `<#${draft.logChannelId}>` : t(lang, 'tickets.setup.logChannelEmpty') }),
    '',
    `### ${EMOJI.TICKET} ${draft.title}`,
    draft.description,
    '',
    ...draft.types.map((type) => `${COLOR_DOT[draft.buttonStyle]} ${type.emoji ? `${type.emoji} ` : ''}**${type.label}**${type.description ? ` — ${type.description}` : ''}`),
    '',
    `-# ${summary.join(' · ')}`,
  ];

  const channelSelect = (id, placeholder, current) => {
    const s = new ChannelSelectMenuBuilder().setCustomId(`${id}::${uid}`).setPlaceholder(placeholder).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
    if (current) s.setDefaultChannels(current);
    return s;
  };
  const roles = new RoleSelectMenuBuilder().setCustomId(`tfw_roles::${uid}`).setPlaceholder(t(lang, 'tickets.setup.rolesPlaceholder.menu')).setMinValues(1).setMaxValues(10);
  if (draft.supportRoleIds.length) roles.setDefaultRoles(draft.supportRoleIds);

  const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
    const b = new ButtonBuilder().setCustomId(`${id}::${uid}`).setLabel(label).setStyle(style);
    if (emoji) b.setEmoji(emoji);
    return b;
  };
  const rows = [
    new ActionRowBuilder().addComponents(channelSelect('tfw_channel', t(lang, 'tickets.setup.channelPlaceholder.menu'), draft.channelId)),
    new ActionRowBuilder().addComponents(roles),
    new ActionRowBuilder().addComponents(channelSelect('tfw_log', t(lang, 'tickets.setup.logPlaceholder.menu'), draft.logChannelId).setMinValues(0)),
    new ActionRowBuilder().addComponents(
      btn('tfw_text', t(lang, 'tickets.setup.text.button')),
      btn('tfw_add', t(lang, 'tickets.setup.addType.button'), ButtonStyle.Primary).setDisabled(draft.types.length >= maxTypes(draft)),
      btn('tfw_remove', t(lang, 'tickets.setup.removeType.button')).setDisabled(draft.types.length <= 1),
      btn('tfw_color', t(lang, 'tickets.setup.color.button', { color: colorName })),
      btn('tfw_style', t(lang, draft.style === 'select' ? 'tickets.setup.useButtons.button' : 'tickets.setup.useDropdown.button')),
    ),
    new ActionRowBuilder().addComponents(
      btn('tfw_publish', t(lang, 'tickets.setup.publish.button'), ButtonStyle.Success, EMOJI.APPROVE),
      btn('tfw_cancel', t(lang, 'tickets.cancel.button'), ButtonStyle.Secondary, EMOJI.DENY),
    ),
  ];

  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  return { components: [container, ...rows], flags: MessageFlags.IsComponentsV2 };
}

function guard(interaction, uid, lang) {
  if (interaction.user.id !== uid) {
    interaction.reply({ content: t(lang, 'tickets.setup.notYours', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    interaction.reply({ content: t(lang, 'tickets.needManageServer', { permission: t(lang, 'core.perm.ManageGuild') }), flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  return true;
}

function textModal(uid, draft, lang) {
  return new ModalBuilder()
    .setCustomId(`tfwm_text::${uid}`)
    .setTitle(t(lang, 'tickets.setup.textModal.title'))
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel(t(lang, 'tickets.setup.textModal.titleLabel')).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(draft.title)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel(t(lang, 'tickets.setup.textModal.textLabel')).setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(draft.description)),
    );
}

function typeModal(uid, lang) {
  const input = (id, label, required, max, placeholder) => {
    const field = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
    if (placeholder) field.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(field);
  };
  return new ModalBuilder()
    .setCustomId(`tfwm_type::${uid}`)
    .setTitle(t(lang, 'tickets.setup.typeModal.title'))
    .addComponents(
      input('label', t(lang, 'tickets.setup.typeModal.name'), true, 40, t(lang, 'tickets.setup.typeModal.namePlaceholder')),
      input('emoji', t(lang, 'tickets.setup.typeModal.emoji'), false, 60, '🎫'),
      input('description', t(lang, 'tickets.setup.typeModal.description'), false, 100),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('welcome').setLabel(t(lang, 'tickets.setup.typeModal.welcome')).setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder(t(lang, 'tickets.setup.typeModal.welcomePlaceholder')),
      ),
    );
}

function uniqueKey(label, taken) {
  const base = String(label).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 30) || 'ticket';
  let key = base;
  let n = 2;
  while (taken.has(key)) key = `${base}-${n++}`;
  taken.add(key);
  return key;
}

async function publish(interaction, uid, draft, lang) {
  const guild = interaction.guild;
  const missing = !draft.channelId && !draft.supportRoleIds.length ? 'both' : !draft.channelId ? 'channel' : !draft.supportRoleIds.length ? 'roles' : null;
  if (missing) {
    await interaction.reply({ content: t(lang, `tickets.setup.missing.${missing}`, { emoji: EMOJI.ALERT }), flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await guild.channels.fetch(draft.channelId).catch(() => null);
  const me = guild.members.me;
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (!channel || !channel.isTextBased() || !channel.permissionsFor(me)?.has(needed)) {
    const permissions = formatList(lang, ['ViewChannel', 'SendMessages', 'EmbedLinks'].map((flag) => t(lang, `core.perm.${flag}`)));
    await interaction.reply({ content: t(lang, 'tickets.setup.cannotPost', { emoji: EMOJI.DENY, channel: draft.channelId, permissions }), flags: MessageFlags.Ephemeral });
    return;
  }

  // The new types count toward the plan limit of ticket types, the same one the dashboard and `!ticket category add` use.
  const allowed = await guildLimit(guild.id, 'ticketCategories');
  const current = (await db.listCategories(guild.id)).length;
  if (current + draft.types.length > allowed.limit) {
    const room = Math.max(0, allowed.limit - current);
    await interaction.reply({ content: t(lang, allowed.premium ? 'tickets.setup.typesOverLimit' : 'tickets.setup.typesOverLimitFree', { emoji: EMOJI.ALERT, limit: allowed.limit, room, premium: allowed.premiumLimit }), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferUpdate();
  await ensureGuild(guild.id);

  let panel = null;
  const createdKeys = [];
  try {
    panel = await db.createPanel({ guildId: guild.id, channelId: channel.id, title: draft.title, description: draft.description, embedTemplate: null, style: draft.style });
    const existing = await db.listCategories(guild.id);
    const taken = new Set(existing.map((c) => c.key));
    const categories = [];
    for (const type of draft.types) {
      const key = uniqueKey(type.label, taken);
      const category = await db.createCategory({
        guildId: guild.id,
        panelId: panel.id,
        key,
        label: type.label,
        emoji: type.emoji || null,
        buttonStyle: draft.buttonStyle,
        description: type.description || null,
        supportRoleIds: draft.supportRoleIds,
        welcomeMessage: type.welcome || null,
      });
      createdKeys.push(key);
      categories.push(category);
    }

    const message = await channel.send({ components: [buildPanelFallbackCard({ title: draft.title, description: draft.description, lang }), ...buildPanelRows(draft.style, categories, { lang })], flags: MessageFlags.IsComponentsV2 });
    await db.setPanelMessageId(panel.id, message.id);

    if (draft.logChannelId) await settingsDb.upsertSettings(guild.id, { opened_log_channel_id: draft.logChannelId, closed_log_channel_id: draft.logChannelId });

    deleteDraft(uid);
    await interaction.editReply({
      components: [textCard(tn(lang, 'tickets.setup.ready', categories.length, { emoji: EMOJI.APPROVE, channel: `${channel}` }), 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (err) {
    logger.error('Ticket setup wizard failed:', err);
    if (panel) {
      for (const key of createdKeys) await db.deleteCategory(guild.id, key).catch(() => {});
      await db.deletePanel(guild.id, panel.id).catch(() => {});
    }
    await interaction.followUp({ content: `${t(lang, 'tickets.setup.failed', { emoji: EMOJI.DENY })} ${err.message || ''}`.trim(), flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function expired(interaction, lang) {
  const payload = { components: [textCard(t(lang, 'tickets.setup.expired'))], flags: MessageFlags.IsComponentsV2 };
  if (interaction.isModalSubmit()) await interaction.reply({ content: t(lang, 'tickets.setup.expired'), flags: MessageFlags.Ephemeral });
  else await interaction.update(payload);
}

async function handleButton(interaction) {
  const [type, uid] = interaction.customId.split('::');
  const lang = await languageOf(interaction);
  if (!guard(interaction, uid, lang)) return;
  const draft = getDraft(uid);
  if (!draft) return expired(interaction, lang);

  if (type === 'tfw_text') return interaction.showModal(textModal(uid, draft, lang));
  if (type === 'tfw_add') {
    if (draft.types.length >= maxTypes(draft)) {
      await interaction.reply({ content: t(lang, 'tickets.setup.typesFull', { max: maxTypes(draft) }), flags: MessageFlags.Ephemeral });
      return;
    }
    return interaction.showModal(typeModal(uid, lang));
  }
  if (type === 'tfw_publish') return publish(interaction, uid, draft, lang);

  if (type === 'tfw_cancel') {
    deleteDraft(uid);
    await interaction.update({ components: [textCard(t(lang, 'tickets.setup.cancelled', { emoji: EMOJI.DENY }))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (type === 'tfw_remove') draft.types.pop();
  else if (type === 'tfw_color') draft.buttonStyle = COLORS[(COLORS.indexOf(draft.buttonStyle) + 1) % COLORS.length];
  else if (type === 'tfw_style') {
    draft.style = draft.style === 'select' ? 'button' : 'select';
    draft.types = draft.types.slice(0, maxTypes(draft));
  } else return;

  setDraft(uid, draft);
  await interaction.update(renderWizard(uid, draft, lang));
}

async function handleSelect(interaction) {
  const [type, uid] = interaction.customId.split('::');
  const lang = await languageOf(interaction);
  if (!guard(interaction, uid, lang)) return;
  const draft = getDraft(uid);
  if (!draft) return expired(interaction, lang);

  if (type === 'tfw_channel') draft.channelId = interaction.values[0] ?? null;
  else if (type === 'tfw_log') draft.logChannelId = interaction.values[0] ?? null;
  else if (type === 'tfw_roles') draft.supportRoleIds = [...interaction.values];
  else return;

  setDraft(uid, draft);
  await interaction.update(renderWizard(uid, draft, lang));
}

async function handleModal(interaction) {
  const [type, uid] = interaction.customId.split('::');
  const lang = await languageOf(interaction);
  if (!guard(interaction, uid, lang)) return;
  const draft = getDraft(uid);
  if (!draft) return expired(interaction, lang);
  const g = (id) => (interaction.fields.getTextInputValue(id) ?? '').trim();

  if (type === 'tfwm_text') {
    draft.title = g('title') || draft.title;
    draft.description = g('description') || draft.description;
  } else if (type === 'tfwm_type') {
    if (draft.types.length >= maxTypes(draft)) {
      await interaction.reply({ content: t(lang, 'tickets.setup.typesFull', { max: maxTypes(draft) }), flags: MessageFlags.Ephemeral });
      return;
    }
    const label = g('label');
    const emoji = g('emoji');
    if (!label) {
      await interaction.reply({ content: t(lang, 'tickets.setup.emptyName'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (emoji && !isValidEmoji(emoji)) {
      await interaction.reply({ content: t(lang, 'tickets.setup.badEmoji', { emoji: EMOJI.ALERT, value: emoji, sample: '🎫', example: '<:name:123456789012345678>' }), flags: MessageFlags.Ephemeral });
      return;
    }
    draft.types.push({ label, emoji: emoji || null, description: g('description') || null, welcome: g('welcome') || null });
  } else return;

  setDraft(uid, draft);
  await interaction.deferUpdate();
  await interaction.editReply(renderWizard(uid, draft, lang));
}

// Wrapped in the safety net of the tickets (utils/safeTicketAction.js): an expired press is not an error and a failure is told kindly.
module.exports = {
  renderWizard,
  startDraft,
  handleButton: wrapTicketHandler('tk_setup', handleButton),
  handleSelect: wrapTicketHandler('tk_setup_select', handleSelect),
  handleModal: wrapTicketHandler('tk_setup_modal', handleModal),
  isValidEmoji,
  uniqueKey,
};
