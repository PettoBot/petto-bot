const { SlashCommandBuilder } = require('discord.js');
const { infoPayload, noticePayload } = require('../../utils/infoCard');

const LIST_LIMIT = 2800;

module.exports = {
  aliases: ['rl'],
  data: new SlashCommandBuilder().setName('roles').setDescription('Lists every role in this server.'),

  async execute(interaction) {
    const guild = interaction.guild;
    const roles = [...guild.roles.cache.filter((r) => r.id !== guild.id).values()].sort((a, b) => b.position - a.position);

    if (!roles.length) {
      await interaction.reply(noticePayload('This server has no roles.'));
      return;
    }

    const lines = [];
    let length = 0;
    for (const role of roles) {
      const entry = `<@&${role.id}> · ${role.members.size} ${role.members.size === 1 ? 'member' : 'members'}`;
      if (length + entry.length + 1 > LIST_LIMIT) break;
      lines.push(entry);
      length += entry.length + 1;
    }
    const hidden = roles.length - lines.length;
    if (hidden > 0) lines.push(`…and ${hidden} more`);

    await interaction.reply(infoPayload({
      title: `Roles (${roles.length})`,
      thumbnail: guild.iconURL({ size: 256 }),
      subtitle: [guild.name],
      sections: [{ lines, limit: LIST_LIMIT + 200 }],
      footer: 'Highest role first',
    }));
  },
};
