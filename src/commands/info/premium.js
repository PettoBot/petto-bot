const { SlashCommandBuilder, EmbedBuilder } = require('discord.js');
const config = require('../../config');
const {
  getUserPremium,
  grantManualPremium,
  assignPremiumSlot,
  unassignPremiumSlot,
  revokeManualPremium,
} = require('../../db/premium');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { syncPremiumRoleForUser } = require('../../jobs/premiumRoleJob');
const { t, languageOf } = require('../../i18n');

// The statuses with a name in the catalogs (`info.premium.status.<key>`); any other is shown as it is stored.
const STATUS_KEYS = { active: 'active', pending: 'pending', past_due: 'pastDue', canceled: 'canceled', expired: 'expired', free: 'free' };

// The owner actions (grant, assign, unassign, revoke) answer only the Petto owner: those answers are team operations and
// stay in English. What any member can see (the status card and its errors) is translated.

module.exports = {
  // This builder is used by the prefix parser only. deployCommands.js skips
  // every command marked prefixOnly, so no /premium command is created.
  prefixOnly: true,
  prefixDefaultSubcommand: 'status',
  aliases: ['prem'],
  data: new SlashCommandBuilder()
    .setName('premium')
    .setDescription('View or manage Petto Premium from the message prefix.')
    .setDMPermission(false)
    .addSubcommand((sub) => sub
      .setName('status')
      .setDescription('Show Premium status for yourself or another user.')
      .addUserOption((option) => option.setName('user').setDescription('User to inspect (default: you)').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('grant')
      .setDescription('Give a user permanent Premium. Owner only.')
      .addUserOption((option) => option.setName('user').setDescription('Discord user').setRequired(true))
      .addIntegerOption((option) => option.setName('slots').setDescription('Number of server slots').setMinValue(1).setMaxValue(1000).setRequired(true))
      .addStringOption((option) => option.setName('guild_id').setDescription('Optional server ID to activate immediately').setRequired(false)))
    .addSubcommand((sub) => sub
      .setName('assign')
      .setDescription('Activate a Premium slot on a server. Owner only.')
      .addUserOption((option) => option.setName('user').setDescription('Premium owner').setRequired(true))
      .addStringOption((option) => option.setName('guild_id').setDescription('Server ID').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('unassign')
      .setDescription('Release a Premium slot from a server. Owner only.')
      .addUserOption((option) => option.setName('user').setDescription('Premium owner').setRequired(true))
      .addStringOption((option) => option.setName('guild_id').setDescription('Server ID').setRequired(true)))
    .addSubcommand((sub) => sub
      .setName('revoke')
      .setDescription('Revoke a manual permanent Premium grant. Owner only.')
      .addUserOption((option) => option.setName('user').setDescription('Premium owner').setRequired(true))),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const subcommand = interaction.options.getSubcommand(false) ?? 'status';
    try {
      if (subcommand === 'status') return status(interaction, lang);
      if (!isOwner(interaction)) return replyError(interaction, t(lang, 'info.premium.ownerOnly'));
      if (subcommand === 'grant') return grant(interaction);
      if (subcommand === 'assign') return assign(interaction);
      if (subcommand === 'unassign') return unassign(interaction);
      if (subcommand === 'revoke') return revoke(interaction);
      return replyError(interaction, t(lang, 'info.premium.unknownAction'));
    } catch (error) {
      logger.error(`Premium command failed for ${interaction.user?.id ?? 'unknown user'}:`, error);
      return replyError(interaction, t(lang, 'info.premium.failed'));
    }
  },
};

function isOwner(interaction) {
  return interaction.user?.id === config.ownerId;
}

async function status(interaction, lang) {
  const requested = interaction.options.getUser('user');
  if (requested && requested.id !== interaction.user.id && !isOwner(interaction)) {
    return replyError(interaction, t(lang, 'info.premium.ownStatusOnly'));
  }
  const user = requested ?? interaction.user;
  const premium = await getUserPremium(user.id);
  const embed = buildStatusEmbed(interaction, user, premium, lang);
  return interaction.reply({ embeds: [embed], allowedMentions: { parse: [] } });
}

async function grant(interaction) {
  const user = interaction.options.getUser('user', true);
  const slots = interaction.options.getInteger('slots', true);
  const guildId = interaction.options.getString('guild_id');
  const result = await grantManualPremium(user.id, slots, interaction.user.id, guildId);

  if (!result.ok) return replyError(interaction, grantError(result));
  await syncPremiumRoleForUser(interaction.client, user.id).catch((error) => logger.warn('Immediate Premium role sync failed:', error.message));
  const assigned = result.assignment ? ` It is active on server **${guildId}**.` : ''; // i18n-ignore: owner operation
  // i18n-ignore: owner operation
  return replySuccess(interaction, `Permanent Premium granted to <@${user.id}> with **${slots}** server slot${slots === 1 ? '' : 's'}.${assigned}`);
}

async function assign(interaction) {
  const user = interaction.options.getUser('user', true);
  const guildId = interaction.options.getString('guild_id', true).trim();
  const result = await assignPremiumSlot(user.id, guildId);
  if (!result.ok) return replyError(interaction, assignmentError(result));
  // i18n-ignore: owner operation
  return replySuccess(interaction, result.already ? `Premium is already active on server **${guildId}**.` : `Premium activated on server **${guildId}** for <@${user.id}>.`);
}

async function unassign(interaction) {
  const user = interaction.options.getUser('user', true);
  const guildId = interaction.options.getString('guild_id', true).trim();
  const result = await unassignPremiumSlot(user.id, guildId, interaction.client);
  // i18n-ignore: owner operation
  if (!result.ok) return replyError(interaction, result.code === 'no_assignment' ? 'That user has no active Premium slot on this server.' : 'The server ID is invalid.');
  // i18n-ignore: owner operation
  return replySuccess(interaction, `Premium released from server **${guildId}**. Its avatar, banner, and bio were restored to the free defaults; the server nickname was kept.`);
}

async function revoke(interaction) {
  const user = interaction.options.getUser('user', true);
  const result = await revokeManualPremium(user.id, interaction.user.id, interaction.client);
  if (!result.ok) {
    // i18n-ignore: owner operation
    if (result.code === 'no_manual') return replyError(interaction, `No manual Premium grant was found for <@${user.id}>. Paid Polar subscriptions are managed from the billing portal.`);
    return replyError(interaction, 'The Premium grant could not be revoked.'); // i18n-ignore: owner operation
  }
  await syncPremiumRoleForUser(interaction.client, user.id).catch((error) => logger.warn('Immediate Premium role sync failed:', error.message));
  // i18n-ignore: owner operation
  return replySuccess(interaction, `Manual Premium revoked for <@${user.id}>. Released **${result.releasedGuildIds.length}** server slot${result.releasedGuildIds.length === 1 ? '' : 's'}.`);
}

function buildStatusEmbed(interaction, user, premium, lang) {
  const entitlement = premium.entitlement;
  const status = STATUS_KEYS[premium.status] ? t(lang, `info.premium.status.${STATUS_KEYS[premium.status]}`) : premium.status;
  const stateColor = premium.active ? COLORS.GREEN : premium.status === 'free' ? COLORS.DEFAULT : COLORS.YELLOW;
  const assigned = premium.assignments.length
    ? premium.assignments.map((assignment) => formatGuild(interaction, assignment.guild_id)).join('\n').slice(0, 1024)
    : t(lang, 'info.premium.noServers');
  const period = premium.active
    ? (premium.expiresAt ? `<t:${Math.floor(new Date(premium.expiresAt).getTime() / 1000)}:F>` : t(lang, 'info.premium.permanent'))
    : entitlement?.current_period_end ? `<t:${Math.floor(new Date(entitlement.current_period_end).getTime() / 1000)}:F>` : '—';

  return new EmbedBuilder()
    .setColor(stateColor)
    .setAuthor({ name: `${user.username} · Premium`, iconURL: user.displayAvatarURL() })
    .setTitle(t(lang, 'info.premium.title', { status }))
    .setDescription(t(lang, premium.active ? 'info.premium.description.active' : 'info.premium.description.inactive'))
    .addFields(
      { name: t(lang, 'info.premium.field.user'), value: `<@${user.id}>\n\`${user.id}\``, inline: true },
      { name: t(lang, 'info.premium.field.plan'), value: entitlement?.plan_key ?? t(lang, 'info.premium.status.free'), inline: true },
      { name: t(lang, 'info.premium.field.period'), value: period, inline: true },
      { name: t(lang, 'info.premium.field.slots'), value: `${premium.slotsUsed} / ${premium.slotsTotal}`, inline: true },
      { name: t(lang, 'info.premium.field.servers'), value: assigned, inline: false },
    )
    .setFooter({ text: t(lang, 'info.premium.footer') });
}

function formatGuild(interaction, guildId) {
  const guild = interaction.client.guilds.cache.get(guildId);
  return guild ? `**${guild.name}** · \`${guildId}\`` : `\`${guildId}\``;
}

function grantError(result) {
  if (result.code === 'paid_active') return 'This user already has an active paid Polar Premium entitlement. Do not replace it with a manual grant.'; // i18n-ignore: owner operation
  if (result.code === 'slots_below_usage') return `That user already has ${result.used} active slot${result.used === 1 ? '' : 's'}; the new limit cannot be lower than current usage.`; // i18n-ignore: owner operation
  if (result.code === 'no_slots') return 'The Premium grant was saved, but it has no free slots. Use `!premium assign @user SERVER_ID` after increasing the limit.'; // i18n-ignore: owner operation
  if (result.code === 'invalid_guild') return 'The optional server ID is invalid.'; // i18n-ignore: owner operation
  return 'The Premium grant could not be saved.'; // i18n-ignore: owner operation
}

function assignmentError(result) {
  if (result.code === 'no_active_entitlement') return 'That user has no active Premium entitlement.'; // i18n-ignore: owner operation
  if (result.code === 'server_taken') return 'That server already has an active Premium owner. Release it first if you need to move the slot.'; // i18n-ignore: owner operation
  if (result.code === 'no_slots') return `That account has used all its Premium slots (${result.used}/${result.limit}).`; // i18n-ignore: owner operation
  if (result.code === 'invalid_guild') return 'The server ID is invalid.'; // i18n-ignore: owner operation
  return 'The Premium slot could not be assigned.'; // i18n-ignore: owner operation
}

async function replySuccess(interaction, content) {
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.GREEN).setDescription(`✅ ${content}`)], allowedMentions: { parse: [] } });
}

async function replyError(interaction, content) {
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.RED).setDescription(`⚠️ ${content}`)], allowedMentions: { parse: [] } });
}
