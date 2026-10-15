const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  parseEmoji,
  PermissionFlagsBits,
} = require('discord.js');
const rrDb = require('../db/reactionRoles');
const { t, languageOf, currentLanguage } = require('../i18n');

const BUTTON_PREFIX = 'rr:';
const MAX_BUTTONS = 25;

const STYLE_BY_NUMBER = { 1: ButtonStyle.Primary, 2: ButtonStyle.Secondary, 3: ButtonStyle.Success, 4: ButtonStyle.Danger };
const MAX_ROWS = 5;
const PER_ROW = 5;
// A button with no emoji is saved with an emoji key that starts with this, so two of them on a message do not clash.
const NO_EMOJI = /^label:/;

/** The color the builder chose (1 to 4), or the one of its mode: green adds, red removes, blurple toggles. */
function buttonStyle(row) {
  const chosen = STYLE_BY_NUMBER[Number(row.button_style)];
  if (chosen) return chosen;
  if (row.mode === 'add') return ButtonStyle.Success;
  if (row.mode === 'remove') return ButtonStyle.Danger;
  return ButtonStyle.Primary;
}

function buttonEmoji(value) {
  if (!value || NO_EMOJI.test(value)) return null;
  const parsed = parseEmoji(value);
  return parsed
    ? { id: parsed.id ?? undefined, name: parsed.name ?? undefined, animated: parsed.animated ?? false }
    : { name: value };
}

/** The text of a button: its own, the name of the role, or nothing when it is meant to be only an emoji (an empty label and an emoji). */
function buttonLabel(row, role, hasEmoji, lang) {
  if (row.button_label === '' && hasEmoji) return '';
  const fallback = t(lang, 'automation.reactionrole.role.button');
  return String(row.button_label || role?.name || fallback).trim().slice(0, 80) || fallback;
}

/** The buttons in the rows of the message: the rows the builder chose, in their order, and what has no row after them, five to a row. */
function placeInRows(buttons, lang = currentLanguage()) {
  const byPlace = (a, b) => (Number(a.button_position ?? 0) - Number(b.button_position ?? 0)) || (Number(a.id) - Number(b.id));
  const explicit = new Map();
  const loose = [];
  for (const row of [...buttons].sort(byPlace)) {
    const place = Number(row.button_row);
    if (row.button_row !== null && row.button_row !== undefined && Number.isInteger(place) && place >= 0 && place < MAX_ROWS && (explicit.get(place)?.length ?? 0) < PER_ROW) {
      explicit.set(place, [...(explicit.get(place) ?? []), row]);
    } else loose.push(row);
  }
  const rows = [...explicit.keys()].sort((a, b) => a - b).map((key) => explicit.get(key));
  for (let index = 0; index < loose.length; index += PER_ROW) rows.push(loose.slice(index, index + PER_ROW));
  if (rows.length > MAX_ROWS) throw new Error(t(lang, 'automation.reactionrole.maxRows'));
  return rows;
}

function buildButtonRows(rows, guild, lang = currentLanguage()) {
  const buttons = rows.filter((row) => row.interaction_type === 'button');
  if (buttons.length > MAX_BUTTONS) throw new Error(t(lang, 'automation.reactionrole.maxButtons'));

  return placeInRows(buttons, lang).map((placed) => new ActionRowBuilder().addComponents(placed.map((row) => {
    const role = guild.roles.cache.get(row.role_id);
    const emoji = buttonEmoji(row.emoji);
    const label = buttonLabel(row, role, Boolean(emoji), lang);
    const button = new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}${row.id}`).setStyle(buttonStyle(row));
    if (label) button.setLabel(label);
    if (emoji) button.setEmoji(emoji);
    return button;
  })));
}

async function assertCanEditComponents(message, lang) {
  const hasForeignComponents = message.components?.some((row) =>
    row.components?.some((component) => component.customId && !String(component.customId).startsWith(BUTTON_PREFIX)),
  );
  if (hasForeignComponents) {
    throw new Error(t(lang, 'automation.reactionrole.foreignComponents'));
  }
}

async function syncMessageButtons(message, rows, lang = currentLanguage()) {
  await assertCanEditComponents(message, lang);
  await message.edit({ components: buildButtonRows(rows, message.guild, lang) });
}

async function reply(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
  return interaction.reply(payload);
}

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const id = interaction.customId.slice(BUTTON_PREFIX.length);
  if (!/^\d+$/.test(id)) return reply(interaction, t(lang, 'automation.reactionrole.button.invalid'));

  const row = await rrDb.getReactionRoleById(id);
  if (!row || row.interaction_type !== 'button' || !interaction.guild || row.guild_id !== interaction.guild.id) {
    return reply(interaction, t(lang, 'automation.reactionrole.button.notConfigured'));
  }

  const role = interaction.guild.roles.cache.get(row.role_id);
  if (!role) return reply(interaction, t(lang, 'automation.reactionrole.button.roleGone'));
  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || !role.editable) {
    return reply(interaction, t(lang, 'automation.reactionrole.button.cannotManage'));
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const hasRole = member.roles.cache.has(role.id);
  if (row.mode === 'add' && hasRole) return reply(interaction, t(lang, 'automation.reactionrole.button.alreadyHave', { role: role.name }));
  if (row.mode === 'remove' && !hasRole) return reply(interaction, t(lang, 'automation.reactionrole.button.doNotHave', { role: role.name }));

  if (row.mode === 'remove' || (row.mode === 'toggle' && hasRole)) {
    await member.roles.remove(role, t(lang, 'automation.reactionrole.button.auditReason'));
    return reply(interaction, t(lang, 'automation.reactionrole.button.removed', { role: role.name }));
  }

  await member.roles.add(role, t(lang, 'automation.reactionrole.button.auditReason'));
  return reply(interaction, t(lang, 'automation.reactionrole.button.added', { role: role.name }));
}

module.exports = { BUTTON_PREFIX, buildButtonRows, placeInRows, buttonStyle, buttonEmoji, syncMessageButtons, handleButton };
