const { SlashCommandBuilder } = require('discord.js');
const { infoPayload, noticePayload, clip, line } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');
const { t, languageOf } = require('../../i18n');

module.exports = {
  aliases: ['ii'],
  data: new SlashCommandBuilder()
    .setName('inviteinfo')
    .setDescription('Shows information about an invite code.')
    .addStringOption((o) => o.setName('code').setDescription('Invite code or link').setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const raw = interaction.options.getString('code', true).trim();
    const code = raw.split('/').pop();

    const invite = await interaction.client.fetchInvite(code).catch(() => null);
    if (!invite) {
      await interaction.reply(noticePayload(t(lang, 'info.inviteinfo.notFound'), COLORS.RED));
      return;
    }

    const members = invite.memberCount ?? invite.guild?.memberCount ?? null;
    const online = invite.presenceCount ?? null;
    const guild = invite.guild;

    await interaction.reply(infoPayload({
      title: guild?.name ?? t(lang, 'info.inviteinfo.invite', { code: invite.code }),
      thumbnail: guild?.iconURL?.({ size: 256 }) ?? null,
      subtitle: [guild?.description ? `> ${clip(guild.description, 300)}` : null],
      sections: [
        {
          title: t(lang, 'info.inviteinfo.inviteSection'),
          lines: [
            line(t(lang, 'info.label.code'), `\`${invite.code}\``),
            line(t(lang, 'info.label.channel'), invite.channel ? `#${invite.channel.name}` : null),
            line(t(lang, 'info.inviteinfo.inviter'), invite.inviter ? invite.inviter.username : null),
            line(t(lang, 'info.inviteinfo.expires'), invite.expiresTimestamp ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : t(lang, 'info.inviteinfo.never')),
          ],
        },
        {
          title: t(lang, 'info.inviteinfo.serverSection'),
          lines: [
            line(t(lang, 'info.label.members'), members),
            online !== null ? line(t(lang, 'info.inviteinfo.online'), online) : null,
            guild?.id ? line('ID', `\`${guild.id}\``) : null,
          ],
        },
      ],
      footer: t(lang, 'info.inviteinfo.invite', { code: invite.code }),
      buttons: [{ label: t(lang, 'info.inviteinfo.open.button'), url: invite.url ?? `https://discord.gg/${invite.code}` }],
    }));
  },
};
