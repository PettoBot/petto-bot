"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// i18n-ignore-file: the texts are in the catalogs (missions.*); the builder holds the English descriptions that scripts/i18n-commands.js copies.
// /missions (and `!missions`): the missions of the day and of the week (messages and minutes in voice, in every server where Petto counts them) and claiming their ceramos.
// The progress comes from the activity Petto already counts; paying goes through db/missions.ts (once for each period). Written in TypeScript: compiled over missions.js.
const discord_js_1 = require("discord.js");
const { t, languageOf, formatNumber } = require('../../i18n');
const actions = require('../../utils/missionActions');
const unix = (iso) => Math.floor(new Date(iso).getTime() / 1000);
async function listView(interaction, lang) {
    const data = await actions.list(interaction.user.id);
    const line = (mission) => {
        const icon = mission.claimed ? '☑️' : mission.complete ? '✅' : '▫️';
        const what = t(lang, `missions.kind.${mission.kind}`, { n: formatNumber(lang, mission.target) });
        return `${icon} ${what} · ${formatNumber(lang, mission.progress)}/${formatNumber(lang, mission.target)} · **+${formatNumber(lang, mission.reward)}**${mission.claimed ? ` (${t(lang, 'missions.claimed')})` : ''}`;
    };
    const block = (period) => `**${t(lang, `missions.period.${period}`)}** · ${t(lang, 'missions.resets', { when: `<t:${unix(data.resets[period])}:R>` })}\n${data.missions.filter((mission) => mission.period === period).map(line).join('\n')}`;
    const ready = data.missions.some((mission) => mission.complete && !mission.claimed);
    await interaction.reply({ content: `**${t(lang, 'missions.title')}**\n${block('day')}\n\n${block('week')}\n\n${ready ? t(lang, 'missions.hint.claim') : t(lang, 'missions.hint.keep')}`, flags: discord_js_1.MessageFlags.Ephemeral });
}
async function claimView(interaction, lang) {
    const done = await actions.claim(interaction.user.id, undefined);
    if (!done.ok) {
        await interaction.reply({ content: t(lang, `missions.claim.${done.error}`), flags: discord_js_1.MessageFlags.Ephemeral });
        return;
    }
    await interaction.reply({ content: t(lang, 'missions.claim.ok', { count: done.paid.length, total: formatNumber(lang, done.total), balance: formatNumber(lang, done.balance) }), flags: discord_js_1.MessageFlags.Ephemeral });
}
module.exports = {
    registerSlash: true,
    guildScoped: true,
    aliases: ['quests-daily', 'mission'],
    prefixDefaultSubcommand: 'list',
    data: new discord_js_1.SlashCommandBuilder()
        .setName('missions')
        .setDescription('Missions for ceramos: messages and minutes in voice, every day and every week.')
        .setDMPermission(false)
        .addSubcommand((s) => s.setName('list').setDescription('See your missions and how far you are.'))
        .addSubcommand((s) => s.setName('claim').setDescription('Claim the ceramos of the missions you finished.')),
    async execute(interaction) {
        const lang = await languageOf(interaction);
        try {
            if (interaction.options.getSubcommand() === 'claim')
                return await claimView(interaction, lang);
            return await listView(interaction, lang);
        }
        catch (error) {
            console.error('missions failed', error); // i18n-ignore: log line
            const content = t(lang, 'missions.failed');
            if (interaction.deferred || interaction.replied)
                await interaction.editReply({ content }).catch(() => null);
            else
                await interaction.reply({ content, flags: discord_js_1.MessageFlags.Ephemeral }).catch(() => null);
        }
    },
};
