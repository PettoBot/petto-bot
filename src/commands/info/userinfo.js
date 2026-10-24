const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { INFO_ACCENT, infoPayload, clip, stamp, line } = require('../../utils/infoCard');
const { badgeList, badgeText } = require('../../utils/userBadges');
const { EMOJI } = require('../../utils/emojis');
const { renderProfileLook } = require('../../utils/profileLookImage');
const { decorationUrl, nameplateUrl, serverTag } = require('../../utils/profileLook');
const { t, languageOf } = require('../../i18n');

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
function roleList(roles, lang) {
  const shown = [];
  let length = 0;
  for (const role of roles) {
    const mention = `<@&${role.id}>`;
    if (length + mention.length + 1 > ROLE_LIST_LIMIT) break;
    shown.push(mention);
    length += mention.length + 1;
  }
  const hidden = roles.length - shown.length;
  return shown.join(' ') + (hidden > 0 ? ` ${t(lang, 'info.userinfo.moreRoles', { count: hidden })}` : '');
}

module.exports = {
  // Also registered as a slash command (one of the everyday ones people look for with `/`); the prefix keeps working.
  registerSlash: true,
  data: new SlashCommandBuilder()
    .setName('userinfo')
    .setDMPermission(false)
    .setDescription('Shows information about a member.')
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)),
  aliases: ['ui', 'whois'],

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const selectedUser = interaction.options.getUser('user') ?? interaction.user;
    const user = await interaction.client.users.fetch(selectedUser.id, { force: true }).catch(() => selectedUser);
    const member = interaction.guild
      ? await interaction.guild.members.fetch(user.id).catch(() => interaction.guild.members.cache.get(user.id) ?? null)
      : null;

    const badges = badgeList(user, member, lang);
    const globalAvatar = user.displayAvatarURL({ size: 1024 });
    const serverAvatar = member?.avatar ? member.displayAvatarURL({ size: 1024 }) : null;
    // A banner set for this server wins over the global one.
    const serverBanner = member?.banner ? member.bannerURL({ size: 1024 }) : null;
    const globalBanner = user.bannerURL?.({ size: 1024 }) ?? null;
    const banner = serverBanner ?? globalBanner;
    const shownAvatar = serverAvatar ?? globalAvatar;
    const displayName = member?.displayName ?? user.globalName ?? user.username;

    // One row of a section: a small Petto icon, the label in bold and the value.
    const row = (icon, label, value) => (value === null || value === undefined || value === '' ? null : `${icon} **${label}** ${value}`);
    const tag = serverTag(user);
    const decoration = decorationUrl(user);
    const nameplate = nameplateUrl(user);

    const sections = [
      {
        title: t(lang, 'info.userinfo.account'),
        lines: [
          row(EMOJI.FIELD_DOT, t(lang, 'info.userinfo.username'), `\`${user.username}\``),
          row(EMOJI.MEMBERS, t(lang, 'info.label.type'), t(lang, user.bot ? 'info.userinfo.botAccount' : 'info.userinfo.userAccount')),
          row(EMOJI.FIELD_CALENDAR, t(lang, 'info.label.created'), stamp(user.createdTimestamp)),
          badges.length ? row(EMOJI.STAR, t(lang, 'info.userinfo.badges'), badgeText(badges)) : null,
        ],
      },
    ];

    if (member) {
      const joinPos = joinPosition(interaction.guild, member);
      sections.push({
        title: t(lang, 'info.userinfo.inServer'),
        lines: [
          row(EMOJI.FIELD_CALENDAR, t(lang, 'info.label.joined'), member.joinedTimestamp ? `${stamp(member.joinedTimestamp)}${joinPos ? ` · #${joinPos}` : ''}` : null),
          row(EMOJI.FIELD_NOTES, t(lang, 'info.userinfo.nickname'), member.nickname ? clip(member.nickname, 64) : null),
          member.premiumSinceTimestamp ? row(EMOJI.STAR, t(lang, 'info.userinfo.boostingSince'), `<t:${Math.floor(member.premiumSinceTimestamp / 1000)}:R>`) : null,
          member.communicationDisabledUntilTimestamp && member.communicationDisabledUntilTimestamp > Date.now()
            ? row(EMOJI.SAFETY, t(lang, 'info.userinfo.timedOutUntil'), `<t:${Math.floor(member.communicationDisabledUntilTimestamp / 1000)}:R>`)
            : null,
        ],
      });

      const roles = [...member.roles.cache.filter((r) => r.id !== interaction.guild.id).values()].sort((a, b) => b.position - a.position);
      sections.push({ title: t(lang, 'info.userinfo.roles', { count: roles.length }), lines: [roles.length ? roleList(roles, lang) : t(lang, 'info.userinfo.noRoles')] });
    }

    // The decoration is drawn on the avatar, as Discord shows it, and the nameplate is a picture of its own: both are seen in the card.
    const look = decoration ? await renderProfileLook(user, { member }) : null;
    const files = look ? [new AttachmentBuilder(look.buffer, { name: look.name })] : [];
    if (tag || decoration || nameplate) sections.push({ title: t(lang, 'info.userinfo.cosmetics'), lines: [t(lang, 'info.userinfo.cosmeticsHint', { command: '/usercosmetics' })] });

    await interaction.reply({
      ...infoPayload({
        accent: null,
        title: displayName,
        thumbnail: look ? `attachment://${look.name}` : shownAvatar,
        banner,
        gallery: nameplate ? [nameplate] : [],
        subtitle: [[`<@${user.id}>${user.bot ? ' · Bot' : ''}`, tag ? `\`${tag}\`` : null].filter(Boolean).join('  ·  ')],
        sections,
        footer: t(lang, 'info.card.id', { id: user.id }),
        buttons: [
          { label: t(lang, serverAvatar ? 'info.button.globalAvatar.button' : 'info.button.avatar.button'), url: globalAvatar },
          { label: t(lang, 'info.button.serverAvatar.button'), url: serverAvatar },
          { label: t(lang, serverBanner ? 'info.button.globalBanner.button' : 'info.button.banner.button'), url: globalBanner },
          { label: t(lang, 'info.button.serverBanner.button'), url: serverBanner },
        ],
      }),
      files,
    });
  },
};
