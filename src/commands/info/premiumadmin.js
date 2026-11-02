// i18n-ignore-file: the owner operations of Premium (grant, assign, unassign, revoke): team tools, they read English.
const { SlashCommandBuilder, EmbedBuilder, MessageFlags } = require('discord.js');
const config = require('../../config');
const {
  grantManualPremium,
  assignPremiumSlot,
  unassignPremiumSlot,
  revokeManualPremium,
} = require('../../db/premium');
const { COLORS } = require('../../utils/colors');
const logger = require('../../utils/logger');
const { syncPremiumRoleForUser } = require('../../jobs/premiumRoleJob');

/** Only the Petto OWNER may change Premium (a developer of the team may not): for everybody else this is not a command at all. */
const isOwner = (userId) => String(userId ?? '') === String(config.ownerId);

/**
 * `!premiumadmin grant|assign|unassign|revoke`: the owner-only actions of Petto Premium. They used to be subcommands of `/premium` (and so of `/bot premium`), which showed
 * them to everybody in the `/` menu; now they are prefix only and hidden. The old words keep working (`!premium grant ...` is `!premiumadmin grant ...`, see `prefixWords`
 * of the `premium` command), and what members need (`status`) stays in `/premium`.
 */
module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  hiddenEverywhere: true,
  teamOnly: true,
  // Narrower than the team: a developer who is not the owner gets no answer either (src/utils/hiddenCommands.js).
  ownerOnly: true,
  team: {
    summary: 'Premium by hand: grants permanent Premium with server slots, activates or releases a slot on a server, or revokes a manual grant (paid subscriptions are managed from the billing portal). The old `!premium grant ...` words still work.',
    usage: ['!premiumadmin grant <user> <slots> [server id]', '!premiumadmin assign <user> <server id>', '!premiumadmin unassign <user> <server id>', '!premiumadmin revoke <user>'],
    who: 'owner only (not the developers)',
    area: 'premium',
    examples: ['!premiumadmin grant @user 3', '!premiumadmin assign @user 123456789012345678'],
    answers: 'one card: what was done, or why it could not be done',
    dangers: 'It changes what a person gets for free: a revoke releases all their slots and restores the avatar, banner and bio of those servers.',
  },
  data: new SlashCommandBuilder()
    .setName('premiumadmin')
    .setDescription('Private control: grant, assign, unassign or revoke Petto Premium by hand (owner only).')
    .setDMPermission(false)
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
    // The second lock: the first one is in the message handler, where nobody else gets an answer.
    if (!isOwner(interaction.user?.id)) return undefined;
    const subcommand = interaction.options.getSubcommand(false);
    try {
      if (subcommand === 'grant') return await grant(interaction);
      if (subcommand === 'assign') return await assign(interaction);
      if (subcommand === 'unassign') return await unassign(interaction);
      if (subcommand === 'revoke') return await revoke(interaction);
      return await replyError(interaction, 'Use `!premiumadmin grant|assign|unassign|revoke`.');
    } catch (error) {
      logger.error(`Premium admin action failed for ${interaction.user?.id ?? 'unknown user'}:`, error);
      return replyError(interaction, 'The Premium action failed.');
    }
  },
};

async function grant(interaction) {
  const user = interaction.options.getUser('user', true);
  const slots = interaction.options.getInteger('slots', true);
  const guildId = interaction.options.getString('guild_id');
  const result = await grantManualPremium(user.id, slots, interaction.user.id, guildId);

  if (!result.ok) return replyError(interaction, grantError(result));
  await syncPremiumRoleForUser(interaction.client, user.id).catch((error) => logger.warn('Immediate Premium role sync failed:', error.message));
  const assigned = result.assignment ? ` It is active on server **${guildId}**.` : '';
  return replySuccess(interaction, `Permanent Premium granted to <@${user.id}> with **${slots}** server slot${slots === 1 ? '' : 's'}.${assigned}`);
}

async function assign(interaction) {
  const user = interaction.options.getUser('user', true);
  const guildId = interaction.options.getString('guild_id', true).trim();
  const result = await assignPremiumSlot(user.id, guildId);
  if (!result.ok) return replyError(interaction, assignmentError(result));
  return replySuccess(interaction, result.already ? `Premium is already active on server **${guildId}**.` : `Premium activated on server **${guildId}** for <@${user.id}>.`);
}

async function unassign(interaction) {
  const user = interaction.options.getUser('user', true);
  const guildId = interaction.options.getString('guild_id', true).trim();
  const result = await unassignPremiumSlot(user.id, guildId, interaction.client);
  if (!result.ok) return replyError(interaction, result.code === 'no_assignment' ? 'That user has no active Premium slot on this server.' : 'The server ID is invalid.');
  return replySuccess(interaction, `Premium released from server **${guildId}**. Its avatar, banner, and bio were restored to the free defaults; the server nickname was kept.`);
}

async function revoke(interaction) {
  const user = interaction.options.getUser('user', true);
  const result = await revokeManualPremium(user.id, interaction.user.id, interaction.client);
  if (!result.ok) {
      if (result.code === 'no_manual') return replyError(interaction, `No manual Premium grant was found for <@${user.id}>. Paid Polar subscriptions are managed from the billing portal.`);
    return replyError(interaction, 'The Premium grant could not be revoked.');
  }
  await syncPremiumRoleForUser(interaction.client, user.id).catch((error) => logger.warn('Immediate Premium role sync failed:', error.message));
  return replySuccess(interaction, `Manual Premium revoked for <@${user.id}>. Released **${result.releasedGuildIds.length}** server slot${result.releasedGuildIds.length === 1 ? '' : 's'}.`);
}

function grantError(result) {
  if (result.code === 'paid_active') return 'This user already has an active paid Polar Premium entitlement. Do not replace it with a manual grant.';
  if (result.code === 'slots_below_usage') return `That user already has ${result.used} active slot${result.used === 1 ? '' : 's'}; the new limit cannot be lower than current usage.`;
  if (result.code === 'no_slots') return 'The Premium grant was saved, but it has no free slots. Use `!premium assign @user SERVER_ID` after increasing the limit.';
  if (result.code === 'invalid_guild') return 'The optional server ID is invalid.';
  return 'The Premium grant could not be saved.';
}

function assignmentError(result) {
  if (result.code === 'no_active_entitlement') return 'That user has no active Premium entitlement.';
  if (result.code === 'server_taken') return 'That server already has an active Premium owner. Release it first if you need to move the slot.';
  if (result.code === 'no_slots') return `That account has used all its Premium slots (${result.used}/${result.limit}).`;
  if (result.code === 'invalid_guild') return 'The server ID is invalid.';
  return 'The Premium slot could not be assigned.';
}

async function replySuccess(interaction, content) {
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.GREEN).setDescription(`✅ ${content}`)], allowedMentions: { parse: [] } });
}

async function replyError(interaction, content) {
  return interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.RED).setDescription(`⚠️ ${content}`)], flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } });
}
