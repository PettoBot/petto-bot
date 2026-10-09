const {
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  MessageFlags,
  parseEmoji,
  PermissionFlagsBits,
} = require('discord.js');
const rrDb = require('../db/reactionRoles');

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
function buttonLabel(row, role, hasEmoji) {
  if (row.button_label === '' && hasEmoji) return '';
  return String(row.button_label || role?.name || 'Role').trim().slice(0, 80) || 'Role';
}

/** The buttons in the rows of the message: the rows the builder chose, in their order, and what has no row after them, five to a row. */
function placeInRows(buttons) {
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
  if (rows.length > MAX_ROWS) throw new Error('A message can have at most 5 rows of 5 buttons.');
  return rows;
}

function buildButtonRows(rows, guild) {
  const buttons = rows.filter((row) => row.interaction_type === 'button');
  if (buttons.length > MAX_BUTTONS) throw new Error('A message can have at most 25 button roles.');

  return placeInRows(buttons).map((placed) => new ActionRowBuilder().addComponents(placed.map((row) => {
    const role = guild.roles.cache.get(row.role_id);
    const emoji = buttonEmoji(row.emoji);
    const label = buttonLabel(row, role, Boolean(emoji));
    const button = new ButtonBuilder().setCustomId(`${BUTTON_PREFIX}${row.id}`).setStyle(buttonStyle(row));
    if (label) button.setLabel(label);
    if (emoji) button.setEmoji(emoji);
    return button;
  })));
}

async function assertCanEditComponents(message) {
  const hasForeignComponents = message.components?.some((row) =>
    row.components?.some((component) => component.customId && !String(component.customId).startsWith(BUTTON_PREFIX)),
  );
  if (hasForeignComponents) {
    throw new Error('That message already has another component panel. Use a message without buttons or selects for button roles.');
  }
}

async function syncMessageButtons(message, rows) {
  await assertCanEditComponents(message);
  await message.edit({ components: buildButtonRows(rows, message.guild) });
}

async function reply(interaction, content) {
  const payload = { content, flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
  if (interaction.replied || interaction.deferred) return interaction.followUp(payload);
  return interaction.reply(payload);
}

async function handleButton(interaction) {
  const id = interaction.customId.slice(BUTTON_PREFIX.length);
  if (!/^\d+$/.test(id)) return reply(interaction, 'That role button is no longer valid.');

  const row = await rrDb.getReactionRoleById(id);
  if (!row || row.interaction_type !== 'button' || !interaction.guild || row.guild_id !== interaction.guild.id) {
    return reply(interaction, 'That role button is no longer configured.');
  }

  const role = interaction.guild.roles.cache.get(row.role_id);
  if (!role) return reply(interaction, 'That role no longer exists.');
  const me = interaction.guild.members.me;
  if (!me?.permissions.has(PermissionFlagsBits.ManageRoles) || !role.editable) {
    return reply(interaction, 'I cannot manage that role. Move my bot role above it and enable Manage Roles.');
  }

  const member = await interaction.guild.members.fetch(interaction.user.id);
  const hasRole = member.roles.cache.has(role.id);
  if (row.mode === 'add' && hasRole) return reply(interaction, `You already have **${role.name}**.`);
  if (row.mode === 'remove' && !hasRole) return reply(interaction, `You do not have **${role.name}**.`);

  if (row.mode === 'remove' || (row.mode === 'toggle' && hasRole)) {
    await member.roles.remove(role, 'Button role');
    return reply(interaction, `Removed **${role.name}**.`);
  }

  await member.roles.add(role, 'Button role');
  return reply(interaction, `Added **${role.name}**.`);
}

module.exports = { BUTTON_PREFIX, buildButtonRows, placeInRows, buttonStyle, buttonEmoji, syncMessageButtons, handleButton };
