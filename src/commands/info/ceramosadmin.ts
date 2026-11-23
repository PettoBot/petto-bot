// i18n-ignore-file: the owner operations of the ceramos (give, take, see): team tools, they read English.
// `!ceramosadmin give|take|balance`: the owner gives or takes ceramos by hand, with a note in the ledger that says who did it. Prefix only and hidden (nothing of the
// team is a slash command: scripts/check-team-not-slash.js). Written in TypeScript: `npm run build:ts` compiles it over ceramosadmin.js.
import { SlashCommandBuilder, EmbedBuilder, MessageFlags } from 'discord.js';
import type { ChatInputCommandInteraction } from 'discord.js';
const config = require('../../config') as { ownerId: string };
const { COLORS } = require('../../utils/colors') as { COLORS: { GREEN: number; RED: number } };
const rules = require('../../utils/ceramos') as typeof import('../../utils/ceramos');
const walletDb = require('../../db/ceramos') as typeof import('../../db/ceramos');

/** Only the Petto OWNER changes ceramos by hand (a developer of the team may not): for everybody else this is not a command at all. */
const isOwner = (userId: string | undefined): boolean => String(userId ?? '') === String(config.ownerId);

const ok = (interaction: ChatInputCommandInteraction, content: string) => interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.GREEN).setDescription(`✅ ${content}`)], allowedMentions: { parse: [] } });
const fail = (interaction: ChatInputCommandInteraction, content: string) => interaction.reply({ embeds: [new EmbedBuilder().setColor(COLORS.RED).setDescription(`⚠️ ${content}`)], flags: MessageFlags.Ephemeral as const, allowedMentions: { parse: [] } });

module.exports = {
  prefixOnly: true,
  hiddenFromHelp: true,
  hiddenEverywhere: true,
  teamOnly: true,
  ownerOnly: true,
  team: {
    summary: 'Ceramos by hand: gives ceramos to a person, takes them away (never below zero), or shows a balance. Every change is written in the ledger with the owner as the author.',
    usage: ['!ceramosadmin give <user> <amount> [note]', '!ceramosadmin take <user> <amount> [note]', '!ceramosadmin balance <user>'],
    who: 'owner only (not the developers)',
    area: 'ceramos',
    examples: ['!ceramosadmin give @user 250 contest prize', '!ceramosadmin take @user 50 mistake', '!ceramosadmin balance @user'],
    answers: 'one card: what was done and the new balance, or why it could not be done',
    dangers: 'It changes what a person has in their wallet. A take cannot go below zero: if the person has less, nothing is taken and the answer says so.',
  },
  data: new SlashCommandBuilder()
    .setName('ceramosadmin')
    .setDescription('Private control: give or take ceramos by hand (owner only).')
    .setDMPermission(false)
    .addSubcommand((s) => s.setName('give').setDescription('Give ceramos to a user. Owner only.')
      .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How many').setMinValue(1).setMaxValue(1_000_000).setRequired(true))
      .addStringOption((o) => o.setName('note').setDescription('Why (written in the ledger)').setMaxLength(60).setRequired(false)))
    .addSubcommand((s) => s.setName('take').setDescription('Take ceramos from a user. Owner only.')
      .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))
      .addIntegerOption((o) => o.setName('amount').setDescription('How many').setMinValue(1).setMaxValue(1_000_000).setRequired(true))
      .addStringOption((o) => o.setName('note').setDescription('Why (written in the ledger)').setMaxLength(60).setRequired(false)))
    .addSubcommand((s) => s.setName('balance').setDescription('See the ceramos of a user. Owner only.')
      .addUserOption((o) => o.setName('user').setDescription('Who').setRequired(true))),

  async execute(interaction: ChatInputCommandInteraction): Promise<unknown> {
    // The second lock: the first one is in the message handler, where nobody else gets an answer.
    if (!isOwner(interaction.user?.id)) return undefined;
    const sub = interaction.options.getSubcommand(false);
    try {
      const user = interaction.options.getUser('user', true);
      if (sub === 'balance') {
        const wallet = await walletDb.getWallet(user.id);
        return await ok(interaction, `<@${user.id}> has **${wallet.balance}** ceramos.`);
      }
      const amount = rules.parseAmount(interaction.options.getInteger('amount', true));
      if (amount === null) return await fail(interaction, 'The amount has to be a whole number from 1 to 1,000,000.');
      const note = (interaction.options.getString('note') ?? '').trim().slice(0, 60) || null;
      if (sub === 'give') {
        const balance = await walletDb.give(user.id, amount, 'grant', note, interaction.user.id);
        return await ok(interaction, `Gave **${amount}** ceramos to <@${user.id}>. They have **${balance}**.`);
      }
      if (sub === 'take') {
        const balance = await walletDb.spend(user.id, amount, 'take', note, interaction.user.id);
        if (balance === null) {
          const wallet = await walletDb.getWallet(user.id);
          return await fail(interaction, `<@${user.id}> has only **${wallet.balance}** ceramos; nothing was taken.`);
        }
        return await ok(interaction, `Took **${amount}** ceramos from <@${user.id}>. They have **${balance}**.`);
      }
      return await fail(interaction, 'Use `!ceramosadmin give|take|balance`.');
    } catch (error) {
      console.error('ceramosadmin failed', error); // i18n-ignore: log line
      return fail(interaction, 'The ceramos action failed.');
    }
  },
};
