const { SlashCommandBuilder } = require('discord.js');
const { infoPayload, noticePayload, clip, line } = require('../../utils/infoCard');
const { COLORS } = require('../../utils/colors');

module.exports = {
  aliases: ['ii'],
  data: new SlashCommandBuilder()
    .setName('inviteinfo')
    .setDescription('Shows information about an invite code.')
    .addStringOption((o) => o.setName('code').setDescription('Invite code or link').setRequired(true)),

  async execute(interaction) {
    const raw = interaction.options.getString('code', true).trim();
    const code = raw.split('/').pop();

    const invite = await interaction.client.fetchInvite(code).catch(() => null);
    if (!invite) {
      await interaction.reply(noticePayload("That invite doesn't exist or has expired.", COLORS.RED));
      return;
    }

    const members = invite.memberCount ?? invite.guild?.memberCount ?? null;
    const online = invite.presenceCount ?? null;
    const guild = invite.guild;

    await interaction.reply(infoPayload({
      title: guild?.name ?? `Invite ${invite.code}`,
      thumbnail: guild?.iconURL?.({ size: 256 }) ?? null,
      subtitle: [guild?.description ? `> ${clip(guild.description, 300)}` : null],
      sections: [
        {
          title: 'Invite',
          lines: [
            line('Code', `\`${invite.code}\``),
            line('Channel', invite.channel ? `#${invite.channel.name}` : null),
            line('Inviter', invite.inviter ? invite.inviter.username : null),
            line('Expires', invite.expiresTimestamp ? `<t:${Math.floor(invite.expiresTimestamp / 1000)}:R>` : 'Never'),
          ],
        },
        {
          title: 'Server',
          lines: [
            line('Members', members),
            online !== null ? line('Online', online) : null,
            guild?.id ? line('ID', `\`${guild.id}\``) : null,
          ],
        },
      ],
      footer: `Invite ${invite.code}`,
      buttons: [{ label: 'Open invite', url: invite.url ?? `https://discord.gg/${invite.code}` }],
    }));
  },
};
