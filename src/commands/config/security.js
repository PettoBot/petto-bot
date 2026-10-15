const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { getConfig: getAutomodConfig } = require('../../db/automod');
const { getConfig: getAntinukeConfig } = require('../../db/antinuke');
const { getConfig: getVerificationConfig } = require('../../db/verificationConfig');
const { getLogConfig } = require('../../db/logConfig');
const { COLORS } = require('../../utils/colors');
const { t, tn, languageOf } = require('../../i18n');

// The permissions the scan calls dangerous, by flag name; their names come from `core.perm.<flag>`.
const DANGEROUS_PERMISSIONS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'BanMembers', 'KickMembers', 'ModerateMembers', 'ManageWebhooks', 'ManageMessages', 'MentionEveryone'];

module.exports = {
  aliases: ['securityscan', 'secscan'],
  prefixDefaultSubcommand: 'scan',
  data: new SlashCommandBuilder()
    .setName('security')
    .setDescription('Review server protection and dangerous permissions.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((sub) => sub.setName('scan').setDescription('Run a read-only security scan.'))
    .addSubcommand((sub) => sub.setName('role').setDescription('Simulate what a role can do.').addRoleOption((opt) => opt.setName('role').setDescription('Role to inspect').setRequired(true))),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    if (sub === 'role') return inspectRole(interaction, lang);
    return scan(interaction, lang);
  },
};

async function scan(interaction, lang) {
  const guild = interaction.guild;
  const [automod, antinuke, verification, logs] = await Promise.all([
    getAutomodConfig(guild.id).catch(() => null),
    getAntinukeConfig(guild.id).catch(() => null),
    getVerificationConfig(guild.id).catch(() => null),
    getLogConfig(guild.id).catch(() => ({ entries: [] })),
  ]);

  const findings = [];
  let score = 100;
  const everyone = guild.roles.everyone;
  const adminRoles = guild.roles.cache.filter((role) => role.id !== guild.id && role.permissions.has(PermissionFlagsBits.Administrator));
  const dangerousEveryone = permissionFlags(everyone).filter((flag) => flag !== 'MentionEveryone').map((flag) => permissionName(flag, lang));
  const botMember = guild.members.me;

  if (dangerousEveryone.length) {
    score -= 30;
    findings.push(t(lang, 'security.scan.finding.everyone', { permissions: dangerousEveryone.join(', ') }));
  }
  if (adminRoles.size > 0) {
    score -= Math.min(30, adminRoles.size * 10);
    findings.push(tn(lang, 'security.scan.finding.adminRoles', adminRoles.size, { count: adminRoles.size, roles: adminRoles.map((role) => role.name).slice(0, 4).join(', ') }));
  }
  if (!antinuke?.enabled) {
    score -= 15;
    findings.push(t(lang, 'security.scan.finding.antinuke'));
  }
  if (!automod?.anti_spam_enabled) {
    score -= 10;
    findings.push(t(lang, 'security.scan.finding.antispam'));
  }
  if (!automod?.anti_raid_enabled) {
    score -= 10;
    findings.push(t(lang, 'security.scan.finding.antiraid'));
  }
  if (!verification?.enabled) {
    score -= 5;
    findings.push(t(lang, 'security.scan.finding.verification'));
  }
  if (!logs?.entries?.length) {
    score -= 10;
    findings.push(t(lang, 'security.scan.finding.logs'));
  }
  if (!botMember?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    score -= 10;
    findings.push(t(lang, 'security.scan.finding.auditLog'));
  }

  score = Math.max(0, score);
  const status = t(lang, score >= 80 ? 'security.scan.status.good' : score >= 55 ? 'security.scan.status.attention' : 'security.scan.status.risk');
  const recommendations = findings.length
    ? findings.slice(0, 6).map((finding) => `• ${finding}`).join('\n')
    : t(lang, 'security.scan.noFindings');
  const yesNo = (value) => t(lang, value ? 'security.scan.enabled' : 'security.scan.disabled');

  const embed = new EmbedBuilder()
    .setColor(COLORS.DEFAULT)
    .setTitle(t(lang, 'security.scan.title', { server: guild.name }))
    .setDescription(t(lang, 'security.scan.description', { score, status, recommendations }))
    .addFields(
      {
        name: t(lang, 'security.scan.protection.name'),
        value: t(lang, 'security.scan.protection.value', { antinuke: yesNo(antinuke?.enabled), antispam: yesNo(automod?.anti_spam_enabled), antiraid: yesNo(automod?.anti_raid_enabled), verification: yesNo(verification?.enabled) }),
        inline: true,
      },
      {
        name: t(lang, 'security.scan.coverage.name'),
        value: t(lang, 'security.scan.coverage.value', { logs: logs?.entries?.length ?? 0, admins: adminRoles.size, dangerous: dangerousEveryone.length, audit: yesNo(botMember?.permissions.has(PermissionFlagsBits.ViewAuditLog)) }),
        inline: true,
      },
    )
    .setFooter({ text: t(lang, 'security.scan.footer') });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.SuppressNotifications });
}

async function inspectRole(interaction, lang) {
  const role = interaction.options.getRole('role', true);
  const names = permissionFlags(role).map((flag) => permissionName(flag, lang));
  const embed = new EmbedBuilder()
    .setColor(COLORS.DEFAULT)
    .setTitle(t(lang, 'security.role.title', { role: role.name }))
    .setDescription(names.length ? names.map((name) => `• ${name}`).join('\n') : t(lang, 'security.role.none'))
    .addFields(
      { name: t(lang, 'security.role.position'), value: role.id === interaction.guild.id ? '@everyone' : `#${role.position}`, inline: true },
      { name: t(lang, 'security.role.managed'), value: t(lang, role.managed ? 'security.role.managedYes' : 'security.role.managedNo'), inline: true },
    )
    .setFooter({ text: t(lang, 'security.role.footer') });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.SuppressNotifications });
}

/** The dangerous permissions a role has, as flag names. */
function permissionFlags(role) {
  return DANGEROUS_PERMISSIONS.filter((flag) => role.permissions.has(PermissionFlagsBits[flag]));
}

const permissionName = (flag, lang) => t(lang, `core.perm.${flag}`);
