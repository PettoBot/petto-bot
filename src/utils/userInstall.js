"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CONTEXTS = exports.INSTALL_TYPES = void 0;
exports.userInstallable = userInstallable;
exports.outsideServer = outsideServer;
// i18n-ignore-file: no text of its own, only the settings that let a command be used when Petto is installed on a person and not on a server.
// User install: a person can add Petto to their own account ("Add to my apps") and use some commands in any server, in direct messages and in group chats, even where Petto is not a member.
// There, the interaction has no `guild` that the bot knows (it is null; only the id of the server comes), so nothing that reads the server's settings, members or database rows can run.
// The commands that can be used this way are the ones that do not need the server: `/action`, `/avatar`, `/banner`, `/userinfo` and `/birthday`. Written in TypeScript: compiled over userInstall.js.
const discord_js_1 = require("discord.js");
/** The command is used where Petto is installed on a server and where it is installed on a person. */
exports.INSTALL_TYPES = [discord_js_1.ApplicationIntegrationType.GuildInstall, discord_js_1.ApplicationIntegrationType.UserInstall];
/** And in a server, in a direct message with Petto and in a private chat or group chat. */
exports.CONTEXTS = [discord_js_1.InteractionContextType.Guild, discord_js_1.InteractionContextType.BotDM, discord_js_1.InteractionContextType.PrivateChannel];
/** Lets a slash command be used from a person's own installation: `userInstallable(new SlashCommandBuilder().setName(...))`. */
function userInstallable(builder) {
    return builder.setIntegrationTypes(...exports.INSTALL_TYPES).setContexts(...exports.CONTEXTS);
}
/**
 * Whether the command runs where Petto is not a member: a direct message, a group chat, or a server that only has the person's installation.
 * There the server is unknown to the bot, so a command must not read or write anything tied to a server (its settings, counters, members, language).
 * The prefix and the commands of a server always come with the guild, so they never are "outside".
 */
function outsideServer(interaction) {
    if (!interaction)
        return false;
    if (!interaction.guildId)
        return true;
    return interaction.guild === null;
}
