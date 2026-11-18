// What `add-message`, `remove-message` and `messages` do for the welcome, the goodbye and the boost commands (the same three subcommands in each, so it is written once).
// The messages are rows of `member_event_variants` (utils/messageVariants.ts); the first message of each kind is the one `setup` saves. Written in TypeScript: compiled over
// utils/messageVariantsCommand.js.
import { MAX_MESSAGES, addVariant, removeVariant, variantsOf, type Kind } from './messageVariants';

interface Interaction {
  guild: { id: string };
  options: { getString(name: string): string | null; getInteger(name: string, required?: boolean): number | null };
  reply(options: Record<string, unknown>): Promise<unknown>;
}
const { MessageFlags } = require('discord.js') as { MessageFlags: { Ephemeral: number } };
const { t, languageOf } = require('../i18n') as { t: (lang: string, key: string, params?: Record<string, unknown>) => string; languageOf: (interaction: unknown) => Promise<string> };
const { getConfig } = require('../db/memberEvents') as { getConfig: (guildId: string) => Promise<Record<string, string | null> | null> };
const { getTemplate } = require('../db/embedTemplates') as { getTemplate: (guildId: string, name: string) => Promise<unknown> };
const { ensureGuild } = require('../db/guilds') as { ensureGuild: (guildId: string) => Promise<void> };
const { EMOJI } = require('./emojis') as { EMOJI: Record<string, string> };

const COLUMNS: Record<Kind, { message: string; template: string }> = {
  welcome: { message: 'welcome_message', template: 'welcome_embed_template' },
  leave: { message: 'leave_message', template: 'leave_embed_template' },
  boost: { message: 'boost_message', template: 'boost_embed_template' },
};
const ephemeral = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] as string[] } };
const kindWord = (lang: string, kind: Kind): string => t(lang, `welcomevariants.kind.${kind}`);
const preview = (lang: string, message: string | null, template: string | null): string => {
  const text = (message ?? '').replace(/\s+/g, ' ').trim();
  if (template && !text) return t(lang, 'welcomevariants.template', { name: template });
  return text.length > 90 ? `${text.slice(0, 89)}…` : text;
};

export async function addMessageCommand(interaction: Interaction, kind: Kind): Promise<void> {
  const lang = await languageOf(interaction);
  const message = interaction.options.getString('message');
  const template = interaction.options.getString('embed');
  if (!message?.trim() && !template?.trim()) { await interaction.reply({ content: t(lang, 'welcomevariants.needText'), ...ephemeral }); return; }
  if (template && !(await getTemplate(interaction.guild.id, template))) { await interaction.reply({ content: t(lang, 'welcomevariants.noEmbed', { name: template }), ...ephemeral }); return; }
  await ensureGuild(interaction.guild.id);
  const result = await addVariant(interaction.guild.id, kind, { message: message ?? null, template: template ?? null });
  if (result.ok === false) { await interaction.reply({ content: t(lang, result.reason === 'full' ? 'welcomevariants.full' : 'welcomevariants.needText', { kind: kindWord(lang, kind), max: MAX_MESSAGES }), ...ephemeral }); return; }
  await interaction.reply({ content: t(lang, 'welcomevariants.added', { emoji: EMOJI.APPROVE, kind: kindWord(lang, kind), total: result.total }), ...ephemeral });
}

export async function removeMessageCommand(interaction: Interaction, kind: Kind): Promise<void> {
  const lang = await languageOf(interaction);
  const number = interaction.options.getInteger('number', true) ?? 0;
  if (number === 1) { await interaction.reply({ content: t(lang, 'welcomevariants.firstNote'), ...ephemeral }); return; }
  const removed = await removeVariant(interaction.guild.id, kind, number);
  await interaction.reply({ content: removed ? t(lang, 'welcomevariants.removed', { emoji: EMOJI.APPROVE, number }) : t(lang, 'welcomevariants.notFound', { number }), ...ephemeral });
}

export async function listMessagesCommand(interaction: Interaction, kind: Kind): Promise<void> {
  const lang = await languageOf(interaction);
  const config = await getConfig(interaction.guild.id);
  const columns = COLUMNS[kind];
  const extra = await variantsOf(interaction.guild.id, kind);
  const first = config ? { message: config[columns.message] ?? null, template: config[columns.template] ?? null } : { message: null, template: null };
  const lines: string[] = [];
  const hasFirst = Boolean(first.message?.trim() || first.template?.trim());
  if (hasFirst) lines.push(`**1.** ${preview(lang, first.message, first.template)}`);
  extra.forEach((variant, index) => lines.push(`**${index + 2}.** ${preview(lang, variant.message, variant.template)}`));
  if (!lines.length) { await interaction.reply({ content: t(lang, 'welcomevariants.listEmpty', { kind: kindWord(lang, kind) }), ...ephemeral }); return; }
  const head = t(lang, 'welcomevariants.listTitle', { kind: kindWord(lang, kind), count: lines.length, max: MAX_MESSAGES });
  await interaction.reply({ content: `${head}\n${lines.join('\n')}`.slice(0, 1900), ...ephemeral });
}
