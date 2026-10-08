const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { commandRef } = require('../../utils/commandRef');
const { parseDuration: parseLength } = require('../../utils/duration');
const { ensureGuild } = require('../../db/guilds');
const giveawaysDb = require('../../db/giveaways');
const presetsDb = require('../../db/giveawayPresets');
const giveawayTemplatesDb = require('../../db/giveawayTemplates');
const embedTemplatesDb = require('../../db/embedTemplates');
const configDb = require('../../db/giveawayConfig');
const engine = require('../../utils/giveawayEngine');
const { formatDuration } = require('../../utils/duration');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');

const ENTRY_MODE_CHOICES = [{ name: 'button', value: 'button' }, { name: 'reaction', value: 'reaction' }];

const MESSAGE_CHOICES = [
  { name: 'winner', value: 'winner' },
  { name: 'deny', value: 'deny' },
  { name: 'claim time', value: 'claim_time' },
  { name: 'claim time over', value: 'claim_time_over' },
  { name: 'accept', value: 'accept' },
  { name: 'no entries', value: 'no_entries' },
];

module.exports = {
  data: new SlashCommandBuilder()
    .setName('giveaway')
    .setDescription('Run and manage giveaways.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addSubcommand((s) =>
      s
        .setName('quick')
        .setDescription('Start a giveaway with default settings.')
        .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 1h, 3d').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('prize').setDescription('Prize').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in (default: here)').setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('start')
        .setDescription('Start a fully-customized giveaway.')
        .addStringOption((o) => o.setName('duration').setDescription('e.g. 10m, 1h, 3d').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('Number of winners').setRequired(true).setMinValue(1))
        .addStringOption((o) => o.setName('prize').setDescription('Prize').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription('Channel to post in (default: here)').setRequired(false))
        .addStringOption((o) => o.setName('claim_time').setDescription('e.g. 5m — winners must accept within this time (default: none)').setRequired(false))
        .addStringOption((o) => o.setName('preset').setDescription('Giveaway preset name (default: none)').setRequired(false))
        .addStringOption((o) => o.setName('embed_template').setDescription('Saved giveaway embed template name (default: none)').setRequired(false))
        .addStringOption((o) => o.setName('entry_mode').setDescription('button or reaction (default: button)').setRequired(false).addChoices(...ENTRY_MODE_CHOICES)),
    )
    .addSubcommand((s) =>
      s
        .setName('template')
        .setDescription('Start a giveaway from a saved template.')
        .addStringOption((o) => o.setName('template_name').setDescription('Template name').setRequired(true))
        .addChannelOption((o) => o.setName('channel').setDescription("Override the template's channel").setRequired(false)),
    )
    .addSubcommand((s) =>
      s
        .setName('reroll')
        .setDescription('Draw new winner(s) for an ended giveaway.')
        .addStringOption((o) => o.setName('message_id').setDescription('The giveaway message ID').setRequired(true))
        .addIntegerOption((o) => o.setName('winners').setDescription('How many to redraw (default: original count)').setRequired(false).setMinValue(1)),
    )
    .addSubcommand((s) => s.setName('end').setDescription('End a giveaway early.').addStringOption((o) => o.setName('message_id').setDescription('The giveaway message ID').setRequired(true)))
    .addSubcommand((s) =>
      s
        .setName('edit')
        .setDescription('Edit an active giveaway.')
        .addStringOption((o) => o.setName('message_id').setDescription('The giveaway message ID').setRequired(true))
        .addStringOption((o) => o.setName('prize').setDescription('New prize').setRequired(false))
        .addIntegerOption((o) => o.setName('winners').setDescription('New winner count').setRequired(false).setMinValue(1))
        .addStringOption((o) => o.setName('duration').setDescription('New total duration from now, e.g. 10m').setRequired(false)),
    )
    .addSubcommand((s) => s.setName('embed').setDescription('Set the default saved !embed design used for new giveaways.').addStringOption((o) => o.setName('template').setDescription('Saved !embed name, or clear').setRequired(true)))
    .addSubcommand((s) => s.setName('reaction').setDescription('Set the default entry reaction emoji.').addStringOption((o) => o.setName('emoji').setDescription('An emoji').setRequired(true)))
    .addSubcommand((s) => s.setName('entry-mode').setDescription('Set the default entry mode.').addStringOption((o) => o.setName('mode').setDescription('button or reaction').setRequired(true).addChoices(...ENTRY_MODE_CHOICES)))
    .addSubcommand((s) => s.setName('winner-message').setDescription('Set the message sent when winners are chosen.').addStringOption((o) => o.setName('message').setDescription('Supports {gw.*} and {user} variables').setRequired(true)))
    .addSubcommand((s) => s.setName('deny-message').setDescription('Set the message sent when a winner denies their prize.').addStringOption((o) => o.setName('message').setDescription('Supports {gw.*} and {user} variables').setRequired(true)))
    .addSubcommand((s) => s.setName('claim-time-message').setDescription('Set the claim-time reminder message.').addStringOption((o) => o.setName('message').setDescription('Supports {gw.*} and {user} variables').setRequired(true)))
    .addSubcommand((s) => s.setName('claim-time-over-message').setDescription('Set the message sent when claim time expires.').addStringOption((o) => o.setName('message').setDescription('Supports {gw.*} and {user} variables').setRequired(true)))
    .addSubcommand((s) => s.setName('accept-message').setDescription('Set the message sent when a winner accepts.').addStringOption((o) => o.setName('message').setDescription('Supports {gw.*} and {user} variables').setRequired(true)))
    .addSubcommand((s) => s
      .setName('message-template')
      .setDescription('Use a saved embed for one of the giveaway messages, or none to go back to its text.')
      .addStringOption((o) => o.setName('message').setDescription('Which message').setRequired(true).addChoices(...MESSAGE_CHOICES))
      .addStringOption((o) => o.setName('template').setDescription('Saved embed name, or none').setRequired(true)))
    .addSubcommand((s) => s.setName('no-entries-message').setDescription('Set the message sent when a giveaway ends with no entries.').addStringOption((o) => o.setName('message').setDescription('Supports {gw.*} variables').setRequired(true))),
  aliases: ['gw'],
  prefixGreedyStringOptions: {
    quick: 'prize',
    start: 'prize',
  },
  // `!giveaway edit <message id> <prize, with or without quotes> [winners] [duration]`: the prize is everything between the id and the
  // numbers at the end, so it does not need quotes. `--prize`, `--winners` and `--duration` also work.
  prefixRawOptions: { edit: parseEditText },

  async execute(interaction) {
    const sub = interaction.options.getSubcommand();
    if (sub === 'quick') return quickCmd(interaction);
    if (sub === 'start') return startCmd(interaction);
    if (sub === 'template') return templateCmd(interaction);
    if (sub === 'reroll') return rerollCmd(interaction);
    if (sub === 'end') return endCmd(interaction);
    if (sub === 'edit') return editCmd(interaction);
    if (sub === 'embed') return setEmbedCmd(interaction);
    if (sub === 'reaction') return configCmd(interaction, 'reaction', interaction.options.getString('emoji', true), 'Default entry reaction set.');
    if (sub === 'entry-mode') return configCmd(interaction, 'entry_mode', interaction.options.getString('mode', true), 'Default entry mode set.');
    if (sub === 'winner-message') return configCmd(interaction, 'winner_message', interaction.options.getString('message', true), 'Winner message set.');
    if (sub === 'deny-message') return configCmd(interaction, 'deny_message', interaction.options.getString('message', true), 'Deny message set.');
    if (sub === 'claim-time-message') return configCmd(interaction, 'claim_time_message', interaction.options.getString('message', true), 'Claim-time message set.');
    if (sub === 'claim-time-over-message') return configCmd(interaction, 'claim_time_over_message', interaction.options.getString('message', true), 'Claim-time-over message set.');
    if (sub === 'accept-message') return configCmd(interaction, 'accept_message', interaction.options.getString('message', true), 'Accept message set.');
    if (sub === 'message-template') return messageTemplateCmd(interaction);
    return configCmd(interaction, 'no_entries_message', interaction.options.getString('message', true), 'No-entries message set.');
  },
};

// Lengths of time as people write them ("3d 4h", "1 hour 30 minutes"), shared with the other commands.
const parseDuration = (str) => parseLength(str);

async function quickCmd(interaction) {
  const durationMs = parseDuration(interaction.options.getString('duration', true));
  if (!durationMs) {
    await interaction.reply({ content: 'Provide a valid duration, e.g. `10m`, `1h`, `3d`.', flags: MessageFlags.Ephemeral });
    return;
  }
  const winners = interaction.options.getInteger('winners', true);
  const prize = interaction.options.getString('prize', true);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const config = await configDb.ensureConfig(interaction.guild.id);

  await engine.startGiveaway({
    guild: interaction.guild,
    channel,
    hostId: interaction.user.id,
    prize,
    winnersCount: winners,
    endsAt: new Date(Date.now() + durationMs),
    claimTimeMs: null,
    entryMode: config.entry_mode,
    reaction: config.reaction,
    presetId: null,
    embedTemplate: config.embed_template,
  });

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Giveaway started in ${channel} for **${prize}**.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function startCmd(interaction) {
  const durationMs = parseDuration(interaction.options.getString('duration', true));
  if (!durationMs) {
    await interaction.reply({ content: 'Provide a valid duration, e.g. `10m`, `1h`, `3d`.', flags: MessageFlags.Ephemeral });
    return;
  }
  const claimTimeStr = interaction.options.getString('claim_time');
  const claimTimeMs = claimTimeStr ? parseDuration(claimTimeStr) : null;
  if (claimTimeStr && !claimTimeMs) {
    await interaction.reply({ content: 'Provide a valid claim time, e.g. `5m`, `1h`.', flags: MessageFlags.Ephemeral });
    return;
  }

  const winners = interaction.options.getInteger('winners', true);
  const prize = interaction.options.getString('prize', true);
  const channel = interaction.options.getChannel('channel') ?? interaction.channel;
  const presetName = interaction.options.getString('preset');
  const embedTemplate = interaction.options.getString('embed_template');
  const entryMode = interaction.options.getString('entry_mode');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const config = await configDb.ensureConfig(interaction.guild.id);

  let presetId = null;
  if (presetName) {
    const preset = await presetsDb.getPreset(interaction.guild.id, presetName);
    if (!preset) {
      await interaction.editReply({ components: [textCard(`Preset \`${presetName}\` doesn't exist.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
      return;
    }
    presetId = preset.id;
  }

  if (embedTemplate) {
    const template = await embedTemplatesDb.getTemplate(interaction.guild.id, embedTemplate);
    if (!template) {
      await interaction.editReply({
        components: [textCard(`Saved embed \`${embedTemplate}\` doesn't exist. Create it first with \`${commandRef(interaction, `embed create ${embedTemplate}`)}\`.`, 0xfe6465)],
        flags: MessageFlags.IsComponentsV2,
      });
      return;
    }
  }

  await engine.startGiveaway({
    guild: interaction.guild,
    channel,
    hostId: interaction.user.id,
    prize,
    winnersCount: winners,
    endsAt: new Date(Date.now() + durationMs),
    claimTimeMs,
    entryMode: entryMode ?? config.entry_mode,
    reaction: config.reaction,
    presetId,
    embedTemplate: embedTemplate ?? config.embed_template,
  });

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Giveaway started in ${channel} for **${prize}**.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function templateCmd(interaction) {
  const name = interaction.options.getString('template_name', true);
  const channelOverride = interaction.options.getChannel('channel');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  const doc = await giveawayTemplatesDb.getTemplate(interaction.guild.id, name);
  if (!doc) {
    await interaction.editReply({ components: [textCard("That giveaway template doesn't exist.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const data = doc.data;
  const channel = channelOverride ?? (data.channelId ? await interaction.guild.channels.fetch(data.channelId).catch(() => null) : null) ?? interaction.channel;
  const config = await configDb.ensureConfig(interaction.guild.id);

  await engine.startGiveaway({
    guild: interaction.guild,
    channel,
    hostId: interaction.user.id,
    prize: data.prize,
    winnersCount: data.winners,
    endsAt: new Date(Date.now() + data.durationMs),
    claimTimeMs: data.claimTimeMs ?? null,
    entryMode: data.entryMode ?? config.entry_mode,
    reaction: config.reaction,
    presetId: data.presetId ?? null,
    embedTemplate: data.embedTemplate ?? config.embed_template,
  });

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Giveaway started from template **${doc.name}** in ${channel}.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function findGiveaway(interaction, messageId) {
  return giveawaysDb.getGiveawayByMessageId(interaction.guild.id, messageId.trim());
}

async function rerollCmd(interaction) {
  const messageId = interaction.options.getString('message_id', true);
  const winners = interaction.options.getInteger('winners');

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const giveaway = await findGiveaway(interaction, messageId);
  if (!giveaway) {
    await interaction.editReply({ components: [textCard("Couldn't find a giveaway with that message ID.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (!giveaway.ended) {
    await interaction.editReply({ components: [textCard('That giveaway is still active — use `end` first.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  try {
    const winnerIds = await engine.rerollGiveaway(interaction.client, giveaway, winners);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  New winner(s): ${winnerIds.map((id) => `<@${id}>`).join(', ')}`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
  } catch (err) {
    await interaction.editReply({ components: [textCard(err.userFacing ? err.message : 'Failed to reroll.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
}

async function endCmd(interaction) {
  const messageId = interaction.options.getString('message_id', true);
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });

  const giveaway = await findGiveaway(interaction, messageId);
  if (!giveaway) {
    await interaction.editReply({ components: [textCard("Couldn't find a giveaway with that message ID.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (giveaway.ended) {
    await interaction.editReply({ components: [textCard('That giveaway already ended.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  await engine.endGiveaway(interaction.client, giveaway);
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Giveaway ended.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

const DURATION_WORD = /^\d+(?:\.\d+)?\s*[smhdw]$/i;
const WINNERS_WORD = /^\d{1,2}$/;

/** Reads the text after `!giveaway edit` into the options of the command (see `prefixRawOptions`). */
function parseEditText(text) {
  const tokens = require('../../handlers/prefixInteraction').tokenize(text);
  const values = {};
  if (tokens.length) values.message_id = tokens.shift();

  const flagged = tokens.some((token) => /^--(prize|winners|duration)$/i.test(token));
  if (flagged) {
    const words = [];
    let current = null;
    for (const token of tokens) {
      const flag = /^--(prize|winners|duration)$/i.exec(token);
      if (flag) { current = flag[1].toLowerCase(); words.push([current, []]); } else if (current) words[words.length - 1][1].push(token);
    }
    for (const [name, parts] of words) {
      const value = parts.join(' ').trim();
      if (!value) continue;
      if (name === 'winners') values.winners = Number(value);
      else values[name] = value;
    }
    return values;
  }

  // Without flags: the end of the text is the duration (3d 4h) and the number of winners, what is left is the prize.
  const duration = [];
  while (tokens.length && DURATION_WORD.test(tokens[tokens.length - 1])) duration.unshift(tokens.pop());
  if (duration.length) values.duration = duration.join(' ');
  if (tokens.length > 1 && WINNERS_WORD.test(tokens[tokens.length - 1])) values.winners = Number(tokens.pop());
  const prize = tokens.join(' ').trim();
  if (prize) values.prize = prize;
  return values;
}

async function editCmd(interaction) {
  const messageId = interaction.options.getString('message_id', true);
  const prize = interaction.options.getString('prize');
  const winners = interaction.options.getInteger('winners');
  const durationStr = interaction.options.getString('duration');

  let durationMs = null;
  if (durationStr) {
    durationMs = parseDuration(durationStr);
    if (!durationMs) {
      await interaction.reply({ content: 'Provide a valid duration, e.g. `10m`, `1h`.', flags: MessageFlags.Ephemeral });
      return;
    }
  }

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  const giveaway = await findGiveaway(interaction, messageId);
  if (!giveaway) {
    await interaction.editReply({ components: [textCard("Couldn't find a giveaway with that message ID.", 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (giveaway.ended) {
    await interaction.editReply({ components: [textCard('That giveaway already ended.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  if (!prize && !winners && !durationMs) {
    await interaction.editReply({ components: [textCard('Provide at least one field to change.', 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  const patch = {};
  if (prize) patch.prize = prize;
  if (winners) patch.winners_count = winners;
  if (durationMs) patch.ends_at = new Date(Date.now() + durationMs).toISOString();

  const updated = await giveawaysDb.updateGiveaway(giveaway.id, patch);

  const channel = await interaction.guild.channels.fetch(giveaway.channel_id).catch(() => null);
  if (channel) await engine.refreshGiveawayMessage(channel, updated);

  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  Giveaway updated.`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}

async function setEmbedCmd(interaction) {
  const rawName = interaction.options.getString('template', true).trim();

  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);

  if (['clear', 'none'].includes(rawName.toLowerCase())) {
    await configDb.updateConfig(interaction.guild.id, { embed_template: null });
    await interaction.editReply({
      components: [textCard(`${EMOJI.APPROVE}  Default giveaway embed cleared. New giveaways will use Petto's built-in design.`, 0xa5ea7a)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  const doc = await embedTemplatesDb.getTemplate(interaction.guild.id, rawName);
  if (!doc) {
    await interaction.editReply({
      components: [textCard(`No saved embed named \`${rawName}\` exists. Create one with \`${commandRef(interaction, `embed create ${rawName}`)}\` first.`, 0xfe6465)],
      flags: MessageFlags.IsComponentsV2,
    });
    return;
  }

  await configDb.updateConfig(interaction.guild.id, { embed_template: doc.name });
  await interaction.editReply({
    components: [textCard(`${EMOJI.APPROVE}  Default giveaway design set to saved embed **${doc.name}**.`, 0xa5ea7a)],
    flags: MessageFlags.IsComponentsV2,
  });
}

async function messageTemplateCmd(interaction) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  const which = interaction.options.getString('message', true).trim().toLowerCase().replace(/[\s-]+/g, '_');
  if (!MESSAGE_CHOICES.some((choice) => choice.value === which)) {
    return interaction.editReply({ components: [textCard(`Choose one of: ${MESSAGE_CHOICES.map((choice) => `\`${choice.value}\``).join(', ')}.`, 0xfe6465)], flags: MessageFlags.IsComponentsV2 });
  }
  const column = `${which}_embed_template`;
  const name = interaction.options.getString('template', true).trim();
  const label = MESSAGE_CHOICES.find((choice) => choice.value === which)?.name ?? which;
  const done = (text, color = 0xa5ea7a) => interaction.editReply({ components: [textCard(text, color)], flags: MessageFlags.IsComponentsV2 });
  if (['none', 'clear'].includes(name.toLowerCase())) {
    await configDb.updateConfig(interaction.guild.id, { [column]: null });
    return done(`${EMOJI.APPROVE}  The ${label} message goes back to its text.`);
  }
  const doc = await embedTemplatesDb.getTemplate(interaction.guild.id, name);
  if (!doc) return done(`No saved embed named \`${name}\` exists. Create one with \`${commandRef(interaction, `embed create ${name}`)}\` first.`, 0xfe6465);
  await configDb.updateConfig(interaction.guild.id, { [column]: doc.name });
  return done(`${EMOJI.APPROVE}  The ${label} message now uses the saved embed **${doc.name}**.`);
}

async function configCmd(interaction, field, value, successText) {
  await interaction.deferReply({ flags: MessageFlags.IsComponentsV2 });
  await ensureGuild(interaction.guild.id);
  await configDb.updateConfig(interaction.guild.id, { [field]: value });
  await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE}  ${successText}`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
}
