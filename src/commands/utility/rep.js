const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const db = require('../../db/reputation');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { formatDuration } = require('../../utils/duration');

module.exports = {
  data: new SlashCommandBuilder()
    .setName('rep')
    .setDescription('A simple reputation point members can give each other.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('give').setDescription('Give a member a reputation point.').addUserOption((o) => o.setName('user').setDescription('Member to thank').setRequired(true)))
    .addSubcommand((s) => s.setName('view').setDescription("Check your (or someone else's) reputation.").addUserOption((o) => o.setName('user').setDescription('Member').setRequired(false)))
    .addSubcommand((s) => s.setName('leaderboard').setDescription('Top reputation in this server.'))
    .addSubcommand((s) =>
      s
        .setName('reset')
        .setDescription('(Staff) Reset a member\'s reputation to 0.')
        .addUserOption((o) => o.setName('user').setDescription('Member').setRequired(true)),
    ),
  aliases: ['reputation'],

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'give') return giveCmd(interaction);
    if (sub === 'view') return viewCmd(interaction);
    if (sub === 'leaderboard') return leaderboardCmd(interaction);
    return resetCmd(interaction);
  },
};

async function giveCmd(interaction) {
  const target = interaction.options.getUser('user', true);

  if (target.id === interaction.user.id) {
    await interaction.reply({ content: "You can't give reputation to yourself.", flags: MessageFlags.Ephemeral });
    return;
  }
  if (target.bot) {
    await interaction.reply({ content: "You can't give reputation to a bot.", flags: MessageFlags.Ephemeral });
    return;
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const config = await db.getConfig(interaction.guild.id);
  if (!config.enabled) {
    await interaction.editReply({ components: [textCard('Reputation is turned off in this server.', 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const giver = await db.getUser(interaction.guild.id, interaction.user.id);
  if (config.cooldown_hours > 0 && giver.last_given_at) {
    const cooldownMs = config.cooldown_hours * 3600_000;
    const elapsed = Date.now() - new Date(giver.last_given_at).getTime();
    const remaining = cooldownMs - elapsed;
    if (remaining > 0) {
      await interaction.editReply({ components: [textCard(`You can give another point in **${formatDuration(remaining)}**.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
  }

  await db.giveRep(interaction.guild.id, interaction.user.id, target.id);
  const receiver = await db.getUser(interaction.guild.id, target.id);

  await interaction.editReply({
    components: [textCard(`${EMOJI.APPROVE}  Gave a reputation point to ${target}. They now have **${receiver.points}**.`, 0xa5ea7a)],
    flags: MessageFlags.IsComponentsV2,
  });
}

async function viewCmd(interaction) {
  const target = interaction.options.getUser('user') ?? interaction.user;
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const row = await db.getUser(interaction.guild.id, target.id);
  await interaction.editReply({ components: [textCard(`${target} has **${row.points}** reputation point${row.points === 1 ? '' : 's'}.`, 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
}

async function leaderboardCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const top = await db.getLeaderboard(interaction.guild.id, 10);
  if (!top.length) {
    await interaction.editReply({ components: [textCard('No reputation given yet.', 0x8399ff)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const medals = ['🥇', '🥈', '🥉'];
  const lines = top.map((row, i) => `${medals[i] ?? `**${i + 1}.**`} <@${row.user_id}> — **${row.points}**`);
  await interaction.editReply({ components: [textCard(`**Reputation leaderboard**\n${lines.join('\n')}`, 0xfed53c)], flags: MessageFlags.IsComponentsV2 });
}

async function resetCmd(interaction) {
  if (!interaction.member.permissions.has(PermissionFlagsBits.ManageGuild)) {
    await interaction.reply({ content: 'You need the **Manage Server** permission to do that.', flags: MessageFlags.Ephemeral });
    return;
  }

  const target = interaction.options.getUser('user', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await db.resetUser(interaction.guild.id, target.id);

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Reset ${target}'s reputation to **0**.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
