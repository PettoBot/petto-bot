const { SlashCommandBuilder } = require('discord.js');
const { INFO_ACCENT, infoPayload, clip, stamp, line } = require('../../utils/infoCard');
const { badgeList, badgeText } = require('../../utils/userBadges');

const ROLE_LIST_LIMIT = 800;

function joinPosition(guild, member) {
  if (!member?.joinedTimestamp) return null;
  // The position is only right once every member is cached.
  if (guild.members.cache.size < guild.memberCount) return null;
  const sorted = [...guild.members.cache.values()].filter((m) => m.joinedTimestamp).sort((a, b) => a.joinedTimestamp - b.joinedTimestamp);
  const pos = sorted.findIndex((m) => m.id === member.id) + 1;
  return pos > 0 ? pos : null;
}

/** Role mentions, highest first, cut at a whole mention with a "+N more" tail instead of mid-mention. */
function roleList(roles) {
  const shown = [];
  let length = 0;
  for (const role of roles) {
    const mention = `<@&${role.id}>`;
    if (length + mention.length + 1 > ROLE_LIST_LIMIT) break;
    shown.push(mention);
    length += mention.length + 1;
  }
  const hidden = roles.length - shown.length;
  return shown.join(' ') + (hidden > 0 ? ` +${hidden} more` : '');
}

module.exports = {
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDescription('Shows information about a member.')
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)),
  aliases: ['ui', 'whois'],

  async execute(interaction) {
    const selectedUser = interaction.options.getUser('user') ?? interaction.user;
    const user = await interaction.client.users.fetch(selectedUser.id, { force: true }).catch(() => selectedUser);
    const member = interaction.guild
      ? await interaction.guild.members.fetch(user.id).catch(() => interaction.guild.members.cache.get(user.id) ?? null)
      : null;

    const badges = badgeList(user, member);
    const globalAvatar = user.displayAvatarURL({ size: 1024 });
    const serverAvatar = member?.avatar ? member.displayAvatarURL({ size: 1024 }) : null;
    const banner = user.bannerURL?.({ size: 1024 }) ?? null;
    const displayName = member?.displayName ?? user.globalName ?? user.username;

    const sections = [
      {
        title: 'Account',
        lines: [
          line('Username', `\`${user.username}\``),
          line('Type', user.bot ? 'Bot account' : 'User account'),
          line('Created', stamp(user.createdTimestamp)),
          badges.length ? line('Badges', badgeText(badges)) : null,
        ],
      },
    ];

    if (member) {
      const joinPos = joinPosition(interaction.guild, member);
      sections.push({
        title: 'In this server',
        lines: [
          line('Joined', member.joinedTimestamp ? `${stamp(member.joinedTimestamp)}${joinPos ? ` · #${joinPos}` : ''}` : null),
          line('Nickname', member.nickname ? clip(member.nickname, 64) : null),
          member.premiumSinceTimestamp ? line('Boosting since', `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`) : null,
          member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()
            ? line('Timed out until', `<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`)
            : null,
        ],
      });

      const roles = [...member.roles.cache.filter((r) => r.id !== interaction.guild.id).values()].sort((a, b) => b.position - a.position);
      sections.push({ title: `Roles (${roles.length})`, lines: [roles.length ? roleList(roles) : 'None'] });
    }

    await interaction.reply(infoPayload({
      accent: member?.displayColor || user.accentColor || INFO_ACCENT,
      title: displayName,
      thumbnail: serverAvatar ?? globalAvatar,
      banner,
      subtitle: [`<@${user.id}>${user.bot ? ' · Bot' : ''}`],
      sections,
      footer: `ID ${user.id}`,
      buttons: [
        { label: serverAvatar ? 'Global avatar' : 'Avatar', url: globalAvatar },
        { label: 'Server avatar', url: serverAvatar },
        { label: 'Banner', url: banner },
      ],
    }));
  },
};
