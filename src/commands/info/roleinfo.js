const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { INFO_ACCENT, infoPayload, stamp, line, yesNo } = require('../../utils/infoCard');

// Permissions worth calling out on a role; the full list would not fit and mostly says nothing.
const KEY_PERMISSIONS = [
  ['Administrator', PermissionFlagsBits.Administrator],
  ['Manage Server', PermissionFlagsBits.ManageGuild],
  ['Manage Roles', PermissionFlagsBits.ManageRoles],
  ['Manage Channels', PermissionFlagsBits.ManageChannels],
  ['Manage Messages', PermissionFlagsBits.ManageMessages],
  ['Kick Members', PermissionFlagsBits.KickMembers],
  ['Ban Members', PermissionFlagsBits.BanMembers],
  ['Timeout Members', PermissionFlagsBits.ModerateMembers],
  ['Mention Everyone', PermissionFlagsBits.MentionEveryone],
];

module.exports = {
  aliases: ['ri'],
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Shows information about a role.')
    .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),

  async execute(interaction) {
    const role = interaction.options.getRole('role', true);
    const permissions = role.permissions;
    const key = permissions ? KEY_PERMISSIONS.filter(([, flag]) => permissions.has(flag)).map(([name]) => `\`${name}\``) : [];

    await interaction.reply(infoPayload({
      accent: role.color || INFO_ACCENT,
      title: role.name,
      thumbnail: typeof role.iconURL === 'function' ? role.iconURL({ size: 256 }) : null,
      subtitle: [`<@&${role.id}>`],
      sections: [
        {
          title: 'Details',
          lines: [
            line('Color', role.color ? `\`${role.hexColor}\`` : 'Default'),
            line('Position', role.position),
            line('Members', role.members?.size ?? 0),
            line('Created', stamp(role.createdTimestamp)),
          ],
        },
        {
          title: 'Settings',
          lines: [
            line('Mentionable', yesNo(role.mentionable)),
            line('Shown separately', yesNo(role.hoist)),
            line('Managed by an integration', yesNo(role.managed)),
          ],
        },
        { title: 'Key permissions', lines: [key.length ? key.join(' · ') : 'None of the key permissions'] },
      ],
      footer: `ID ${role.id}`,
    }));
  },
};
