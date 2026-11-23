// i18n-ignore-file: the texts are in the catalogs (ceramos.*); the builder holds the English descriptions that scripts/i18n-commands.js copies.
// /ceramos (and `!ceramos`): the wallet as a picture, the shop of badges (countries and languages, bought once), buying and giving a badge a better frame.
// /daily claims the daily ceramos (src/commands/utility/daily.ts). The balance only changes through db/ceramos.ts. Written in TypeScript: compiled over ceramos.js.
import { SlashCommandBuilder, AttachmentBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction, AutocompleteInteraction } from 'discord.js';
import type { Image } from '@napi-rs/canvas';
const { loadImageFromLink } = require('../../utils/safeImage') as { loadImageFromLink: (url: string) => Promise<Image> };
const { t, languageOf, formatNumber } = require('../../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; languageOf: (i: unknown) => Promise<string>; formatNumber: (lang: string, n: number) => string };
const rules = require('../../utils/ceramos') as typeof import('../../utils/ceramos');
const badges = require('../../utils/profileBadges') as typeof import('../../utils/profileBadges');
const shop = require('../../utils/ceramosShop') as typeof import('../../utils/ceramosShop');
const image = require('../../utils/ceramosImage') as typeof import('../../utils/ceramosImage');
const view = require('../../utils/profileView') as typeof import('../../utils/profileView');
const registry = require('../../utils/badgeRegistry') as typeof import('../../utils/badgeRegistry');
const catalog = require('../../utils/shopCatalog') as typeof import('../../utils/shopCatalog');
const shopBuy = require('../../utils/shopBuy') as typeof import('../../utils/shopBuy');
const walletDb = require('../../db/ceramos') as typeof import('../../db/ceramos');
const profileDb = require('../../db/userProfile') as typeof import('../../db/userProfile');

const say = (content: string) => ({ content, flags: MessageFlags.Ephemeral as const });
const nameOf = (lang: string, id: string): string => {
  const def = badges.badgeById(id);
  return def ? badges.badgeName(lang, def, (key) => t(lang, key)) : id;
};

/** The name of what a movement of the wallet was about: a badge, a banner, a name font or a pack. */
function refName(lang: string, reason: string, ref: string): string {
  const id = ref.split(':')[0];
  if (reason === 'banner' || reason === 'font') { const item = catalog.itemById(reason, id); return item ? catalog.itemName(lang, item) : id; }
  if (reason === 'pack') return packName(lang, id);
  return nameOf(lang, id);
}
const packName = (lang: string, id: string): string => { const pack = badges.packById(id); return pack ? (pack.names[lang] ?? pack.names[lang.split('-')[0]] ?? pack.names.en ?? id) : id; };

/** `in 5h 12m`, `in 12m`: how long until a moment, in the language of the person. */
export function untilText(lang: string, nextAt: Date, now: Date = new Date()): string {
  const minutes = Math.max(1, Math.ceil((nextAt.getTime() - now.getTime()) / 60_000));
  return t(lang, 'ceramos.in', { time: minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m` });
}

async function picture(url: string | null | undefined): Promise<Image | null> {
  if (!url) return null;
  try { return await loadImageFromLink(url); } catch { return null; }
}

const REASONS = ['daily', 'badge', 'frame', 'grant', 'take', 'refund', 'banner', 'font', 'pack'];

async function wallet(interaction: ChatInputCommandInteraction, lang: string): Promise<void> {
  await interaction.deferReply();
  const user = interaction.user;
  const [data, moves] = await Promise.all([walletDb.getWallet(user.id), walletDb.lastMovements(user.id, 4)]);
  const status = rules.claimStatus(data.lastDaily, new Date());
  const member = interaction.inGuild() ? await interaction.guild?.members.fetch(user.id).catch(() => null) : null;
  const avatar = await picture((member ?? user).displayAvatarURL({ size: 256, extension: 'png' }));
  const png = image.renderWalletImage({
    name: member?.displayName ?? user.username, avatar, balance: formatNumber(lang, data.balance), title: t(lang, 'ceramos.title'),
    daily: status.canClaim ? t(lang, 'ceramos.daily.ready') : t(lang, 'ceramos.daily.next', { time: untilText(lang, status.nextAt) }), dailyReady: status.canClaim,
    movementsTitle: t(lang, 'ceramos.movements'), noMovements: t(lang, 'ceramos.noMovements'),
    movements: moves.map((move) => ({
      text: REASONS.includes(move.reason) ? t(lang, `ceramos.reason.${move.reason}`, { badge: move.ref ? refName(lang, move.reason, move.ref) : '' }) : move.reason,
      amount: `${move.delta > 0 ? '+' : '−'}${formatNumber(lang, Math.abs(move.delta))}`, positive: move.delta > 0,
    })),
  });
  await interaction.editReply({ files: [new AttachmentBuilder(png, { name: 'ceramos.png' })] });
}

const SHOP_PAGE = 18;

const ITEM_PAGE = 8;

/** The shop of banners, name fonts and packs (the cards of the picture are bigger than a badge, so fewer fit in a page). */
async function itemShopView(interaction: ChatInputCommandInteraction, lang: string, category: 'banner' | 'font' | 'pack'): Promise<void> {
  const userId = interaction.user.id;
  const [data, ownedKeys, badgeRows, plan] = await Promise.all([walletDb.getWallet(userId), shopBuy.ownedKeys(userId), profileDb.getBadgeRows(userId), view.planOfUser(userId)]);
  await registry.ensure();
  const cards: import('../../utils/ceramosImage').ItemCard[] = [];
  const owned = t(lang, 'ceramos.shop.owned');
  if (category === 'pack') {
    const have = new Set<string>([...ownedKeys, ...badgeRows.map((row) => row.id)]);
    for (const pack of badges.allPacks()) {
      if (pack.retired || !badges.onSale(pack)) continue;
      const summary = catalog.packSummary(pack.id, have, plan);
      if (!summary || !summary.pieces.length || pack.free) continue;
      cards.push({ name: packName(lang, pack.id), price: formatNumber(lang, summary.price), owned: !summary.missing.length, color: pack.color,
        line: t(lang, 'ceramos.shop.pack.line', { count: summary.pieces.length, full: formatNumber(lang, summary.fullPrice) }) });
    }
  } else {
    for (const item of catalog.allItems(category)) {
      if (!item.hasFile || !(badges.onSale(item) || ownedKeys.has(`${item.kind}:${item.id}`))) continue;
      const card: import('../../utils/ceramosImage').ItemCard = { name: catalog.itemName(lang, item), price: formatNumber(lang, catalog.priceOf(item)), owned: ownedKeys.has(`${item.kind}:${item.id}`) };
      if (category === 'banner') card.picture = await registry.bannerImage(item.id);
      else card.fontFamily = await registry.fontFamily(item.id);
      cards.push(card);
    }
  }
  const pages = Math.max(1, Math.ceil(cards.length / ITEM_PAGE));
  const page = Math.min(pages, Math.max(1, interaction.options.getInteger('page') ?? 1));
  const png = image.renderItemShopImage({
    title: `${t(lang, 'ceramos.shop.title')} · ${t(lang, `ceramos.shop.category.${category}`)} ${page}/${pages}`, balanceText: formatNumber(lang, data.balance),
    ownedText: owned, sample: t(lang, 'ceramos.shop.sample'), cards: cards.slice((page - 1) * ITEM_PAGE, page * ITEM_PAGE),
  });
  const hint = cards.length ? t(lang, `ceramos.shop.hint.${category}`) : t(lang, 'ceramos.shop.empty');
  await interaction.editReply({ content: hint, files: [new AttachmentBuilder(png, { name: 'ceramos-shop.png' })] });
}

async function shopView(interaction: ChatInputCommandInteraction, lang: string): Promise<void> {
  await interaction.deferReply();
  const category = interaction.options.getString('category') ?? 'country';
  if (category === 'banner' || category === 'font' || category === 'pack') return itemShopView(interaction, lang, category);
  const [data, rows] = await Promise.all([walletDb.getWallet(interaction.user.id), profileDb.getBadgeRows(interaction.user.id)]);
  const have = new Set(rows.map((row) => row.id));
  await registry.ensure();
  // What is on sale now and what the person already has (a badge whose sale ended stays in the list of whoever bought it).
  const all = badges.shopBadges().filter((def) => badges.categoryOf(def) === category && (badges.onSale(def) || have.has(def.id)));
  const pages = Math.max(1, Math.ceil(all.length / SHOP_PAGE));
  const page = Math.min(pages, Math.max(1, interaction.options.getInteger('page') ?? 1));
  const items = [];
  for (const def of all.slice((page - 1) * SHOP_PAGE, page * SHOP_PAGE)) {
    items.push({ badge: { id: def.id, art: await view.artOfBadge(def), color: def.color, label: badges.badgeLabel(def) }, name: nameOf(lang, def.id), price: formatNumber(lang, badges.priceOf(def)), owned: have.has(def.id) });
  }
  const png = image.renderShopImage({ title: `${t(lang, 'ceramos.shop.title')} · ${t(lang, `ceramos.shop.category.${category}`)} ${page}/${pages}`, balanceText: formatNumber(lang, data.balance), items, ownedText: t(lang, 'ceramos.shop.owned') });
  await interaction.editReply({ content: t(lang, 'ceramos.shop.hint', { price: formatNumber(lang, rules.BADGE_PRICE), bright: formatNumber(lang, rules.FRAMES[1].cost), divine: formatNumber(lang, rules.FRAMES[2].cost) }), files: [new AttachmentBuilder(png, { name: 'ceramos-shop.png' })] });
}

/** A banner, a name font or a pack is bought by the same option, written `banner:id`, `font:id` or `pack:id` (the list fills it in); a badge is just its id. */
async function buyPiece(interaction: ChatInputCommandInteraction, lang: string, kind: 'banner' | 'font' | 'pack', id: string): Promise<void> {
  if (kind === 'pack') {
    const result = await shopBuy.buyPack(interaction.user.id, id);
    const vars = { name: packName(lang, id), price: formatNumber(lang, result.price), balance: formatNumber(lang, result.balance), count: result.ok ? result.added : 0 };
    await interaction.reply(say(t(lang, result.ok ? 'ceramos.buy.pack.ok' : `ceramos.buy.pack.${result.reason}`, vars)));
    return;
  }
  const result = await shopBuy.buyItem(interaction.user.id, kind, id);
  const item = catalog.itemById(kind, id);
  const vars = { name: item ? catalog.itemName(lang, item) : id, price: formatNumber(lang, result.price), balance: formatNumber(lang, result.balance), command: kind };
  await interaction.reply(say(t(lang, result.ok ? 'ceramos.buy.item.ok' : `ceramos.buy.item.${result.reason}`, vars)));
}

async function buy(interaction: ChatInputCommandInteraction, lang: string): Promise<void> {
  const id = interaction.options.getString('badge', true);
  const piece = /^(banner|font|pack):([a-z0-9-]{1,40})$/.exec(id);
  if (piece) { await buyPiece(interaction, lang, piece[1] as 'banner' | 'font' | 'pack', piece[2]); return; }
  const result = await shop.buyBadge(interaction.user.id, id);
  const vars = { badge: nameOf(lang, id), price: formatNumber(lang, result.price), balance: formatNumber(lang, result.balance) };
  if (result.ok) { await interaction.reply(say(t(lang, 'ceramos.buy.ok', vars))); return; }
  await interaction.reply(say(t(lang, `ceramos.buy.${result.reason}`, vars)));
}

async function upgrade(interaction: ChatInputCommandInteraction, lang: string): Promise<void> {
  const id = interaction.options.getString('badge', true);
  const result = await shop.upgradeFrame(interaction.user.id, id);
  const vars = { badge: nameOf(lang, id), cost: formatNumber(lang, result.cost), balance: formatNumber(lang, result.balance) };
  if (result.ok) { await interaction.reply(say(t(lang, 'ceramos.upgrade.ok', { ...vars, frame: t(lang, `ceramos.frame.${result.frame}`) }))); return; }
  await interaction.reply(say(t(lang, `ceramos.upgrade.${result.reason}`, vars)));
}

module.exports = {
  // A command of its own in the second set (registered in each server): the 100 global slots of Discord are nearly used (scripts/check-slash-structure.js).
  registerSlash: true,
  guildScoped: true,
  aliases: ['wallet', 'cer'],
  prefixDefaultSubcommand: 'balance',
  data: new SlashCommandBuilder()
    .setName('ceramos')
    .setDescription('Your ceramos: the wallet, the shop of badges and better frames.')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('balance').setDescription('See your ceramos and your last movements.'))
    .addSubcommand((s) => s.setName('shop').setDescription('See the badges you can buy with ceramos.')
      .addStringOption((o) => o.setName('category').setDescription('Countries or languages').addChoices({ name: 'Countries', value: 'country' }, { name: 'Languages', value: 'language' }, { name: 'Special', value: 'special' }, { name: 'Banners', value: 'banner' }, { name: 'Name fonts', value: 'font' }, { name: 'Packs', value: 'pack' }).setRequired(false))
      .addIntegerOption((o) => o.setName('page').setDescription('Page').setMinValue(1).setMaxValue(20).setRequired(false)))
    .addSubcommand((s) => s.setName('buy').setDescription('Buy a badge of the shop. You keep it for good.')
      .addStringOption((o) => o.setName('badge').setDescription('Which badge').setRequired(true).setAutocomplete(true)))
    .addSubcommand((s) => s.setName('upgrade').setDescription('Give a badge of yours a better frame.')
      .addStringOption((o) => o.setName('badge').setDescription('Which badge').setRequired(true).setAutocomplete(true))),

  async autocomplete(interaction: AutocompleteInteraction): Promise<void> {
    const focused = interaction.options.getFocused(true);
    if (focused.name !== 'badge') { await interaction.respond([]); return; }
    const lang = await languageOf(interaction);
    const typed = String(focused.value ?? '').toLowerCase().trim();
    const sub = interaction.options.getSubcommand(false);
    const have = new Set((await profileDb.getBadgeRows(interaction.user.id)).map((row) => row.id));
    await registry.ensure();
    const pool = sub === 'upgrade' ? badges.allBadges().filter((def) => def.unlock !== 'plan' && have.has(def.id)) : badges.shopBadges().filter((def) => !have.has(def.id) && badges.onSale(def));
    let list = pool.map((def) => ({ name: nameOf(lang, def.id), value: def.id }));
    if (sub !== 'upgrade') {
      // Banners, name fonts and packs are bought in the same place: their value carries what they are.
      const ownedKeys = await shopBuy.ownedKeys(interaction.user.id);
      for (const item of catalog.allItems()) if (item.hasFile && badges.onSale(item) && !ownedKeys.has(`${item.kind}:${item.id}`)) list.push({ name: `${t(lang, `ceramos.kind.${item.kind}`)} · ${catalog.itemName(lang, item)}`, value: `${item.kind}:${item.id}` });
      for (const pack of badges.allPacks()) if (!pack.free && badges.onSale(pack)) list.push({ name: `${t(lang, 'ceramos.kind.pack')} · ${packName(lang, pack.id)}`, value: `pack:${pack.id}` });
    }
    list = list.filter((choice) => !typed || choice.name.toLowerCase().includes(typed) || choice.value.includes(typed));
    await interaction.respond(list.slice(0, 25));
  },

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = await languageOf(interaction);
    const sub = interaction.options.getSubcommand();
    try {
      if (sub === 'shop') return await shopView(interaction, lang);
      if (sub === 'buy') return await buy(interaction, lang);
      if (sub === 'upgrade') return await upgrade(interaction, lang);
      return await wallet(interaction, lang);
    } catch (error) {
      console.error('ceramos failed', error); // i18n-ignore: log line
      const reply = say(t(lang, 'ceramos.failed'));
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content: reply.content }).catch(() => null);
      else await interaction.reply(reply).catch(() => null);
    }
  },
};
