"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ROLEPLAY_BUTTON_PREFIX = void 0;
exports.handleButton = handleButton;
const discord_js_1 = require("discord.js");
const roleplayStats_1 = require("../db/roleplayStats");
const roleplayButtons_1 = require("../utils/roleplayButtons");
Object.defineProperty(exports, "ROLEPLAY_BUTTON_PREFIX", { enumerable: true, get: function () { return roleplayButtons_1.ROLEPLAY_BUTTON_PREFIX; } });
const { fetchActionImage } = require('../utils/roleplay');
const { COLORS } = require('../utils/colors');
const { t, languageOf } = require('../i18n');
function parseButton(customId) {
    const parts = customId.split(':');
    if (parts.length !== 6)
        return null;
    const [prefix, response, action, actorId, targetId, requestId] = parts;
    if (prefix !== roleplayButtons_1.ROLEPLAY_BUTTON_PREFIX.slice(0, -1))
        return null;
    if (response !== 'accept' && response !== 'reject')
        return null;
    if (!/^[a-z][a-z0-9_-]{0,31}$/.test(action) || !/^\d{15,25}$/.test(actorId) || !/^\d{15,25}$/.test(targetId) || !/^[a-z0-9_-]{15,64}$/.test(requestId))
        return null;
    return {
        response: response === 'accept' ? 'accepted' : 'rejected',
        action,
        actorId,
        targetId,
        requestId,
    };
}
function displayName(user) {
    return user.globalName ?? user.username;
}
async function handleButton(interaction) {
    const lang = await languageOf(interaction);
    const parsed = parseButton(interaction.customId);
    if (!parsed) {
        await interaction.reply({
            content: t(lang, 'roleplay.response.invalid'),
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        }).catch(() => { });
        return true;
    }
    if (interaction.user.id !== parsed.targetId) {
        await interaction.reply({
            content: t(lang, 'roleplay.response.notTarget'),
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }
    if (!interaction.guildId || !interaction.channelId) {
        await interaction.reply({
            content: t(lang, 'roleplay.response.guildOnly'),
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }
    await interaction.deferUpdate();
    let result;
    try {
        result = await (0, roleplayStats_1.recordRoleplayResponse)({
            requestId: parsed.requestId,
            guildId: interaction.guildId,
            messageId: interaction.message.id,
            channelId: interaction.channelId,
            actorId: parsed.actorId,
            targetId: parsed.targetId,
            action: parsed.action,
            response: parsed.response,
        });
    }
    catch {
        await interaction.followUp({
            content: t(lang, 'roleplay.response.saveFailed'),
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        }).catch(() => { });
        return true;
    }
    if (!result.claimed) {
        await interaction.followUp({
            content: t(lang, 'roleplay.response.alreadyAnswered'),
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        }).catch(() => { });
        return true;
    }
    const responseAction = parsed.response === 'accepted' ? parsed.action : 'slap';
    const imageUrl = await fetchActionImage(responseAction);
    const actor = await interaction.client.users.fetch(parsed.actorId).catch(() => null);
    const actorLabel = actor ? displayName(actor) : t(lang, 'roleplay.response.unknownSender');
    const targetLabel = displayName(interaction.user);
    const description = (0, roleplayButtons_1.getRoleplayResponseSentence)(parsed.action, parsed.response === 'accepted', targetLabel, actorLabel, lang);
    const counterAction = parsed.response === 'accepted' ? parsed.action : 'slap';
    const counterRecipient = parsed.response === 'accepted' ? `**${targetLabel}**` : `**${actorLabel}**`;
    const counterMessage = (0, roleplayButtons_1.getRoleplayCounterMessage)(counterAction, result.counterValue, counterRecipient, lang);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(parsed.response === 'accepted' ? COLORS.GREEN : COLORS.RED)
        .setAuthor({ name: t(lang, 'roleplay.response.author', { name: targetLabel }), iconURL: interaction.user.displayAvatarURL({ size: 128 }) })
        .setDescription(`${description}\n\n*${counterMessage}*`)
        .setFooter({ text: t(lang, 'roleplay.response.footer') });
    if (imageUrl)
        embed.setImage(imageUrl);
    // An edit never notifies anyone, so the response goes out as a new message that replies to the original.
    // The original keeps its text and only loses its buttons.
    await interaction.message.edit({
        components: [(0, roleplayButtons_1.buildRoleplayButtonRow)({
                requestId: parsed.requestId,
                action: parsed.action,
                actorId: parsed.actorId,
                targetId: parsed.targetId,
            }, true, lang)],
        allowedMentions: { parse: [] },
    }).catch(() => { });
    // The response is a reply to the message that holds the buttons. It never mentions anyone, whether the
    // command was used as a slash command or with the prefix.
    const sent = await interaction.message
        .reply({ embeds: [embed], allowedMentions: { parse: [], repliedUser: false } })
        .then(() => true, () => false);
    if (!sent) {
        await interaction.followUp({
            content: t(lang, 'roleplay.response.sendFailed'),
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        }).catch(() => { });
    }
    return true;
}
