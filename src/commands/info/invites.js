const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { applyRewards } = require('../../utils/inviteRewards');
const inviteTrackingDb = require('../../db/inviteTracking');
const { INFO_ACCENT, infoPayload, noticePayload, line } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

const SOURCE_TEXT = { invite: 'an invite', vanity: 'the server link', unknown: 'a link Petto could not tell' };

module.exports = {
  aliases: ['invs'],
  prefixDefaultSubcommand: 'user',
  data: new SlashCommandBuilder()
    .setName('invites')
    .setDescription('Invite tracker: who invited whom, with fake and bonus invites.')
    .addSubcommand((s) => s.setName('user').setDescription('Invites of a member (default: you).').addUserOption((o) => o.setName('user').setDescription('User').setRequired(false)))
    .addSubcommand((s) => s.setName('top').setDescription('Invite leaderboard for this server.')
      .addStringOption((o) => o.setName('period').setDescription('All time (default), this week or this month').setRequired(false).addChoices({ name: 'All time', value: 'all' }, { name: 'This week', value: 'week' }, { name: 'This month', value: 'month' })))
    .addSubcommand((s) => s.setName('who').setDescription('Who invited a member, and how.').addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('The last members someone invited.').addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('codes').setDescription('The invite links a member has made and how much each was used.').addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('bonus').setDescription('Add or take away bonus invites (needs Manage Server).')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How many (negative takes away)').setMinValue(-10000).setMaxValue(10000).setRequired(true)))
    .addSubcommand((s) => s.setName('config').setDescription('Show the invite settings, or set when an account counts as fake (Manage Server).')
      .addIntegerOption((o) => o.setName('fake_days').setDescription('Accounts younger than this many days are fake joins (0 turns it off; default 3)').setMinValue(0).setMaxValue(365).setRequired(false)))
    .addSubcommandGroup((g) => g.setName('reward').setDescription('Roles given for reaching a number of invites (needs Manage Server).')
      .addSubcommand((s) => s.setName('add').setDescription('Give a role to whoever reaches a number of invites.')
        .addIntegerOption((o) => o.setName('invites').setDescription('How many invites').setMinValue(1).setMaxValue(100000).setRequired(true))
        .addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true)))
      .addSubcommand((s) => s.setName('remove').setDescription('Stop giving a role.').addRoleOption((o) => o.setName('role').setDescription('The role').setRequired(true)))
      .addSubcommand((s) => s.setName('list').setDescription('The roles given for invites.')))
    .addSubcommand((s) => s.setName('reset').setDescription('Put the invites of a member back to zero (needs Administrator).').addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))),

  async execute(interaction) {
    const group = interaction.options.getSubcommandGroup?.(false);
    if (group === 'reward') return rewardCmd(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'config') return configCmd(interaction);
    if (sub === 'top') return topCmd(interaction);
    if (sub === 'who') return whoCmd(interaction);
    if (sub === 'list') return listCmd(interaction);
    if (sub === 'codes') return codesCmd(interaction);
    if (sub === 'bonus') return bonusCmd(interaction);
    if (sub === 'reset') return resetCmd(interaction);
    return userCmd(interaction);
  },
};

const net = (stats) => stats.joins - stats.leaves + stats.bonus;

async function userCmd(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const stats = await inviteTrackingDb.getStats(interaction.guild.id, user.id);

  await interaction.reply(infoPayload({
    accent: interaction.guild.members.cache.get(user.id)?.displayColor || INFO_ACCENT,
    title: `${user.globalName ?? user.username}'s invites`,
    thumbnail: user.displayAvatarURL({ size: 256 }),
    subtitle: [`**${net(stats)}** invites`],
    sections: [{ lines: [line('Joined', stats.joins), line('Left', stats.leaves), line('Fake', stats.fake), line('Bonus', stats.bonus)] }],
    footer: 'Invites = joined - left + bonus. A fake join (account under 3 days old, or someone who came back) is not counted.',
  }));
}

async function topCmd(interaction) {
  const period = interaction.options.getString('period') ?? 'all';
  const rows = period === 'all' ? await inviteTrackingDb.getLeaderboard(interaction.guild.id, 10) : await inviteTrackingDb.getPeriodLeaderboard(interaction.guild.id, period, 10);
  if (!rows.length) {
    await interaction.reply(noticePayload('No tracked invites yet.'));
    return;
  }

  const lines = rows.map((r, i) => `**${i + 1}.** <@${r.inviter_id}> · **${r.net}** (${r.joins} joined, ${r.leaves} left${r.bonus ? `, ${r.bonus > 0 ? '+' : ''}${r.bonus} bonus` : ''})`);
  await interaction.reply(infoPayload({
    title: period === 'all' ? 'Invite leaderboard' : `Invite leaderboard · this ${period}`,
    thumbnail: interaction.guild.iconURL({ size: 256 }),
    subtitle: [interaction.guild.name],
    sections: [{ lines }],
    footer: period === 'all' ? 'Top 10 by invites' : 'Top 10 by invites this period (GMT-5)',
  }));
}

async function whoCmd(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const row = await inviteTrackingDb.getInviter(interaction.guild.id, user.id);
  if (!row) {
    await interaction.reply(noticePayload('Petto has no record of how that member joined (they came before it was tracking).'));
    return;
  }
  await interaction.reply(infoPayload({
    title: `How ${user.globalName ?? user.username} joined`,
    thumbnail: user.displayAvatarURL({ size: 256 }),
    sections: [{
      lines: [
        line('Invited by', row.inviter_id ? `<@${row.inviter_id}>` : 'Unknown'),
        line('Through', SOURCE_TEXT[row.source] ?? row.source),
        line('Code', row.invite_code ? `\`${row.invite_code}\`` : null),
        line('Joined', `<t:${Math.floor(new Date(row.joined_at).getTime() / 1000)}:R>`),
        line('Counted', row.fake ? 'No, it is a fake join' : 'Yes'),
      ],
    }],
    footer: `ID ${user.id}`,
  }));
}

async function listCmd(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  const rows = await inviteTrackingDb.listInvited(interaction.guild.id, user.id, 15);
  if (!rows.length) {
    await interaction.reply(noticePayload(`${user.globalName ?? user.username} has not invited anybody that Petto saw.`));
    return;
  }
  const lines = rows.map((r) => `<@${r.user_id}> · <t:${Math.floor(new Date(r.joined_at).getTime() / 1000)}:R>${r.left_at ? ' · left' : ''}${r.fake ? ' · fake' : ''}`);
  await interaction.reply(infoPayload({
    title: `Invited by ${user.globalName ?? user.username}`,
    thumbnail: user.displayAvatarURL({ size: 256 }),
    sections: [{ lines }],
    footer: 'The last 15',
  }));
}

async function codesCmd(interaction) {
  const user = interaction.options.getUser('user') ?? interaction.user;
  if (!interaction.guild.members.me.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply(noticePayload('I need the **Manage Server** permission to read the invite links.', COLORS.RED));
    return;
  }
  const invites = await interaction.guild.invites.fetch().catch(() => null);
  if (!invites) {
    await interaction.reply(noticePayload('I could not read the invite links of this server.', COLORS.RED));
    return;
  }
  const own = [...invites.values()].filter((i) => i.inviter?.id === user.id).sort((a, b) => (b.uses ?? 0) - (a.uses ?? 0)).slice(0, 15);
  if (!own.length) {
    await interaction.reply(noticePayload(`${user.globalName ?? user.username} has no invite links right now.`));
    return;
  }
  const lines = own.map((i) => `\`${i.code}\` · <#${i.channelId}> · **${i.uses ?? 0}** uses${i.maxUses ? ` of ${i.maxUses}` : ''}${i.expiresTimestamp ? ` · ends <t:${Math.floor(i.expiresTimestamp / 1000)}:R>` : ''}`);
  await interaction.reply(infoPayload({ title: `Invite links of ${user.globalName ?? user.username}`, thumbnail: user.displayAvatarURL({ size: 256 }), sections: [{ lines }] }));
}

async function bonusCmd(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply(noticePayload('You need the **Manage Server** permission.', COLORS.RED));
    return;
  }
  const user = interaction.options.getUser('user', true);
  const amount = interaction.options.getInteger('amount', true);
  if (amount === 0) {
    await interaction.reply(noticePayload('The amount cannot be zero.'));
    return;
  }
  const stats = await inviteTrackingDb.addBonus(interaction.guild.id, user.id, amount);
  await applyRewards(interaction.guild, user.id);
  await interaction.reply(noticePayload(`${amount > 0 ? 'Added' : 'Took away'} **${Math.abs(amount)}** bonus invites ${amount > 0 ? 'to' : 'from'} <@${user.id}>. They have **${net(stats)}** now.`));
}

async function resetCmd(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply(noticePayload('You need the **Administrator** permission.', COLORS.RED));
    return;
  }
  const user = interaction.options.getUser('user', true);
  await inviteTrackingDb.resetUser(interaction.guild.id, user.id);
  await applyRewards(interaction.guild, user.id);
  await interaction.reply(noticePayload(`The invites of <@${user.id}> are back to zero.`));
}

function needManageGuild(interaction) {
  if (interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) return false;
  interaction.reply(noticePayload('You need the **Manage Server** permission.', COLORS.RED));
  return true;
}

async function configCmd(interaction) {
  const days = interaction.options.getInteger('fake_days');
  if (days !== null) {
    if (needManageGuild(interaction)) return;
    await inviteTrackingDb.setFakeDays(interaction.guild.id, days);
    await interaction.reply(noticePayload(days ? `Accounts younger than **${days}** day${days === 1 ? '' : 's'} (and members who come back) count as fake joins from now on.` : 'Only members who come back count as fake joins now (the age of the account is not checked).'));
    return;
  }
  const settings = await inviteTrackingDb.getSettings(interaction.guild.id);
  const rewards = await inviteTrackingDb.listRewards(interaction.guild.id);
  await interaction.reply(infoPayload({
    title: 'Invite settings',
    thumbnail: interaction.guild.iconURL({ size: 256 }),
    sections: [{ lines: [line('Fake joins', settings.fakeDays ? `accounts under ${settings.fakeDays} day${settings.fakeDays === 1 ? '' : 's'}, and members who come back` : 'only members who come back'), line('Rewards', rewards.length ? String(rewards.length) : 'none')] }],
    footer: 'Change it with invites config fake_days <days>',
  }));
}

async function rewardCmd(interaction) {
  const sub = interaction.options.getSubcommand();
  const guild = interaction.guild;
  if (sub === 'list') {
    const rewards = await inviteTrackingDb.listRewards(guild.id);
    await interaction.reply(rewards.length
      ? infoPayload({ title: 'Invite rewards', sections: [{ lines: rewards.map((r) => `**${r.invites}** invites → <@&${r.role_id}>`) }], footer: 'A role is given when someone reaches the number, and taken away if they fall below it.' })
      : noticePayload('There are no invite rewards. Add one with `invites reward add <invites> <role>`.'));
    return;
  }
  if (needManageGuild(interaction)) return;
  const role = interaction.options.getRole('role', true);
  if (sub === 'remove') {
    const removed = await inviteTrackingDb.removeReward(guild.id, role.id);
    await interaction.reply(noticePayload(removed ? `<@&${role.id}> is no longer given for invites.` : 'That role was not an invite reward.'));
    return;
  }
  const invites = interaction.options.getInteger('invites', true);
  const me = guild.members.me;
  if (role.managed || role.id === guild.id || role.position >= me.roles.highest.position) {
    await interaction.reply(noticePayload('I cannot give that role: it is managed by an integration, it is @everyone, or it is above my highest role.', COLORS.RED));
    return;
  }
  if (interaction.member.id !== guild.ownerId && role.position >= interaction.member.roles.highest.position) {
    await interaction.reply(noticePayload('You can only use roles below your own highest role.', COLORS.RED));
    return;
  }
  await inviteTrackingDb.addReward(guild.id, invites, role.id);
  await interaction.reply(noticePayload(`<@&${role.id}> is given at **${invites}** invites. Checking who has them already...`));
  for (const inviterId of await inviteTrackingDb.listInviterIds(guild.id)) await applyRewards(guild, inviterId);
}
