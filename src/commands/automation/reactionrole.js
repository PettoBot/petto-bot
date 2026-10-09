const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const rrDb = require('../../db/reactionRoles');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { syncMessageButtons } = require('../../interactions/reactionRoleButton');
const { templatePayload } = require('../../utils/templatedMessage');

const MODE_CHOICES = [
  { name: 'toggle (react adds, un-react removes)', value: 'toggle' },
  { name: 'add only (react adds, un-react does nothing)', value: 'add' },
  { name: 'remove only (react removes the role)', value: 'remove' },
];
const STYLE_CHOICES = [
  { name: 'blurple', value: '1' }, { name: 'gray', value: '2' }, { name: 'green', value: '3' }, { name: 'red', value: '4' },
];
const TYPE_CHOICES = [
  { name: 'reaction (emoji on the message)', value: 'reaction' },
  { name: 'button (clickable role menu)', value: 'button' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('reactionrole')
    .setDescription('Give members a role with a reaction or button.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageRoles)
    .setDMPermission(false)
    .addSubcommand((s) => s
      .setName('add')
      .setDescription('Bind a reaction or button on a message to a role.')
      .addStringOption((o) => o.setName('message_id').setDescription('The message ID, or new to post a message from a saved embed').setRequired(true))
      .addStringOption((o) => o.setName('emoji').setDescription('Emoji for the reaction or button').setRequired(true))
      .addRoleOption((o) => o.setName('role').setDescription('Role to grant').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel the message is in (default: this one)').setRequired(false))
      .addStringOption((o) => o.setName('mode').setDescription('Default: toggle').setRequired(false).addChoices(...MODE_CHOICES))
      .addStringOption((o) => o.setName('type').setDescription('Default: reaction').setRequired(false).addChoices(...TYPE_CHOICES))
      .addStringOption((o) => o.setName('label').setDescription('Button text (button mode only)').setRequired(false).setMaxLength(80))
      .addStringOption((o) => o.setName('embed').setDescription('With message_id new: the saved embed to post with the button').setRequired(false))
      .addStringOption((o) => o.setName('style').setDescription('Button color (default: by mode)').setRequired(false).addChoices(...STYLE_CHOICES))
      .addIntegerOption((o) => o.setName('row').setDescription('Row of the buttons, 1 to 5 (default: in order)').setRequired(false).setMinValue(1).setMaxValue(5)))
    .addSubcommand((s) => s
      .setName('remove')
      .setDescription('Unbind a reaction or button from a message.')
      .addStringOption((o) => o.setName('message_id').setDescription('The message ID').setRequired(true))
      .addStringOption((o) => o.setName('emoji').setDescription('The emoji used by the binding').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel the message is in (default: this one)').setRequired(false)))
    .addSubcommand((s) => s
      .setName('list')
      .setDescription('List reaction and button roles on a message.')
      .addStringOption((o) => o.setName('message_id').setDescription('The message ID').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel the message is in (default: this one)').setRequired(false)))
    .addSubcommand((s) => s
      .setName('clear')
      .setDescription('Remove every reaction and button role on a message.')
      .addStringOption((o) => o.setName('message_id').setDescription('The message ID').setRequired(true))
      .addChannelOption((o) => o.setName('channel').setDescription('Channel the message is in (default: this one)').setRequired(false))),
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

const NEW_MESSAGE = 'new';

async function addCmd(interaction) {
  let messageId = interaction.options.getString('message_id', true).trim();
  const emoji = interaction.options.getString('emoji', true).trim();
  const role = interaction.options.getRole('role', true);
  const channelOption = interaction.options.getChannel('channel');
  const mode = interaction.options.getString('mode') ?? 'toggle';
  let type = interaction.options.getString('type') ?? 'reaction';
  const label = interaction.options.getString('label')?.trim().slice(0, 80) || null;
  const embedName = interaction.options.getString('embed')?.trim() || null;
  const style = Number(interaction.options.getString('style')) || null;
  const rowOption = interaction.options.getInteger('row');
  const fail = (text) => interaction.editReply({ components: [textCard(text, COLORS.RED)], flags: MessageFlags.IsComponentsV2 });

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  let message = null;
  let posted = false;
  if (messageId.toLowerCase() === NEW_MESSAGE) {
    // `new` posts the saved embed as a message of its own and puts the role button on it.
    if (!embedName) return fail('To post a new message, write the saved embed after `embed`, for example `rr add new 🎀 @role --embed rules`.');
    const channel = channelOption ?? interaction.channel;
    const payload = await templatePayload(interaction.guild.id, embedName, { guild: interaction.guild, user: interaction.user, member: interaction.member, channel });
    if (!payload) return fail(`The saved embed \`${embedName}\` does not exist or it is empty.`);
    if (payload.flags) return fail('A V2 design cannot hold role buttons. Pick a classic embed.');
    message = await channel.send({ content: payload.content, embeds: payload.embeds, allowedMentions: { parse: [] } }).catch(() => null);
    if (!message) return fail(`I could not post in ${channel}. Check that I can write there.`);
    posted = true;
    messageId = message.id;
    type = 'button';
  } else {
    message = await findMessage(interaction, messageId, channelOption);
    if (!message) return fail("Couldn't find that message (check the channel and message ID).");
  }
  // A message made just for this and left with no button would be left over, so it is taken down when something fails.
  const failAndClean = async (text) => { if (posted) await message.delete().catch(() => {}); return fail(text); };

  if (await rrDb.getReactionRole(messageId, emoji)) return failAndClean('That emoji is already bound to a role on this message.');

  if (type === 'reaction') {
    try {
      await message.react(emoji);
    } catch {
      return failAndClean("Couldn't react with that emoji - make sure it's valid and I can use it.");
    }
  }

  let row;
  try {
    row = await rrDb.addReactionRole({
      guild_id: interaction.guild.id,
      channel_id: message.channel.id,
      message_id: messageId,
      emoji,
      role_id: role.id,
      mode,
      interaction_type: type,
      button_label: type === 'button' ? label : null,
      ...(type === 'button' && style ? { button_style: style } : {}),
      ...(type === 'button' && rowOption ? { button_row: rowOption - 1 } : {}),
    });
    if (type === 'button') await syncMessageButtons(message, await rrDb.listForMessage(messageId));
  } catch (error) {
    if (row?.id) await rrDb.removeReactionRoleById(row.id).catch(() => {});
    return failAndClean(error.message || "Couldn't save that role binding.");
  }

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${type === 'button' ? 'Button role' : emoji} now grants ${role} (mode: ${mode}).${posted ? `\nMessage: ${message.url}\nTo add more buttons to it: \`rr add ${message.id} <emoji> <role> --type button\`.` : ''}`, COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const messageId = interaction.options.getString('message_id', true).trim();
  const emoji = interaction.options.getString('emoji', true).trim();
  const channelOption = interaction.options.getChannel('channel');
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const existing = await rrDb.getReactionRole(messageId, emoji);
  const removed = await rrDb.removeReactionRole(messageId, emoji);
  if (removed && existing?.interaction_type === 'button') {
    const message = await findMessage(interaction, messageId, channelOption);
    if (message) await syncMessageButtons(message, await rrDb.listForMessage(messageId)).catch(() => {});
  }
  await interaction.editReply({ components: [textCard(removed ? `${EMOJI.APPROVE}  Role binding removed.` : "That emoji wasn't bound on this message.", removed ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  const messageId = interaction.options.getString('message_id', true).trim();
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await rrDb.listForMessage(messageId);
  const text = rows.length
    ? rows.map((r) => `${r.interaction_type === 'button' ? '[button]' : r.emoji} -> <@&${r.role_id}> (${r.mode})`).join('\n')
    : 'No reaction or button roles on that message.';
  await interaction.editReply({ components: [textCard(text, COLORS.DEFAULT)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function clearCmd(interaction) {
  const messageId = interaction.options.getString('message_id', true).trim();
  const channelOption = interaction.options.getChannel('channel');
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await rrDb.listForMessage(messageId);
  const count = await rrDb.clearForMessage(messageId);
  if (rows.some((row) => row.interaction_type === 'button')) {
    const message = await findMessage(interaction, messageId, channelOption);
    if (message) await syncMessageButtons(message, []).catch(() => {});
  }
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Removed ${count} role binding(s) from that message.`, COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
}
