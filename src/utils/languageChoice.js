// The part of the setup message that says which language Petto chose for a new server and why, with a button for each language. Pressing one
// is handled by src/interactions/languageChoice.js. The custom id carries everything the handler needs, because the same buttons also arrive by
// direct message (no server in the interaction): `plang:<kind>:<server id>:<language>`, where kind is the message they are on.
const { ContainerBuilder, TextDisplayBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const { EMOJI } = require('./emojis');
const { LANGUAGES, LANGUAGE_NAMES, t, currentLanguage } = require('../i18n');

const PREFIX = 'plang:';
// admin: the setup message in the private channel; fallback: in another private channel; dm: by direct message to who added Petto;
// owner: the guide sent to the owner of the server.
const KINDS = { admin: 'a', fallback: 'f', dm: 'd', owner: 'o' };
const KIND_BY_CODE = Object.fromEntries(Object.entries(KINDS).map(([name, code]) => [code, name]));

// The catalog key of each button (`setup.language.<key>.button`): the names of the languages are never translated.
const BUTTON_KEY = { en: 'en', es: 'es', 'pt-BR': 'pt' };

const customId = (kind, guildId, language) => `${PREFIX}${KINDS[kind]}:${guildId}:${language}`;

/** `plang:a:123:es` -> { kind: 'admin', guildId: '123', language: 'es' }, or null when it is not one of these ids. */
function parseCustomId(id) {
  const match = /^plang:([afdo]):(\d{15,25}):([A-Za-z-]+)$/.exec(String(id ?? ''));
  if (!match || !LANGUAGES.includes(match[3])) return null;
  return { kind: KIND_BY_CODE[match[1]], guildId: match[2], language: match[3] };
}

/**
 * @param {object} options
 * @param {string} options.guildId
 * @param {'admin'|'fallback'|'dm'|'owner'} options.kind which message this goes on
 * @param {{ language: string, source: 'locale'|'words'|'default', words?: string[] }|null} options.choice what Petto detected; null when the language
 *   was chosen by a person (or the server is not new): nothing is offered
 * @param {boolean} [options.done] a button was pressed: say it is done instead of why Petto chose
 * @param {string} options.prefix
 */
function buildLanguageSection({ guildId, kind, choice, done = false, prefix = '!', lang = currentLanguage() }) {
  if (!choice) return null;
  const language = LANGUAGE_NAMES[choice.language];
  const text = done
    ? t(lang, 'setup.language.done', { emoji: EMOJI.APPROVE, language, prefix })
    : [
      t(lang, `setup.language.chose.${choice.source}`, { language, words: (choice.words ?? []).map((word) => `\`${word}\``).join(', ') }),
      t(lang, 'setup.language.change', { prefix }),
    ].join('\n');
  const row = new ActionRowBuilder().addComponents(LANGUAGES.map((code) => new ButtonBuilder()
    .setCustomId(customId(kind, guildId, code))
    .setLabel(t(lang, `setup.language.${BUTTON_KEY[code]}.button`))
    .setStyle(code === choice.language ? ButtonStyle.Primary : ButtonStyle.Secondary)));
  return new ContainerBuilder()
    .addTextDisplayComponents(new TextDisplayBuilder().setContent(`${t(lang, 'setup.language.heading')}\n${text}`))
    .addActionRowComponents(row);
}

module.exports = { PREFIX, KINDS, customId, parseCustomId, buildLanguageSection };
