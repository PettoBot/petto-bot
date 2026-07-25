const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const rrDb = require('../../db/reactionRoles');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');

const MODE_CHOICES = [
  { name: 'toggle (react adds, un-react removes)', value: 'toggle' },
  { name: 'add only (react adds, un-react does nothing)', value: 'add' },
  { name: 'remove only (react removes the role)', value: 'remove' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Give members a role when they react to a message.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('add')
        .setDescription('Bind an emoji on a message to a role.')
        .addStringOption((o) => o.setName('message_id').setDescription('The message ID').setRequired(true))
        .addStringOption((o) => o.setName('emoji').setDescription('An emoji (custom or default)').setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel the message is in (default: this one)').setRequired(false))
        .addStringOption((o) => o.setName('mode').setDescription('Default: toggle').setRequired(false).addChoices(...MODE_CHOICES)),
    )
    .addSubcommand((s) =>
      s
        .setName('remove')
        .setDescription('Unbind an emoji from a message.')
        .addStringOption((o) => o.setName('message_id').setDescription('The message ID').setRequired(true))
        .addStringOption((o) => o.setName('emoji').setDescription('The emoji').setRequired(true)),
    )
    .addSubcommand((s) => s.setName('list').setDescription('List reaction roles on a message.').addStringOption((o) => o.setName('message_id').setDescription('The message ID').setRequired(true)))
    .addSubcommand((s) => s.setName('clear').setDescription('Remove every reaction role on a message.').addStringOption((o) => o.setName('message_id').setDescription('The message ID').setRequired(true))),
  aliases: ['rr'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'add') return addCmd(interaction);
    if (sub === 'remove') return removeCmd(interaction);
    if (sub === 'list') return listCmd(interaction);
    return clearCmd(interaction);
  },
};

async function findMessage(interaction, messageId, channelOverride) {
  const channel = channelOverride ?? interaction.channel;
  return channel.messages.fetch(messageId).catch(() => null);
}

async function addCmd(interaction) {
  const messageId = interaction.options.getString('message_id', true).trim();
  const emoji = interaction.options.getString('emoji', true).trim();
  const role = interaction.options.getRole('role', true);
  const channelOption = interaction.options.getChannel('channel');
  const mode = interaction.options.getString('mode') ?? 'toggle';

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const message = await findMessage(interaction, messageId, channelOption);
  if (!message) {
    await interaction.editReply({ components: [textCard("Couldn't find that message (check the channel and message ID).", COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const existing = await rrDb.getReactionRole(messageId, emoji);
  if (existing) {
    await interaction.editReply({ components: [textCard('That emoji is already bound to a role on this message.', COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  try {
    await message.react(emoji);
  } catch {
    await interaction.editReply({ components: [textCard("Couldn't react with that emoji — make sure it's valid and I can use it.", COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await rrDb.addReactionRole({ guild_id: interaction.guild.id, channel_id: message.channel.id, message_id: messageId, emoji, role_id: role.id, mode });
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${emoji} on that message now grants ${role} (mode: ${mode}).`, COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const messageId = interaction.options.getString('message_id', true).trim();
  const emoji = interaction.options.getString('emoji', true).trim();

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const removed = await rrDb.removeReactionRole(messageId, emoji);
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Reaction role removed.` : "That emoji wasn't bound on this message.", removed ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  const messageId = interaction.options.getString('message_id', true).trim();
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const rows = await rrDb.listForMessage(messageId);
  const text = rows.length ? rows.map((r) => `${r.emoji} → <@&${r.role_id}> (${r.mode})`).join('\n') : 'No reaction roles on that message.';
  await interaction.editReply({ components: [textCard(text, COLORS.BLUE)], flags: MessageFlags.IsComponentsV2 });
}

async function clearCmd(interaction) {
  const messageId = interaction.options.getString('message_id', true).trim();
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const count = await rrDb.clearForMessage(messageId);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Removed ${count} reaction role(s) from that message.`, COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
}
