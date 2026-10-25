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
const { buildPollMessage, checkPollTemplate } = require('../utils/pollCard');
const { textCard } = require('../utils/caseCard');
const { ensureDraft, setDraft, deleteDraft } = require('../utils/pollDrafts');
const { parseDuration, formatDuration } = require('../utils/duration');
const { EMOJI } = require('../utils/emojis');
const { t, languageOf, currentLanguage } = require('../i18n');

const MAX_OPTIONS = 10;

function buildRows(uid, draft, lang) {
  const btn = (id, label, style = ButtonStyle.Secondary, emoji) => {
    const b = new ButtonBuilder().setCustomId(`${id}::${uid}`).setLabel(label).setStyle(style);
    if (emoji) b.setEmoji(emoji);
    return b;
  };

  return [
    new ActionRowBuilder().addComponents(
      btn('pl_q', t(lang, 'polls.panel.question.button'), ButtonStyle.Secondary, draft.question ? EMOJI.APPROVE : undefined),
      btn('pl_opts', t(lang, 'polls.panel.options.button', { count: draft.options.length }), ButtonStyle.Secondary, draft.options.length >= 2 ? EMOJI.APPROVE : undefined),
      btn('pl_img', t(lang, 'polls.panel.image.button'), ButtonStyle.Secondary, draft.image ? EMOJI.APPROVE : undefined),
      btn('pl_dur', t(lang, 'polls.panel.duration.button'), ButtonStyle.Secondary, draft.duration ? EMOJI.APPROVE : undefined),
      btn('pl_multi', t(lang, draft.multi ? 'polls.panel.multiOn.button' : 'polls.panel.multiOff.button')),
    ),
    new ActionRowBuilder().addComponents(
      btn('pl_tpl', draft.template ? t(lang, 'polls.panel.designNamed.button', { name: draft.template }).slice(0, 80) : t(lang, 'polls.panel.design.button'), ButtonStyle.Secondary, draft.template ? EMOJI.APPROVE : undefined),
      btn('pl_start', t(lang, 'polls.panel.start.button'), ButtonStyle.Success, EMOJI.APPROVE),
      btn('pl_cancel', t(lang, 'polls.panel.cancel.button'), ButtonStyle.Secondary, EMOJI.DENY),
    ),
  ];
}

/** Renders the panel message: a live preview of the poll-in-progress + edit buttons. */
function renderPanel(uid, draft, lang = currentLanguage()) {
  const lines = [
    t(lang, 'polls.panel.intro', { emoji: EMOJI.STAR }),
    '',
    `### 📊 ${draft.question ?? t(lang, 'polls.panel.noQuestion')}`,
    '',
  ];
  if (draft.options.length) {
    draft.options.forEach((opt, i) => lines.push(`${i + 1}. ${opt}`));
  } else {
    lines.push(t(lang, 'polls.panel.noOptions'));
  }
  const meta = [
    t(lang, draft.multi ? 'polls.type.multi' : 'polls.type.single'),
    draft.duration ? t(lang, 'polls.panel.closesIn', { duration: formatDuration(draft.duration, lang) }) : null,
    draft.template ? t(lang, 'polls.panel.designMeta', { name: draft.template }) : null,
  ].filter(Boolean);
  lines.push('', `-# ${meta.join(' · ')}`);

  const container = new ContainerBuilder().addTextDisplayComponents(new TextDisplayBuilder().setContent(lines.join('\n')));
  if (draft.image) {
    container.addMediaGalleryComponents(new MediaGalleryBuilder().addItems(new MediaGalleryItemBuilder().setURL(draft.image)));
  }

  return { components: [container, ...buildRows(uid, draft, lang)], flags: MessageFlags.IsComponentsV2 };
}

async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const [type, uid] = interaction.customId.split('::');
  if (interaction.user.id !== uid) {
    await interaction.reply({ content: t(lang, 'polls.panel.notYours', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral });
    return;
  }

  const draft = ensureDraft(uid);

  if (type === 'pl_multi') {
    draft.multi = !draft.multi;
    setDraft(uid, draft);
    await interaction.update(renderPanel(uid, draft, lang));
    return;
  }

  if (type === 'pl_cancel') {
    deleteDraft(uid);
    await interaction.update({ components: [textCard(t(lang, 'polls.panel.cancelled', { emoji: EMOJI.DENY }))], flags: MessageFlags.IsComponentsV2 });
    return;
  }

  if (type === 'pl_start') {
    if (!draft.question) {
      await interaction.reply({ content: t(lang, 'polls.panel.needQuestion'), flags: MessageFlags.Ephemeral });
      return;
    }
    if (draft.options.length < 2) {
      await interaction.reply({ content: t(lang, 'polls.panel.needOptions'), flags: MessageFlags.Ephemeral });
      return;
    }

    await interaction.deferUpdate();
    await ensureGuild(interaction.guild.id);

    const endsAt = draft.duration ? new Date(Date.now() + draft.duration).toISOString() : null;
    const empty = { counts: new Array(draft.options.length).fill(0), voters: 0 };
    const placeholder = { id: 0, question: draft.question, options: draft.options, image: draft.image, multi: draft.multi, closed: false, ends_at: endsAt, creator_id: interaction.user.id, embed_template: draft.template };
    const message = await interaction.channel.send(await buildPollMessage({ guild: interaction.guild, poll: placeholder, results: empty, lang }));

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
      embedTemplate: draft.template,
    });

    await message.edit(await buildPollMessage({ guild: interaction.guild, poll, results: empty, lang }));

    deleteDraft(uid);
    await interaction.editReply({ components: [textCard(t(lang, 'polls.panel.started', { emoji: EMOJI.APPROVE }), 0xa5ea7a)], flags: MessageFlags.IsComponentsV2 });
    return;
  }
  const modals = {
    pl_q: new ModalBuilder()
      .setCustomId(`plm_q::${uid}`)
      .setTitle(t(lang, 'polls.modal.question.title'))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('question').setLabel(t(lang, 'polls.modal.question.label')).setStyle(TextInputStyle.Short).setRequired(true).setMaxLength(200).setValue(draft.question ?? ''))),

    pl_opts: new ModalBuilder()
      .setCustomId(`plm_opts::${uid}`)
      .setTitle(t(lang, 'polls.modal.options.title'))
      .addComponents(
        new ActionRowBuilder().addComponents(
          new TextInputBuilder()
            .setCustomId('options')
            .setLabel(t(lang, 'polls.modal.options.label', { max: MAX_OPTIONS }))
            .setStyle(TextInputStyle.Paragraph)
            .setRequired(true)
            .setValue(draft.options.join('\n')),
        ),
      ),

    pl_img: new ModalBuilder()
      .setCustomId(`plm_img::${uid}`)
      .setTitle(t(lang, 'polls.modal.image.title'))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('image').setLabel(t(lang, 'polls.modal.image.label')).setStyle(TextInputStyle.Short).setRequired(false).setValue(draft.image ?? ''))),

    pl_tpl: new ModalBuilder()
      .setCustomId(`plm_tpl::${uid}`)
      .setTitle(t(lang, 'polls.modal.design.title'))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('template').setLabel(t(lang, 'polls.modal.design.label')).setStyle(TextInputStyle.Short).setRequired(false).setMaxLength(60).setValue(draft.template ?? ''))),

    pl_dur: new ModalBuilder()
      .setCustomId(`plm_dur::${uid}`)
      .setTitle(t(lang, 'polls.modal.duration.title'))
      .addComponents(new ActionRowBuilder().addComponents(new TextInputBuilder().setCustomId('duration').setLabel(t(lang, 'polls.modal.duration.label')).setStyle(TextInputStyle.Short).setRequired(false).setValue(draft.duration ? formatDuration(draft.duration, lang) : ''))),
  };

  const modal = modals[type];
  if (!modal) return;
  await interaction.showModal(modal);
}

async function handleModal(interaction) {
  const lang = await languageOf(interaction);
  const [type, uid] = interaction.customId.split('::');
  if (interaction.user.id !== uid) {
    await interaction.reply({ content: t(lang, 'polls.panel.notYours', { emoji: EMOJI.DENY }), flags: MessageFlags.Ephemeral });
    return;
  }

  const draft = ensureDraft(uid);
  const g = (id) => interaction.fields.getTextInputValue(id).trim();

  if (type === 'plm_dur') {
    const raw = g('duration');
    if (raw) {
      const ms = parseDuration(raw);
      if (!ms) {
        await interaction.reply({ content: t(lang, 'polls.modal.duration.invalid'), flags: MessageFlags.Ephemeral });
        return;
      }
    }
  }

  if (type === 'plm_tpl') {
    const raw = g('template');
    if (raw) {
      const status = await checkPollTemplate(interaction.guild.id, raw);
      if (status !== 'ok') {
        const key = status === 'missing' ? 'polls.modal.design.missing' : 'polls.modal.design.notV2';
        await interaction.reply({ content: t(lang, key, { emoji: EMOJI.DENY, name: raw }), flags: MessageFlags.Ephemeral });
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
  } else if (type === 'plm_tpl') {
    draft.template = g('template') || null;
  }

  setDraft(uid, draft);
  await interaction.editReply(renderPanel(uid, draft, lang));
}

module.exports = { renderPanel, handleButton, handleModal };
