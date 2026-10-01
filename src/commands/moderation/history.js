const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { getUserHistory } = require('../../db/modActions');
const { getNotesForUser } = require('../../db/notes');
const { getActiveWarns } = require('../../db/warns');
const { getJailed } = require('../../db/jail');
const { listReports } = require('../../db/report');
const { ensureGuild } = require('../../db/guilds');
const { infoPayload, clip, stamp, line } = require('../../utils/infoCard');
const { EMOJI, TYPE_EMOJI } = require('../../utils/emojis');
const { COLORS } = require('../../utils/colors');
const { settle } = require('../../utils/withTimeout');

const CASE_SCAN_LIMIT = 500;
const RECENT_CASES = 5;

// How case types are grouped into the totals line.
const TOTAL_GROUPS = [
  ['Warns', ['warn']],
  ['Mutes', ['mute', 'tempmute']],
  ['Jails', ['jail']],
  ['Kicks', ['kick', 'softban']],
  ['Bans', ['ban', 'tempban']],
];

function capitalize(text) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function totals(cases) {
  return TOTAL_GROUPS
    .map(([label, types]) => [label, cases.filter((row) => types.includes(row.type)).length])
    .filter(([, count]) => count > 0)
    .map(([label, count]) => `**${label}** ${count}`);
}

/** What applies to the member right now, from the strictest down. */
function currentStatus({ jail, member, muteRoleId, banned }) {
  const status = [];
  if (banned) status.push('Banned from the server');
  if (jail) status.push(`In jail${jail.expires_at ? ` until <t:${Math.floor(new Date(jail.expires_at).getTime() / 1000)}:f>` : ' with no end'}`);
  if (member?.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
    status.push(`Timed out until <t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:f>`);
  }
  if (muteRoleId && member?.roles?.cache?.has(muteRoleId)) status.push('Has the mute role');
  return status;
}

module.exports = {
  aliases: ['hist', 'modhistory'],
  data: new SlashCommandBuilder()
    .setName('history')
    .setDescription("Everything moderation knows about a member: cases, notes, reports and current status.")
    .setDefaultMemberPermissions(PermissionFlagsBits.ModerateMembers)
    .setDMPermission(false)
    .addUserOption((opt) => opt.setName('user').setDescription('The member to look up (default: you)').setRequired(false)),

  async execute(interaction) {
    const user = interaction.options.getUser('user') ?? interaction.user;
    const guild = interaction.guild;
    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

    // Everything is read at once, and a source that fails only removes its own section.
    const [guildRow, cases, notes, warns, jail, reportsAbout, openReports, member] = await Promise.all([
      settle(ensureGuild(guild.id)),
      settle(getUserHistory(guild.id, user.id, { limit: CASE_SCAN_LIMIT })),
      settle(getNotesForUser(guild.id, user.id)),
      settle(getActiveWarns(guild.id, user.id)),
      settle(getJailed(guild.id, user.id)),
      settle(listReports(guild.id, { reportedUserId: user.id, limit: 1 })),
      settle(listReports(guild.id, { reportedUserId: user.id, status: 'open', limit: 1 })),
      guild.members.fetch(user.id).then((value) => ({ ok: true, value }), () => ({ ok: true, value: null })),
    ]);

    // Someone who left may still be banned; only worth the extra API call when they are not a member.
    const banned = member.value ? false : await guild.bans.fetch({ user: user.id, force: true }).then(() => true, () => false);
    const status = currentStatus({ jail: jail.ok ? jail.value : null, member: member.value, muteRoleId: guildRow.ok ? guildRow.value.mute_role_id : null, banned });

    const caseRows = cases.ok ? cases.value : [];
    const sections = [];

    sections.push({
      title: 'Status',
      lines: status.length ? status.map((entry) => `${EMOJI.WARNING} ${entry}`) : [`${EMOJI.APPROVE} No active restrictions.`],
    });

    sections.push({
      title: 'Record',
      lines: cases.ok
        ? [
            caseRows.length ? totals(caseRows).join(' · ') || `${caseRows.length} case(s) with no sanctions` : 'No cases on record.',
            warns.ok ? line('Active warnings', warns.value.length) : null,
            notes.ok ? line('Staff notes', notes.value.length) : null,
          ]
        : ['Cases could not be loaded right now.'],
    });

    const reportTotal = reportsAbout.ok ? reportsAbout.value.count : 0;
    if (reportTotal) {
      const open = openReports.ok ? openReports.value.count : 0;
      sections.push({ title: 'Reports', lines: [`${reportTotal} ${reportTotal === 1 ? 'report' : 'reports'} about this member${open ? ` · **${open}** still open` : ''}`, 'Use `/report list user:` to read them.'] });
    }

    if (caseRows.length) {
      sections.push({
        title: 'Latest cases',
        lines: caseRows.slice(0, RECENT_CASES).map((row) => {
          const when = `<t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`;
          return `${TYPE_EMOJI[row.type] ?? ''} **#${row.case_number}** ${capitalize(row.type)} · ${when}${row.active === false ? ' · *inactive*' : ''}\n> ${clip(row.reason || 'No reason provided.', 90)}`.trim();
        }),
        limit: 1800,
      });
    }

    if (notes.ok && notes.value.length) {
      const latest = notes.value[0];
      sections.push({ title: 'Latest note', lines: [`#${latest.id} · <t:${Math.floor(new Date(latest.created_at).getTime() / 1000)}:R> · <@${latest.moderator_id}>\n> ${clip(latest.note, 150)}`] });
    }

    const worst = status.length ? COLORS.RED : caseRows.length ? COLORS.YELLOW : COLORS.GREEN;
    const m = member.value;
    await interaction.editReply(infoPayload({
      accent: worst,
      title: m?.displayName ?? user.globalName ?? user.username,
      thumbnail: (m ?? user).displayAvatarURL({ size: 256 }),
      subtitle: [
        `<@${user.id}> · \`${user.id}\``,
        `Account created ${stamp(user.createdTimestamp)}`,
        m?.joinedTimestamp ? `Joined ${stamp(m.joinedTimestamp)}` : 'Not in this server.',
      ],
      sections,
      footer: 'Use case list to page through every case.',
    }));
  },
};
