const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
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
    .addSubcommand((s) => s.setName('top').setDescription('Invite leaderboard for this server.'))
    .addSubcommand((s) => s.setName('who').setDescription('Who invited a member, and how.').addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('list').setDescription('The last members someone invited.').addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('codes').setDescription('The invite links a member has made and how much each was used.').addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)))
    .addSubcommand((s) => s.setName('bonus').setDescription('Add or take away bonus invites (needs Manage Server).')
      .addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How many (negative takes away)').setMinValue(-10000).setMaxValue(10000).setRequired(true)))
    .addSubcommand((s) => s.setName('reset').setDescription('Put the invites of a member back to zero (needs Administrator).').addUserOption((o) => o.setName('user').setDescription('User').setRequired(true))),

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
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
  const rows = await inviteTrackingDb.getLeaderboard(interaction.guild.id, 10);
  if (!rows.length) {
    await interaction.reply(noticePayload('No tracked invites yet.'));
    return;
  }

  const lines = rows.map((r, i) => `**${i + 1}.** <@${r.inviter_id}> · **${r.net}** (${r.joins} joined, ${r.leaves} left${r.bonus ? `, ${r.bonus > 0 ? '+' : ''}${r.bonus} bonus` : ''})`);
  await interaction.reply(infoPayload({
    title: 'Invite leaderboard',
    thumbnail: interaction.guild.iconURL({ size: 256 }),
    subtitle: [interaction.guild.name],
    sections: [{ lines }],
    footer: 'Top 10 by invites',
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
  await interaction.reply(noticePayload(`${amount > 0 ? 'Added' : 'Took away'} **${Math.abs(amount)}** bonus invites ${amount > 0 ? 'to' : 'from'} <@${user.id}>. They have **${net(stats)}** now.`));
}

async function resetCmd(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.Administrator)) {
    await interaction.reply(noticePayload('You need the **Administrator** permission.', COLORS.RED));
    return;
  }
  const user = interaction.options.getUser('user', true);
  await inviteTrackingDb.resetUser(interaction.guild.id, user.id);
  await interaction.reply(noticePayload(`The invites of <@${user.id}> are back to zero.`));
}
