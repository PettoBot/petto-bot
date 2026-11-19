"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
// i18n-ignore-file: an event, it only counts.
// Counts the messages of the members of the servers that have message roles (utils/messageRoles.ts). Servers without rules cost one cached read. Written in TypeScript:
// compiled over messageCreateMessageRoles.js.
const discord_js_1 = require("discord.js");
const messageRoles_1 = require("../utils/messageRoles");
const logger = require('../utils/logger');
module.exports = {
    name: discord_js_1.Events.MessageCreate,
    async execute(message, client) {
        if (!message.guild || message.author.bot || message.webhookId || message.system)
            return;
        try {
            const rules = await (0, messageRoles_1.rulesOf)(message.guild.id);
            if (!rules.some((rule) => rule.enabled))
                return;
            if ((0, messageRoles_1.countMessage)(message.guild.id, message.author.id))
                await (0, messageRoles_1.flush)(client ?? message.client);
        }
        catch (error) {
            logger.error(`Message roles count failed for message ${message.id}:`, error);
        }
    },
};
