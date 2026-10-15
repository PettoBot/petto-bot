const { SlashCommandBuilder, PermissionFlagsBits } = require('discord.js');
const { INFO_ACCENT, infoPayload, stamp, line, yesNo } = require('../../utils/infoCard');
const { t, languageOf } = require('../../i18n');

// Permissions worth calling out on a role; the full list would not fit and mostly says nothing. Their names are the shared
// `core.perm.<flag>` ones.
const KEY_PERMISSIONS = ['Administrator', 'ManageGuild', 'ManageRoles', 'ManageChannels', 'ManageMessages', 'KickMembers', 'BanMembers', 'ModerateMembers', 'MentionEveryone']
  .map((name) => [name, PermissionFlagsBits[name]]);

module.exports = {
  aliases: ['ri'],
  data: new SlashCommandBuilder()
    .setName('roleinfo')
    .setDescription('Shows information about a role.')
    .addRoleOption((o) => o.setName('role').setDescription('Role').setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const role = interaction.options.getRole('role', true);
    const permissions = role.permissions;
    const key = permissions ? KEY_PERMISSIONS.filter(([, flag]) => permissions.has(flag)).map(([name]) => `\`${t(lang, `core.perm.${name}`)}\``) : [];

    await interaction.reply(infoPayload({
      accent: role.color || INFO_ACCENT,
      title: role.name,
      thumbnail: typeof role.iconURL === 'function' ? role.iconURL({ size: 256 }) : null,
      subtitle: [`<@&${role.id}>`],
      sections: [
        {
          title: t(lang, 'info.section.details'),
          lines: [
            line(t(lang, 'info.roleinfo.color'), role.color ? `\`${role.hexColor}\`` : t(lang, 'info.roleinfo.defaultColor')),
            line(t(lang, 'info.roleinfo.position'), role.position),
            line(t(lang, 'info.label.members'), role.members?.size ?? 0),
            line(t(lang, 'info.label.created'), stamp(role.createdTimestamp)),
          ],
        },
        {
          title: t(lang, 'info.section.settings'),
          lines: [
            line(t(lang, 'info.roleinfo.mentionable'), yesNo(role.mentionable, lang)),
            line(t(lang, 'info.roleinfo.hoist'), yesNo(role.hoist, lang)),
            line(t(lang, 'info.roleinfo.managed'), yesNo(role.managed, lang)),
          ],
        },
        { title: t(lang, 'info.roleinfo.keyPermissions'), lines: [key.length ? key.join(' · ') : t(lang, 'info.roleinfo.noKeyPermissions')] },
      ],
      footer: t(lang, 'info.card.id', { id: role.id }),
    }));
  },
};
