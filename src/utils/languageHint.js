// A hint, once for each server whose language Petto only detected: when the first person who can manage the server runs a slash command and
// their Discord is in Spanish or Portuguese while the server speaks something else, a private note (in their language) says that
// `!language` switches it. It is never sent for a language somebody chose, and the database remembers it was said (`language_source` becomes
// 'auto-hinted', which is still "detected by Petto", not "chosen").
const { MessageFlags, PermissionFlagsBits } = require('discord.js');
const { ensureGuild, updateGuild } = require('../db/guilds');
const { LANGUAGE_NAMES, t, languageFromLocale, peekGuildLanguage } = require('../i18n');

const asked = new Set(); // servers looked at in this run: the database is read at most once for each

/** Runs after a slash command was answered. Never throws. Returns true when the hint was sent. */
async function maybeHintLanguage(interaction) {
  try {
    const guildId = interaction.guildId;
    if (!guildId || asked.has(guildId) || !(interaction.replied || interaction.deferred)) return false;
    const mine = languageFromLocale(interaction.locale);
    if (mine === 'en' || mine === peekGuildLanguage(guildId)) return false; // cheap checks first: most commands stop here
    if (!interaction.member?.permissions?.has?.(PermissionFlagsBits.ManageGuild)) return false;
    asked.add(guildId);
    const row = await ensureGuild(guildId);
    if (row.language_source !== 'auto') return false;
    await updateGuild(guildId, { language_source: 'auto-hinted' });
    await interaction.followUp({
      content: t(mine, 'setup.language.hint', { current: LANGUAGE_NAMES[peekGuildLanguage(guildId)], language: LANGUAGE_NAMES[mine], command: `${row.prefix || '!'}language ${mine}` }),
      flags: MessageFlags.Ephemeral,
      allowedMentions: { parse: [] },
    });
    return true;
  } catch {
    return false;
  }
}

module.exports = { maybeHintLanguage };
