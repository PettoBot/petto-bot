const { SlashCommandBuilder } = require('discord.js');
const { infoPayload } = require('../../utils/infoCard');
const { IntegrationError, fetchJson, cached, lookup, row, formatMoney, dateTag } = require('../../utils/integrations');
const { t, languageOf } = require('../../i18n');

const API = 'https://open.er-api.com/v6/latest';
const CACHE_MS = 30 * 60_000;
const COOLDOWN = { name: 'currency', ms: 3000 };
const MAX_TARGETS = 6;
const DEFAULT_TARGETS = ['USD', 'EUR', 'COP', 'MXN'];

/**
 * `100 usd cop`, `100 usd to cop eur`, `usd` or `1,5 eur mxn` as { amount, from, to: [...] }, or null when it is not a conversion.
 * Without an amount it is 1; without a currency to go to, a few common ones.
 */
function parseConversion(input) {
  const joined = String(input ?? '').trim().replace(/->|→/g, ' ');
  const amountMatch = /^(\d+(?:[.,]\d+)?)\s+(.*)$/.exec(joined);
  const amount = amountMatch ? Number(amountMatch[1].replace(',', '.')) : 1;
  const rest = (amountMatch ? amountMatch[2] : joined).split(/\s+/).filter((word) => !/^(to|in|a|en|para|em|-)$/i.test(word));
  if (!Number.isFinite(amount) || amount <= 0 || amount > 1e15) return null;
  const codes = rest.map((word) => word.toUpperCase());
  if (!codes.length || !codes.every((code) => /^[A-Z]{3}$/.test(code))) return null;
  const [from, ...to] = codes;
  const targets = (to.length ? to : DEFAULT_TARGETS.filter((code) => code !== from)).filter((code, index, list) => code !== from && list.indexOf(code) === index).slice(0, MAX_TARGETS);
  return targets.length ? { amount, from, to: targets } : null;
}

async function rates(base) {
  return cached(`currency:${base}`, CACHE_MS, async () => {
    const body = await fetchJson(`${API}/${base}`);
    if (body?.result !== 'success' || !body.rates) throw new IntegrationError(body?.['error-type'] === 'unsupported-code' ? 'notFound' : 'unavailable');
    return body;
  });
}

module.exports = {
  aliases: ['cur', 'convert'],
  data: new SlashCommandBuilder()
    .setName('currency')
    .setDescription('Change an amount of money from one currency to others, for example 100 usd cop.')
    .addStringOption((o) => o.setName('conversion').setDescription('Amount, the currency it is in, and the ones to go to: 100 usd cop eur').setMaxLength(100).setRequired(true)),

  async execute(interaction) {
    const lang = await languageOf(interaction);
    const typed = interaction.options.getString('conversion', true);
    await lookup(interaction, lang, 'ExchangeRate-API', async () => {
      const conversion = parseConversion(typed);
      if (!conversion) throw new IntegrationError('badInput');
      const body = await rates(conversion.from);
      const known = conversion.to.filter((code) => body.rates[code] !== undefined);
      if (!known.length) throw new IntegrationError('notFound');
      const money = (value) => formatMoney(lang, value, value >= 100 ? 2 : value >= 1 ? 3 : 6);
      return infoPayload({
        accent: null,
        title: `${money(conversion.amount)} ${conversion.from}`,
        sections: [{ lines: known.map((code) => row(code, money(conversion.amount * body.rates[code]))) }],
        footer: t(lang, 'integrations.currency.updated', { when: dateTag(body.time_last_update_unix * 1000, 'R') }),
        buttons: [{ label: t(lang, 'integrations.currency.provider'), url: 'https://www.exchangerate-api.com' }],
      });
    }, COOLDOWN);
  },
};

module.exports.parseConversion = parseConversion;
