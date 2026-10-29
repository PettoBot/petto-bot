// The question a feed of pictures asks when a word has more than one meaning (`!feed add pictures 30m rosa`: the flower, the color or the
// mountain?): a button for each meaning. The feed is only saved when one is clicked, by who added it, with the tag of that meaning.
const crypto = require('node:crypto');
const { ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } = require('discord.js');
const { textCard } = require('../utils/caseCard');
const { t, languageOf } = require('../i18n');

const PREFIX = 'fdsense:';
const KEEP_MS = 15 * 60_000;
const pending = new Map(); // token -> { until, userId, guildId, input, choices }

function forgetOld(now = Date.now()) {
  for (const [token, entry] of pending) if (entry.until < now) pending.delete(token);
}

/**
 * The card that asks which meaning, and remembers what to save for each one. `input` is what `createFeed` was given (the account is replaced by the
 * meaning chosen); `result` is its answer `{ error: 'ambiguous', word, choices }`.
 */
function question({ lang, userId, guildId, input, result }) {
  forgetOld();
  if (pending.size > 500) pending.delete(pending.keys().next().value);
  const token = crypto.randomBytes(6).toString('hex');
  const choices = (result.choices ?? []).slice(0, 4);
  pending.set(token, { until: Date.now() + KEEP_MS, userId, guildId, input, choices });
  const example = `${String(input.account ?? '').trim()} ${t(lang, 'feeds.pictures.moreWordsExample')}`.trim();
  const text = [t(lang, 'feeds.add.error.ambiguous', { emoji: '❓', word: result.word }), `-# ${t(lang, 'feeds.pictures.senseOther', { example })}`].join('\n');
  const row = new ActionRowBuilder().addComponents(choices.map((choice, index) => new ButtonBuilder()
    .setCustomId(`${PREFIX}${token}:${index}`).setStyle(ButtonStyle.Secondary)
    .setLabel(t(lang, `feeds.pictures.sense.${choice.key}`, { word: result.word }).slice(0, 80))));
  return { components: [textCard(text, null), row], flags: MessageFlags.IsComponentsV2 };
}

/** A click on a meaning: the feed is saved with it, and the question becomes the answer. */
async function handleButton(interaction) {
  const lang = await languageOf(interaction);
  const [token, index] = interaction.customId.slice(PREFIX.length).split(':');
  const entry = pending.get(token);
  const reply = (key) => interaction.reply({ content: t(lang, key), flags: MessageFlags.Ephemeral });
  if (!entry || entry.until < Date.now() || entry.guildId !== interaction.guildId) return reply('feeds.pictures.expired');
  if (entry.userId !== interaction.user.id) return reply('feeds.pictures.notYours');
  const choice = entry.choices[Number(index)];
  if (!choice) return reply('feeds.pictures.expired');
  pending.delete(token);
  await interaction.deferUpdate();
  // Required here: the command module loads the service, which loads the providers.
  const { createFeed } = require('../feeds/service');
  const { resultCard } = require('../commands/config/feed');
  const result = await createFeed(interaction.guild, { ...entry.input, account: choice.account, lang });
  return interaction.editReply({ components: [resultCard(lang, entry.input.platform, result)], flags: MessageFlags.IsComponentsV2 });
}

module.exports = { PREFIX, question, handleButton };
