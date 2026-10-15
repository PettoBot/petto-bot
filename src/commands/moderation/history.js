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
const { typeName, reasonText, capitalize } = require('../../utils/caseFormat');
const { t, tn, languageOf } = require('../../i18n');

const CASE_SCAN_LIMIT = 500;
const RECENT_CASES = 5;

// How case types are grouped into the totals line (the label is `moderation.history.total.<group>`).
const TOTAL_GROUPS = [
  ['warns', ['warn']],
  ['mutes', ['mute', 'tempmute']],
  ['jails', ['jail']],
  ['kicks', ['kick', 'softban']],
  ['bans', ['ban', 'hardban', 'tempban']],
];

function totals(cases, lang) {
  return TOTAL_GROUPS
    .map(([group, types]) => [group, cases.filter((row) => types.includes(row.type)).length])
    .filter(([, count]) => count > 0)
    .map(([group, count]) => `**${t(lang, `moderation.history.total.${group}`)}** ${count}`);
}

/** What applies to the member right now, from the strictest down. */
function currentStatus({ jail, member, muteRoleId, banned }, lang) {
  const status = [];
  if (banned) status.push(t(lang, 'moderation.history.status.banned'));
  if (jail) status.push(jail.expires_at ? t(lang, 'moderation.history.status.jailedUntil', { time: `<t:${Math.floor(new Date(jail.expires_at).getTime() / 1000)}:f>` }) : t(lang, 'moderation.history.status.jailed'));
  if (member?.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()) {
    status.push(t(lang, 'moderation.history.status.timedOut', { time: `<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:f>` }));
  }
  if (muteRoleId && member?.roles?.cache?.has(muteRoleId)) status.push(t(lang, 'moderation.history.status.muteRole'));
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
    const lang = await languageOf(interaction);
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
    const status = currentStatus({ jail: jail.ok ? jail.value : null, member: member.value, muteRoleId: guildRow.ok ? guildRow.value.mute_role_id : null, banned }, lang);

    const caseRows = cases.ok ? cases.value : [];
    const sections = [];

    sections.push({
      title: t(lang, 'moderation.history.section.status'),
      lines: status.length ? status.map((entry) => `${EMOJI.WARNING} ${entry}`) : [t(lang, 'moderation.history.noRestrictions', { emoji: EMOJI.APPROVE })],
    });

    sections.push({
      title: t(lang, 'moderation.history.section.record'),
      lines: cases.ok
        ? [
            caseRows.length ? totals(caseRows, lang).join(' · ') || tn(lang, 'moderation.history.noSanctions', caseRows.length, { count: caseRows.length }) : t(lang, 'moderation.history.noCases'),
            warns.ok ? line(t(lang, 'moderation.history.activeWarnings'), warns.value.length) : null,
            notes.ok ? line(t(lang, 'moderation.history.staffNotes'), notes.value.length) : null,
          ]
        : [t(lang, 'moderation.history.casesFailed')],
    });

    const reportTotal = reportsAbout.ok ? reportsAbout.value.count : 0;
    if (reportTotal) {
      const open = openReports.ok ? openReports.value.count : 0;
      sections.push({
        title: t(lang, 'moderation.history.section.reports'),
        lines: [
          `${tn(lang, 'moderation.history.reports', reportTotal, { count: reportTotal })}${open ? t(lang, 'moderation.history.reportsOpen', { count: open }) : ''}`,
          t(lang, 'moderation.history.reportsHint'),
        ],
      });
    }

    if (caseRows.length) {
      sections.push({
        title: t(lang, 'moderation.history.section.latestCases'),
        lines: caseRows.slice(0, RECENT_CASES).map((row) => {
          const when = `<t:${Math.floor(new Date(row.created_at).getTime() / 1000)}:R>`;
          return `${TYPE_EMOJI[row.type] ?? ''} **#${row.case_number}** ${capitalize(typeName(row.type, lang))} · ${when}${row.active === false ? t(lang, 'moderation.history.inactive') : ''}\n> ${clip(reasonText(row.reason, lang), 90)}`.trim();
        }),
        limit: 1800,
      });
    }

    if (notes.ok && notes.value.length) {
      const latest = notes.value[0];
      sections.push({ title: t(lang, 'moderation.history.section.latestNote'), lines: [`#${latest.id} · <t:${Math.floor(new Date(latest.created_at).getTime() / 1000)}:R> · <@${latest.moderator_id}>\n> ${clip(latest.note, 150)}`] });
    }

    const worst = status.length ? COLORS.RED : caseRows.length ? COLORS.YELLOW : COLORS.GREEN;
    const m = member.value;
    await interaction.editReply(infoPayload({
      accent: worst,
      title: m?.displayName ?? user.globalName ?? user.username,
      thumbnail: (m ?? user).displayAvatarURL({ size: 256 }),
      subtitle: [
        `<@${user.id}> · \`${user.id}\``,
        t(lang, 'moderation.history.created', { time: stamp(user.createdTimestamp) }),
        m?.joinedTimestamp ? t(lang, 'moderation.history.joined', { time: stamp(m.joinedTimestamp) }) : t(lang, 'moderation.history.notMember'),
      ],
      sections,
      footer: t(lang, 'moderation.history.footer'),
    }));
  },
};
