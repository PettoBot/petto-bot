const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const rrDb = require('../../db/reactionRoles');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { syncMessageButtons } = require('../../interactions/reactionRoleButton');
const { templatePayload } = require('../../utils/templatedMessage');
const { t, tn, languageOf } = require('../../i18n');

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
  const lang = await languageOf(interaction);
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
    if (!embedName) return fail(t(lang, 'automation.reactionrole.needEmbed'));
    const channel = channelOption ?? interaction.channel;
    const payload = await templatePayload(interaction.guild.id, embedName, { guild: interaction.guild, user: interaction.user, member: interaction.member, channel });
    if (!payload) return fail(t(lang, 'automation.reactionrole.embedMissing', { name: embedName }));
    if (payload.flags) return fail(t(lang, 'automation.reactionrole.v2'));
    message = await channel.send({ content: payload.content, embeds: payload.embeds, allowedMentions: { parse: [] } }).catch(() => null);
    if (!message) return fail(t(lang, 'automation.reactionrole.postFailed', { channel: `${channel}` }));
    posted = true;
    messageId = message.id;
    type = 'button';
  } else {
    message = await findMessage(interaction, messageId, channelOption);
    if (!message) return fail(t(lang, 'automation.reactionrole.noMessage'));
  }
  // A message made just for this and left with no button would be left over, so it is taken down when something fails.
  const failAndClean = async (text) => { if (posted) await message.delete().catch(() => {}); return fail(text); };

  if (await rrDb.getReactionRole(messageId, emoji)) return failAndClean(t(lang, 'automation.reactionrole.alreadyBound'));

  if (type === 'reaction') {
    try {
      await message.react(emoji);
    } catch {
      return failAndClean(t(lang, 'automation.reactionrole.reactFailed'));
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
    if (type === 'button') await syncMessageButtons(message, await rrDb.listForMessage(messageId), lang);
  } catch (error) {
    if (row?.id) await rrDb.removeReactionRoleById(row.id).catch(() => {});
    return failAndClean(error.message || t(lang, 'automation.reactionrole.saveFailed'));
  }

  const grants = t(lang, type === 'button' ? 'automation.reactionrole.grantsButton' : 'automation.reactionrole.grantsEmoji', { emoji: EMOJI.APPROVE, reaction: emoji, role: `${role}`, mode });
  await interaction.editReply({ components: [textCard(`${grants}${posted ? `\n${t(lang, 'automation.reactionrole.postedHint', { url: message.url, id: message.id })}` : ''}`, COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
}

async function removeCmd(interaction) {
  const lang = await languageOf(interaction);
  const messageId = interaction.options.getString('message_id', true).trim();
  const emoji = interaction.options.getString('emoji', true).trim();
  const channelOption = interaction.options.getChannel('channel');
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const existing = await rrDb.getReactionRole(messageId, emoji);
  const removed = await rrDb.removeReactionRole(messageId, emoji);
  if (removed && existing?.interaction_type === 'button') {
    const message = await findMessage(interaction, messageId, channelOption);
    if (message) await syncMessageButtons(message, await rrDb.listForMessage(messageId), lang).catch(() => {});
  }
  await interaction.editReply({ components: [textCard(removed ? t(lang, 'automation.reactionrole.removed', { emoji: EMOJI.APPROVE }) : t(lang, 'automation.reactionrole.notBound'), removed ? COLORS.GREEN : COLORS.RED)], flags: MessageFlags.IsComponentsV2 });
}

async function listCmd(interaction) {
  const lang = await languageOf(interaction);
  const messageId = interaction.options.getString('message_id', true).trim();
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await rrDb.listForMessage(messageId);
  const text = rows.length
    ? rows.map((r) => `${r.interaction_type === 'button' ? t(lang, 'automation.reactionrole.buttonTag') : r.emoji} -> <@&${r.role_id}> (${r.mode})`).join('\n')
    : t(lang, 'automation.reactionrole.listEmpty');
  await interaction.editReply({ components: [textCard(text, COLORS.DEFAULT)], flags: MessageFlags.IsComponentsV2, allowedMentions: { parse: [] } });
}

async function clearCmd(interaction) {
  const lang = await languageOf(interaction);
  const messageId = interaction.options.getString('message_id', true).trim();
  const channelOption = interaction.options.getChannel('channel');
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const rows = await rrDb.listForMessage(messageId);
  const count = await rrDb.clearForMessage(messageId);
  if (rows.some((row) => row.interaction_type === 'button')) {
    const message = await findMessage(interaction, messageId, channelOption);
    if (message) await syncMessageButtons(message, [], lang).catch(() => {});
  }
  await interaction.editReply({ components: [textCard(tn(lang, 'automation.reactionrole.cleared', count, { count, emoji: EMOJI.APPROVE }), COLORS.GREEN)], flags: MessageFlags.IsComponentsV2 });
}
