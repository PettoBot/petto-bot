// i18n-ignore-file: the texts are in the catalog (purchase.*); the builder holds the English description that scripts/i18n-commands.js copies.
// /purchase (and `!purchase`): where to buy Premium for a server, a plan for yourself (Bronze, Silver or Gold) or a pack of ceramos. It does not make the checkout:
// the buttons open the pages of the website, where the person signs in with Discord, accepts the terms and goes on to the payment. Written in TypeScript: compiled over purchase.js.
import { SlashCommandBuilder, ContainerBuilder, TextDisplayBuilder, SeparatorBuilder, SeparatorSpacingSize, ActionRowBuilder, ButtonBuilder, ButtonStyle, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
const { t, languageOf } = require('../../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; languageOf: (i: unknown) => Promise<string> };
const { EMOJI } = require('../../utils/emojis') as { EMOJI: Record<string, string> };

const SITE = 'https://petto.sbs';
/** The page of the website for each thing that can be bought (the public Premium page has its own copy in each language; the dashboard pages follow the saved language). */
const premiumPage = (lang: string): string => `${SITE}${lang === 'es' ? '/es' : lang === 'pt-BR' ? '/pt-br' : ''}/premium`;
const PLANS_PAGE = `${SITE}/dash/plan`;
const CERAMOS_PAGE = `${SITE}/dash/buy-ceramos`;

interface PurchaseCard { components: ContainerBuilder[]; flags: number }

/** The card: what can be bought, and one link button for each page. */
function buildPurchaseCard(lang: string): PurchaseCard {
  const link = (label: string, url: string) => new ButtonBuilder().setLabel(label).setStyle(ButtonStyle.Link).setURL(url);
  return {
    components: [new ContainerBuilder()
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'purchase.title', { emoji: EMOJI.BOT })))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent([
        t(lang, 'purchase.server'),
        t(lang, 'purchase.plans'),
        t(lang, 'purchase.ceramos'),
      ].join('\n')))
      .addSeparatorComponents(new SeparatorBuilder().setDivider(true).setSpacing(SeparatorSpacingSize.Small))
      .addActionRowComponents(new ActionRowBuilder<ButtonBuilder>().addComponents(
        link(t(lang, 'purchase.button.server'), premiumPage(lang)),
        link(t(lang, 'purchase.button.plans'), PLANS_PAGE),
        link(t(lang, 'purchase.button.ceramos'), CERAMOS_PAGE),
      ))
      .addTextDisplayComponents(new TextDisplayBuilder().setContent(t(lang, 'purchase.note')))],
    flags: MessageFlags.IsComponentsV2,
  };
}

module.exports = {
  registerSlash: true,
  guildScoped: true, // the 100 global slots are kept free: it is registered in each server instead (second set)
  buildPurchaseCard,
  premiumPage,
  PLANS_PAGE,
  CERAMOS_PAGE,
  data: new SlashCommandBuilder().setName('purchase').setDescription('Where to buy Premium, a plan or ceramos.').setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = await languageOf(interaction);
    await interaction.reply(buildPurchaseCard(lang));
  },
};
