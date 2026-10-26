const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, plain, formatMoney, dateTag } = require('../../utils/integrations');
const { t, formatNumber, formatDecimal, languageOf } = require('../../i18n');

const API = 'https://api.coingecko.com/api/v3';
const CACHE_MS = 2 * 60_000;
const COOLDOWN = { name: 'crypto', ms: 4000 };

/** A price in dollars: cents for a normal price, more digits for a tiny one. */
function dollars(lang, value) {
  const number = Number(value);
  return `$${formatMoney(lang, number, number >= 1 ? 2 : number >= 0.01 ? 4 : 8)}`;
}

async function findCoin(query) {
  return cached(`crypto:${query.toLowerCase()}`, CACHE_MS, async () => {
    const found = await fetchJson(`${API}/search?query=${encodeURIComponent(query)}`);
    const id = found?.coins?.[0]?.id;
    if (!id) throw new IntegrationError('notFound');
    const markets = await fetchJson(`${API}/coins/markets?vs_currency=usd&ids=${encodeURIComponent(id)}&price_change_percentage=24h`);
    const coin = markets?.[0];
    if (!coin) throw new IntegrationError('notFound');
    return coin;
  });
}

module.exports = {
  aliases: ['coin'],
  data: new SlashCommandBuilder()
    .setName('crypto')
    .setDescription('The price of a cryptocurrency in dollars, with its change today and its market.')
    .addStringOption((o) => o.setName('coin').setDescription('The name or the symbol, for example bitcoin or eth').setMaxLength(60).setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const typed = interaction.options.getString('coin', true).trim();
    await lookup(interaction, lang, 'CoinGecko', async () => {
      if (!typed) throw new IntegrationError('badInput');
      const coin = await findCoin(typed);
      const change = Number(coin.price_change_percentage_24h);
      const arrow = change >= 0 ? '▲' : '▼';
      return infoPayload({
        accent: null,
        title: `${plain(coin.name, 60)} (${plain(String(coin.symbol).toUpperCase(), 12)})`,
        subtitle: [`**${dollars(lang, coin.current_price)}** ${Number.isFinite(change) ? `${arrow} ${formatDecimal(lang, Math.abs(change), 2)}%` : ''}`.trim()],
        thumbnail: coin.image ?? null,
        sections: [{
          lines: [
            coin.market_cap_rank ? row(t(lang, 'integrations.crypto.rank'), `#${formatNumber(lang, coin.market_cap_rank)}`) : null,
            coin.market_cap ? row(t(lang, 'integrations.crypto.marketCap'), `$${formatNumber(lang, Math.round(coin.market_cap))}`) : null,
            coin.total_volume ? row(t(lang, 'integrations.crypto.volume'), `$${formatNumber(lang, Math.round(coin.total_volume))}`) : null,
            coin.low_24h !== undefined && coin.high_24h !== undefined ? row(t(lang, 'integrations.crypto.range'), `${dollars(lang, coin.low_24h)} – ${dollars(lang, coin.high_24h)}`) : null,
            coin.ath ? row(t(lang, 'integrations.crypto.ath'), `${dollars(lang, coin.ath)}${coin.ath_date ? ` (${dateTag(coin.ath_date)})` : ''}`) : null,
            coin.circulating_supply ? row(t(lang, 'integrations.crypto.supply'), formatNumber(lang, Math.round(coin.circulating_supply))) : null,
          ],
        }],
        footer: coin.last_updated ? t(lang, 'integrations.crypto.updated', { when: dateTag(coin.last_updated, 'R') }) : 'CoinGecko', // i18n-ignore: a brand name
        buttons: [{ label: t(lang, 'integrations.crypto.open'), url: `https://www.coingecko.com/en/coins/${encodeURIComponent(coin.id)}` }],
      });
    }, COOLDOWN);
  },
};

module.exports.dollars = dollars;
module.exports.findCoin = findCoin;
