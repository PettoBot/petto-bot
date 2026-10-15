// `!language` (alias `!lang`): which language Petto speaks on this server, and changing it (Manage Server). Prefix only.
const { SlashCommandBuilder, PermissionFlagsBits, MessageFlags } = require('discord.js');
const { textCard } = require('../../utils/caseCard');
const { EMOJI } = require('../../utils/emojis');
const { LANGUAGES, LANGUAGE_NAMES, t, tn, normalizeLanguage, languageOf, setGuildLanguage } = require('../../i18n');
const { refreshGuildPanels } = require('../../utils/panelRefresh');

// The language names stay in their own language, so a member who cannot read the current one still finds theirs.
const languageList = () => LANGUAGES.map((code) => `${LANGUAGE_NAMES[code]} (\`${code}\`)`).join(' · ');

/** The current language of the server and how to change it, written in that language. */
function buildCurrentCard(lang, prefix) {
  return textCard([
    t(lang, 'config.language.current', { language: LANGUAGE_NAMES[lang], command: `${prefix}language <${LANGUAGES.join('|')}>` }),
    t(lang, 'config.language.redrawHint', { command: `${prefix}language ${lang}` }),
    t(lang, 'config.language.available', { list: languageList() }),
  ].join('\n'), 0x4b4f59);
}

/** The answer after a change, already in the new language, with how many standing messages of Petto were redrawn in it. */
function buildDoneCard(lang, redrawn = 0) {
  const lines = [t(lang, 'config.language.set', { emoji: EMOJI.APPROVE, language: LANGUAGE_NAMES[lang] })];
  if (redrawn > 0) lines.push(tn(lang, 'config.language.redrawn', redrawn));
  return textCard(lines.join('\n'), 0xa5ea7a);
}

/** `es`, `set es`, `español`, `pt` -> the language code, or null. */
function readLanguageInput(text) {
  const raw = String(text ?? '').trim();
  const withSet = /^set\s+(\S.*)$/i.exec(raw);
  return normalizeLanguage(withSet ? withSet[1] : raw);
}

module.exports = {
  aliases: ['lang'],
  buildCurrentCard,
  buildDoneCard,
  readLanguageInput,
  data: new SlashCommandBuilder()
    .setName('language')
    .setDescription('View or change the language Petto speaks on this server.')
    .setDefaultMemberPermissions(PermissionFlagsBits.ManageGuild)
    .setDMPermission(false)
    .addStringOption((o) => o
      .setName('language')
      .setDescription('The new language: English, Español or Português (Brasil)')
      .setRequired(false)
      .addChoices(...LANGUAGES.map((code) => ({ name: LANGUAGE_NAMES[code], value: code })))),

  async execute(interaction) {
    const requested = interaction.options.getString('language');
    const current = await languageOf(interaction);
    const prefix = interaction.typedPrefix ?? '!';

    if (requested == null) {
      await interaction.reply({ components: [buildCurrentCard(current, prefix)], flags: MessageFlags.IsComponentsV2 });
      return;
    }

    const lang = readLanguageInput(requested);
    if (!lang) {
      await interaction.reply({ content: t(current, 'config.language.invalid', { list: languageList() }), flags: MessageFlags.Ephemeral });
      return;
    }

    await setGuildLanguage(interaction.guild.id, lang);
    interaction.pettoLang = lang;
    // The panels Petto already posted (VoiceMaster, tickets, verification…) keep the words they were posted with: they are redrawn
    // now. Setting the same language again is the way to redraw panels posted before this server chose it.
    const redrawn = await refreshGuildPanels(interaction.guild, lang);
    await interaction.reply({ components: [buildDoneCard(lang, redrawn.total)], flags: MessageFlags.IsComponentsV2 });
  },
};
