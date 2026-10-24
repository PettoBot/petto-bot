const { SlashCommandBuilder, AttachmentBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { EMOJI } = require('../../utils/emojis');
const { decorationUrl, animatedDecorationUrl, nameplateUrl, serverTag, serverTagBadge } = require('../../utils/profileLook');
const { renderCosmeticsImage } = require('../../utils/profileLookImage');
const { t, languageOf } = require('../../i18n');

const row = (icon, label, value) => (value === null || value === undefined || value === '' ? null : `${icon} **${label}** ${value}`);

module.exports = {
  // A prefix command (`!usercosmetics`, `!uc`): the card shows pictures and has no slash twin.
  aliases: ['uc', 'cosmetics', 'cosmeticos'],
  data: new SlashCommandBuilder()
    .setName('usercosmetics')
    .setDescription('Shows the avatar decoration, nameplate and server tag of a member.')
    .addUserOption((o) => o.setName('user').setDescription('User (default: you)').setRequired(false)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const selected = interaction.options.getUser('user') ?? interaction.user;
    // The cosmetics only come with a full copy of the account, so it is fetched fresh.
    const user = await interaction.client.users.fetch(selected.id, { force: true }).catch(() => selected);
    const member = interaction.guild ? await interaction.guild.members.fetch(user.id).catch(() => interaction.guild.members.cache.get(user.id) ?? null) : null;

    const decoration = decorationUrl(user);
    const moving = animatedDecorationUrl(user);
    const nameplate = nameplateUrl(user);
    const tag = serverTag(user);
    const badge = serverTagBadge(user);
    const none = t(lang, 'info.cosmetics.none');

    // One picture with all of it, like the row of a profile in Discord: nameplate, avatar with its decoration, name and tag.
    const look = decoration || nameplate || tag ? await renderCosmeticsImage(user, { member, moving: true }) : null;
    const files = look ? [new AttachmentBuilder(look.buffer, { name: look.name })] : [];
    const plate = user.collectibles?.nameplate;
    const about = plate?.label ? `-# ${String(plate.label).replace(/\s+/g, ' ').slice(0, 110)}` : null;

    const sections = [
      {
        title: t(lang, 'info.userinfo.decoration'),
        lines: [decoration ? row(EMOJI.FIELD_DOT, t(lang, 'info.cosmetics.kind'), t(lang, moving ? 'info.cosmetics.moving' : 'info.cosmetics.still')) : none],
      },
      {
        title: t(lang, 'info.userinfo.nameplate'),
        lines: nameplate ? [plate?.palette ? row(EMOJI.FIELD_DOT, t(lang, 'info.cosmetics.palette'), `\`${String(plate.palette).slice(0, 30)}\``) : null, about] : [none],
      },
      {
        title: t(lang, 'info.userinfo.serverTag'),
        lines: tag
          ? [row(EMOJI.FIELD_DOT, t(lang, 'info.cosmetics.tag'), `\`${tag}\``), row(EMOJI.FIELD_DOT, t(lang, 'info.cosmetics.server'), `\`${user.primaryGuild?.identityGuildId}\``)]
          : [none],
      },
    ];

    await interaction.reply({
      ...infoPayload({
        accent: null,
        title: t(lang, 'info.cosmetics.title', { name: member?.displayName ?? user.globalName ?? user.username }),
        subtitle: [`<@${user.id}>${tag ? `  ·  \`${tag}\`` : ''}`],
        banner: look ? `attachment://${look.name}` : null,
        sections,
        footer: t(lang, 'info.card.id', { id: user.id }),
        buttons: [
          { label: t(lang, moving ? 'info.cosmetics.button.still' : 'info.cosmetics.button.decoration'), url: decoration },
          { label: t(lang, 'info.cosmetics.button.moving'), url: moving },
          { label: t(lang, 'info.cosmetics.button.nameplate'), url: nameplate },
          { label: t(lang, 'info.cosmetics.button.badge'), url: badge },
        ],
      }),
      files,
    });
  },
};
