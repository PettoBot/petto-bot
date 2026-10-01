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
    const parsed = parseButton(interaction.customId);
    if (!parsed) {
        await interaction.reply({
            content: 'This roleplay interaction is no longer valid. Please send the command again.',
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        }).catch(() => { });
        return true;
    }
    if (interaction.user.id !== parsed.targetId) {
        await interaction.reply({
            content: 'Only the mentioned member can respond to this roleplay interaction.',
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        });
        return true;
    }
    if (!interaction.guildId || !interaction.channelId) {
        await interaction.reply({
            content: 'Roleplay responses are only available inside a server.',
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
            content: 'This roleplay response could not be saved. Please try again.',
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        }).catch(() => { });
        return true;
    }
    if (!result.claimed) {
        await interaction.followUp({
            content: 'This roleplay interaction already has a response.',
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        }).catch(() => { });
        return true;
    }
    const responseAction = parsed.response === 'accepted' ? parsed.action : 'slap';
    const imageUrl = await fetchActionImage(responseAction);
    const actor = await interaction.client.users.fetch(parsed.actorId).catch(() => null);
    const actorLabel = actor ? displayName(actor) : 'The sender';
    const targetLabel = displayName(interaction.user);
    const actionLabel = (0, roleplayButtons_1.getRoleplayLabel)(parsed.action);
    const description = parsed.response === 'accepted'
        ? `**${targetLabel}** responds to **${actorLabel}** with a ${actionLabel}.`
        : `**${targetLabel}** rejects the ${actionLabel} from **${actorLabel}** and gives them a slap.`;
    const counterAction = parsed.response === 'accepted' ? parsed.action : 'slap';
    const counterRecipient = parsed.response === 'accepted' ? `**${targetLabel}**` : `**${actorLabel}**`;
    const counterMessage = (0, roleplayButtons_1.getRoleplayCounterMessage)(counterAction, result.counterValue, counterRecipient);
    const embed = new discord_js_1.EmbedBuilder()
        .setColor(parsed.response === 'accepted' ? COLORS.GREEN : COLORS.RED)
        .setAuthor({ name: `${targetLabel} · response`, iconURL: interaction.user.displayAvatarURL({ size: 128 }) })
        .setDescription(`${description}\n\n*${counterMessage}*`)
        .setFooter({ text: 'Roleplay response · Petto' });
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
            }, true)],
        allowedMentions: { parse: [] },
    }).catch(() => { });
    // Commands used as a slash command mention the sender in the response; prefix commands never do.
    const mentionsSender = interaction.message.interactionMetadata !== null;
    const payload = {
        ...(mentionsSender ? { content: `<@${parsed.actorId}>` } : {}),
        embeds: [embed],
        allowedMentions: mentionsSender ? { parse: [], users: [parsed.actorId], repliedUser: false } : { parse: [], repliedUser: false },
    };
    let sent = false;
    try {
        await interaction.message.reply(payload);
        sent = true;
    }
    catch {
        // The original message may be gone; fall back to a plain message in the channel.
        if (interaction.channel?.isSendable())
            sent = await interaction.channel.send(payload).then(() => true, () => false);
    }
    if (!sent) {
        await interaction.followUp({
            content: 'Your response was saved, but Petto could not send the roleplay message.',
            flags: discord_js_1.MessageFlags.Ephemeral,
            allowedMentions: { parse: [] },
        }).catch(() => { });
    }
    return true;
}
