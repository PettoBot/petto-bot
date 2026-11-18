"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.addMessageCommand = addMessageCommand;
exports.removeMessageCommand = removeMessageCommand;
exports.listMessagesCommand = listMessagesCommand;
// What `add-message`, `remove-message` and `messages` do for the welcome, the goodbye and the boost commands (the same three subcommands in each, so it is written once).
// The messages are rows of `member_event_variants` (utils/messageVariants.ts); the first message of each kind is the one `setup` saves. Written in TypeScript: compiled over
// utils/messageVariantsCommand.js.
const messageVariants_1 = require("./messageVariants");
const { MessageFlags } = require('discord.js');
const { t, languageOf } = require('../i18n');
const { getConfig } = require('../db/memberEvents');
const { getTemplate } = require('../db/embedTemplates');
const { ensureGuild } = require('../db/guilds');
const { EMOJI } = require('./emojis');
const COLUMNS = {
    welcome: { message: 'welcome_message', template: 'welcome_embed_template' },
    leave: { message: 'leave_message', template: 'leave_embed_template' },
    boost: { message: 'boost_message', template: 'boost_embed_template' },
};
const ephemeral = { flags: MessageFlags.Ephemeral, allowedMentions: { parse: [] } };
const kindWord = (lang, kind) => t(lang, `welcomevariants.kind.${kind}`);
const preview = (lang, message, template) => {
    const text = (message ?? '').replace(/\s+/g, ' ').trim();
    if (template && !text)
        return t(lang, 'welcomevariants.template', { name: template });
    return text.length > 90 ? `${text.slice(0, 89)}…` : text;
};
async function addMessageCommand(interaction, kind) {
    const lang = await languageOf(interaction);
    const message = interaction.options.getString('message');
    const template = interaction.options.getString('embed');
    if (!message?.trim() && !template?.trim()) {
        await interaction.reply({ content: t(lang, 'welcomevariants.needText'), ...ephemeral });
        return;
    }
    if (template && !(await getTemplate(interaction.guild.id, template))) {
        await interaction.reply({ content: t(lang, 'welcomevariants.noEmbed', { name: template }), ...ephemeral });
        return;
    }
    await ensureGuild(interaction.guild.id);
    const result = await (0, messageVariants_1.addVariant)(interaction.guild.id, kind, { message: message ?? null, template: template ?? null });
    if (!result.ok) {
        await interaction.reply({ content: t(lang, result.reason === 'full' ? 'welcomevariants.full' : 'welcomevariants.needText', { kind: kindWord(lang, kind), max: messageVariants_1.MAX_MESSAGES }), ...ephemeral });
        return;
    }
    await interaction.reply({ content: t(lang, 'welcomevariants.added', { emoji: EMOJI.APPROVE, kind: kindWord(lang, kind), total: result.total }), ...ephemeral });
}
async function removeMessageCommand(interaction, kind) {
    const lang = await languageOf(interaction);
    const number = interaction.options.getInteger('number', true) ?? 0;
    if (number === 1) {
        await interaction.reply({ content: t(lang, 'welcomevariants.firstNote'), ...ephemeral });
        return;
    }
    const removed = await (0, messageVariants_1.removeVariant)(interaction.guild.id, kind, number);
    await interaction.reply({ content: removed ? t(lang, 'welcomevariants.removed', { emoji: EMOJI.APPROVE, number }) : t(lang, 'welcomevariants.notFound', { number }), ...ephemeral });
}
async function listMessagesCommand(interaction, kind) {
    const lang = await languageOf(interaction);
    const config = await getConfig(interaction.guild.id);
    const columns = COLUMNS[kind];
    const extra = await (0, messageVariants_1.variantsOf)(interaction.guild.id, kind);
    const first = config ? { message: config[columns.message] ?? null, template: config[columns.template] ?? null } : { message: null, template: null };
    const lines = [];
    const hasFirst = Boolean(first.message?.trim() || first.template?.trim());
    if (hasFirst)
        lines.push(`**1.** ${preview(lang, first.message, first.template)}`);
    extra.forEach((variant, index) => lines.push(`**${index + 2}.** ${preview(lang, variant.message, variant.template)}`));
    if (!lines.length) {
        await interaction.reply({ content: t(lang, 'welcomevariants.listEmpty', { kind: kindWord(lang, kind) }), ...ephemeral });
        return;
    }
    const head = t(lang, 'welcomevariants.listTitle', { kind: kindWord(lang, kind), count: lines.length, max: messageVariants_1.MAX_MESSAGES });
    await interaction.reply({ content: `${head}\n${lines.join('\n')}`.slice(0, 1900), ...ephemeral });
}
