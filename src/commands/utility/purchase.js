"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// i18n-ignore-file: the texts are in the catalog (purchase.*); the builder holds the English description that scripts/i18n-commands.js copies.
// /purchase (and `!purchase`): where to buy Premium for a server, a plan for yourself (Bronze, Silver or Gold) or a pack of ceramos. It does not make the checkout:
// the buttons open the pages of the website, where the person signs in with Discord, accepts the terms and goes on to the payment. Written in TypeScript: compiled over purchase.js.
const discord_js_1 = require("discord.js");
const { t, languageOf } = require('../../i18n');
const { EMOJI } = require('../../utils/emojis');
const SITE = 'https://petto.sbs';
/** The page of the website for each thing that can be bought (the public Premium page has its own copy in each language; the dashboard pages follow the saved language). */
const premiumPage = (lang) => `${SITE}${lang === 'es' ? '/es' : lang === 'pt-BR' ? '/pt-br' : ''}/premium`;
const PLANS_PAGE = `${SITE}/dash/plan`;
const CERAMOS_PAGE = `${SITE}/dash/buy-ceramos`;
/** The card: what can be bought, and one link button for each page. */
function buildPurchaseCard(lang) {
    const link = (label, url) => new discord_js_1.ButtonBuilder().setLabel(label).setStyle(discord_js_1.ButtonStyle.Link).setURL(url);
    return {
        components: [new discord_js_1.ContainerBuilder()
                .addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(t(lang, 'purchase.title', { emoji: EMOJI.BOT })))
                .addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(discord_js_1.SeparatorSpacingSize.Small))
                .addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent([
                t(lang, 'purchase.server'),
                t(lang, 'purchase.plans'),
                t(lang, 'purchase.ceramos'),
            ].join('\n')))
                .addSeparatorComponents(new discord_js_1.SeparatorBuilder().setDivider(true).setSpacing(discord_js_1.SeparatorSpacingSize.Small))
                .addActionRowComponents(new discord_js_1.ActionRowBuilder().addComponents(link(t(lang, 'purchase.button.server'), premiumPage(lang)), link(t(lang, 'purchase.button.plans'), PLANS_PAGE), link(t(lang, 'purchase.button.ceramos'), CERAMOS_PAGE)))
                .addTextDisplayComponents(new discord_js_1.TextDisplayBuilder().setContent(t(lang, 'purchase.note')))],
        flags: discord_js_1.MessageFlags.IsComponentsV2,
    };
}
module.exports = {
    registerSlash: true,
    guildScoped: true, // the 100 global slots are kept free: it is registered in each server instead (second set)
    buildPurchaseCard,
    premiumPage,
    PLANS_PAGE,
    CERAMOS_PAGE,
    data: new discord_js_1.SlashCommandBuilder().setName('purchase').setDescription('Where to buy Premium, a plan or ceramos.').setDMPermission(false),
    async execute(interaction) {
        const lang = await languageOf(interaction);
        await interaction.reply(buildPurchaseCard(lang));
    },
};
