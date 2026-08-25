// Handles the interactive poll panel and its vote-management actions.
const {
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ContainerBuilder,
  TextDisplayBuilder,
  MediaGalleryBuilder,
  MediaGalleryItemBuilder,
  MessageFlags,
} = require('discord.js');
const { ensureGuild } = require('../db/guilds');
const pollsDb = require('../db/polls');
const { buildPollCard } = require('../utils/pollCard');
const { textCard } = require('../utils/caseCard');
const { ensureDraft, setDraft, deleteDraft } = require('../utils/pollDrafts');
const { parseDuration, formatDuration } = require('../utils/duration');
const { EMOJI } = require('../utils/emojis');

const MAX_OPTIONS = 10;

function buildRows(uid, draft) {
  const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
    const b = new ButtonBuilder().setCustomId(`${id}::${uid}`).setLabel(label).setStyle(style);
    if (emoji) b.setEmoji(emoji);
    return b;
  };

  return [
    new ActionRowBuilder().addComponents(
      btn('pl_q', 'Question', ButtonStyle.Secondary, draft.question ? EMOJI.APPROVE : undefined),
      btn('pl_opts', `Options (${draft.options.length})`, ButtonStyle.Secondary, draft.options.length >= 2 ? EMOJI.APPROVE : undefined),
      btn('pl_img', 'Image', ButtonStyle.Secondary, draft.image ? EMOJI.APPROVE : undefined),
      btn('pl_dur', 'Duration', ButtonStyle.Secondary, draft.duration ? EMOJI.APPROVE : undefined),
      btn('pl_multi', draft.multi ? 'Multiple choice ✓' : 'Multiple choice'),
    ),
    new ActionRowBuilder().addComponents(
      btn('pl_start', 'Start Poll', ButtonStyle.Success, EMOJI.APPROVE),
      btn('pl_cancel', 'Cancel', ButtonStyle.Secondary, EMOJI.DENY),
    ),
  ];
}

/** Renders the panel message: a live preview of the poll-in-progress + edit buttons. */
function renderPanel(uid, draft) {
  const lines = [
    `${EMOJI.STAR} Building your poll. Click a button below to set that part, then **Start Poll** when ready.`,
    '',
    `### 📊 ${draft.question ?? '*No question set yet*'}`,
    '',
  ];
  if (draft.options.length) {
    draft.options.forEach((opt, i) => lines.push(`${i + 1}. ${opt}`));
  } else {
    lines.push('*No options yet — add at least 2.*');
  }
  lines.push('', `-# ${draft.multi ? 'Multiple choice' : 'Single choice'}${draft.duration ? ` · closes in ${formatDuration(draft.duration)}` : ''}`);

  const container = new ContainerBuilder().setAccentColor(0x4b4f59).addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  if (draft.image) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(draft.image)));
  }

  return { components: [container, ...buildRows(uid, draft)], flags: MessageFlags.IsComponentsV2 };
}

async function handleButton(interaction) {
  const [type, uid] = interaction.customId.split('::');
  if (interaction.user.id !== uid) {
    await interaction.reply({ content: `${EMOJI.DENY} This panel belongs to someone else.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const draft = ensureDraft(uid);

  if (type === 'pl_multi') {
    draft.multi = !draft.multi;
    setDraft(uid, draft);
    await interaction.update(renderPanel(uid, draft));
    return;
  }

  if (type === 'pl_cancel') {
    deleteDraft(uid);
    await interaction.update({ components: [textCard(`${EMOJI.DENY} Poll cancelled.`, 0x8b8fa3)], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (type === 'pl_start') {
    if (!draft.question) {
      await interaction.reply({ content: 'Set a question first.', flags: MessageFlags.Ephemeral });
      return;
    }
    if (draft.options.length < 2) {
      await interaction.reply({ content: 'Add at least 2 options first.', flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferUpdate();
    await ensureGuild(interaction.guild.id);

    const endsAt = draft.duration ? new Date(Date.now() + draft.duration).toISOString() : null;
    const placeholder = { id: 0, question: draft.question, options: draft.options, image: draft.image, multi: draft.multi, closed: false };
    const { components, rows } = buildPollCard(placeholder, { counts: new Array(draft.options.length).fill(0), voters: 0 });
    const message = await interaction.channel.send({ components: [...components, ...rows], flags: MessageFlags.IsComponentsV2 });

    const poll = await pollsDb.createPoll({
      guildId: interaction.guild.id,
      channelId: interaction.channel.id,
      messageId: message.id,
      creatorId: interaction.user.id,
      question: draft.question,
      options: draft.options,
      image: draft.image,
      multi: draft.multi,
      endsAt,
    });

    const final = buildPollCard(poll, { counts: new Array(draft.options.length).fill(0), voters: 0 });
    await message.edit({ components: [...final.components, ...final.rows], flags: MessageFlags.IsComponentsV2 });

    deleteDraft(uid);
    await interaction.editReply({ components: [textCard(`${EMOJI.APPROVE} Poll started!`, 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const modals = {
    pl_q: new ModalBuilder()
      .setCustomId(`plm_q::${uid}`)
      .setTitle('Poll Question')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('question').setLabel('Question').setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setValue(draft.question ?? ''))),

    pl_opts: new ModalBuilder()
      .setCustomId(`plm_opts::${uid}`)
      .setTitle('Poll Options')
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('options')
            .setLabel(`One option per line (2-${MAX_OPTIONS})`)
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue(draft.options.join('\n')),
        ),
      ),

    pl_img: new ModalBuilder()
      .setCustomId(`plm_img::${uid}`)
      .setTitle('Poll Image')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel('Image URL (leave blank to remove)').setStyle(TextInputStyle.Short).setRequired(false).setValue(draft.image ?? ''))),

    pl_dur: new ModalBuilder()
      .setCustomId(`plm_dur::${uid}`)
      .setTitle('Auto-close Duration')
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel('e.g. 1h, 30m, 1d (blank = never)').setStyle(TextInputStyle.Short).setRequired(false).setValue(draft.duration ? formatDuration(draft.duration) : ''))),
  };

  const modal = modals[type];
  if (!modal) return;
  await interaction.showModal(modal);
}

async function handleModal(interaction) {
  const [type, uid] = interaction.customId.split('::');
  if (interaction.user.id !== uid) {
    await interaction.reply({ content: `${EMOJI.DENY} This panel belongs to someone else.`, flags: MessageFlags.Ephemeral });
    return;
  }

  const draft = ensureDraft(uid);
  const g = (id) => interaction.fields.getTextInputValue(id).trim();

  if (type === 'plm_dur') {
    const raw = g('duration');
    if (raw) {
      const ms = parseDuration(raw);
      if (!ms) {
        await interaction.reply({ content: 'Invalid duration. Use something like `1h`, `30m`, or `1d`.', flags: MessageFlags.Ephemeral });
        return;
      }
    }
  }

  await interaction.deferUpdate();

  if (type === 'plm_q') {
    draft.question = g('question') || null;
  } else if (type === 'plm_opts') {
    draft.options = g('options')
      .split('\n')
      .map((o) => o.trim())
      .filter(Boolean)
      .slice(0, MAX_OPTIONS);
  } else if (type === 'plm_img') {
    draft.image = g('image') || null;
  } else if (type === 'plm_dur') {
    const raw = g('duration');
    draft.duration = raw ? parseDuration(raw) : null;
  }

  setDraft(uid, draft);
  await interaction.editReply(renderPanel(uid, draft));
}

module.exports = { renderPanel, handleButton, handleModal };
