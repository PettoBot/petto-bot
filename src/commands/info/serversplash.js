// /serversplash: Shows this server's invite splash, with links in every size. A command of its own (it was `/server splash`), registered in each server (the second set of slash commands). The picture is built by utils/serverImages.js.
const { SlashCommandBuilder } = require('discord.js');
const { serverImagePayload } = require('../../utils/serverImages');
const { languageOf } = require('../../i18n');

module.exports = {
  registerSlash: true,
  guildScoped: true,
  data: new SlashCommandBuilder().setName('serversplash').setDMPermission(false).setDescription("Shows this server's invite splash, with links in every size."),
  async execute(interaction) {
    const lang = await languageOf(interaction);
    await interaction.reply(serverImagePayload(interaction.guild, 'splash', lang));
  },
};
