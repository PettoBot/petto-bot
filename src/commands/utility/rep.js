const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/reputation');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { formatDuration } = require('../../utils/duration');
const logger = require('../../utils/logger');
const { t, tn, languageOf } = require('../../i18n');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rep')
    .setDescription('A simple reputation point members can give each other.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('give').setDescription('Give a member a reputation point.').addUserOption((o) => o.setName('user').setDescription('Member to thank').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription("Check your (or someone else's) reputation.").addUserOption((o) => o.setName('user').setDescription('Member').setRequired(false)))
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Top reputation in this server.'))
    .addSubcommand((s) =>
      s
        .setName('reset')
        .setDescription('(Staff) Reset a member\'s reputation to 0.')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    ),
  aliases: ['reputation'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'give') return giveCmd(interaction);
    if (sub === 'view') return viewCmd(interaction);
    if (sub === 'leaderboard') return leaderboardCmd(interaction);
    return resetCmd(interaction);
  },
};

async function giveCmd(interaction) {
  const lang = await languageOf(interaction);
  const target = interaction.options.getUser('user', true);

  if (target.id === interaction.user.id) {
    await interaction.reply({ content: t(lang, 'utility.rep.self'), flags: MessageFlags.Ephemeral });
    return;
  }
  if (target.bot) {
    await interaction.reply({ content: t(lang, 'utility.rep.bot'), flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const config = await db.getConfig(interaction.guild.id);
  if (!config.enabled) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.rep.disabled'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  // Where and by whom, as set on the dashboard: the channel (a thread counts as its parent), the roles that may give, the blocked roles.
  const channelIds = config.channel_ids ?? [];
  const channel = interaction.channel;
  if (channelIds.length && !channelIds.includes(interaction.channelId) && !(channel?.isThread?.() && channelIds.includes(channel.parentId))) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.rep.wrongChannel', { channels: channelIds.map((id) => `<#${id}>`).join(', ') }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const giverRoles = roleIdsOf(interaction.member);
  const blocked = config.blocked_role_ids ?? [];
  if (blocked.some((id) => giverRoles.has(id))) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.rep.blocked'), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const giverRoleIds = config.giver_role_ids ?? [];
  if (giverRoleIds.length && !giverRoleIds.some((id) => giverRoles.has(id))) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.rep.noRole', { roles: giverRoleIds.map((id) => `<@&${id}>`).join(', ') }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const targetMember = await interaction.guild.members.fetch(target.id).catch(() => null);
  if (targetMember && blocked.some((id) => targetMember.roles.cache.has(id))) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.rep.targetBlocked', { user: `${target}` }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const giver = await db.getUser(interaction.guild.id, interaction.user.id);
  if (config.cooldown_hours > 0 && giver.last_given_at) {
    const cooldownMs = config.cooldown_hours * 3600_000;
    const elapsed = Date.now() - new Date(giver.last_given_at).getTime();
    const remaining = cooldownMs - elapsed;
    if (remaining > 0) {
      await interaction.editReply({ components: [textCard(t(lang, 'utility.rep.cooldown', { duration: formatDuration(remaining, lang) }), 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  await db.giveRep(interaction.guild.id, interaction.user.id, target.id);
  await db.logRep(interaction.guild.id, interaction.user.id, target.id, interaction.channelId).catch((err) => logger.warn('Reputation log failed:', err.message));
  const receiver = await db.getUser(interaction.guild.id, target.id);
  const earned = targetMember ? await giveRewards(interaction.guild, targetMember, db.rewardsFor(config, receiver.points), lang) : [];

  let text = t(lang, 'utility.rep.given', { emoji: EMOJI.APPROVE, user: `${target}`, points: receiver.points });
  if (earned.length) text += `\n${t(lang, 'utility.rep.reward', { user: `${target}`, roles: earned.map((id) => `<@&${id}>`).join(', ') })}`;
  await interaction.editReply({
    components: [textCard(text, 0xa5ea7a)],
    flags: MessageFlags.IsComponentsV2,
  });
}

/** The role ids of a member, from a cached member or the raw one Discord sends with an interaction. */
function roleIdsOf(member) {
  if (member?.roles?.cache) return new Set(member.roles.cache.keys());
  return new Set(Array.isArray(member?.roles) ? member.roles : []);
}

/** Gives the reward roles the member does not have yet and returns the ones given (a role Petto cannot give is skipped). */
async function giveRewards(guild, member, rewards, lang) {
  const given = [];
  for (const reward of rewards) {
    if (member.roles.cache.has(reward.roleId)) continue;
    const role = guild.roles.cache.get(reward.roleId);
    if (!role || role.managed || !role.editable) continue;
    const ok = await member.roles.add(role, t(lang, 'utility.rep.rewardReason', { points: reward.points })).then(() => true, () => false);
    if (ok) given.push(role.id);
  }
  return given;
}

async function viewCmd(interaction) {
  const lang = await languageOf(interaction);
  const target = interaction.options.getUser('user') ?? interaction.user;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const row = await db.getUser(interaction.guild.id, target.id);
  await interaction.editReply({ components: [textCard(tn(lang, 'utility.rep.points', row.points, { user: `${target}`, count: row.points }), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
}

async function leaderboardCmd(interaction) {
  const lang = await languageOf(interaction);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const top = await db.getLeaderboard(interaction.guild.id, 10);
  if (!top.length) {
    await interaction.editReply({ components: [textCard(t(lang, 'utility.rep.empty'), 0x4b4f59)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((row, i) => `${medals[i] ?? `**${i + 1}.**`} <@${row.user_id}> — **${row.points}**`);
  await interaction.editReply({ components: [textCard(`**${t(lang, 'utility.rep.leaderboard')}**\n${lines.join('\n')}`, 0xfed53c)], flags: MessageFlags.IsComponentsV2 });
}

async function resetCmd(interaction) {
  const lang = await languageOf(interaction);
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: t(lang, 'core.moderate.youNeed', { permission: t(lang, 'core.perm.ManageGuild') }), flags: MessageFlags.Ephemeral });
    return;
  }

  const target = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await db.resetUser(interaction.guild.id, target.id);

  await interaction.editReply({ components: [textCard(t(lang, 'utility.rep.reset', { emoji: EMOJI.APPROVE, user: `${target}` }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
