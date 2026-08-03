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

function buttonStyle(mode) {
  if (mode === 'add') return ButtonStyle.Success;
  if (mode === 'remove') return ButtonStyle.Danger;
  return ButtonStyle.Primary;
}

function buttonEmoji(value) {
  if (!value) return null;
  const parsed = parseEmoji(value);
  return parsed
    ? { id: parsed.id ?? undefined, name: parsed.name ?? undefined, animated: parsed.animated ?? false }
    : { name: value };
}

function buildButtonRows(rows, guild) {
  const buttons = rows.filter((row) => row.interaction_type === 'button');
  if (buttons.length > MAX_BUTTONS) throw new Error('A message can have at most 25 button roles.');

  const builders = buttons.map((row) => {
    const role = guild.roles.cache.get(row.role_id);
    const label = String(row.button_label || role?.name || 'Role').trim().slice(0, 80) || 'Role';
    const button = new ButtonBuilder()
      .setCustomId(`${BUTTON_PREFIX}${row.id}`)
      .setLabel(label)
      .setStyle(buttonStyle(row.mode));
    const emoji = buttonEmoji(row.emoji);
    if (emoji) button.setEmoji(emoji);
    return button;
  });

  const rowsOut = [];
  for (let index = 0; index < builders.length; index += 5) {
    rowsOut.push(new ActionRowBuilder().addComponents(builders.slice(index, index + 5)));
  }
  return rowsOut;
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

module.exports = { BUTTON_PREFIX, buildButtonRows, syncMessageButtons, handleButton };
