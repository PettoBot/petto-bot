// i18n-ignore-file: no text of its own, only the settings that let a command be used when Petto is installed on a person and not on a server.
// User install: a person can add Petto to their own account ("Add to my apps") and use some commands in any server, in direct messages and in group chats, even where Petto is not a member.
// There, the interaction has no `guild` that the bot knows (it is null; only the id of the server comes), so nothing that reads the server's settings, members or database rows can run.
// The commands that can be used this way are the ones that do not need the server: `/action`, `/avatar`, `/banner`, `/userinfo` and `/birthday`. Written in TypeScript: compiled over userInstall.js.
import { ApplicationIntegrationType, InteractionContextType } from 'discord.js';

/** The command is used where Petto is installed on a server and where it is installed on a person. */
export const INSTALL_TYPES = [ApplicationIntegrationType.GuildInstall, ApplicationIntegrationType.UserInstall] as const;
/** And in a server, in a direct message with Petto and in a private chat or group chat. */
export const CONTEXTS = [InteractionContextType.Guild, InteractionContextType.BotDM, InteractionContextType.PrivateChannel] as const;

interface Installable<T> {
  setIntegrationTypes(...types: ApplicationIntegrationType[]): T;
  setContexts(...contexts: InteractionContextType[]): T;
}

/** Lets a slash command be used from a person's own installation: `userInstallable(new SlashCommandBuilder().setName(...))`. */
export function userInstallable<T extends Installable<T>>(builder: T): T {
  return builder.setIntegrationTypes(...INSTALL_TYPES).setContexts(...CONTEXTS);
}

interface Where { guildId?: string | null; guild?: unknown }

/**
 * Whether the command runs where Petto is not a member: a direct message, a group chat, or a server that only has the person's installation.
 * There the server is unknown to the bot, so a command must not read or write anything tied to a server (its settings, counters, members, language).
 * The prefix and the commands of a server always come with the guild, so they never are "outside".
 */
export function outsideServer(interaction: Where | null | undefined): boolean {
  if (!interaction) return false;
  if (!interaction.guildId) return true;
  return interaction.guild === null;
}
