const { SlashCommandBuilder, PermissionFlagsBits, EmbedBuilder, MessageFlags } = require('discord.js');
const { getConfig: getAutomodConfig } = require('../../db/automod');
const { getConfig: getAntinukeConfig } = require('../../db/antinuke');
const { getConfig: getVerificationConfig } = require('../../db/verificationConfig');
const { getLogConfig } = require('../../db/logConfig');
const { COLORS } = require('../../utils/colors');

const DANGEROUS_PERMISSIONS = [
  [PermissionFlagsBits.Administrator, 'Administrator'],
  [PermissionFlagsBits.ManageGuild, 'Manage Server'],
  [PermissionFlagsBits.ManageRoles, 'Manage Roles'],
  [PermissionFlagsBits.ManageChannels, 'Manage Channels'],
  [PermissionFlagsBits.BanMembers, 'Ban Members'],
  [PermissionFlagsBits.KickMembers, 'Kick Members'],
  [PermissionFlagsBits.ModerateMembers, 'Timeout Members'],
  [PermissionFlagsBits.ManageWebhooks, 'Manage Webhooks'],
  [PermissionFlagsBits.ManageMessages, 'Manage Messages'],
  [PermissionFlagsBits.MentionEveryone, 'Mention Everyone'],
];

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
    const sub = interaction.options.getSubcommand();
    if (sub === 'role') return inspectRole(interaction);
    return scan(interaction);
  },
};

async function scan(interaction) {
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
  const dangerousEveryone = permissionNames(everyone).filter((name) => name !== 'Mention Everyone');
  const botMember = guild.members.me;

  if (dangerousEveryone.length) {
    score -= 30;
    findings.push(`@everyone has: ${dangerousEveryone.join(', ')}`);
  }
  if (adminRoles.size > 0) {
    score -= Math.min(30, adminRoles.size * 10);
    findings.push(`${adminRoles.size} role(s) have Administrator: ${adminRoles.map((role) => role.name).slice(0, 4).join(', ')}`);
  }
  if (!antinuke?.enabled) {
    score -= 15;
    findings.push('Anti-nuke is disabled.');
  }
  if (!automod?.anti_spam_enabled) {
    score -= 10;
    findings.push('Anti-spam is disabled.');
  }
  if (!automod?.anti_raid_enabled) {
    score -= 10;
    findings.push('Anti-raid is disabled.');
  }
  if (!verification?.enabled) {
    score -= 5;
    findings.push('Join verification is disabled.');
  }
  if (!logs?.entries?.length) {
    score -= 10;
    findings.push('No audit-log destination is configured.');
  }
  if (!botMember?.permissions.has(PermissionFlagsBits.ViewAuditLog)) {
    score -= 10;
    findings.push('Petto cannot view the audit log, so anti-nuke attribution is limited.');
  }

  score = Math.max(0, score);
  const status = score >= 80 ? 'Good baseline' : score >= 55 ? 'Needs attention' : 'High risk';
  const recommendations = findings.length
    ? findings.slice(0, 6).map((finding) => `• ${finding}`).join('\n')
    : 'No high-impact gaps were found in this read-only scan.';

  const embed = new EmbedBuilder()
    .setColor(COLORS.DEFAULT)
    .setTitle(`Security scan · ${guild.name}`)
    .setDescription(`**Score:** \`${score}/100\` · **${status}**\n\n${recommendations}`)
    .addFields(
      { name: 'Protection', value: `Anti-nuke: ${yesNo(antinuke?.enabled)}\nAnti-spam: ${yesNo(automod?.anti_spam_enabled)}\nAnti-raid: ${yesNo(automod?.anti_raid_enabled)}\nVerification: ${yesNo(verification?.enabled)}`, inline: true },
      { name: 'Coverage', value: `Log routes: ${logs?.entries?.length ?? 0}\nAdmin roles: ${adminRoles.size}\nDangerous @everyone perms: ${dangerousEveryone.length}\nAudit access: ${yesNo(botMember?.permissions.has(PermissionFlagsBits.ViewAuditLog))}`, inline: true },
    )
    .setFooter({ text: 'Read-only scan. Petto did not change any server setting.' });

  await interaction.reply({ embeds: [embed], flags: MessageFlags.SuppressNotifications });
}

async function inspectRole(interaction) {
  const role = interaction.options.getRole('role', true);
  const names = permissionNames(role);
  const embed = new EmbedBuilder()
    .setColor(COLORS.DEFAULT)
    .setTitle(`Permission simulator · ${role.name}`)
    .setDescription(names.length ? names.map((name) => `• ${name}`).join('\n') : 'This role has no elevated permissions.')
    .addFields(
      { name: 'Position', value: role.id === interaction.guild.id ? '@everyone' : `#${role.position}`, inline: true },
      { name: 'Managed', value: role.managed ? 'Yes, Discord integration role' : 'No', inline: true },
    )
    .setFooter({ text: 'This is a permission preview, not an action.' });
  await interaction.reply({ embeds: [embed], flags: MessageFlags.SuppressNotifications });
}

function permissionNames(role) {
  return DANGEROUS_PERMISSIONS.filter(([flag]) => role.permissions.has(flag)).map(([, name]) => name);
}

function yesNo(value) {
  return value ? 'enabled' : 'disabled';
}
