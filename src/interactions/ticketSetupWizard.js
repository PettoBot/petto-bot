// Guided ticket setup: pick the channel, support roles and log channel with menus, name the ticket types with buttons,
// choose how the panel looks, and publish it all in one go.
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
const settingsDb = require('../db/ticketSettings');
const { ensureGuild } = require('../db/guilds');
const { buildPanelRows, buildPanelFallbackCard } = require('../utils/ticketCards');
const { textCard } = require('../utils/caseCard');
const { EMOJI } = require('../utils/emojis');
const logger = require('../utils/logger');

const DRAFT_TTL_MS = 20 * 60_000;
const MAX_TYPES_BUTTON = 5;
const MAX_TYPES_SELECT = 25;
const COLORS = ['primary', 'secondary', 'success', 'danger'];
const COLOR_DOT = { primary: '🔵', secondary: '⚪', success: '🟢', danger: '🔴' };
const COLOR_NAME = { primary: 'Blue', secondary: 'Grey', success: 'Green', danger: 'Red' };
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

function startDraft(userId, { guildId, channelId }) {
  return setDraft(userId, {
    guildId,
    channelId: channelId ?? null,
    supportRoleIds: [],
    logChannelId: null,
    style: 'button',
    buttonStyle: 'primary',
    title: 'Support',
    description: 'Click a button below to open a ticket. A private channel will be created for you and our staff.',
    types: [{ label: 'Support', emoji: '🎫', description: 'General help' }],
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

function renderWizard(uid, draft) {
  const mark = (ok) => (ok ? EMOJI.APPROVE : '▫️');
  const lines = [
    `${EMOJI.STAR} **Ticket setup.** Pick the options, then press **Publish**. Nothing is posted until then.`,
    '',
    `${mark(draft.channelId)} **Panel channel:** ${draft.channelId ? `<#${draft.channelId}>` : '*choose one below*'}`,
    `${mark(draft.supportRoleIds.length)} **Support roles:** ${draft.supportRoleIds.length ? draft.supportRoleIds.map((r) => `<@&${r}>`).join(' ') : '*choose who answers tickets*'}`,
    `${mark(draft.logChannelId)} **Log channel:** ${draft.logChannelId ? `<#${draft.logChannelId}>` : '*optional: opened/closed tickets and transcripts*'}`,
    '',
    `### 🎫 ${draft.title}`,
    draft.description,
    '',
    ...draft.types.map((t) => `${COLOR_DOT[draft.buttonStyle]} ${t.emoji ? `${t.emoji} ` : ''}**${t.label}**${t.description ? ` — ${t.description}` : ''}`),
    '',
    `-# ${draft.types.some((t) => t.welcome) ? 'Own welcome text set · ' : ''}${draft.style === 'select' ? 'Dropdown menu' : 'Buttons'} · ${COLOR_NAME[draft.buttonStyle]} buttons · ${draft.types.length}/${maxTypes(draft)} ticket types`,
  ];

  const channelSelect = (id, placeholder, current) => {
    const s = new ChannelSelectMenuBuilder().setCustomId(`${id}::${uid}`).setPlaceholder(placeholder).setChannelTypes(ChannelType.GuildText, ChannelType.GuildAnnouncement).setMinValues(1).setMaxValues(1);
    if (current) s.setDefaultChannels(current);
    return s;
  };
  const roles = new RoleSelectMenuBuilder().setCustomId(`tfw_roles::${uid}`).setPlaceholder('Support roles (who answers tickets)').setMinValues(1).setMaxValues(10);
  if (draft.supportRoleIds.length) roles.setDefaultRoles(draft.supportRoleIds);

  const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
    const b = new ButtonBuilder().setCustomId(`${id}::${uid}`).setLabel(label).setStyle(style);
    if (emoji) b.setEmoji(emoji);
    return b;
  };
  const rows = [
    new ActionRowBuilder().addComponents(channelSelect('tfw_channel', 'Where to post the panel', draft.channelId)),
    new ActionRowBuilder().addComponents(roles),
    new ActionRowBuilder().addComponents(channelSelect('tfw_log', 'Log channel (optional)', draft.logChannelId).setMinValues(0)),
    new ActionRowBuilder().addComponents(
      btn('tfw_text', 'Title & text'),
      btn('tfw_add', 'Add type', ButtonStyle.Primary).setDisabled(draft.types.length >= maxTypes(draft)),
      btn('tfw_remove', 'Remove last type').setDisabled(draft.types.length <= 1),
      btn('tfw_color', `Color: ${COLOR_NAME[draft.buttonStyle]}`),
      btn('tfw_style', draft.style === 'select' ? 'Use buttons' : 'Use dropdown'),
    ),
    new ActionRowBuilder().addComponents(
      btn('tfw_publish', 'Publish', ButtonStyle.Success, EMOJI.APPROVE),
      btn('tfw_cancel', 'Cancel', ButtonStyle.Secondary, EMOJI.DENY),
    ),
  ];

  const container = new ContainerBuilder().setAccentColor(0x4b4f59).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  return { components: [container, ...rows], flags: MessageFlags.IsComponentsV2 };
}

function guard(interaction, uid) {
  if (interaction.user.id !== uid) {
    interaction.reply({ content: `${EMOJI.DENY} This setup belongs to someone else.`, flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  if (!interaction.memberPermissions?.has(PermissionFlagsBits.ManageGuild)) {
    interaction.reply({ content: 'You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral }).catch(() => {});
    return false;
  }
  return true;
}

function textModal(uid, draft) {
  return new ModalBuilder()
    .setCustomId(`tfwm_text::${uid}`)
    .setTitle('Panel title and text')
    .addComponents(
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('title').setLabel('Title').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(100).setValue(draft.title)),
      new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('description').setLabel('Text shown above the buttons').setStyle(TextInputStyle.Paragraph).setRequired(true).setMaxLength(1000).setValue(draft.description)),
    );
}

function typeModal(uid) {
  const input = (id, label, required, max, placeholder) => {
    const t = new TextInputBuilder().setCustomId(id).setLabel(label).setStyle(TextInputStyle.Short).setRequired(required).setMaxLength(max);
    if (placeholder) t.setPlaceholder(placeholder);
    return new ActionRowBuilder().addComponents(t);
  };
  return new ModalBuilder()
    .setCustomId(`tfwm_type::${uid}`)
    .setTitle('Add a ticket type')
    .addComponents(
      input('label', 'Name (button text)', true, 40, 'e.g. Report a player'),
      input('emoji', 'Emoji (optional)', false, 60, '🎫'),
      input('description', 'Short description (shown in the dropdown)', false, 100),
      new ActionRowBuilder().addComponents(
        new TextInputBuilder().setCustomId('welcome').setLabel('Welcome text in the ticket (optional)').setStyle(TextInputStyle.Paragraph).setRequired(false).setMaxLength(1000).setPlaceholder('Hi {user}! Tell us what you need and staff will answer soon.'),
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

async function publish(interaction, uid, draft) {
  const guild = interaction.guild;
  const problems = [];
  if (!draft.channelId) problems.push('choose the panel channel');
  if (!draft.supportRoleIds.length) problems.push('choose at least one support role');
  if (problems.length) {
    await interaction.reply({ content: `${EMOJI.ALERT} First ${problems.join(' and ')}.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const channel = await guild.channels.fetch(draft.channelId).catch(() => null);
  const me = guild.members.me;
  const needed = [PermissionFlagsBits.ViewChannel, PermissionFlagsBits.SendMessages, PermissionFlagsBits.EmbedLinks];
  if (!channel || !channel.isTextBased() || !channel.permissionsFor(me)?.has(needed)) {
    await interaction.reply({ content: `${EMOJI.DENY} I cannot post in <#${draft.channelId}>. Give me View Channel, Send Messages and Embed Links there, or choose another channel.`, flags: MessageFlags.Ephemeral });
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

    const message = await channel.send({ components: [buildPanelFallbackCard({ title: draft.title, description: draft.description }), ...buildPanelRows(draft.style, categories)], flags: MessageFlags.IsComponentsV2 });
    await db.setPanelMessageId(panel.id, message.id);

    if (draft.logChannelId) await settingsDb.upsertSettings(guild.id, { opened_log_channel_id: draft.logChannelId, closed_log_channel_id: draft.logChannelId });

    deleteDraft(uid);
    await interaction.editReply({
      components: [textCard(`${EMOJI.APPROVE} Ticket system ready. The panel is in ${channel} with ${categories.length} ticket type${categories.length === 1 ? '' : 's'}. Fine-tune each type (welcome message, form, naming) from the dashboard or with \`!ticket category edit\`.`, 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
  } catch (err) {
    logger.error('Ticket setup wizard failed:', err);
    if (panel) {
      for (const key of createdKeys) await db.deleteCategory(guild.id, key).catch(() => {});
      await db.deletePanel(guild.id, panel.id).catch(() => {});
    }
    await interaction.followUp({ content: `${EMOJI.DENY} I could not finish the setup, so nothing was kept. ${err.message || ''}`.trim(), flags: MessageFlags.Ephemeral }).catch(() => {});
  }
}

async function expired(interaction) {
  const payload = { components: [textCard('This setup expired. Run `!ticket setup` again.', 0x8b8fa3)], flags: MessageFlags.IsComponentsV2 };
  if (interaction.isModalSubmit()) await interaction.reply({ content: 'This setup expired. Run `!ticket setup` again.', flags: MessageFlags.Ephemeral });
  else await interaction.update(payload);
}

async function handleButton(interaction) {
  const [type, uid] = interaction.customId.split('::');
  if (!guard(interaction, uid)) return;
  const draft = getDraft(uid);
  if (!draft) return expired(interaction);

  if (type === 'tfw_text') return interaction.showModal(textModal(uid, draft));
  if (type === 'tfw_add') {
    if (draft.types.length >= maxTypes(draft)) {
      await interaction.reply({ content: `This panel can have up to ${maxTypes(draft)} ticket types.`, flags: MessageFlags.Ephemeral });
      return;
    }
    return interaction.showModal(typeModal(uid));
  }
  if (type === 'tfw_publish') return publish(interaction, uid, draft);

  if (type === 'tfw_cancel') {
    deleteDraft(uid);
    await interaction.update({ components: [textCard(`${EMOJI.DENY} Setup cancelled. Nothing was posted.`, 0x8b8fa3)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (type === 'tfw_remove') draft.types.pop();
  else if (type === 'tfw_color') draft.buttonStyle = COLORS[(COLORS.indexOf(draft.buttonStyle) + 1) % COLORS.length];
  else if (type === 'tfw_style') {
    draft.style = draft.style === 'select' ? 'button' : 'select';
    draft.types = draft.types.slice(0, maxTypes(draft));
  } else return;

  setDraft(uid, draft);
  await interaction.update(renderWizard(uid, draft));
}

async function handleSelect(interaction) {
  const [type, uid] = interaction.customId.split('::');
  if (!guard(interaction, uid)) return;
  const draft = getDraft(uid);
  if (!draft) return expired(interaction);

  if (type === 'tfw_channel') draft.channelId = interaction.values[0] ?? null;
  else if (type === 'tfw_log') draft.logChannelId = interaction.values[0] ?? null;
  else if (type === 'tfw_roles') draft.supportRoleIds = [...interaction.values];
  else return;

  setDraft(uid, draft);
  await interaction.update(renderWizard(uid, draft));
}

async function handleModal(interaction) {
  const [type, uid] = interaction.customId.split('::');
  if (!guard(interaction, uid)) return;
  const draft = getDraft(uid);
  if (!draft) return expired(interaction);
  const g = (id) => (interaction.fields.getTextInputValue(id) ?? '').trim();

  if (type === 'tfwm_text') {
    draft.title = g('title') || draft.title;
    draft.description = g('description') || draft.description;
  } else if (type === 'tfwm_type') {
    if (draft.types.length >= maxTypes(draft)) {
      await interaction.reply({ content: `This panel can have up to ${maxTypes(draft)} ticket types.`, flags: MessageFlags.Ephemeral });
      return;
    }
    const label = g('label');
    const emoji = g('emoji');
    if (!label) {
      await interaction.reply({ content: 'The name cannot be empty.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (emoji && !isValidEmoji(emoji)) {
      await interaction.reply({ content: `${EMOJI.ALERT} \`${emoji}\` is not an emoji I can use. Use a normal emoji like 🎫 or a custom one pasted as \`<:name:123456789012345678>\`, or leave it empty.`, flags: MessageFlags.Ephemeral });
      return;
    }
    draft.types.push({ label, emoji: emoji || null, description: g('description') || null, welcome: g('welcome') || null });
  } else return;

  setDraft(uid, draft);
  await interaction.deferUpdate();
  await interaction.editReply(renderWizard(uid, draft));
}

module.exports = { renderWizard, startDraft, handleButton, handleSelect, handleModal, isValidEmoji, uniqueKey };
