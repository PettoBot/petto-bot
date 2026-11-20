// i18n-ignore-file: an event, it only brings the bot back.
// When Petto is taken out of the voice channel it stays in (or moved to another one), it goes back at once (utils/stayVoice.ts). Written in TypeScript: compiled over voiceStateUpdateStayVoice.js.
import { Events, type Client, type VoiceState } from 'discord.js';
import { onBotMoved, targetOf } from '../utils/stayVoice';

const logger = require('../utils/logger') as { warn: (message: string) => void };

module.exports = {
  name: Events.VoiceStateUpdate,
  execute(oldState: VoiceState, newState: VoiceState, client?: Client): void {
    try {
      const bot = (client ?? newState.client).user?.id;
      if (!bot || newState.id !== bot) return;
      const target = targetOf(newState.guild.id);
      if (!target || oldState.channelId !== target.channelId || newState.channelId === target.channelId) return;
      onBotMoved(client ?? newState.client, newState.guild.id, oldState.channelId).catch((error) => logger.warn(`Stay in voice: ${(error as Error)?.message ?? error}`));
    } catch (error) {
      logger.warn(`Stay in voice: a voice change could not be handled: ${(error as Error)?.message ?? error}`);
    }
  },
};
