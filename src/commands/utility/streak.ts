// i18n-ignore-file: the texts are in the catalog (streaks.*); the builder holds the English description that scripts/i18n-commands.js copies.
// /streak (and `!streak`): the days in a row you were active in this server, your best streak and the freezes your plan gives. Each server decides what an active day is.
// Worked out from the activity Petto counts (db/streaks.ts); nothing is stored for the streak. Written in TypeScript: compiled over streak.js.
import { SlashCommandBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
const { t, languageOf, formatNumber } = require('../../i18n') as { t: (lang: string, key: string, vars?: Record<string, unknown>) => string; languageOf: (i: unknown) => Promise<string>; formatNumber: (lang: string, n: number) => string };
const actions = require('../../utils/streakActions') as typeof import('../../utils/streakActions');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  aliases: ['streaks', 'racha'],
  data: new SlashCommandBuilder().setName('streak').setDescription('Your streak in this server: days in a row with activity.').setDMPermission(false)
    .addBooleanOption((option) => option.setName('notifications').setDescription('Get the messages and the nickname of your streaks (false turns them off).')),

  async execute(interaction: ChatInputCommandInteraction): Promise<void> {
    const lang = await languageOf(interaction);
    try {
      // `notifications`: the member turns the DMs and the nickname of the streaks off (false) or on again (true).
      const wanted = interaction.options.getBoolean('notifications');
      if (wanted !== null) {
        await require('../../db/streaks').setOptOut(interaction.user.id, !wanted);
        await interaction.reply({ content: t(lang, wanted ? 'streaks.notifications.on' : 'streaks.notifications.off'), flags: MessageFlags.Ephemeral });
        return;
      }
      const streak = await actions.inGuild(interaction.user.id, interaction.guildId as string);
      if (!streak.enabled) { await interaction.reply({ content: t(lang, 'streaks.off'), flags: MessageFlags.Ephemeral }); return; }
      const lines = [
        `**${t(lang, 'streaks.title')}**`,
        t(lang, 'streaks.current', { days: streak.current, n: formatNumber(lang, streak.current) }),
        t(lang, 'streaks.best', { days: streak.best, n: formatNumber(lang, streak.best) }),
        t(lang, streak.activeToday ? 'streaks.today.yes' : 'streaks.today.no'),
        t(lang, 'streaks.freezes', { used: streak.freezesUsed, total: streak.freezes }),
        t(lang, `streaks.rule.${streak.rules.mode}`, { messages: streak.rules.minMessages, minutes: streak.rules.minVoiceMinutes }),
      ];
      await interaction.reply({ content: lines.join('\n'), flags: MessageFlags.Ephemeral });
    } catch (error) {
      console.error('streak failed', error); // i18n-ignore: log line
      const content = t(lang, 'streaks.failed');
      if (interaction.deferred || interaction.replied) await interaction.editReply({ content }).catch(() => null);
      else await interaction.reply({ content, flags: MessageFlags.Ephemeral }).catch(() => null);
    }
  },
};
