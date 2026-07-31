const { SlashCommandBuilder, MessageFlags } = require('discord.js');
const { ensureGuild } = require('../../db/guilds');
const pollsDb = require('../../db/polls');
const { buildPollCard } = require('../../utils/pollCard');
const { textCard } = require('../../utils/caseCard');
const { parseDuration, formatDuration } = require('../../utils/duration');

const MAX_OPTIONS = 10;

module.exports = {
  data: new SlashCommandBuilder()
    .setName('poll')
    .setDescription('Start a poll members can vote on with buttons.')
    .setDMPermission(false)
    .addStringOption((opt) => opt.setName('question').setDescription('What are you asking?').setRequired(true))
    .addStringOption((opt) => opt.setName('options').setDescription('2-10 choices, separated by COMMAS. e.g: Pizza, Sushi, Tacos').setRequired(true))
    .addBooleanOption((opt) => opt.setName('multiple').setDescription('Allow voting for more than one option').setRequired(false))
    .addStringOption((opt) => opt.setName('duration').setDescription('Auto-close after this long, e.g. 1h, 30m, 1d').setRequired(false)),
  interactive: true,

  async execute(interaction) {
    const question = interaction.options.getString('question', true);
    const rawOptions = interaction.options.getString('options', true);
    const multi = interaction.options.getBoolean('multiple') ?? false;
    const durationStr = interaction.options.getString('duration');

    const options = rawOptions.split(',').map((o) => o.trim()).filter(Boolean).slice(0, MAX_OPTIONS);
    if (options.length < 2) {
      await interaction.reply({ content: "Separate your options with commas, e.g. `Pizza, Sushi, Tacos` — you gave me only 1.", flags: MessageFlags.Ephemeral });
      return;
    }

    let endsAt = null;
    if (durationStr) {
      const durationMs = parseDuration(durationStr);
      if (!durationMs) {
        await interaction.reply({ content: 'Invalid duration. Use something like `1h`, `30m`, or `1d`.', flags: MessageFlags.Ephemeral });
        return;
      }
      endsAt = new Date(Date.now() + durationMs).toISOString();
    }

    await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
    await ensureGuild(interaction.guild.id);

    // Placeholder poll id (0) so the reply can go out first, then we swap in the real id once
    // we know the message's own id — vote buttons are keyed off the poll row, not the message.
    const placeholder = { id: 0, question, options, multi, closed: false };
    const { components, rows } = buildPollCard(placeholder, { counts: new Array(options.length).fill(0), voters: 0 });
    await interaction.editReply({ components: [...components, ...rows], flags: MessageFlags.IsComponentsV2 });

    const message = await interaction.fetchReply();
    const poll = await pollsDb.createPoll({
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      messageId: message.id,
      creatorId: interaction.user.id,
      question,
      options,
      multi,
      endsAt,
    });

    const final = buildPollCard(poll, { counts: new Array(options.length).fill(0), voters: 0 });
    await interaction.editReply({ components: [...final.components, ...final.rows], flags: MessageFlags.IsComponentsV2 });

    if (endsAt) {
      await interaction.followUp({ components: [textCard(`This poll closes automatically in **${formatDuration(new Date(endsAt) - Date.now())}**.`, 0x8399ff)], flags: [MessageFlags.IsComponentsV2, MessageFlags.Ephemeral] }).catch(() => {});
    }
  },
};
