"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// i18n-ignore-file: an event, it only brings the bot back.
// When Petto is taken out of the voice channel it stays in (or moved to another one), it goes back at once (utils/stayVoice.ts). Written in TypeScript: compiled over voiceStateUpdateStayVoice.js.
const discord_js_1 = require("discord.js");
const stayVoice_1 = require("../utils/stayVoice");
const logger = require('../utils/logger');
module.exports = {
    name: discord_js_1.Events.VoiceStateUpdate,
    execute(oldState, newState, client) {
        try {
            const bot = (client ?? newState.client).user?.id;
            if (!bot || newState.id !== bot)
                return;
            const target = (0, stayVoice_1.targetOf)(newState.guild.id);
            if (!target || oldState.channelId !== target.channelId || newState.channelId === target.channelId)
                return;
            (0, stayVoice_1.onBotMoved)(client ?? newState.client, newState.guild.id, oldState.channelId).catch((error) => logger.warn(`Stay in voice: ${error?.message ?? error}`));
        }
        catch (error) {
            logger.warn(`Stay in voice: a voice change could not be handled: ${error?.message ?? error}`);
        }
    },
};
