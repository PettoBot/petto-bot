// i18n-ignore-file: the texts are in the catalog (ceramos.*); the builder holds the English description that scripts/i18n-commands.js copies.
// /daily (and `!daily`): claims the daily ceramos of the day (2 with no plan, 5, 10 or 20 with a plan). Once for each UTC day. Written in TypeScript: compiled over daily.js.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
const { t, languageOf, formatNumber } = require('../../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; languageOf: (i: unknown) => Promise<string>; formatNumber: (lang: string, n: number) => string };
const { claimToday } = require('../../utils/ceramosShop') as typeof import('../../utils/ceramosShop');
const { planOfUser } = require('../../utils/profileView') as typeof import('../../utils/profileView');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  data: new SlashCommandBuilder().setName('daily').setDescription('Claim your daily ceramos.').setDMPermission(false),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = await languageOf(interaction);
    try {
      const result = await claimToday(interaction.user.id, await planOfUser(interaction.user.id));
      if (result.ok) {
        await interaction.reply({ content: t(lang, 'ceramos.daily.claimed', { amount: formatNumber(lang, result.amount), balance: formatNumber(lang, result.balance) }) });
        return;
      }
      const minutes = Math.max(1, Math.ceil((result.nextAt.getTime() - Date.now()) / 60_000));
      const time = t(lang, 'ceramos.in', { time: minutes >= 60 ? `${Math.floor(minutes / 60)}h ${minutes % 60}m` : `${minutes}m` });
      await interaction.reply({ content: t(lang, 'ceramos.daily.already', { time }), flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('daily failed', error); // i18n-ignore: log line
      await interaction.reply({ content: t(lang, 'ceramos.failed'), flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  },
};
